(function () {
  'use strict';
  var shell = document.querySelector('.editor-shell');
  if (!shell) return;

  var csrf = shell.getAttribute('data-csrf');
  var isNew = shell.getAttribute('data-new') === '1';
  var originalSlug = shell.getAttribute('data-original-slug');
  var myName = shell.getAttribute('data-user') || 'you';
  var ICON_NAMES = (shell.getAttribute('data-icons') || '').split(',').filter(Boolean);

  var md = document.getElementById('md');
  var preview = document.getElementById('preview');
  var wzEditor = document.getElementById('wzEditor');
  var wzPane = document.getElementById('wzPane');
  var mdPane = document.getElementById('mdPane');
  var previewPane = document.getElementById('previewPane');
  var state = document.getElementById('saveState');
  var saveBtn = document.getElementById('saveBtn');

  var F = {
    title: document.getElementById('f-title'), slug: document.getElementById('f-slug'),
    group: document.getElementById('f-group'), icon: document.getElementById('f-icon'),
    sort: document.getElementById('f-sort'), internal: document.getElementById('f-internal'),
    desc: document.getElementById('f-desc'), division: document.getElementById('f-division'),
  };

  var dirty = false, current = 'wysiwyg', lastRt = null;
  function setState(t, c) { state.textContent = t; state.className = 'save-state' + (c ? ' ' + c : ''); }
  function markDirty() { dirty = true; if (!collabLive) setState('Unsaved changes', 'dirty'); }

  // ============================ markdown <-> html ============================
  function escHtml(s) { return s.replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }

  function inlineToHtml(s) {
    s = escHtml(s);
    s = s.replace(/`([^`]+)`/g, function (_, x) { return '<code>' + x + '</code>'; });
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    return s;
  }

  function mdToHtml(src) {
    var blocks = String(src).split(/\n{2,}/);
    var html = '';
    blocks.forEach(function (b) {
      var lines = b.split('\n');
      while (lines.length) {
        var h = /^(#{1,6})\s+(.*)$/.exec(lines[0]);
        if (!h) break;
        var lvl = Math.min(h[1].length, 4);
        html += '<h' + lvl + '>' + inlineToHtml(h[2]) + '</h' + lvl + '>';
        lines.shift();
      }
      if (!lines.length) return;
      b = lines.join('\n');
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(b.trim())) { html += '<hr>'; return; }
      if (lines.every(function (l) { return /^>\s?/.test(l); })) {
        html += '<blockquote><p>' + lines.map(function (l) { return inlineToHtml(l.replace(/^>\s?/, '')); }).join('<br>') + '</p></blockquote>'; return;
      }
      if (lines.every(function (l) { return /^[-*]\s+/.test(l); })) {
        html += '<ul>' + lines.map(function (l) { return '<li>' + inlineToHtml(l.replace(/^[-*]\s+/, '')) + '</li>'; }).join('') + '</ul>'; return;
      }
      if (lines.every(function (l) { return /^\d+\.\s+/.test(l); })) {
        html += '<ol>' + lines.map(function (l) { return '<li>' + inlineToHtml(l.replace(/^\d+\.\s+/, '')) + '</li>'; }).join('') + '</ol>'; return;
      }
      html += '<p>' + lines.map(inlineToHtml).join('<br>') + '</p>';
    });
    return html;
  }

  function inlineToMd(node) {
    var out = '';
    node.childNodes.forEach(function (n) {
      if (n.nodeType === 3) { out += n.nodeValue; return; }
      if (n.nodeType !== 1) return;
      var tag = n.tagName.toLowerCase(), inner = inlineToMd(n);
      if (tag === 'strong' || tag === 'b') out += '**' + inner + '**';
      else if (tag === 'em' || tag === 'i') out += '*' + inner + '*';
      else if (tag === 'del' || tag === 's' || tag === 'strike') out += '~~' + inner + '~~';
      else if (tag === 'code') out += '`' + inner + '`';
      else if (tag === 'a') out += '[' + inner + '](' + (n.getAttribute('href') || '') + ')';
      else if (tag === 'br') out += '\n';
      else out += inner;
    });
    return out;
  }

  function htmlToMd(el) {
    var out = [];
    Array.prototype.forEach.call(el.childNodes, function (n) {
      if (n.nodeType === 3) { if (n.nodeValue.trim()) out.push(n.nodeValue.trim()); return; }
      if (n.nodeType !== 1) return;
      var tag = n.tagName.toLowerCase();
      if (/^h[1-4]$/.test(tag)) out.push('#'.repeat(+tag[1]) + ' ' + inlineToMd(n).trim());
      else if (tag === 'p' || tag === 'div') { var t = inlineToMd(n).trim(); if (t) out.push(t); }
      else if (tag === 'ul') Array.prototype.forEach.call(n.children, function (li) { out.push('- ' + inlineToMd(li).trim()); });
      else if (tag === 'ol') Array.prototype.forEach.call(n.children, function (li, i) { out.push((i + 1) + '. ' + inlineToMd(li).trim()); });
      else if (tag === 'blockquote') inlineToMd(n).split('\n').forEach(function (l) { out.push('> ' + l); });
      else if (tag === 'hr') out.push('---');
      else { var x = inlineToMd(n).trim(); if (x) out.push(x); }
    });
    var res = '', prevList = false;
    out.forEach(function (l, i) {
      var isList = /^([-]|\d+\.)\s/.test(l) || /^>/.test(l);
      if (i > 0) res += (isList && prevList) ? '\n' : '\n\n';
      res += l; prevList = isList;
    });
    return res;
  }

  // ============================ block tokenizer =============================
  function tokenize(src) {
    var lines = String(src).split(/\r?\n/), segs = [], rt = [], i = 0;
    function flush() { var t = rt.join('\n').trim(); if (t) segs.push({ type: 'rt', md: t }); rt = []; }
    while (i < lines.length) {
      var line = lines[i];
      var m = /^:::\s*([a-zA-Z]+)\s*(.*)$/.exec(line);
      if (m) {
        flush(); var body = [line]; i++;
        while (i < lines.length && !/^:::\s*$/.test(lines[i])) { body.push(lines[i]); i++; }
        if (i < lines.length) { body.push(lines[i]); i++; }
        var t = m[1].toLowerCase();
        segs.push({ type: 'block', kind: (t === 'details' || t === 'accordion') ? 'accordion' : 'callout', md: body.join('\n') });
        continue;
      }
      if (/^```/.test(line)) {
        flush(); var b = [line]; i++;
        while (i < lines.length && !/^```/.test(lines[i])) { b.push(lines[i]); i++; }
        if (i < lines.length) { b.push(lines[i]); i++; }
        segs.push({ type: 'block', kind: 'code', md: b.join('\n') }); continue;
      }
      if (/^\s*<(div|table|figure|section)/i.test(line)) {
        flush(); var h = []; while (i < lines.length && lines[i].trim() !== '') { h.push(lines[i]); i++; }
        segs.push({ type: 'block', kind: 'html', md: h.join('\n') }); continue;
      }
      if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]*-{2,}[\s:|-]*\|?\s*$/.test(lines[i + 1])) {
        flush(); var tb = [line]; i++; while (i < lines.length && /\|/.test(lines[i])) { tb.push(lines[i]); i++; }
        segs.push({ type: 'block', kind: 'table', md: tb.join('\n') }); continue;
      }
      rt.push(line); i++;
    }
    flush();
    return segs;
  }

  // ============================ editor rendering ============================
  function makeRt(mdText) {
    var d = document.createElement('div');
    d.className = 'wz-rt'; d.contentEditable = 'true';
    d.innerHTML = mdToHtml(mdText) || '<p><br></p>';
    d._mdCache = String(mdText).trim();
    return d;
  }

  function fetchPreview(mdText, target) {
    target.innerHTML = '<p class="muted">Rendering…</p>';
    fetch('/admin/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: mdText }) })
      .then(function (r) { return r.json(); }).then(function (d) { target.innerHTML = d.html || ''; })
      .catch(function () { target.innerHTML = '<p class="muted">Preview unavailable.</p>'; });
  }

  var CALLOUT_TYPES = ['note', 'info', 'tip', 'success', 'warning', 'danger', 'important'];
  var CALLOUT_META = {
    note: { label: 'Note', color: '#3b82f6', ic: 'info' },
    info: { label: 'Info', color: '#38bdf8', ic: 'info' },
    tip: { label: 'Tip', color: '#22c55e', ic: 'check' },
    success: { label: 'Success', color: '#22c55e', ic: 'check' },
    warning: { label: 'Warning', color: '#f59e0b', ic: 'warning' },
    danger: { label: 'Danger', color: '#ef4444', ic: 'danger' },
    important: { label: 'Important', color: '#a855f7', ic: 'star' },
  };
  // A small custom dropdown for the callout type, with a color dot per option.
  function calloutTypeControl(current, onPick) {
    var cur = CALLOUT_META[current] ? current : 'info';
    var wrap = document.createElement('div'); wrap.className = 'wz-co-cs';
    var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'wz-co-cs-btn';
    function label(t) { var m = CALLOUT_META[t]; return '<span class="wz-co-dot" style="background:' + m.color + '"></span>' + m.label + '<span class="wz-co-caret">▾</span>'; }
    btn.innerHTML = label(cur);
    var pop = null;
    function close() { if (pop) { pop.remove(); pop = null; document.removeEventListener('mousedown', out, true); } }
    function out(e) { if (pop && !pop.contains(e.target) && e.target !== btn) close(); }
    function open() {
      close();
      pop = document.createElement('div'); pop.className = 'wz-co-cs-pop';
      pop.innerHTML = CALLOUT_TYPES.map(function (t) { var m = CALLOUT_META[t]; return '<button type="button" class="wz-co-cs-opt' + (t === cur ? ' sel' : '') + '" data-t="' + t + '"><span class="wz-co-dot" style="background:' + m.color + '"></span>' + m.label + '</button>'; }).join('');
      document.body.appendChild(pop);
      var r = btn.getBoundingClientRect();
      pop.style.position = 'fixed';
      pop.style.left = r.left + 'px';
      pop.style.minWidth = r.width + 'px';
      pop.style.top = (r.bottom + 4 + pop.offsetHeight > window.innerHeight ? r.top - pop.offsetHeight - 4 : r.bottom + 4) + 'px';
      pop.addEventListener('click', function (e) { var o = e.target.closest('.wz-co-cs-opt'); if (!o) return; cur = o.getAttribute('data-t'); btn.innerHTML = label(cur); close(); onPick(cur); });
      setTimeout(function () { document.addEventListener('mousedown', out, true); }, 0);
    }
    btn.addEventListener('click', function (e) { e.preventDefault(); pop ? close() : open(); });
    wrap.appendChild(btn);
    wrap.value = function () { return cur; };
    return wrap;
  }
  function parseCallout(mdText) {
    var m = /^:::\s*([a-zA-Z]+)\s*(.*)\n?([\s\S]*?)\n?:::\s*$/.exec(String(mdText).trim());
    if (!m) return { type: 'info', title: '', body: '' };
    return { type: m[1].toLowerCase(), title: m[2].trim(), body: m[3].trim() };
  }
  function calloutMd(type, title, body) {
    return ':::' + type + (title ? ' ' + title : '') + '\n' + body + '\n:::';
  }

  var KIND_LABEL = { callout: 'Callout', accordion: 'Accordion', table: 'Table', code: 'Code block', html: 'Card / HTML' };
  function makeBlock(seg) {
    // Callouts & accordions are edited fully inline — type, title, and body —
    // no modal needed. Other kinds keep the modal (code/table/html).
    if (seg.kind === 'callout' || seg.kind === 'accordion') return makeInlineBlock(seg);

    var wrap = document.createElement('div');
    wrap.className = 'wz-block'; wrap.contentEditable = 'false'; wrap.dataset.kind = seg.kind; wrap._md = seg.md;
    var bar = document.createElement('div'); bar.className = 'wz-block-bar';
    bar.innerHTML = '<span class="wz-drag" title="Drag to reorder" draggable="true">⋮⋮</span><span>' + (KIND_LABEL[seg.kind] || 'Block') + '</span>';
    var actions = document.createElement('div'); actions.className = 'wz-block-actions';
    var edit = document.createElement('button'); edit.type = 'button'; edit.textContent = 'Edit';
    var del = document.createElement('button'); del.type = 'button'; del.textContent = 'Delete';
    actions.appendChild(edit); actions.appendChild(del); bar.appendChild(actions);
    var prev = document.createElement('div'); prev.className = 'wz-block-preview markdown';
    wrap.appendChild(bar); wrap.appendChild(prev);
    fetchPreview(seg.md, prev);
    edit.addEventListener('click', function () {
      if (seg.kind === 'html' && /md-cards/.test(wrap._md)) openCardModal(wrap, prev);
      else openBlockModal(wrap, prev);
    });
    del.addEventListener('click', function () {
      askConfirm('Delete this block?', function () { wrap.remove(); ensureTrailingRt(); afterStructuralChange(); });
    });
    return wrap;
  }

  function makeInlineBlock(seg) {
    var isAcc = seg.kind === 'accordion';
    var c = parseCallout(seg.md);
    var wrap = document.createElement('div');
    wrap.className = 'wz-block wz-inline-block'; wrap.contentEditable = 'false'; wrap.dataset.kind = seg.kind;
    wrap._md = seg.md;

    var bar = document.createElement('div'); bar.className = 'wz-block-bar';
    bar.innerHTML = '<span class="wz-drag" title="Drag to reorder" draggable="true">⋮⋮</span><span>' + (isAcc ? 'Accordion' : 'Callout') + '</span>';
    var actions = document.createElement('div'); actions.className = 'wz-block-actions';
    var del = document.createElement('button'); del.type = 'button'; del.textContent = 'Delete';
    actions.appendChild(del); bar.appendChild(actions);

    var head = document.createElement('div'); head.className = 'wz-co-head';
    var typeCtl = null;
    if (!isAcc) {
      typeCtl = calloutTypeControl(c.type, function () { applyLook(); sync(); });
      head.appendChild(typeCtl);
    }
    var title = document.createElement('input');
    title.type = 'text'; title.className = 'wz-co-title'; title.placeholder = isAcc ? 'Section title' : 'Title (optional)';
    title.value = c.title;
    head.appendChild(title);

    var body = document.createElement('div');
    body.className = 'wz-co-body wz-rt markdown'; body.contentEditable = 'true';
    body.innerHTML = mdToHtml(c.body) || '<p><br></p>';

    function currentType() { return isAcc ? 'details' : (typeCtl ? typeCtl.value() : 'info'); }
    function applyLook() { wrap.className = 'wz-block wz-inline-block co-' + currentType(); }
    function sync() {
      wrap._md = calloutMd(currentType(), title.value.trim(), htmlToMd(body).trim());
      markDirty(); scheduleFlush();
    }
    applyLook();
    title.addEventListener('input', sync);
    body.addEventListener('input', sync);
    del.addEventListener('click', function () {
      askConfirm('Delete this ' + (isAcc ? 'accordion' : 'callout') + '?', function () { wrap.remove(); ensureTrailingRt(); afterStructuralChange(); });
    });

    wrap.appendChild(bar); wrap.appendChild(head); wrap.appendChild(body);
    return wrap;
  }

  function askConfirm(msg, onOk) {
    if (window.vcfConfirm) window.vcfConfirm({ title: 'Please confirm', message: msg, okLabel: 'Delete' }, onOk);
    else if (confirm(msg)) onOk();
  }

  function ensureTrailingRt() {
    var last = wzEditor.lastElementChild;
    if (!last || last.classList.contains('wz-block')) wzEditor.appendChild(makeRt(''));
  }

  function renderEditor(mdText) {
    wzEditor.innerHTML = '';
    var segs = tokenize(mdText);
    if (!segs.length) segs = [{ type: 'rt', md: '' }];
    segs.forEach(function (s) { wzEditor.appendChild(s.type === 'rt' ? makeRt(s.md) : makeBlock(s)); });
    ensureTrailingRt();
  }

  function serialize() {
    var out = [];
    Array.prototype.forEach.call(wzEditor.children, function (el) {
      if (el.classList.contains('wz-block')) { var m = (el._md || '').trim(); if (m) out.push(m); }
      else if (el.classList.contains('wz-rt')) {
        var t = htmlToMd(el).trim();
        el._mdCache = t;
        if (t) out.push(t);
      }
    });
    return out.join('\n\n');
  }

  // ============================ block edit modals ==========================
  function openBlockModal(wrap, prev) {
    var back = document.createElement('div'); back.className = 'wz-modal-back';
    back.innerHTML = '<div class="wz-modal"><h3>Edit block</h3>'
      + '<textarea class="wz-modal-ta"></textarea>'
      + '<div class="wz-modal-actions"><button type="button" class="btn btn-ghost btn-sm wz-cancel">Cancel</button>'
      + '<button type="button" class="btn btn-solid btn-sm wz-ok">Apply</button></div></div>';
    document.body.appendChild(back);
    var ta = back.querySelector('.wz-modal-ta'); ta.value = wrap._md || ''; ta.focus();
    function close() { back.remove(); }
    back.querySelector('.wz-cancel').addEventListener('click', close);
    back.addEventListener('click', function (e) { if (e.target === back) close(); });
    back.querySelector('.wz-ok').addEventListener('click', function () {
      wrap._md = ta.value; if (prev) fetchPreview(ta.value, prev); afterStructuralChange(); close();
    });
  }

  // Structured card editor: title/body per card, add/remove, column count —
  // no raw HTML in sight.
  function parseCards(html) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var grid = doc.querySelector('.md-cards');
    if (!grid) return null;
    var colsM = /cols-(\d)/.exec(grid.className);
    return {
      cols: colsM ? +colsM[1] : 2,
      cards: Array.prototype.map.call(grid.querySelectorAll('.md-card'), function (c) {
        var t = c.querySelector('.md-card-title'), b = c.querySelector('.md-card-body');
        return { title: t ? t.innerHTML.trim() : '', body: b ? b.innerHTML.trim() : '' };
      }),
    };
  }
  function cardsToHtml(data) {
    var out = '<div class="md-cards cols-' + data.cols + '">\n';
    data.cards.forEach(function (c) {
      out += '  <div class="md-card"><div class="md-card-title">' + c.title + '</div><div class="md-card-body">' + c.body + '</div></div>\n';
    });
    return out + '</div>';
  }
  function openCardModal(wrap, prev) {
    var data = parseCards(wrap._md) || { cols: 2, cards: [{ title: 'Title', body: 'Body text.' }] };
    var back = document.createElement('div'); back.className = 'wz-modal-back';
    back.innerHTML = '<div class="wz-modal wz-card-modal">'
      + '<div class="wz-card-modal-head"><h3>Edit card grid</h3>'
      + '<div class="wz-card-cols">Columns'
      + '<div class="wz-seg"><button type="button" data-cols="2">2</button><button type="button" data-cols="3">3</button></div></div></div>'
      + '<div class="wz-card-modal-body">'
      + '<div class="wz-card-editor"><div class="wz-card-list"></div>'
      + '<button type="button" class="btn btn-ghost btn-sm wz-card-add">' + '+ Add card</button></div>'
      + '<div class="wz-card-preview-wrap"><div class="wz-card-preview-label">Live preview</div><div class="markdown wz-card-preview">Loading…</div></div>'
      + '</div>'
      + '<div class="wz-modal-actions"><button type="button" class="btn btn-ghost btn-sm wz-cancel">Cancel</button>'
      + '<button type="button" class="btn btn-solid btn-sm wz-ok">Apply</button></div></div>';
    document.body.appendChild(back);
    var list = back.querySelector('.wz-card-list');
    var preview = back.querySelector('.wz-card-preview');
    var cols = +data.cols || 2;
    var seg = back.querySelector('.wz-seg');
    function markCols() { seg.querySelectorAll('button').forEach(function (b) { b.classList.toggle('active', +b.getAttribute('data-cols') === cols); }); }
    seg.addEventListener('click', function (e) { var b = e.target.closest('[data-cols]'); if (b) { cols = +b.getAttribute('data-cols'); markCols(); refresh(); } });
    markCols();

    function collect() {
      return Array.prototype.map.call(list.querySelectorAll('.wz-card-row'), function (row) {
        return { title: row.querySelector('.wz-card-t').value.trim(), body: row.querySelector('.wz-card-b').value.trim() };
      }).filter(function (c) { return c.title || c.body; });
    }
    var refreshT;
    function refresh() {
      clearTimeout(refreshT);
      refreshT = setTimeout(function () {
        var cards = collect(); if (!cards.length) cards = [{ title: 'Title', body: 'Body text.' }];
        fetchPreview(cardsToHtml({ cols: cols, cards: cards }), preview);
      }, 350);
    }
    function addRow(card) {
      var row = document.createElement('div'); row.className = 'wz-card-row';
      row.innerHTML = '<span class="wz-card-drag" title="Drag to reorder" draggable="true">⋮⋮</span>'
        + '<div class="wz-card-fields">'
        + '<div class="wz-card-title-row"><input type="text" class="wz-card-t" placeholder="Card title" />'
        + '<button type="button" class="wz-card-icon" title="Insert icon"><span class="ic ic-star"></span></button></div>'
        + '<textarea class="wz-card-b" rows="3" placeholder="Card body — supports **bold**, links, and :i[icon]: shortcodes"></textarea></div>'
        + '<button type="button" class="wz-card-del" title="Remove card"><span class="ic ic-trash"></span></button>';
      var tInput = row.querySelector('.wz-card-t');
      tInput.value = card.title; row.querySelector('.wz-card-b').value = card.body;
      row.querySelector('.wz-card-del').addEventListener('click', function () { row.remove(); refresh(); });
      row.querySelector('.wz-card-icon').addEventListener('click', function (e) {
        openIconPicker(e.currentTarget, function (name) {
          var pos = tInput.selectionStart != null ? tInput.selectionStart : tInput.value.length;
          tInput.value = tInput.value.slice(0, pos) + ':i[' + name + ']: ' + tInput.value.slice(pos);
          tInput.focus(); refresh();
        }, false);
      });
      row.addEventListener('input', refresh);
      // drag to reorder cards within the modal
      var handle = row.querySelector('.wz-card-drag');
      handle.addEventListener('dragstart', function (e) { row._dragging = true; row.classList.add('dragging'); try { e.dataTransfer.setData('text/plain', 'card'); } catch (x) {} });
      handle.addEventListener('dragend', function () { row.classList.remove('dragging'); refresh(); });
      list.appendChild(row);
    }
    list.addEventListener('dragover', function (e) {
      e.preventDefault();
      var dragging = list.querySelector('.wz-card-row.dragging'); if (!dragging) return;
      var after = null;
      Array.prototype.forEach.call(list.querySelectorAll('.wz-card-row:not(.dragging)'), function (r) {
        var box = r.getBoundingClientRect();
        if (e.clientY > box.top + box.height / 2) after = r;
      });
      if (after) after.after(dragging); else list.prepend(dragging);
    });
    data.cards.forEach(addRow);
    back.querySelector('.wz-card-add').addEventListener('click', function () { addRow({ title: 'Title', body: 'Body text.' }); refresh(); });
    function close() { clearTimeout(refreshT); back.remove(); }
    back.querySelector('.wz-cancel').addEventListener('click', close);
    back.addEventListener('mousedown', function (e) { if (e.target === back) close(); });
    back.querySelector('.wz-ok').addEventListener('click', function () {
      var cards = collect(); if (!cards.length) cards = [{ title: 'Title', body: 'Body text.' }];
      wrap._md = cardsToHtml({ cols: cols, cards: cards });
      if (prev) fetchPreview(wrap._md, prev);
      afterStructuralChange(); close();
    });
    refresh();
  }

  // ============================ icon picker ================================
  var iconPop = null;
  function closeIconPicker() { if (iconPop) { iconPop.remove(); iconPop = null; document.removeEventListener('mousedown', onIconOut); } }
  function onIconOut(e) { if (iconPop && !iconPop.contains(e.target)) closeIconPicker(); }
  function openIconPicker(anchor, onPick, allowNone) {
    closeIconPicker();
    iconPop = document.createElement('div'); iconPop.className = 'icon-pop';
    iconPop.innerHTML = '<input type="text" class="icon-pop-q" placeholder="Search icons…" />'
      + (allowNone ? '<button type="button" class="icon-pop-none">No icon</button>' : '')
      + '<div class="icon-pop-grid"></div>';
    document.body.appendChild(iconPop);
    var r = anchor.getBoundingClientRect();
    iconPop.style.position = 'fixed';
    iconPop.style.left = Math.min(r.left, window.innerWidth - 300) + 'px';
    iconPop.style.top = Math.min(r.bottom + 6, window.innerHeight - 320) + 'px';
    var grid = iconPop.querySelector('.icon-pop-grid'), q = iconPop.querySelector('.icon-pop-q');
    function draw(filter) {
      grid.innerHTML = ICON_NAMES.filter(function (n) { return !filter || n.indexOf(filter) !== -1; })
        .map(function (n) { return '<button type="button" class="icon-pop-item" data-n="' + n + '" title="' + n + '"><span class="ic ic-' + n + '"></span></button>'; }).join('')
        || '<span class="muted small" style="padding:8px">No matches</span>';
    }
    draw('');
    q.addEventListener('input', function () { draw(q.value.trim().toLowerCase()); });
    grid.addEventListener('click', function (e) {
      var b = e.target.closest('.icon-pop-item'); if (!b) return;
      onPick(b.getAttribute('data-n')); closeIconPicker();
    });
    var none = iconPop.querySelector('.icon-pop-none');
    if (none) none.addEventListener('click', function () { onPick(''); closeIconPicker(); });
    setTimeout(function () { q.focus(); document.addEventListener('mousedown', onIconOut); }, 0);
  }
  // settings icon field
  var iconBtn = document.getElementById('iconPickBtn');
  if (iconBtn) iconBtn.addEventListener('click', function () {
    openIconPicker(iconBtn, function (name) {
      F.icon.value = name;
      document.getElementById('iconPickLabel').textContent = name || 'Choose icon…';
      document.getElementById('iconPickPreview').innerHTML = name ? '<span class="ic ic-' + name + '"></span>' : '';
      markDirty();
    }, true);
  });

  // ============================ toolbar / commands =========================
  function currentRt() {
    if (lastRt && wzEditor.contains(lastRt)) return lastRt;
    return wzEditor.querySelector('.wz-rt');
  }
  wzEditor.addEventListener('focusin', function (e) {
    var rt = e.target.closest ? e.target.closest('.wz-rt') : null;
    if (rt) lastRt = rt;
    updatePresence();
  });
  try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) {}

  function wrapCode() {
    var sel = window.getSelection(); if (!sel.rangeCount) return;
    var text = sel.toString(); if (!text) return;
    document.execCommand('insertHTML', false, '<code>' + text.replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }) + '</code>');
  }

  function exec(cmd) {
    if (cmd === 'insert') { openInsertButtonMenu(); return; }
    if (cmd === 'undo') { doUndo(); return; }
    if (cmd === 'redo') { doRedo(); return; }
    if (cmd === 'icon') {
      var btn = document.querySelector('[data-cmd="icon"]');
      openIconPicker(btn, function (name) {
        if (!name) return;
        var rt = currentRt(); if (rt) { rt.focus(); document.execCommand('insertText', false, ':i[' + name + ']:'); markDirty(); scheduleFlush(); }
      }, false);
      return;
    }
    var rt = currentRt(); if (rt) rt.focus();
    switch (cmd) {
      case 'bold': document.execCommand('bold'); break;
      case 'italic': document.execCommand('italic'); break;
      case 'strike': document.execCommand('strikeThrough'); break;
      case 'h2': document.execCommand('formatBlock', false, 'H2'); break;
      case 'h3': document.execCommand('formatBlock', false, 'H3'); break;
      case 'quote': document.execCommand('formatBlock', false, 'BLOCKQUOTE'); break;
      case 'ul': document.execCommand('insertUnorderedList'); break;
      case 'ol': document.execCommand('insertOrderedList'); break;
      case 'hr': document.execCommand('insertHorizontalRule'); break;
      case 'code': wrapCode(); break;
      case 'link': var u = prompt('Link URL:'); if (u) document.execCommand('createLink', false, u); break;
    }
    markDirty(); scheduleFlush();
  }
  document.getElementById('wzToolbar').addEventListener('click', function (e) {
    var b = e.target.closest('.wz-btn'); if (b) { e.preventDefault(); exec(b.getAttribute('data-cmd')); }
  });

  // ============================ insert / slash menu =======================
  var INSERTS = [
    { icon: 'heading', label: 'Heading', sub: 'Section heading', cmd: 'h2', key: 'heading h2 title' },
    { icon: 'heading', label: 'Subheading', sub: 'Smaller heading', cmd: 'h3', key: 'subheading h3' },
    { icon: 'list', label: 'Bulleted list', sub: 'Unordered list', cmd: 'ul', key: 'list bullet unordered' },
    { icon: 'list', label: 'Numbered list', sub: 'Ordered list', cmd: 'ol', key: 'numbered ordered list' },
    { icon: 'quote', label: 'Quote', sub: 'Block quote', cmd: 'quote', key: 'quote blockquote' },
    { icon: 'divider', label: 'Divider', sub: 'Horizontal rule', cmd: 'hr', key: 'divider hr rule line' },
    { icon: 'star', label: 'Icon', sub: 'Inline icon', cmd: 'icon', key: 'icon symbol glyph' },
    { icon: 'info', label: 'Note callout', sub: 'Blue info box', md: ':::note Note\nYour text here.\n:::', key: 'note callout' },
    { icon: 'info', label: 'Info callout', sub: 'Neutral info box', md: ':::info Info\nYour text here.\n:::', key: 'info callout' },
    { icon: 'check', label: 'Tip / Success', sub: 'Green callout', md: ':::tip Tip\nYour text here.\n:::', key: 'tip success callout' },
    { icon: 'warning', label: 'Warning callout', sub: 'Amber callout', md: ':::warning Warning\nYour text here.\n:::', key: 'warning callout' },
    { icon: 'danger', label: 'Danger callout', sub: 'Red callout', md: ':::danger Danger\nYour text here.\n:::', key: 'danger callout' },
    { icon: 'list', label: 'Accordion', sub: 'Collapsible section', md: ':::details Section title\nHidden content.\n:::', key: 'accordion details collapsible toggle' },
    { icon: 'table', label: 'Table', sub: '2-column table', md: '| Column | Column |\n| --- | --- |\n| Cell | Cell |\n| Cell | Cell |', key: 'table grid' },
    { icon: 'files', label: 'Card grid', sub: 'Two info cards', md: '<div class="md-cards cols-2">\n  <div class="md-card"><div class="md-card-title">Title</div><div class="md-card-body">Body text.</div></div>\n  <div class="md-card"><div class="md-card-title">Title</div><div class="md-card-body">Body text.</div></div>\n</div>', key: 'card grid cards' },
    { icon: 'file', label: 'Steps', sub: 'Numbered steps', md: '1. **First step** — describe it.\n2. **Second step** — describe it.\n3. **Third step** — describe it.', key: 'steps numbered procedure' },
    { icon: 'code', label: 'Code block', sub: 'Fenced code', md: '```\ncode here\n```', key: 'code block fenced' },
    { icon: 'shield', label: 'Badge', sub: 'Inline label', md: '<span class="badge badge-internal">Badge</span>', key: 'badge label tag' },
  ];
  var menuEl = null;

  function closeMenu() {
    if (!menuEl) return;
    document.removeEventListener('keydown', menuEl._key, true);
    document.removeEventListener('mousedown', menuEl._out);
    menuEl.remove(); menuEl = null;
  }

  function openMenu(x, y, typeable, onPick) {
    closeMenu();
    var filter = '', active = 0, filtered = INSERTS.slice();
    menuEl = document.createElement('div'); menuEl.className = 'wz-menu';
    var hint = document.createElement('div'); hint.className = 'wz-menu-hint';
    var list = document.createElement('div');
    menuEl.appendChild(hint); menuEl.appendChild(list);
    function draw() {
      filtered = INSERTS.filter(function (it) { return !filter || (it.label + ' ' + it.key).toLowerCase().indexOf(filter.toLowerCase()) !== -1; });
      if (active >= filtered.length) active = Math.max(0, filtered.length - 1);
      hint.textContent = typeable ? ('/' + filter) : 'Insert block';
      list.innerHTML = filtered.map(function (it, i) {
        return '<div class="wz-menu-item' + (i === active ? ' active' : '') + '" data-i="' + i + '"><span class="ic ic-' + it.icon + '"></span><span>' + it.label + '<small>' + it.sub + '</small></span></div>';
      }).join('') || '<div class="wz-menu-empty">No matching blocks</div>';
    }
    draw();
    menuEl.style.position = 'fixed';
    menuEl.style.top = Math.min(y, window.innerHeight - 340) + 'px';
    menuEl.style.left = Math.min(Math.max(12, x), window.innerWidth - 280) + 'px';
    document.body.appendChild(menuEl);
    list.addEventListener('mousedown', function (e) { var it = e.target.closest('.wz-menu-item'); if (it) { e.preventDefault(); var item = filtered[+it.getAttribute('data-i')]; closeMenu(); onPick(item); } });
    menuEl._key = function (e) {
      if (!menuEl) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, filtered.length - 1); draw(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); draw(); }
      else if (e.key === 'Enter') { e.preventDefault(); var it = filtered[active]; closeMenu(); if (it) onPick(it); }
      else if (e.key === 'Escape') { e.preventDefault(); closeMenu(); }
      else if (typeable) {
        if (e.key === 'Backspace') { e.preventDefault(); if (filter) { filter = filter.slice(0, -1); active = 0; draw(); } else closeMenu(); }
        else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) { e.preventDefault(); filter += e.key; active = 0; draw(); }
      }
    };
    menuEl._out = function (e) { if (menuEl && !menuEl.contains(e.target)) closeMenu(); };
    document.addEventListener('keydown', menuEl._key, true);
    setTimeout(function () { document.addEventListener('mousedown', menuEl._out); }, 0);
  }

  function applyPick(item) {
    if (!item) return;
    if (item.cmd) exec(item.cmd); else insertBlock(item.md);
  }

  function openInsertButtonMenu() {
    var btn = document.querySelector('[data-cmd="insert"]');
    var r = btn.getBoundingClientRect();
    openMenu(r.left - 120, r.bottom + 6, false, applyPick);
  }

  function insertBlock(mdText) {
    var seg = tokenize(mdText)[0] || { type: 'block', kind: 'html', md: mdText };
    var node = seg.type === 'rt' ? makeRt(seg.md) : makeBlock(seg);
    var ref = currentRt();
    if (ref && ref.parentNode === wzEditor) ref.after(node); else wzEditor.appendChild(node);
    ensureTrailingRt(); afterStructuralChange();
    node.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  wzEditor.addEventListener('keydown', function (e) {
    if (e.key !== '/' || menuEl) return;
    var rt = e.target.closest ? e.target.closest('.wz-rt') : null;
    if (!rt || rt.classList.contains('wz-co-body')) return;
    var sel = window.getSelection(); if (!sel.rangeCount) return;
    var node = sel.anchorNode;
    var blockText = (node && node.textContent ? node.textContent : '').replace(/​/g, '');
    if (blockText.trim() !== '') return;
    e.preventDefault();
    var rect = sel.getRangeAt(0).getClientRects()[0] || rt.getBoundingClientRect();
    openMenu(rect.left, rect.bottom + 4, true, applyPick);
  });

  // ============================ right-click context menu ===================
  var ctxEl = null;
  function closeCtx() { if (ctxEl) { ctxEl.remove(); ctxEl = null; document.removeEventListener('mousedown', ctxOut, true); document.removeEventListener('keydown', ctxKey, true); } }
  function ctxOut(e) { if (ctxEl && !ctxEl.contains(e.target)) closeCtx(); }
  function ctxKey(e) { if (e.key === 'Escape') closeCtx(); }
  function buildCtx(x, y, items) {
    closeCtx();
    ctxEl = document.createElement('div'); ctxEl.className = 'wz-ctx';
    ctxEl.innerHTML = items.map(function (it) {
      if (it.sep) return '<div class="wz-ctx-sep"></div>';
      return '<button type="button" class="wz-ctx-item' + (it.danger ? ' danger' : '') + (it.disabled ? ' disabled' : '') + '"' + (it.disabled ? ' disabled' : '') + '>' + (it.icon ? '<span class="ic ic-' + it.icon + '"></span>' : '<span class="wz-ctx-ico"></span>') + '<span>' + it.label + '</span>' + (it.key ? '<kbd>' + it.key + '</kbd>' : '') + '</button>';
    }).join('');
    document.body.appendChild(ctxEl);
    ctxEl.style.position = 'fixed';
    ctxEl.style.left = Math.min(x, window.innerWidth - ctxEl.offsetWidth - 8) + 'px';
    ctxEl.style.top = Math.min(y, window.innerHeight - ctxEl.offsetHeight - 8) + 'px';
    var btns = ctxEl.querySelectorAll('.wz-ctx-item');
    var real = items.filter(function (it) { return !it.sep; });
    Array.prototype.forEach.call(btns, function (b, i) {
      if (real[i].disabled) return;
      b.addEventListener('click', function () { closeCtx(); real[i].action(); });
    });
    setTimeout(function () { document.addEventListener('mousedown', ctxOut, true); document.addEventListener('keydown', ctxKey, true); }, 0);
  }
  function moveBlock(node, dir) {
    if (dir < 0 && node.previousElementSibling) node.previousElementSibling.before(node);
    else if (dir > 0 && node.nextElementSibling) node.nextElementSibling.after(node);
    ensureTrailingRt(); afterStructuralChange();
  }
  function duplicateBlock(node) {
    var seg = tokenize(node._md || '')[0];
    var copy = seg ? makeBlock(seg) : null;
    if (copy) { node.after(copy); ensureTrailingRt(); afterStructuralChange(); }
  }
  wzEditor.addEventListener('contextmenu', function (e) {
    // let the native menu through with Shift (spellcheck, etc.)
    if (e.shiftKey) return;
    var block = e.target.closest ? e.target.closest('.wz-block') : null;
    var rt = e.target.closest ? e.target.closest('.wz-rt') : null;
    var items;
    if (block && !block.classList.contains('wz-inline-block')) {
      var isCards = block.dataset.kind === 'html' && /md-cards/.test(block._md || '');
      items = [
        { label: 'Edit block', icon: 'edit', action: function () { var prev = block.querySelector('.wz-block-preview'); if (isCards) openCardModal(block, prev); else openBlockModal(block, prev); } },
        { label: 'Duplicate', icon: 'files', action: function () { duplicateBlock(block); } },
        { sep: true },
        { label: 'Move up', icon: 'chart', disabled: !block.previousElementSibling, action: function () { moveBlock(block, -1); } },
        { label: 'Move down', icon: 'chart', disabled: !block.nextElementSibling, action: function () { moveBlock(block, 1); } },
        { sep: true },
        { label: 'Delete block', icon: 'trash', danger: true, action: function () { block.remove(); ensureTrailingRt(); afterStructuralChange(); } },
      ];
    } else if (rt || block) {
      // rich-text (or inline callout body): formatting + insert actions
      if (rt) lastRt = rt;
      items = [
        { label: 'Bold', icon: 'bold', key: 'Ctrl B', action: function () { exec('bold'); } },
        { label: 'Italic', icon: 'italic', action: function () { exec('italic'); } },
        { label: 'Link', icon: 'link', key: 'Ctrl K', action: function () { exec('link'); } },
        { label: 'Inline code', icon: 'code', action: function () { exec('code'); } },
        { sep: true },
        { label: 'Heading', icon: 'heading', action: function () { exec('h2'); } },
        { label: 'Subheading', icon: 'heading', action: function () { exec('h3'); } },
        { label: 'Bulleted list', icon: 'list', action: function () { exec('ul'); } },
        { sep: true },
        { label: 'Insert icon…', icon: 'star', action: function () { exec('icon'); } },
        { label: 'Insert block…', icon: 'plus', action: function () { var r = wzEditor.getBoundingClientRect(); openMenu(e.clientX, e.clientY, false, applyPick); } },
      ];
    } else { return; }
    e.preventDefault();
    buildCtx(e.clientX, e.clientY, items);
  });

  // ============================ drag & drop reorder ========================
  var dragNode = null, dropLine = null;
  function ensureDropLine() {
    if (!dropLine) { dropLine = document.createElement('div'); dropLine.className = 'wz-drop-line'; }
    return dropLine;
  }
  wzEditor.addEventListener('dragstart', function (e) {
    var handle = e.target.closest ? e.target.closest('.wz-drag') : null;
    if (!handle) { e.preventDefault(); return; }
    dragNode = handle.closest('.wz-block');
    if (dragNode) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', 'block'); } catch (x) {} dragNode.classList.add('dragging'); }
  });
  wzEditor.addEventListener('dragover', function (e) {
    if (!dragNode) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    var target = e.target.closest ? e.target.closest('.wz-editor > *') : null;
    var line = ensureDropLine();
    if (!target || target === dragNode || target === dropLine) return;
    var r = target.getBoundingClientRect();
    if (e.clientY < r.top + r.height / 2) target.before(line); else target.after(line);
  });
  wzEditor.addEventListener('drop', function (e) {
    if (!dragNode) return;
    e.preventDefault();
    if (dropLine && dropLine.parentNode) { dropLine.replaceWith(dragNode); }
    dragNode.classList.remove('dragging');
    dragNode = null;
    if (dropLine) dropLine.remove();
    ensureTrailingRt(); afterStructuralChange();
  });
  wzEditor.addEventListener('dragend', function () {
    if (dragNode) dragNode.classList.remove('dragging');
    dragNode = null;
    if (dropLine) dropLine.remove();
  });

  // ============================ settings sidebar ==========================
  var settingsSide = document.getElementById('settingsSide');
  var settingsToggle = document.getElementById('settingsToggle');
  function setSettings(open) {
    settingsSide.classList.toggle('open', open);
    settingsToggle.classList.toggle('active', open);
    try { localStorage.setItem('vcfEditorSettings', open ? '1' : '0'); } catch (e) {}
  }
  settingsToggle.addEventListener('click', function () { setSettings(!settingsSide.classList.contains('open')); });
  document.getElementById('settingsClose').addEventListener('click', function () { setSettings(false); });
  var settingsPref = '1';
  try { settingsPref = localStorage.getItem('vcfEditorSettings') || (isNew ? '1' : '0'); } catch (e) {}
  setSettings(settingsPref === '1' || isNew);

  // ================= shared doc (Yjs) — undo/redo + live collab ============
  var Y = window.YB && window.YB.Y;
  var awarenessProto = window.YB && window.YB.awarenessProtocol;
  var doc = null, ytext = null, undoMgr = null, awareness = null, ws = null;
  var collabLive = false, applyingRemote = false;
  var chips = document.getElementById('collabChips');

  function colorFor(name) {
    var h = 0; for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
    return 'hsl(' + h + ', 70%, 55%)';
  }

  function diffApply(oldStr, newStr, origin) {
    if (oldStr === newStr) return;
    var a = 0, maxA = Math.min(oldStr.length, newStr.length);
    while (a < maxA && oldStr[a] === newStr[a]) a++;
    var b = 0;
    while (b < Math.min(oldStr.length, newStr.length) - a && oldStr[oldStr.length - 1 - b] === newStr[newStr.length - 1 - b]) b++;
    doc.transact(function () {
      if (oldStr.length - a - b > 0) ytext.delete(a, oldStr.length - a - b);
      var ins = newStr.slice(a, newStr.length - b);
      if (ins) ytext.insert(a, ins);
    }, origin);
  }

  var flushT = null;
  function scheduleFlush() { clearTimeout(flushT); flushT = setTimeout(flushLocal, 300); }
  function flushLocal() {
    clearTimeout(flushT); flushT = null;
    if (!ytext || applyingRemote) return;
    var domMd = current === 'markdown' ? md.value : serialize();
    diffApply(ytext.toString(), domMd, 'local');
    if (current !== 'markdown') md.value = ytext.toString();
  }
  function afterStructuralChange() { markDirty(); flushLocal(); }

  // Reconcile the WYSIWYG surface with the shared doc, reusing untouched
  // segment nodes so remote edits in other paragraphs never disturb your caret.
  function reconcile(src) {
    var segs = tokenize(src);
    if (!segs.length) segs = [{ type: 'rt', md: '' }];
    var oldNodes = Array.prototype.slice.call(wzEditor.children).filter(function (n) { return !n.classList.contains('wz-drop-line'); });
    var used = new Array(oldNodes.length).fill(false);
    function nodeMd(n) {
      if (n.classList.contains('wz-block')) return (n._md || '').trim();
      return n._mdCache !== undefined ? n._mdCache : htmlToMd(n).trim();
    }
    var frag = [];
    segs.forEach(function (s) {
      var want = s.md.trim();
      for (var i = 0; i < oldNodes.length; i++) {
        if (used[i]) continue;
        var n = oldNodes[i];
        var isBlock = n.classList.contains('wz-block');
        if ((s.type === 'block') === isBlock && nodeMd(n) === want) { used[i] = true; frag.push(n); return; }
      }
      frag.push(s.type === 'rt' ? makeRt(s.md) : makeBlock(s));
    });
    // preserve focused rt with unflushed local edits if its segment vanished remotely? — no:
    // remote is authoritative for segments it changed; unflushed same-segment edits are dropped.
    applyingRemote = true;
    wzEditor.innerHTML = '';
    frag.forEach(function (n) { wzEditor.appendChild(n); });
    ensureTrailingRt();
    applyingRemote = false;
  }

  function applyRemote() {
    var src = ytext.toString();
    if (current === 'markdown') {
      var s = md.selectionStart, e = md.selectionEnd, before = md.value;
      // keep the caret roughly anchored through remote edits
      var relPosOk = document.activeElement === md;
      md.value = src;
      if (relPosOk) {
        var delta = src.length - before.length;
        md.selectionStart = Math.max(0, Math.min(src.length, s + (s > src.length / 2 ? delta : 0)));
        md.selectionEnd = Math.max(0, Math.min(src.length, e + (e > src.length / 2 ? delta : 0)));
      }
    } else if (current === 'wysiwyg') {
      reconcile(src);
      md.value = src;
    } else {
      md.value = src;
    }
  }

  function doUndo() { if (undoMgr) { flushLocal(); undoMgr.undo(); } }
  function doRedo() { if (undoMgr) { flushLocal(); undoMgr.redo(); } }

  function renderChips(states) {
    if (!chips) return;
    var seen = {};
    var html = '';
    states.forEach(function (st) {
      if (!st || !st.name || st.name === myName || seen[st.name]) return;
      seen[st.name] = 1;
      html += '<span class="collab-chip" style="--c:' + st.color + '">' + st.name + '</span>';
    });
    chips.innerHTML = html;
    if (collabLive) setState(html ? 'Live · co-editing' : 'Live', 'saved');
    renderSegTags(states);
  }
  function renderSegTags(states) {
    wzEditor.querySelectorAll('.wz-peer-tag').forEach(function (t) { t.remove(); });
    wzEditor.querySelectorAll('.peer-focus').forEach(function (n) { n.classList.remove('peer-focus'); n.style.removeProperty('--peer-c'); });
    var children = wzEditor.children;
    states.forEach(function (st) {
      if (!st || !st.name || st.name === myName || typeof st.seg !== 'number') return;
      var node = children[st.seg];
      if (!node) return;
      node.classList.add('peer-focus');
      node.style.setProperty('--peer-c', st.color);
      var tag = document.createElement('span');
      tag.className = 'wz-peer-tag'; tag.textContent = st.name; tag.style.background = st.color;
      node.appendChild(tag);
    });
  }

  var presenceT = null;
  function updatePresence() {
    if (!awareness || presenceT) return;
    presenceT = setTimeout(function () {
      presenceT = null;
      var idx = -1;
      var el = document.activeElement;
      var top = el && el.closest ? el.closest('.wz-editor > *') : null;
      if (top) idx = Array.prototype.indexOf.call(wzEditor.children, top);
      awareness.setLocalState({ name: myName, color: colorFor(myName), seg: idx });
    }, 200);
  }
  document.addEventListener('selectionchange', function () { if (current === 'wysiwyg') updatePresence(); });

  function connectCollab() {
    if (!Y || isNew) return; // new pages have no slug yet; collab starts after first save
    doc = new Y.Doc();
    var text = doc.getText('content');
    var synced = false, offline = false;

    // Binding starts once the doc holds authoritative content. Seeding each
    // client with its own copy would duplicate the page on CRDT merge — the
    // SERVER state is the source of truth; offline mode seeds locally instead.
    function bind() {
      if (ytext) return;
      ytext = text;
      undoMgr = new Y.UndoManager(text, { trackedOrigins: new Set(['local']) });
      text.observe(function (ev, tr) {
        if (tr.origin === 'local') return;
        applyRemote();
        if (collabLive) markDirty();
      });
    }

    doc.on('update', function (update, origin) {
      if (origin !== 'ws' && !offline && ws && ws.readyState === 1 && synced) send(2, update);
    });
    function send(type, payload) {
      var buf = new Uint8Array(1 + payload.length);
      buf[0] = type; buf.set(payload, 1);
      ws.send(buf);
    }

    // If the socket can't sync quickly, fall back to a local doc: undo/redo
    // still works, saving works, just no live collaboration this page load.
    var fallbackT = setTimeout(function () {
      if (synced) return;
      offline = true;
      try { if (ws) ws.close(); } catch (e) {}
      text.insert(0, md.value);
      bind();
    }, 2500);

    if (!window.WebSocket) { clearTimeout(fallbackT); offline = true; text.insert(0, md.value); bind(); return; }
    var attempts = 0;
    function open() {
      if (offline) return;
      var proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
      try { ws = new WebSocket(proto + location.host + '/ws/edit?slug=' + encodeURIComponent(originalSlug)); } catch (e) { return; }
      ws.binaryType = 'arraybuffer';
      ws.onopen = function () {
        if (offline) { try { ws.close(); } catch (e) {} return; }
        attempts = 0;
        // Reconnect: share offline-accumulated ops (same doc lineage — safe).
        // First connect: send nothing; the server's state frame is authoritative.
        if (synced) send(1, Y.encodeStateAsUpdate(doc));
      };
      ws.onmessage = function (ev) {
        var buf = new Uint8Array(ev.data);
        if (!buf.length) return;
        var type = buf[0], payload = buf.subarray(1);
        if (type === 1 || type === 2) {
          if (synced) flushLocal();
          Y.applyUpdate(doc, payload, 'ws');
          if (!synced && type === 1) {
            synced = true;
            clearTimeout(fallbackT);
            bind();
            collabLive = true;
            setState('Live', 'saved');
            applyRemote();
            startAwareness();
          }
        } else if (type === 3 && awareness) {
          awarenessProto.applyAwarenessUpdate(awareness, payload, 'ws');
        }
      };
      ws.onclose = function () {
        var wasLive = collabLive;
        collabLive = false;
        if (offline) return;
        if (wasLive) setState(dirty ? 'Offline — unsaved changes' : 'Offline', dirty ? 'dirty' : '');
        if (chips) chips.innerHTML = '';
        attempts++;
        setTimeout(open, Math.min(10000, 1000 * Math.pow(2, attempts)));
      };
      ws.onerror = function () { try { ws.close(); } catch (e) {} };
      // reconnects flip collabLive back on once the server state round-trips
      var prevOnMessage = ws.onmessage;
      ws.onmessage = function (ev) {
        prevOnMessage(ev);
        if (synced && !collabLive && ws.readyState === 1) { collabLive = true; setState('Live', 'saved'); }
      };
    }
    function startAwareness() {
      if (awareness || !awarenessProto) return;
      awareness = new awarenessProto.Awareness(doc);
      awareness.on('update', function (changes, origin) {
        if (origin !== 'ws' && ws && ws.readyState === 1) {
          send(3, awarenessProto.encodeAwarenessUpdate(awareness, [doc.clientID]));
        }
        var states = [];
        awareness.getStates().forEach(function (st) { states.push(st); });
        renderChips(states);
      });
      awareness.setLocalState({ name: myName, color: colorFor(myName), seg: -1 });
    }
    open();
  }

  // ============================ mode switching =============================
  function syncFromCurrent() { flushLocal(); if (!ytext && current === 'wysiwyg') md.value = serialize(); }
  function setMode(mode) {
    if (mode === current) return;
    try { syncFromCurrent(); } catch (e) { console.error(e); }
    current = mode;
    wzPane.hidden = mode !== 'wysiwyg';
    mdPane.hidden = mode !== 'markdown';
    previewPane.hidden = mode !== 'preview';
    document.querySelectorAll('#modeTabs button').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-mode') === mode); });
    if (ytext) md.value = ytext.toString();
    if (mode === 'wysiwyg') { try { renderEditor(md.value); } catch (e) { console.error(e); } }
    if (mode === 'preview') fetchPreview(md.value, preview);
  }
  document.getElementById('modeTabs').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-mode]'); if (b) setMode(b.getAttribute('data-mode'));
  });

  // ============================ dirty + save ==============================
  wzEditor.addEventListener('input', function () { markDirty(); scheduleFlush(); });
  md.addEventListener('input', function () { markDirty(); scheduleFlush(); });
  Object.keys(F).forEach(function (k) { if (F[k]) F[k].addEventListener('input', markDirty); });

  var slugTouched = !isNew;
  if (F.slug) F.slug.addEventListener('input', function () { slugTouched = true; });
  if (isNew && F.title) F.title.addEventListener('input', function () {
    if (slugTouched) return;
    var base = F.title.value.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-');
    F.slug.value = F.group.value ? (F.group.value.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '/' + base) : base;
  });

  function save() {
    try { syncFromCurrent(); } catch (e) { console.error(e); }
    if (ytext) md.value = ytext.toString();
    setState('Saving…');
    var payload = {
      _csrf: csrf, slug: F.slug.value, title: F.title.value, description: F.desc.value,
      group_name: F.group.value, icon: F.icon.value, sort: F.sort.value,
      internal: F.internal.checked ? 1 : 0, division: F.division ? F.division.value : '', content: md.value,
    };
    fetch('/admin/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json(); }).then(function (d) {
        if (!d.ok) { setState(d.error || 'Save failed', 'error'); return; }
        dirty = false; setState(d.unchanged ? 'No changes' : 'Saved', 'saved');
        if (isNew || d.slug !== originalSlug) window.location.href = '/admin/edit?slug=' + encodeURIComponent(d.slug);
      }).catch(function () { setState('Network error', 'error'); });
  }
  saveBtn.addEventListener('click', save);
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    else if (current === 'wysiwyg' && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); exec('link'); }
    else if (undoMgr && current === 'wysiwyg' && (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'z') {
      e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo();
    } else if (undoMgr && current === 'wysiwyg' && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault(); doRedo();
    }
  });
  window.addEventListener('beforeunload', function (e) { if (dirty && !collabLive) { e.preventDefault(); e.returnValue = ''; } });

  var delBtn = document.getElementById('deleteBtn');
  if (delBtn) delBtn.addEventListener('click', function () {
    askConfirm('Delete this page? This cannot be undone.', function () {
      fetch('/admin/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ _csrf: csrf, slug: originalSlug }) })
        .then(function (r) { return r.json(); }).then(function (d) { if (d.ok) { dirty = false; window.location.href = '/admin/pages'; } });
    });
  });
  document.querySelectorAll('.restore-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      askConfirm('Restore this revision? Current content will be replaced.', function () {
        fetch('/admin/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ _csrf: csrf, id: b.getAttribute('data-id') }) })
          .then(function (r) { return r.json(); }).then(function (d) { if (d.ok) window.location.reload(); });
      });
    });
  });

  // ============================ init ======================================
  try {
    renderEditor(md.value);
    setState(isNew ? 'New page' : '');
    connectCollab();
  } catch (e) {
    console.error('WYSIWYG init failed, using Markdown mode', e);
    current = 'markdown'; wzPane.hidden = true; mdPane.hidden = false;
    document.querySelectorAll('#modeTabs button').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-mode') === 'markdown'); });
  }
})();
