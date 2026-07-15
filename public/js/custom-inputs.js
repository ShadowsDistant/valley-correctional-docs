(function () {
  'use strict';
  // Progressive enhancement: replace native <select> and <input type="date">
  // with custom, theme-matched dropdowns. The native control stays in the DOM
  // (hidden) so forms submit exactly as before and JS reading .value still works.

  var CARET = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>';
  var CAL = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/></svg>';
  var MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var DOW = ['Su','Mo','Tu','We','Th','Fr','Sa'];

  var openWidget = null;
  function closeOpen() { if (openWidget) openWidget(); openWidget = null; }
  document.addEventListener('click', function (e) {
    // panels are portaled to <body>, so also treat clicks inside them as "inside"
    if (openWidget && !e.target.closest('.cselect, .cdate, .cselect-panel, .cdate-pop')) closeOpen();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeOpen(); });

  // ---------------------------------------------------------------- select
  function enhanceSelect(sel) {
    if (sel.multiple || sel.dataset.enhanced || sel.dataset.noEnhance !== undefined || sel.closest('.cselect')) return;
    sel.dataset.enhanced = '1';

    var wrap = document.createElement('div'); wrap.className = 'cselect';
    var btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'cselect-btn';
    btn.setAttribute('aria-haspopup', 'listbox'); btn.setAttribute('aria-expanded', 'false');
    var label = document.createElement('span'); label.className = 'cselect-label';
    var caret = document.createElement('span'); caret.className = 'cselect-caret'; caret.innerHTML = CARET;
    btn.appendChild(label); btn.appendChild(caret);
    var panel = document.createElement('div'); panel.className = 'cselect-panel'; panel.setAttribute('role', 'listbox'); panel.hidden = true;

    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(sel); wrap.appendChild(btn); wrap.appendChild(panel);
    sel.classList.add('cselect-native'); sel.tabIndex = -1;
    if (sel.id) { btn.id = sel.id + '-btn'; }

    var active = -1;
    function opts() { return panel.querySelectorAll('.cselect-opt'); }
    function rebuild() {
      panel.innerHTML = '';
      Array.prototype.forEach.call(sel.options, function (opt, i) {
        var o = document.createElement('div');
        o.className = 'cselect-opt' + (i === sel.selectedIndex ? ' selected' : '') + (opt.disabled ? ' disabled' : '');
        o.setAttribute('role', 'option'); o.dataset.i = i;
        o.textContent = opt.textContent || opt.value;
        panel.appendChild(o);
      });
      var cur = sel.options[sel.selectedIndex];
      label.textContent = cur ? (cur.textContent || cur.value) : '';
      label.classList.toggle('placeholder', !cur || cur.value === '');
    }

    // Portal the panel to <body> and position it with fixed coords, so it can
    // never be clipped or covered by an ancestor's overflow / stacking context.
    function position() {
      var r = btn.getBoundingClientRect();
      panel.style.position = 'fixed';
      // Grow to fit long option labels (up to the viewport), but never narrower
      // than the trigger. Then nudge left so it never runs off the right edge.
      panel.style.width = '';
      panel.style.minWidth = r.width + 'px';
      panel.style.maxWidth = Math.max(r.width, window.innerWidth - 20) + 'px';
      var pw = Math.min(panel.offsetWidth, window.innerWidth - 20);
      var left = Math.min(r.left, window.innerWidth - pw - 10);
      panel.style.left = Math.max(10, left) + 'px';
      var below = window.innerHeight - r.bottom - 10;
      var above = r.top - 10;
      var full = Math.min(panel.scrollHeight, 264);
      if (below < full && above > below) {
        panel.classList.add('up');
        panel.style.top = ''; panel.style.bottom = (window.innerHeight - r.top + 6) + 'px';
        panel.style.maxHeight = Math.min(full, above) + 'px';
      } else {
        panel.classList.remove('up');
        panel.style.bottom = ''; panel.style.top = (r.bottom + 6) + 'px';
        panel.style.maxHeight = Math.min(full, below) + 'px';
      }
    }
    function isOpen() { return !panel.hidden; }
    function open() {
      closeOpen();
      document.body.appendChild(panel);
      panel.hidden = false; btn.setAttribute('aria-expanded', 'true'); wrap.classList.add('open');
      active = sel.selectedIndex; highlight(); position();
      var s = panel.querySelector('.selected'); if (s) s.scrollIntoView({ block: 'nearest' });
      window.addEventListener('scroll', position, true); window.addEventListener('resize', position);
      openWidget = close;
    }
    function close() {
      panel.hidden = true; btn.setAttribute('aria-expanded', 'false'); wrap.classList.remove('open');
      window.removeEventListener('scroll', position, true); window.removeEventListener('resize', position);
      if (panel.parentNode === document.body) wrap.appendChild(panel);
    }
    function highlight() {
      opts().forEach(function (o, i) { o.classList.toggle('active', i === active); });
      var a = opts()[active]; if (a) a.scrollIntoView({ block: 'nearest' });
    }
    function pick(i) {
      if (i < 0 || i >= sel.options.length || sel.options[i].disabled) return;
      sel.selectedIndex = i; sel.dispatchEvent(new Event('change', { bubbles: true }));
      rebuild(); close(); btn.focus();
    }
    function step(d) {
      var n = sel.options.length, i = active;
      for (var k = 0; k < n; k++) { i = (i + d + n) % n; if (!sel.options[i].disabled) { active = i; break; } }
      highlight();
    }

    btn.addEventListener('click', function (e) { e.preventDefault(); isOpen() ? close() : open(); });
    btn.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!isOpen()) return open(); step(e.key === 'ArrowDown' ? 1 : -1); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); isOpen() ? pick(active) : open(); }
      else if (e.key === 'Escape') { close(); }
      else if (e.key === 'Tab') { close(); }
    });
    panel.addEventListener('mousemove', function (e) { var o = e.target.closest('.cselect-opt'); if (o) { active = +o.dataset.i; highlight(); } });
    panel.addEventListener('click', function (e) { var o = e.target.closest('.cselect-opt'); if (o && !o.classList.contains('disabled')) pick(+o.dataset.i); });
    sel.addEventListener('change', rebuild);
    // If option set changes (rare), keep in sync.
    rebuild();
  }

  // ------------------------------------------------------------------ date
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  function enhanceDate(input) {
    if (input.dataset.enhanced || input.closest('.cdate')) return;
    input.dataset.enhanced = '1';

    var wrap = document.createElement('div'); wrap.className = 'cdate';
    var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'cdate-btn';
    var ico = document.createElement('span'); ico.className = 'cdate-ico'; ico.innerHTML = CAL;
    var label = document.createElement('span'); label.className = 'cdate-label';
    btn.appendChild(ico); btn.appendChild(label);
    var pop = document.createElement('div'); pop.className = 'cdate-pop'; pop.hidden = true;

    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input); wrap.appendChild(btn); wrap.appendChild(pop);
    input.classList.add('cdate-native'); input.tabIndex = -1;

    var min = input.min ? new Date(input.min + 'T00:00:00') : null;
    var max = input.max ? new Date(input.max + 'T00:00:00') : null;
    var view = new Date(); view.setDate(1);
    if (input.value) { var v = new Date(input.value + 'T00:00:00'); if (!isNaN(v)) { view = new Date(v.getFullYear(), v.getMonth(), 1); } }

    function syncLabel() {
      if (input.value) {
        var d = new Date(input.value + 'T00:00:00');
        label.textContent = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
        wrap.classList.add('has-val');
      } else { label.textContent = input.getAttribute('placeholder') || 'Select a date'; wrap.classList.remove('has-val'); }
    }
    function blocked(d) { return (min && d < min) || (max && d > max); }

    function render() {
      var y = view.getFullYear(), m = view.getMonth();
      var first = new Date(y, m, 1).getDay();
      var days = new Date(y, m + 1, 0).getDate();
      var today = iso(new Date());
      var html = '<div class="cdate-head">'
        + '<button type="button" class="cdate-nav" data-nav="-1" aria-label="Previous month"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg></button>'
        + '<span class="cdate-title">' + MONTHS[m] + ' ' + y + '</span>'
        + '<button type="button" class="cdate-nav" data-nav="1" aria-label="Next month"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg></button>'
        + '</div><div class="cdate-grid">';
      DOW.forEach(function (d) { html += '<span class="cdate-dow">' + d + '</span>'; });
      for (var i = 0; i < first; i++) html += '<span></span>';
      for (var day = 1; day <= days; day++) {
        var ds = y + '-' + pad(m + 1) + '-' + pad(day);
        var cls = 'cdate-day';
        if (ds === input.value) cls += ' selected';
        if (ds === today) cls += ' today';
        if (blocked(new Date(y, m, day))) cls += ' disabled';
        html += '<button type="button" class="' + cls + '" data-d="' + ds + '">' + day + '</button>';
      }
      html += '</div><div class="cdate-foot"><button type="button" class="cdate-link" data-today>Today</button>';
      if (input.value) html += '<button type="button" class="cdate-link" data-clear>Clear</button>';
      html += '</div>';
      pop.innerHTML = html;
    }

    function position() {
      var r = btn.getBoundingClientRect();
      pop.style.position = 'fixed';
      pop.style.left = Math.min(r.left, window.innerWidth - 288) + 'px';
      var need = pop.offsetHeight || 320;
      if (r.bottom + need + 10 > window.innerHeight && r.top > need) {
        pop.classList.add('up'); pop.style.top = ''; pop.style.bottom = (window.innerHeight - r.top + 6) + 'px';
      } else {
        pop.classList.remove('up'); pop.style.bottom = ''; pop.style.top = (r.bottom + 6) + 'px';
      }
    }
    function open() {
      closeOpen(); render(); document.body.appendChild(pop);
      pop.hidden = false; wrap.classList.add('open'); position();
      window.addEventListener('scroll', position, true); window.addEventListener('resize', position);
      openWidget = close;
    }
    function close() {
      pop.hidden = true; wrap.classList.remove('open');
      window.removeEventListener('scroll', position, true); window.removeEventListener('resize', position);
      if (pop.parentNode === document.body) wrap.appendChild(pop);
    }
    function isOpen() { return !pop.hidden; }

    btn.addEventListener('click', function (e) { e.preventDefault(); isOpen() ? close() : open(); });
    pop.addEventListener('click', function (e) {
      var nav = e.target.closest('[data-nav]');
      if (nav) { view.setMonth(view.getMonth() + (+nav.getAttribute('data-nav'))); render(); return; }
      var day = e.target.closest('.cdate-day');
      if (day && !day.classList.contains('disabled')) { input.value = day.getAttribute('data-d'); input.dispatchEvent(new Event('change', { bubbles: true })); syncLabel(); close(); return; }
      if (e.target.closest('[data-today]')) { var t = new Date(); input.value = iso(t); input.dispatchEvent(new Event('change', { bubbles: true })); view = new Date(t.getFullYear(), t.getMonth(), 1); syncLabel(); render(); return; }
      if (e.target.closest('[data-clear]')) { input.value = ''; input.dispatchEvent(new Event('change', { bubbles: true })); syncLabel(); render(); return; }
    });
    input.addEventListener('change', syncLabel);
    syncLabel();
  }

  function run(root) {
    (root || document).querySelectorAll('select').forEach(enhanceSelect);
    (root || document).querySelectorAll('input[type="date"]').forEach(enhanceDate);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { run(); });
  else run();
  // expose for dynamically-added rows (e.g. shift forms) if ever needed
  window.enhanceInputs = run;
})();
