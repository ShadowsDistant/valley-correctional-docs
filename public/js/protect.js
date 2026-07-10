(function () {
  'use strict';
  // Confidential-handbook protection. A determined user can still photograph the
  // screen — no web page can prevent that — so the goal is (1) block the easy
  // capture paths, (2) blur aggressively whenever focus/pointer leaves so a
  // snip tool grabs a blurred frame, and (3) stamp a dense per-user + timestamp
  // watermark so any leaked image is traceable to the account that opened it.
  var doc = document.querySelector('.doc.protected');
  if (!doc) return;
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var username = esc(doc.getAttribute('data-user') || 'staff');
  document.body.classList.add('noprint');

  // --- watermarking ---
  // A single diagonal tiled layer carrying the viewer's username (traceability).
  // It sits at a very low opacity so it's imperceptible to the naked eye and the
  // tiles never overlap — but it re-emerges if a leaked screenshot has its
  // brightness / contrast / saturation cranked up, revealing the account.
  var wm = document.createElement('div');
  wm.className = 'wm-overlay wm-a';
  var cells = '';
  for (var i = 0; i < 320; i++) cells += '<span>' + username + '</span>';
  wm.innerHTML = cells;
  document.body.appendChild(wm);

  // --- blur shield ---
  var shield = document.createElement('div');
  shield.className = 'blur-shield';
  shield.textContent = 'Content hidden — return focus to this window to continue reading.';
  document.body.appendChild(shield);
  var unblurT;
  function setHidden(hidden) {
    clearTimeout(unblurT);
    doc.classList.toggle('blurred', hidden);
    document.body.classList.toggle('blurred', hidden);
  }
  function flashBlur(ms) { setHidden(true); unblurT = setTimeout(function () { setHidden(false); }, ms || 1400); }

  document.addEventListener('visibilitychange', function () { setHidden(document.hidden); });
  window.addEventListener('blur', function () { setHidden(true); });
  window.addEventListener('focus', function () { setHidden(false); });
  // pointer leaving toward the top (toward a snipping toolbar / OS chrome)
  document.addEventListener('mouseleave', function (e) { if (e.clientY <= 0) flashBlur(1600); });
  document.addEventListener('mouseout', function (e) { if (!e.relatedTarget && e.clientY <= 2) flashBlur(1600); });

  // --- block copy / cut / context menu / drag / selection ---
  ['copy', 'cut', 'contextmenu', 'dragstart', 'selectstart'].forEach(function (ev) {
    document.addEventListener(ev, function (e) { e.preventDefault(); return false; });
  });
  // continually clear any selection that slips through
  setInterval(function () { var s = window.getSelection && window.getSelection(); if (s && String(s).length) s.removeAllRanges(); }, 400);

  // --- keyboard: block copy/save/print/view-source; PrintScreen -> blur + clear ---
  document.addEventListener('keydown', function (e) {
    var k = (e.key || '').toLowerCase();
    // Ctrl/Cmd+Shift+S is the browser/OS screenshot shortcut in several browsers.
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && k === 's') {
      e.preventDefault(); flashBlur(1800); flash('Screenshots are logged and traced to your account.'); return false;
    }
    if ((e.ctrlKey || e.metaKey) && (k === 'p' || k === 's' || k === 'c' || k === 'u' || k === 'a')) {
      e.preventDefault(); flash('That action is disabled on confidential documents.'); return false;
    }
    if (e.key === 'PrintScreen' || (e.metaKey && e.shiftKey)) {
      try { navigator.clipboard && navigator.clipboard.writeText(''); } catch (x) {}
      flashBlur(1800);
      flash('Screenshots are logged and traced to your account.');
    }
  });
  window.addEventListener('keyup', function (e) {
    if (e.key === 'PrintScreen') { try { navigator.clipboard && navigator.clipboard.writeText(''); } catch (x) {} }
  });
  window.addEventListener('beforeprint', function () { setHidden(true); });
  window.addEventListener('afterprint', function () { setHidden(false); });

  // --- toast ---
  var toast;
  function flash(msg) {
    if (!toast) {
      toast = document.createElement('div');
      toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:120;'
        + 'background:#1c1917;color:#fff;padding:10px 16px;border-radius:8px;font:13px system-ui;'
        + 'box-shadow:0 8px 24px rgba(0,0,0,.4);opacity:0;transition:opacity .2s;pointer-events:none';
      document.body.appendChild(toast);
    }
    toast.textContent = msg; toast.style.opacity = '1';
    clearTimeout(toast._t); toast._t = setTimeout(function () { toast.style.opacity = '0'; }, 1800);
  }
})();
