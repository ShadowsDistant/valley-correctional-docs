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

// Registration: the client already extracted the SPKI key + alg via
// getPublicKey()/getPublicKeyAlgorithm(). We just validate the ceremony.
function verifyRegistration({ clientDataJSON, credentialId, publicKeySpki, algorithm }, { challenge, origins }) {
  const cd = checkClientData(clientDataJSON, 'webauthn.create', challenge, origins);
  if (!cd.ok) return cd;
  if (!credentialId || !publicKeySpki) return { ok: false, error: 'Missing credential.' };
  // sanity: the stored SPKI must be a key crypto can import
  try { crypto.createPublicKey({ key: b64url.decode(publicKeySpki), format: 'der', type: 'spki' }); }
  catch (e) { return { ok: false, error: 'Unusable public key.' }; }
  return { ok: true, credentialId, publicKeySpki, algorithm: Number(algorithm) || -7 };
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
