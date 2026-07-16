'use strict';
// Minimal, dependency-free WebAuthn (passkey) verification.
//
// We deliberately avoid attestation/CBOR: the browser's
// AuthenticatorAttestationResponse.getPublicKey() hands us the credential's
// public key already in SPKI DER, which Node's crypto can verify against
// directly. We only use passkeys as a second factor (proof of possession),
// so authenticator attestation (which model of key it is) is irrelevant.
//
// Registration: verify clientDataJSON (type/challenge/origin), then store the
// SPKI key + credential id the client extracted.
// Authentication: verify clientDataJSON, the RP-ID hash, the user-present
// flag, and the signature over (authenticatorData || sha256(clientDataJSON)).

const crypto = require('crypto');

const b64url = {
  encode(buf) { return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
  decode(str) { return Buffer.from(String(str).replace(/-/g, '+').replace(/_/g, '/'), 'base64'); },
};

function randomChallenge() { return b64url.encode(crypto.randomBytes(32)); }

// Parse and validate the clientDataJSON blob common to both ceremonies.
function checkClientData(clientDataJSONb64, expectType, expectChallenge, allowedOrigins) {
  let data;
  try { data = JSON.parse(b64url.decode(clientDataJSONb64).toString('utf8')); }
  catch (e) { return { ok: false, error: 'Malformed client data.' }; }
  if (data.type !== expectType) return { ok: false, error: 'Unexpected ceremony type.' };
  // constant-time-ish challenge compare
  const a = Buffer.from(String(data.challenge || ''));
  const b = Buffer.from(String(expectChallenge || ''));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, error: 'Challenge mismatch.' };
  if (!allowedOrigins.includes(data.origin)) return { ok: false, error: 'Origin mismatch (' + data.origin + ').' };
  return { ok: true };
}

// authenticatorData layout: rpIdHash(32) | flags(1) | signCount(4) | ...
function parseAuthData(buf) {
  if (buf.length < 37) return null;
  return {
    rpIdHash: buf.subarray(0, 32),
    flags: buf[32],
    userPresent: !!(buf[32] & 0x01),
    userVerified: !!(buf[32] & 0x04),
    counter: buf.readUInt32BE(33),
  };
}

// --- minimal CBOR decoder (enough for attestationObject + COSE keys) --------
// Returns [value, nextOffset]. Handles unsigned/negative ints, byte/text
// strings, arrays, maps, tags, and the simple values we might meet.
function cborDecode(buf, off) {
  const first = buf[off]; const major = first >> 5; const info = first & 0x1f; off += 1;
  function len(info) {
    if (info < 24) return [info, off];
    if (info === 24) return [buf[off], off + 1];
    if (info === 25) return [buf.readUInt16BE(off), off + 2];
    if (info === 26) return [buf.readUInt32BE(off), off + 4];
    if (info === 27) return [Number(buf.readBigUInt64BE(off)), off + 8];
    throw new Error('cbor length');
  }
  let l, o;
  switch (major) {
    case 0: [l, o] = len(info); return [l, o];
    case 1: [l, o] = len(info); return [-1 - l, o];
    case 2: [l, o] = len(info); return [buf.subarray(o, o + l), o + l];
    case 3: [l, o] = len(info); return [buf.toString('utf8', o, o + l), o + l];
    case 4: { [l, o] = len(info); const a = []; for (let i = 0; i < l; i++) { const [v, no] = cborDecode(buf, o); a.push(v); o = no; } return [a, o]; }
    case 5: { [l, o] = len(info); const m = new Map(); for (let i = 0; i < l; i++) { const [k, ko] = cborDecode(buf, o); const [v, vo] = cborDecode(buf, ko); m.set(k, v); o = vo; } return [m, o]; }
    case 6: [l, o] = len(info); return cborDecode(buf, o); // tag — skip to content
    case 7:
      if (info === 20) return [false, off]; if (info === 21) return [true, off];
      if (info === 22) return [null, off]; if (info === 23) return [undefined, off];
      throw new Error('cbor simple/float unsupported');
    default: throw new Error('cbor major ' + major);
  }
}

