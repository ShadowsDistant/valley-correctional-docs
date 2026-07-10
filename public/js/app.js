(function () {
  'use strict';

  // ---------- theme toggle ----------
  var themeBtn = document.getElementById('themeToggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var cur = document.documentElement.getAttribute('data-theme');
      var next = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('vcf-theme', next); } catch (e) {}
    });
  }

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
        p._hay = (p.title + ' ' + (p.group || '') + ' ' + (p.description || '') + ' ' + (p.text || '')).toLowerCase();
        p._t = p.title.toLowerCase();
        return p;
      });
      loading = false;
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
