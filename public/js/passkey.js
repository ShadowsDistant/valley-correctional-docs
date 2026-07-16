// Client half of the passkey (WebAuthn) flow. Pure browser API — no library.
(function () {
  'use strict';
  if (!window.PublicKeyCredential) { window.vcfPasskey = { supported: false }; return; }

  function b64urlToBuf(s) {
    s = String(s).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s), buf = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return buf.buffer;
  }
  function bufToB64url(buf) {
    var bytes = new Uint8Array(buf), bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function csrf() {
    var m = document.querySelector('input[name="_csrf"]');
    return m ? m.value : '';
  }

  // Enroll a new passkey on the current (already signed-in) account.
  function register(name) {
    return fetch('/account/passkey/register/options', { method: 'POST', headers: { 'X-Requested-With': 'fetch' } })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) throw new Error(d.error || 'Could not start enrollment.');
        var o = d.options;
        var pub = {
          challenge: b64urlToBuf(o.challenge),
          rp: o.rp,
          user: { id: b64urlToBuf(o.user.id), name: o.user.name, displayName: o.user.displayName },
          pubKeyCredParams: o.pubKeyCredParams,
          authenticatorSelection: o.authenticatorSelection,
          timeout: o.timeout,
          attestation: o.attestation,
          excludeCredentials: (o.excludeCredentials || []).map(function (c) { return { id: b64urlToBuf(c.id), type: 'public-key' }; }),
        };
        return navigator.credentials.create({ publicKey: pub });
      })
      .then(function (cred) {
        var resp = cred.response;
        // Send the raw attestationObject — the server parses the public key out
        // of it, so this works with authenticators (Bitwarden, Windows Hello)
        // that don't implement the getPublicKey() convenience method.
        return fetch('/account/passkey/register/verify', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
          body: JSON.stringify({
            attestationObject: bufToB64url(resp.attestationObject),
            clientDataJSON: bufToB64url(resp.clientDataJSON),
            name: name || '',
          }),
        }).then(function (r) { return r.json(); });
      });
  }

  // Complete a passkey-gated login. `step` = { rpId, challenge, allow[] }.
  function login(step) {
    var pub = {
      challenge: b64urlToBuf(step.challenge),
      rpId: step.rpId,
      timeout: 60000,
      userVerification: 'preferred',
      allowCredentials: (step.allow || []).map(function (id) { return { id: b64urlToBuf(id), type: 'public-key' }; }),
    };
    return navigator.credentials.get({ publicKey: pub }).then(function (assertion) {
      var r = assertion.response;
      return fetch('/login/passkey/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credentialId: bufToB64url(assertion.rawId),
          clientDataJSON: bufToB64url(r.clientDataJSON),
          authenticatorData: bufToB64url(r.authenticatorData),
          signature: bufToB64url(r.signature),
        }),
      }).then(function (res) { return res.json(); });
    });
  }

  window.vcfPasskey = { supported: true, register: register, login: login, csrf: csrf };
})();
