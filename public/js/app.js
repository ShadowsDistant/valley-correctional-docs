(function () {
  'use strict';

  // ---------- mobile sidebar ----------
  var menuBtn = document.getElementById('menuToggle');
  var sidebar = document.getElementById('sidebar');
  var scrim = document.getElementById('scrim');
  function closeNav() { if (sidebar) sidebar.classList.remove('open'); if (scrim) scrim.classList.remove('show'); }
  if (menuBtn && sidebar) {
    menuBtn.addEventListener('click', function () {
      sidebar.classList.toggle('open');
      if (scrim) scrim.classList.toggle('show');
    });
  }
  if (scrim) scrim.addEventListener('click', closeNav);

  // ---------- account dropdown ----------
  var acctBtn = document.getElementById('accountBtn');
  var acctDrop = document.getElementById('accountDropdown');
  if (acctBtn && acctDrop) {
    acctBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = acctDrop.hidden;
      acctDrop.hidden = !open;
      acctBtn.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', function (e) {
      if (!acctDrop.hidden && !acctDrop.contains(e.target) && e.target !== acctBtn) {
        acctDrop.hidden = true; acctBtn.setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { acctDrop.hidden = true; acctBtn.setAttribute('aria-expanded', 'false'); } });
  }

  // ---------- search ----------
  var input = document.getElementById('searchInput');
  var box = document.getElementById('searchResults');
  var index = null, loading = false, activeIdx = -1, current = [];

  function loadIndex() {
    if (index || loading) return;
    loading = true;
    fetch('/search-index.json').then(function (r) { return r.json(); }).then(function (data) {
      index = data.map(function (p) {
        p._hay = ((p.title || '') + ' ' + (p.group || '') + ' ' + (p.description || '') + ' ' + (p.text || '')).toLowerCase();
        p._t = (p.title || '').toLowerCase();
        return p;
      });
      loading = false;
      // If the user typed while the index was still loading, answer them now.
      if (input && input.value.trim()) render(search(input.value));
    }).catch(function () { loading = false; });
  }

  function esc(s) { return String(s).replace(/[<>&]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]; }); }
  function escAttr(s) { return esc(s).replace(/"/g, '&quot;'); }
  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // Highlight query terms inside a plain-text string. Escapes first, then wraps
  // matches in <mark> in a single pass (no double-marking inside inserted tags).
  function highlight(text, terms) {
    var out = esc(text);
    var safe = terms.map(escRe).filter(Boolean);
    if (!safe.length) return out;
    var re = new RegExp('(' + safe.join('|') + ')', 'ig');
    return out.replace(re, '<mark>$1</mark>');
  }

  // Build a ~140-char snippet centered on the first matching term.
  function snippet(p, terms) {
    var text = p.text || p.description || '';
    var low = text.toLowerCase(), pos = -1;
    for (var i = 0; i < terms.length; i++) { var q = low.indexOf(terms[i]); if (q !== -1 && (pos === -1 || q < pos)) pos = q; }
    if (pos === -1) return highlight(text.slice(0, 140), terms) + (text.length > 140 ? '…' : '');
    var start = Math.max(0, pos - 55), end = Math.min(text.length, pos + 90);
    return (start > 0 ? '…' : '') + highlight(text.slice(start, end), terms) + (end < text.length ? '…' : '');
  }

  function search(q) {
    if (!index) return [];
    q = q.toLowerCase().trim();
    if (!q) return [];
    var terms = q.split(/\s+/).filter(Boolean);
    var scored = [];
    index.forEach(function (p) {
      var ok = terms.every(function (t) { return p._hay.indexOf(t) !== -1; });
      if (!ok) return;
      var score = 0;
      terms.forEach(function (t) {
        if (p._t === q) score += 100;
        if (p._t.indexOf(t) !== -1) score += 12;
        if ((p.description || '').toLowerCase().indexOf(t) !== -1) score += 4;
        score += 1;
      });
      var hs = (p.headings || []).filter(function (h) {
        var hl = h.text.toLowerCase();
        return terms.some(function (t) { return hl.indexOf(t) !== -1; });
      }).slice(0, 3);
      score += hs.length * 3;
      scored.push({ p: p, score: score, headings: hs, terms: terms });
    });
    scored.sort(function (a, b) { return b.score - a.score; });
    return scored.slice(0, 8);
  }

  function render(results) {
    activeIdx = -1;
    current = results.map(function (r) { return { url: '/' + r.p.slug }; });
    if (!results.length) { box.innerHTML = '<div class="sr-empty">No results</div>'; box.hidden = false; return; }
    box.innerHTML = results.map(function (r, i) {
      var p = r.p;
      var heads = r.headings.map(function (h) {
        return '<a class="sr-head" href="/' + escAttr(p.slug) + '#' + escAttr(h.id) + '"># ' + highlight(h.text, r.terms) + '</a>';
      }).join('');
      return '<div class="sr-row" data-i="' + i + '">'
        + '<a class="sr-main" href="/' + escAttr(p.slug) + '">'
        + '<div class="sr-title">' + (p.internal ? '<span class="ic ic-lock"></span> ' : '') + esc(p.title) + '</div>'
        + '<div class="sr-group">' + esc(p.group || 'General') + '</div>'
        + '<div class="sr-snippet">' + snippet(p, r.terms) + '</div></a>'
        + (heads ? '<div class="sr-heads">' + heads + '</div>' : '') + '</div>';
    }).join('');
    box.hidden = false;
  }

  function setActive(i) {
    var rows = box.querySelectorAll('.sr-row');
    rows.forEach(function (l) { l.classList.remove('active'); });
    if (i >= 0 && i < rows.length) { rows[i].classList.add('active'); rows[i].scrollIntoView({ block: 'nearest' }); }
    activeIdx = i;
  }

  if (input && box) {
    input.addEventListener('focus', loadIndex);
    input.addEventListener('input', function () {
      loadIndex(); // belt & braces — some environments never fire focus
      if (input.value.trim()) render(search(input.value)); else box.hidden = true;
    });
    input.addEventListener('keydown', function (e) {
      if (box.hidden) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(activeIdx + 1, current.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(activeIdx - 1, 0)); }
      else if (e.key === 'Enter') { var i = activeIdx >= 0 ? activeIdx : 0; if (current[i]) window.location.href = current[i].url; }
      else if (e.key === 'Escape') { box.hidden = true; input.blur(); }
    });
    document.addEventListener('click', function (e) {
      if (!box.contains(e.target) && e.target !== input) box.hidden = true;
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === '/' && document.activeElement !== input && !/input|textarea/i.test((document.activeElement || {}).tagName || '')) {
        e.preventDefault(); input.focus();
      }
    });
  }

  // ---------- custom confirm modal ----------
  // Any <form data-confirm="message"> asks for confirmation in a styled modal
  // instead of the browser's confirm(). Optional: data-confirm-title,
  // data-confirm-ok, data-confirm-variant="danger".
  var WARN_SVG = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4 2.6 20.5h18.8L12 4Z"/><path d="M12 10v4M12 17.5h.01"/></svg>';
  function showConfirm(opts, onOk) {
    // never stack modals — drop any that's still open/closing
    var prev = document.querySelectorAll('.confirm-back'); for (var i = 0; i < prev.length; i++) prev[i].remove();
    var back = document.createElement('div');
    back.className = 'confirm-back';
    var danger = opts.danger !== false;
    back.innerHTML =
      '<div class="confirm-card" role="alertdialog" aria-modal="true">'
      + '<div class="confirm-ico' + (danger ? ' danger' : '') + '">' + WARN_SVG + '</div>'
      + '<h3>' + esc(opts.title || 'Are you sure?') + '</h3>'
      + '<p>' + esc(opts.message || '') + '</p>'
      + '<div class="confirm-actions">'
      + '<button type="button" class="btn btn-ghost" data-cancel>Cancel</button>'
      + '<button type="button" class="btn btn-solid ' + (danger ? 'danger' : '') + '" data-ok>' + esc(opts.okLabel || 'Confirm') + '</button>'
      + '</div></div>';
    document.body.appendChild(back);
    var okBtn = back.querySelector('[data-ok]');
    function close() { back.classList.add('closing'); setTimeout(function () { back.remove(); }, 150); document.removeEventListener('keydown', key); }
    function key(e) { if (e.key === 'Escape') close(); else if (e.key === 'Enter') { close(); onOk(); } }
    back.querySelector('[data-cancel]').addEventListener('click', close);
    okBtn.addEventListener('click', function () { close(); onOk(); });
    back.addEventListener('mousedown', function (e) { if (e.target === back) close(); });
    document.addEventListener('keydown', key);
    setTimeout(function () { okBtn.focus(); }, 30);
  }
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (form && form.matches && form.matches('form[data-confirm]')) {
      e.preventDefault();
      showConfirm({
        title: form.getAttribute('data-confirm-title') || 'Please confirm',
        message: form.getAttribute('data-confirm'),
        okLabel: form.getAttribute('data-confirm-ok') || 'Confirm',
        danger: form.getAttribute('data-confirm-variant') !== 'safe'
      }, function () { form.submit(); });
    }
  }, true);

  // ---------- button click ripple ----------
  if (window.matchMedia && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.addEventListener('pointerdown', function (e) {
      var b = e.target.closest && e.target.closest('.btn, .clause-btn, .wz-btn, .cdate-nav');
      if (!b || b.disabled) return;
      var r = b.getBoundingClientRect();
      var d = Math.max(r.width, r.height) * 1.4;
      var s = document.createElement('span');
      s.className = 'ripple';
      s.style.width = s.style.height = d + 'px';
      s.style.left = (e.clientX - r.left - d / 2) + 'px';
      s.style.top = (e.clientY - r.top - d / 2) + 'px';
      if (getComputedStyle(b).position === 'static') b.style.position = 'relative';
      b.appendChild(s);
      setTimeout(function () { s.remove(); }, 520);
    });
  }

  // ---------- relative timestamps ----------
  // <time data-time="2026-07-10 12:00:00"> (UTC) -> "1 hour ago", exact on hover.
  function ago(d) {
    var s = Math.floor((Date.now() - d.getTime()) / 1000);
    if (s < 0) s = 0;
    if (s < 45) return 'just now';
    var units = [['minute', 60], ['hour', 60], ['day', 24], ['month', 30], ['year', 12]];
    var val = s / 60, i = 0;
    for (; i < units.length - 1 && val >= units[i + 1][1]; i++) val /= units[i + 1][1];
    var n = Math.floor(val), label = units[i][0];
    return n + ' ' + label + (n === 1 ? '' : 's') + ' ago';
  }
  function fillTime(el) {
    var raw = el.getAttribute('data-time');
    if (!raw) return;
    var iso = raw.trim().replace(' ', 'T');
    if (!/[zZ]|[+][0-9]/.test(iso)) iso += 'Z'; // DB times are UTC
    var d = new Date(iso);
    if (isNaN(d.getTime())) return;
    el.title = d.toLocaleString();
    el.textContent = ago(d);
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-time]'), fillTime);
  window.fillTimes = function () { Array.prototype.forEach.call(document.querySelectorAll('[data-time]'), fillTime); };

  // ---------- roblox headshot avatars ----------
  // Any [data-rbx-avatar="username"] element gets the user's Roblox headshot as
  // a background image (falls back to the existing initial). Batched in one call.
  (function () {
    var els = Array.prototype.slice.call(document.querySelectorAll('[data-rbx-avatar]'));
    if (!els.length) return;
    var names = {}; els.forEach(function (el) { var n = (el.getAttribute('data-rbx-avatar') || '').trim(); if (n) names[n.toLowerCase()] = n; });
    var list = Object.values(names); if (!list.length) return;
    fetch('/api/roblox-thumbs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usernames: list }) })
      .then(function (r) { return r.json(); }).then(function (d) {
        if (!d.ok || !d.avatars) return;
        els.forEach(function (el) {
          var url = d.avatars[(el.getAttribute('data-rbx-avatar') || '').toLowerCase()];
          if (url) { el.style.backgroundImage = 'url("' + url + '")'; el.style.backgroundSize = 'cover'; el.style.backgroundPosition = 'center'; el.classList.add('has-rbx'); }
        });
      }).catch(function () {});
  })();

  // ---------- TOC scrollspy ----------
  var tocLinks = Array.prototype.slice.call(document.querySelectorAll('.toc a'));
  if (tocLinks.length && 'IntersectionObserver' in window) {
    var map = {};
    tocLinks.forEach(function (a) { map[a.getAttribute('href').slice(1)] = a; });
    var headings = Object.keys(map).map(function (id) { return document.getElementById(id); }).filter(Boolean);
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          tocLinks.forEach(function (l) { l.classList.remove('active'); });
          var a = map[en.target.id];
          if (a) a.classList.add('active');
        }
      });
    }, { rootMargin: '-80px 0px -70% 0px', threshold: 0 });
    headings.forEach(function (h) { obs.observe(h); });
  }
})();