// Convert a COSE public key (from the attestation) to a Node KeyObject via JWK.
// This is what makes registration work with EVERY authenticator — including
// Windows Hello and Bitwarden, which don't implement the browser's
// getPublicKey() convenience method.
function coseToKey(cose) {
  const kty = cose.get(1), alg = cose.get(3);
  if (kty === 2) { // EC2
    const crv = { 1: 'P-256', 2: 'P-384', 3: 'P-521' }[cose.get(-1)];
    if (!crv) throw new Error('Unsupported curve');
    const jwk = { kty: 'EC', crv, x: b64url.encode(cose.get(-2)), y: b64url.encode(cose.get(-3)) };
    return { key: crypto.createPublicKey({ key: jwk, format: 'jwk' }), alg: alg || -7 };
  }
  if (kty === 3) { // RSA
    const jwk = { kty: 'RSA', n: b64url.encode(cose.get(-1)), e: b64url.encode(cose.get(-2)) };
    return { key: crypto.createPublicKey({ key: jwk, format: 'jwk' }), alg: alg || -257 };
  }
  throw new Error('Unsupported key type ' + kty);
}

// Registration: verify the ceremony, then parse the attestationObject to pull
// out the credential id + public key ourselves (no getPublicKey() reliance).
function verifyRegistration({ clientDataJSON, attestationObject }, { challenge, origins }) {
  const cd = checkClientData(clientDataJSON, 'webauthn.create', challenge, origins);
  if (!cd.ok) return cd;
  if (!attestationObject) return { ok: false, error: 'Missing attestation.' };
  let att, authData;
  try { [att] = cborDecode(b64url.decode(attestationObject), 0); authData = att.get('authData'); }
  catch (e) { return { ok: false, error: 'Could not read attestation.' }; }
  if (!Buffer.isBuffer(authData) || authData.length < 55) return { ok: false, error: 'Malformed attestation.' };
  const flags = authData[32];
  if (!(flags & 0x40)) return { ok: false, error: 'Authenticator returned no credential data.' };
  let o = 37;
  o += 16;                                    // AAGUID
  const credIdLen = authData.readUInt16BE(o); o += 2;
  const credId = authData.subarray(o, o + credIdLen); o += credIdLen;
  let pub;
  try { const [cose] = cborDecode(authData, o); pub = coseToKey(cose); }
  catch (e) { return { ok: false, error: 'Unsupported passkey type (' + e.message + ').' }; }
  const spki = pub.key.export({ format: 'der', type: 'spki' });
  return {
    ok: true,
    credentialId: b64url.encode(credId),
    publicKeySpki: b64url.encode(spki),
    algorithm: pub.alg,
    counter: authData.readUInt32BE(33),
  };
}

// Authentication: verify the assertion signature against a stored credential.
function verifyAuthentication({ clientDataJSON, authenticatorData, signature }, cred, { challenge, origins, rpId }) {
  const cd = checkClientData(clientDataJSON, 'webauthn.get', challenge, origins);
  if (!cd.ok) return cd;

  const authData = b64url.decode(authenticatorData);
  const parsed = parseAuthData(authData);
  if (!parsed) return { ok: false, error: 'Malformed authenticator data.' };
  if (!parsed.userPresent) return { ok: false, error: 'User presence not confirmed.' };

  const expectHash = crypto.createHash('sha256').update(rpId).digest();
  if (!crypto.timingSafeEqual(parsed.rpIdHash, expectHash)) return { ok: false, error: 'RP ID hash mismatch.' };

  // signed data = authenticatorData || SHA-256(clientDataJSON)
  const clientHash = crypto.createHash('sha256').update(b64url.decode(clientDataJSON)).digest();
  const signed = Buffer.concat([authData, clientHash]);

  let key;
  try { key = crypto.createPublicKey({ key: b64url.decode(cred.public_key), format: 'der', type: 'spki' }); }
  catch (e) { return { ok: false, error: 'Stored key unusable.' }; }

  let valid = false;
  try {
    if (cred.alg === -257) {
      // RS256
      valid = crypto.verify('sha256', signed, key, b64url.decode(signature));
    } else {
      // ES256 (and other EC) — WebAuthn signatures are DER-encoded ECDSA,
      // which is exactly what crypto.verify expects by default.
      valid = crypto.verify('sha256', signed, { key, dsaEncoding: 'der' }, b64url.decode(signature));
    }
  } catch (e) { return { ok: false, error: 'Signature check failed.' }; }
  if (!valid) return { ok: false, error: 'Invalid signature.' };

  // Clone detection: a well-behaved authenticator's counter only moves forward.
  // Many (esp. platform passkeys) always report 0 — only enforce when both are
  // non-zero.
  if (parsed.counter > 0 && cred.counter > 0 && parsed.counter <= cred.counter) {
    return { ok: false, error: 'Counter regression — possible cloned key.' };
  }
  return { ok: true, counter: parsed.counter };
}

module.exports = { b64url, randomChallenge, verifyRegistration, verifyAuthentication };
