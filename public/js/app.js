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
    var acctMenu = acctBtn.closest('.account-menu');
    function setOpen(open) { acctDrop.hidden = !open; acctBtn.setAttribute('aria-expanded', String(open)); if (acctMenu) acctMenu.classList.toggle('open', open); }
    acctBtn.addEventListener('click', function (e) { e.stopPropagation(); setOpen(acctDrop.hidden); });
    document.addEventListener('click', function (e) {
      if (!acctDrop.hidden && !acctDrop.contains(e.target) && e.target !== acctBtn) setOpen(false);
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setOpen(false); });
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

  // Edit-distance-1 check for typo tolerance ("moderaton" still finds
  // Moderation). Only applied to terms of 5+ chars against page words.
  function near(word, term) {
    var la = word.length, lb = term.length;
    if (Math.abs(la - lb) > 1) return false;
    var i = 0, j = 0, edits = 0;
    while (i < la && j < lb) {
      if (word[i] === term[j]) { i++; j++; continue; }
      if (++edits > 1) return false;
      if (la > lb) i++; else if (lb > la) j++; else { i++; j++; }
    }
    return edits + (la - i) + (lb - j) <= 1;
  }
  function termMatch(p, t) {
    if (p._hay.indexOf(t) !== -1) return 1;                 // exact / prefix substring
    if (t.length >= 5) {                                     // typo tolerance
      var words = p._words || (p._words = p._hay.split(/[^a-z0-9]+/));
      for (var i = 0; i < words.length; i++) if (words[i].length >= 4 && near(words[i], t)) return 0.5;
    }
    return 0;
  }
  function search(q) {
    if (!index) return [];
    q = q.toLowerCase().trim();
    if (!q) return [];
    var terms = q.split(/\s+/).filter(Boolean);
    var scored = [];
    index.forEach(function (p) {
      var quality = 0;
      for (var i = 0; i < terms.length; i++) {
        var m = termMatch(p, terms[i]);
        if (!m) return; // every term must match (exactly or fuzzily)
        quality += m;
      }
      var score = quality;
      terms.forEach(function (t) {
        if (p._t === q) score += 100;
        if (p._t.indexOf(t) === 0) score += 8;              // title starts with term
        if (p._t.indexOf(t) !== -1) score += 12;
        if ((p.description || '').toLowerCase().indexOf(t) !== -1) score += 4;
      });
      var hs = (p.headings || []).filter(function (h) {
        var hl = h.text.toLowerCase();
        return terms.some(function (t) { return hl.indexOf(t) !== -1; });
      }).slice(0, 3);
      score += hs.length * 4;
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
    // opts.input: show a required textarea and pass its value to onOk(value)
    back.innerHTML =
      '<div class="confirm-card" role="alertdialog" aria-modal="true">'
      + '<div class="confirm-ico' + (danger ? ' danger' : '') + '">' + WARN_SVG + '</div>'
      + '<h3>' + esc(opts.title || 'Are you sure?') + '</h3>'
      + '<p>' + esc(opts.message || '') + '</p>'
      + (opts.input ? '<textarea class="confirm-input" rows="3" placeholder="' + esc(opts.inputPlaceholder || 'Reason…') + '"></textarea>' : '')
      + '<div class="confirm-actions">'
      + '<button type="button" class="btn btn-ghost" data-cancel>Cancel</button>'
      + '<button type="button" class="btn btn-solid ' + (danger ? 'danger' : '') + '" data-ok>' + esc(opts.okLabel || 'Confirm') + '</button>'
      + '</div></div>';
    document.body.appendChild(back);
    var okBtn = back.querySelector('[data-ok]');
    var input = back.querySelector('.confirm-input');
    function ok() {
      if (input && !input.value.trim()) { input.classList.add('input-error'); input.focus(); return; }
      close(); onOk(input ? input.value.trim() : undefined);
    }
    function close() { back.classList.add('closing'); setTimeout(function () { back.remove(); }, 150); document.removeEventListener('keydown', key); }
    function key(e) { if (e.key === 'Escape') close(); else if (e.key === 'Enter' && !(input && e.target === input)) { ok(); } }
    back.querySelector('[data-cancel]').addEventListener('click', close);
    okBtn.addEventListener('click', ok);
    back.addEventListener('mousedown', function (e) { if (e.target === back) close(); });
    document.addEventListener('keydown', key);
    setTimeout(function () { (input || okBtn).focus(); }, 30);
  }
  window.vcfConfirm = showConfirm; // reusable by page scripts (dashboard voids, editor)
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (form && form.matches && form.matches('form[data-confirm]')) {
      e.preventDefault();
      var wantsInput = form.hasAttribute('data-confirm-input');
      showConfirm({
        title: form.getAttribute('data-confirm-title') || 'Please confirm',
        message: form.getAttribute('data-confirm'),
        okLabel: form.getAttribute('data-confirm-ok') || 'Confirm',
        danger: form.getAttribute('data-confirm-variant') !== 'safe',
        input: wantsInput,
        inputPlaceholder: form.getAttribute('data-confirm-input') || 'Reason…'
      }, function (val) {
        if (wantsInput) {
          var name = form.getAttribute('data-confirm-input-name') || 'reason';
          var hidden = form.querySelector('input[name="' + name + '"]');
          if (!hidden) { hidden = document.createElement('input'); hidden.type = 'hidden'; hidden.name = name; form.appendChild(hidden); }
          hidden.value = val || '';
        }
        form.submit();
      });
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
  function parseUtc(raw) {
    if (!raw) return null;
    var iso = raw.trim().replace(' ', 'T');
    if (!/[zZ]|[+][0-9]/.test(iso)) iso += 'Z'; // DB times are UTC
    var d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  }
  function tzName() {
    try { return new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' }).formatToParts(new Date()).filter(function (p) { return p.type === 'timeZoneName'; })[0].value; } catch (e) { return ''; }
  }
  function fillTime(el) {
    var d = parseUtc(el.getAttribute('data-time'));
    if (!d) return;
    el.setAttribute('data-tip', d.toLocaleString()); // exact time in the custom tooltip on hover
    // data-time-format: relative (default) | date | range | datetime — all
    // rendered in the viewer's local timezone.
    var fmt = el.getAttribute('data-time-format');
    if (fmt === 'date') {
      el.textContent = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    } else if (fmt === 'range') {
      var t = function (x) { return x.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); };
      var end = parseUtc(el.getAttribute('data-time-end'));
      el.textContent = t(d) + (end ? ' – ' + t(end) : '') + ' ' + tzName();
    } else if (fmt === 'datetime') {
      el.textContent = d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    } else {
      el.textContent = ago(d);
    }
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-time]'), fillTime);
  window.fillTimes = function () { Array.prototype.forEach.call(document.querySelectorAll('[data-time]'), fillTime); };

  // Report the viewer's timezone once per tab session (staff overview display).
  if (document.body.hasAttribute('data-authed') && !sessionStorage.getItem('tzSent')) {
    try {
      var tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz) fetch('/api/tz', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tz: tz }) })
        .then(function () { sessionStorage.setItem('tzSent', '1'); }).catch(function () {});
    } catch (e) {}
  }

  // ---------- roblox headshot avatars ----------
  // Any [data-rbx-avatar="username"] element gets the user's Roblox headshot as
  // a background image (falls back to the existing initial). Batched in one call.
  function loadAvatars(root) {
    var els = Array.prototype.slice.call((root || document).querySelectorAll('[data-rbx-avatar]'));
    if (!els.length) return;
    var CK = 'rbxAv', cache = {};
    try { cache = JSON.parse(sessionStorage.getItem(CK) || '{}') || {}; } catch (e) { cache = {}; }
    function paint(el, url) { if (url) { el.style.backgroundImage = 'url("' + url + '")'; el.style.backgroundSize = 'cover'; el.style.backgroundPosition = 'center'; el.classList.add('has-rbx'); } }
    var names = {}, need = [];
    els.forEach(function (el) {
      var n = (el.getAttribute('data-rbx-avatar') || '').trim().toLowerCase(); if (!n) return;
      names[n] = 1;
      if (n in cache) paint(el, cache[n]);
    });
    Object.keys(names).forEach(function (n) { if (!(n in cache)) need.push(n); });
    if (!need.length) return;
    fetch('/api/roblox-thumbs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usernames: need }) })
      .then(function (r) { return r.json(); }).then(function (d) {
        if (!d.ok || !d.avatars) return;
        need.forEach(function (n) { cache[n] = d.avatars[n] || ''; });
        try { sessionStorage.setItem(CK, JSON.stringify(cache)); } catch (e) {}
        els.forEach(function (el) { paint(el, d.avatars[(el.getAttribute('data-rbx-avatar') || '').toLowerCase()]); });
      }).catch(function () {});
  }
  window.vcfLoadAvatars = loadAvatars;
  loadAvatars();

  // ---------- custom tooltips ----------
  // Any element with data-tip="…" gets a styled tooltip on hover/focus.
  // Optional data-tip-pos = top | bottom | left | right (default top).
  (function () {
    var tip = null, showT = null, curEl = null;
    function make() { if (!tip) { tip = document.createElement('div'); tip.className = 'vcf-tip'; tip.setAttribute('role', 'tooltip'); document.body.appendChild(tip); } return tip; }
    function place(el) {
      var t = make(); t.textContent = el.getAttribute('data-tip');
      var pos = el.getAttribute('data-tip-pos') || 'top';
      t.className = 'vcf-tip pos-' + pos + ' show';
      var r = el.getBoundingClientRect(), tr = t.getBoundingClientRect(), gap = 8;
      var x, y;
      if (pos === 'bottom') { x = r.left + r.width / 2 - tr.width / 2; y = r.bottom + gap; }
      else if (pos === 'left') { x = r.left - tr.width - gap; y = r.top + r.height / 2 - tr.height / 2; }
      else if (pos === 'right') { x = r.right + gap; y = r.top + r.height / 2 - tr.height / 2; }
      else { x = r.left + r.width / 2 - tr.width / 2; y = r.top - tr.height - gap; }
      x = Math.max(6, Math.min(x, window.innerWidth - tr.width - 6));
      y = Math.max(6, Math.min(y, window.innerHeight - tr.height - 6));
      t.style.left = x + 'px'; t.style.top = y + 'px';
    }
    function show(el) { clearTimeout(showT); curEl = el; showT = setTimeout(function () { if (curEl === el && el.getAttribute('data-tip')) place(el); }, 320); }
    function hide() { clearTimeout(showT); curEl = null; if (tip) tip.classList.remove('show'); }
    document.addEventListener('mouseover', function (e) { var el = e.target.closest && e.target.closest('[data-tip]'); if (el) show(el); });
    document.addEventListener('mouseout', function (e) { var el = e.target.closest && e.target.closest('[data-tip]'); if (el && (!e.relatedTarget || !el.contains(e.relatedTarget))) hide(); });
    document.addEventListener('focusin', function (e) { var el = e.target.closest && e.target.closest('[data-tip]'); if (el) { curEl = el; place(el); } });
    document.addEventListener('focusout', hide);
    window.addEventListener('scroll', hide, true);
  })();

  // ---------- shared Roblox username autocomplete ----------
  // One resilient implementation for every roblox search field. Fixes the
  // "dropdown stops showing results" issue: a race token so a slow stale
  // response can't clobber a newer one, a per-query cache (also softens the
  // rate limit), an exact-username fallback when the fuzzy search hides a
  // moderated name, and it never hides on a transient network error.
  var RBX_CACHE = {};
  function robloxAutocomplete(input, box, onPick) {
    if (!input || !box || input._rbxWired) return;
    input._rbxWired = true;
    var authed = document.body.hasAttribute('data-authed');
    var timer, token = 0, lastQ = '';

    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function hide() { box.hidden = true; box.innerHTML = ''; }
    function render(data) {
      if (!data || !data.length) { hide(); return; }
      box.innerHTML = data.map(function (u) {
        return '<div class="rbx-opt" data-name="' + esc(u.name) + '">'
          + (u.avatar ? '<img class="rbx-opt-av" src="' + esc(u.avatar) + '" alt="" width="26" height="26" loading="lazy" />' : '<span class="rbx-opt-av ph"></span>')
          + '<span class="rbx-opt-txt"><strong>' + esc(u.name) + '</strong> <span class="muted">' + esc(u.displayName || '') + '</span></span></div>';
      }).join('');
      box.hidden = false;
    }
    function exactFallback(q, my) {
      if (!authed) { hide(); return; } // /api/roblox/:name needs a session
      fetch('/api/roblox/' + encodeURIComponent(q)).then(function (r) { return r.json(); }).then(function (ex) {
        if (my !== token) return;
        var data = (ex && ex.ok) ? [{ name: ex.name, displayName: ex.displayName, avatar: ex.avatar }] : [];
        RBX_CACHE[q.toLowerCase()] = data;
        render(data);
      }).catch(function () { /* keep whatever is shown */ });
    }
    function search(q) {
      var key = q.toLowerCase();
      if (RBX_CACHE[key]) { render(RBX_CACHE[key]); return; }
      var my = ++token;
      fetch('/api/roblox-search?q=' + encodeURIComponent(q)).then(function (r) { return r.json(); }).then(function (d) {
        if (my !== token || input.value.trim() !== q) return; // stale
        var data = (d && d.data) || [];
        if (data.length) { RBX_CACHE[key] = data; render(data); }
        else exactFallback(q, my);
      }).catch(function () { /* transient error — leave current results, retry next keystroke */ });
    }
    input.addEventListener('input', function () {
      clearTimeout(timer);
      var q = input.value.trim();
      if (q === lastQ) return; lastQ = q;
      if (q.length < 2) { hide(); return; }
      timer = setTimeout(function () { search(q); }, 200);
    });
    input.addEventListener('focus', function () { var q = input.value.trim(); if (q.length >= 2 && RBX_CACHE[q.toLowerCase()]) render(RBX_CACHE[q.toLowerCase()]); });
    box.addEventListener('mousedown', function (e) {
      var o = e.target.closest('.rbx-opt'); if (!o) return;
      e.preventDefault();
      var name = o.getAttribute('data-name');
      input.value = name; hide();
      if (onPick) onPick(name);
    });
    input.addEventListener('blur', function () { setTimeout(hide, 160); });
  }
  window.robloxAutocomplete = robloxAutocomplete;
  // Auto-wire any plain field marked data-rbx-autocomplete (its sibling .rbx-suggest).
  function wireRoblox(root) {
    Array.prototype.forEach.call((root || document).querySelectorAll('input[data-rbx-autocomplete]'), function (inp) {
      var box = inp.parentNode.querySelector('.rbx-suggest');
      if (box) robloxAutocomplete(inp, box, null);
    });
  }
  window.vcfWireRoblox = wireRoblox;
  wireRoblox();

  // ---------- TOC scrollspy ----------
  var tocObs = null;
  function initTOC() {
    if (tocObs) { tocObs.disconnect(); tocObs = null; }
    var tocLinks = Array.prototype.slice.call(document.querySelectorAll('.toc a'));
    if (!tocLinks.length || !('IntersectionObserver' in window)) return;
    var map = {};
    tocLinks.forEach(function (a) { map[a.getAttribute('href').slice(1)] = a; });
    var headings = Object.keys(map).map(function (id) { return document.getElementById(id); }).filter(Boolean);
    tocObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          tocLinks.forEach(function (l) { l.classList.remove('active'); });
          var a = map[en.target.id];
          if (a) a.classList.add('active');
        }
      });
    }, { rootMargin: '-80px 0px -70% 0px', threshold: 0 });
    headings.forEach(function (h) { tocObs.observe(h); });
  }
  window.vcfInitTOC = initTOC;
  initTOC();

  // ---------- client-side navigation (PJAX) ----------
  // Any eligible same-origin link swaps <main> in place instead of a full
  // reload. Works across public docs AND admin pages: page-specific scripts
  // live inside <main>, so after swapping we re-execute them and re-run the
  // shared enhancers. Chrome (sidebar/topbar) stays put, so a navigation is
  // only PJAX'd when source and target share the same chrome (both admin or
  // both public). Protected/confidential pages, the editor, the staff
  // dashboard, and non-page targets always full-load.
  (function () {
    if (!window.history || !window.fetch || !document.querySelector('main.content')) return;
    var main = document.querySelector('main.content');
    var isProtected = function () { return !!document.querySelector('.doc.protected'); };
    var isAdminChrome = function (scope) { return !!(scope || document).querySelector('.admin-sidebar'); };

    // Paths that must always full-load (stateful pages, auth, non-HTML, files).
    var EXCLUDE = /^\/(admin\/edit|admin\/new|dashboard|login|logout|feedback|api|assets|uploads|internal-documents)\b/;
    function candidate(href) {
      var a = document.createElement('a'); a.href = href;
      if (a.origin !== location.origin) return null;
      var path = a.pathname;
      if (EXCLUDE.test(path)) return null;
      if (/\.[a-z0-9]+$/i.test(path)) return null;   // has a file extension
      if (a.hash && a.pathname === location.pathname && a.search === location.search) return null; // same-page anchor
      return a.href;
    }

    function runCleanups() {
      var list = window.pjaxCleanups || [];
      window.pjaxCleanups = [];
      for (var i = 0; i < list.length; i++) { try { list[i](); } catch (e) {} }
    }
    // Re-execute the <script> tags inside the swapped main (innerHTML-inserted
    // scripts don't run on their own). Shared scripts live in the page foot,
    // outside main, so they are never re-run — no duplicate global bindings.
    function runScripts(scope) {
      var scripts = scope.querySelectorAll('script');
      Array.prototype.forEach.call(scripts, function (old) {
        var s = document.createElement('script');
        for (var i = 0; i < old.attributes.length; i++) {
          s.setAttribute(old.attributes[i].name, old.attributes[i].value);
        }
        if (old.src) s.async = false;              // preserve execution order for external scripts
        else s.textContent = old.textContent;
        old.parentNode.replaceChild(s, old);
      });
    }

    // Latest click wins: each navigation gets a sequence number and aborts the
    // previous in-flight fetch. A stale response (or its abort error) is simply
    // discarded — it must never hard-navigate to an outdated URL or leave the
    // page in a half-loaded state.
    var navSeq = 0, inflight = null;
    function navigate(url, push) {
      var seq = ++navSeq;
      if (inflight) { try { inflight.abort(); } catch (e) {} }
      var ctrl = (window.AbortController ? new AbortController() : null);
      inflight = ctrl;
      main.classList.add('pjax-loading');
      fetch(url, { headers: { 'X-Requested-With': 'fetch' }, signal: ctrl && ctrl.signal }).then(function (r) {
        if (seq !== navSeq) throw { stale: true };
        // a redirect (e.g. session expired -> /login) means this isn't the page
        // we asked for — do a real navigation so the right chrome loads.
        if (r.redirected && new URL(r.url).pathname !== new URL(url, location.origin).pathname) { location.href = url; throw { stale: true }; }
        if (!r.ok || !/text\/html/.test(r.headers.get('content-type') || '')) throw 0;
        return r.text();
      }).then(function (html) {
        if (seq !== navSeq) return;
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var newMain = doc.querySelector('main.content');
        // full-load if the target isn't a normal page, is empty, is
        // confidential, or has different chrome (public<->admin) than the
        // current page.
        if (!newMain || !newMain.children.length || doc.querySelector('.doc.protected') || isAdminChrome(doc) !== isAdminChrome()) {
          location.href = url; return;
        }
        // a deploy happened since this tab loaded: the fetched page was built
        // against different assets than the JS/CSS currently running — mixing
        // them breaks pages, so do a real navigation to pick everything up.
        var curV = document.querySelector('meta[name="asset-v"]');
        var newV = doc.querySelector('meta[name="asset-v"]');
        if (curV && newV && curV.getAttribute('content') !== newV.getAttribute('content')) {
          location.href = url; return;
        }
        runCleanups();
        main.innerHTML = newMain.innerHTML;
        main.className = newMain.className;                 // keep admin-content / wide variants
        // mark the document: entrance animations are disabled from now on so
        // swapped-in content can never be stuck invisible (see styles.css).
        document.documentElement.classList.add('pjaxed');
        main.classList.remove('pjax-in'); void main.offsetWidth; main.classList.add('pjax-in');
        document.title = doc.title;
        runScripts(main);
        // sync sidebar active state (works for docs + admin nav)
        var newPath = new URL(url, location.origin).pathname;
        document.querySelectorAll('.side-nav .nav-link, .side-nav a').forEach(function (a) {
          var href = a.getAttribute('href');
          if (href) a.classList.toggle('active', href === newPath || href === url.replace(location.origin, ''));
        });
        if (push) history.pushState({ pjax: 1 }, '', url);
        window.scrollTo(0, 0);
        // re-run the shared enhancers over the new content
        if (window.fillTimes) window.fillTimes();
        loadAvatars(main); initTOC();
        if (window.enhanceInputs) window.enhanceInputs(main);
        if (window.vcfWireRoblox) window.vcfWireRoblox(main);
        try { window.dispatchEvent(new CustomEvent('pjax:load', { detail: { url: url } })); } catch (e) {}
        main.classList.remove('pjax-loading');
        watchdog(seq);
      }).catch(function (err) {
        if (seq !== navSeq || (err && (err.stale || err.name === 'AbortError'))) return; // superseded — newest wins
        location.href = url; // genuine failure: fall back to a real navigation
      });
    }

    // Self-healing: if a swapped page ends up visibly broken anyway — blank,
    // collapsed, or with its content stuck invisible — recover with ONE real
    // reload (a full load never has these problems, so no loop is possible).
    // Also treat an uncaught script error right after the swap as broken.
    function watchdog(seq) {
      function broken() {
        if (!main.firstElementChild) return true;
        if (main.offsetHeight < 40) return true;
        var o = parseFloat(getComputedStyle(main.firstElementChild).opacity);
        return o === 0;
      }
      var onErr = function () { cleanup(); if (seq === navSeq) location.reload(); };
      var cleanup = function () { window.removeEventListener('error', onErr); };
      window.addEventListener('error', onErr);
      setTimeout(function () {
        cleanup();
        if (seq !== navSeq) return;
        if (broken()) location.reload();
      }, 400);
    }

    document.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target.closest ? e.target.closest('a[href]') : null;
      if (!a || a.target === '_blank' || a.hasAttribute('download') || a.hasAttribute('data-no-pjax')) return;
      if (a.getAttribute('href').charAt(0) === '#') return;
      if (isProtected() || EXCLUDE.test(location.pathname)) return; // leaving a confidential/stateful page — full load
      var url = candidate(a.getAttribute('href'));
      if (!url) return;
      e.preventDefault();
      // close the mobile sidebar if open
      var sb = document.getElementById('sidebar'); if (sb) sb.classList.remove('open');
      var scrim = document.getElementById('scrim'); if (scrim) scrim.classList.remove('show');
      navigate(url, true);
    });
    // Tag the initial history entry so Back to it restores content via PJAX.
    if (history.state == null) { try { history.replaceState({ pjax: 1 }, '', location.href); } catch (e) {} }
    window.addEventListener('popstate', function (e) {
      if (!e.state || !e.state.pjax) return;
      navigate(location.href, false);
    });
  })();
})();
