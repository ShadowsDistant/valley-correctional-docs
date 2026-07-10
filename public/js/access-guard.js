(function () {
  'use strict';
  // Realtime access guard for logged-in users. Polls the server; if the account
  // is suspended or loses access to the page currently open, it locks the page
  // behind an access-denied screen immediately (no refresh needed).
  var slug = location.pathname.replace(/^\/+|\/+$/g, '');
  var locked = false;

  function lock(suspended) {
    if (locked) return; locked = true;
    document.documentElement.classList.add('access-locked');
    var o = document.createElement('div');
    o.className = 'access-lock';
    o.innerHTML =
      '<div class="access-lock-box">'
      + '<div class="access-lock-ico"><span class="ic ic-lock"></span></div>'
      + '<h1>' + (suspended ? 'Account suspended' : 'Access revoked') + '</h1>'
      + '<p>' + (suspended
        ? 'Your account has been suspended by an administrator. Your access has been revoked.'
        : 'An administrator changed your access to this document while you were viewing it.') + '</p>'
      + '<div class="access-lock-actions">'
      + '<a class="btn btn-solid" href="/home">Return to documentation</a>'
      + (suspended ? '<form method="post" action="/logout" style="display:inline"><button class="btn btn-ghost" type="submit">Log out</button></form>' : '')
      + '</div></div>';
    document.body.appendChild(o);
  }

  function check() {
    if (locked) return;
    fetch('/api/access?slug=' + encodeURIComponent(slug), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d && d.ok === false) lock(!!d.suspended); })
      .catch(function () {});
  }

  var timer = setInterval(check, 5000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) check(); });
  window.addEventListener('focus', check);
  check();
})();
