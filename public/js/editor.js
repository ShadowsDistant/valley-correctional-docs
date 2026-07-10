(function () {
  'use strict';
  var shell = document.querySelector('.editor-shell');
  if (!shell) return;

  var csrf = shell.getAttribute('data-csrf');
  var isNew = shell.getAttribute('data-new') === '1';
  var originalSlug = shell.getAttribute('data-original-slug');

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
  function markDirty() { dirty = true; setState('Unsaved changes', 'dirty'); }

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

  // Convert a run of standard markdown into editable HTML blocks.
  function mdToHtml(src) {
    var blocks = String(src).split(/\n{2,}/);
    var html = '';
    blocks.forEach(function (b) {
      var lines = b.split('\n');
      // Peel any leading heading lines — headings often have no blank line
      // before the paragraph that follows them.
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
    // join list items compactly, others with blank lines
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
    return d;
  }

  function fetchPreview(mdText, target) {
    target.innerHTML = '<p class="muted">Rendering…</p>';
    fetch('/admin/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: mdText }) })
      .then(function (r) { return r.json(); }).then(function (d) { target.innerHTML = d.html || ''; })
      .catch(function () { target.innerHTML = '<p class="muted">Preview unavailable.</p>'; });
  }

  var KIND_LABEL = { callout: 'Callout', accordion: 'Accordion', table: 'Table', code: 'Code block', html: 'Card / HTML' };
  function makeBlock(seg) {
    var wrap = document.createElement('div');
    wrap.className = 'wz-block'; wrap.contentEditable = 'false'; wrap.dataset.kind = seg.kind; wrap._md = seg.md;
    var bar = document.createElement('div'); bar.className = 'wz-block-bar';
    bar.innerHTML = '<span>' + (KIND_LABEL[seg.kind] || 'Block') + '</span>';
    var actions = document.createElement('div'); actions.className = 'wz-block-actions';
    var edit = document.createElement('button'); edit.type = 'button'; edit.textContent = 'Edit';
    var del = document.createElement('button'); del.type = 'button'; del.textContent = 'Delete';
    actions.appendChild(edit); actions.appendChild(del); bar.appendChild(actions);
    var prev = document.createElement('div'); prev.className = 'wz-block-preview markdown';
    wrap.appendChild(bar); wrap.appendChild(prev);
    fetchPreview(seg.md, prev);
    edit.addEventListener('click', function () { openBlockModal(wrap, prev); });
    del.addEventListener('click', function () { if (confirm('Delete this block?')) { wrap.remove(); ensureTrailingRt(); markDirty(); } });
    return wrap;
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
      if (el.classList.contains('wz-rt')) { var t = htmlToMd(el).trim(); if (t) out.push(t); }
      else if (el.classList.contains('wz-block')) { out.push((el._md || '').trim()); }
    });
    return out.join('\n\n');
  }

  // ============================ block edit modal ===========================
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
      wrap._md = ta.value; fetchPreview(ta.value, prev); markDirty(); close();
    });
  }

  // ============================ toolbar / commands =========================
  function currentRt() {
    if (lastRt && wzEditor.contains(lastRt)) return lastRt;
    return wzEditor.querySelector('.wz-rt');
  }
  wzEditor.addEventListener('focusin', function (e) {
    var rt = e.target.closest ? e.target.closest('.wz-rt') : null;
    if (rt) lastRt = rt;
  });
  try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) {}

  function wrapCode() {
    var sel = window.getSelection(); if (!sel.rangeCount) return;
    var text = sel.toString(); if (!text) return;
    document.execCommand('insertHTML', false, '<code>' + text.replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }) + '</code>');
  }

  function exec(cmd) {
    if (cmd === 'insert') { openInsertButtonMenu(); return; }
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
    markDirty();
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
    ensureTrailingRt(); markDirty();
    node.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  // "/" on an empty line opens the slash menu at the caret.
  wzEditor.addEventListener('keydown', function (e) {
    if (e.key !== '/' || menuEl) return;
    var rt = e.target.closest ? e.target.closest('.wz-rt') : null;
    if (!rt) return;
    var sel = window.getSelection(); if (!sel.rangeCount) return;
    var node = sel.anchorNode;
    var blockText = (node && node.textContent ? node.textContent : '').replace(/​/g, '');
    if (blockText.trim() !== '') return; // only on an empty line
    e.preventDefault();
    var rect = sel.getRangeAt(0).getClientRects()[0] || rt.getBoundingClientRect();
    openMenu(rect.left, rect.bottom + 4, true, applyPick);
  });

  // ============================ mode switching =============================
  function syncFromCurrent() { if (current === 'wysiwyg') md.value = serialize(); }
  function setMode(mode) {
    if (mode === current) return;
    try { syncFromCurrent(); } catch (e) { console.error(e); }
    current = mode;
    wzPane.hidden = mode !== 'wysiwyg';
    mdPane.hidden = mode !== 'markdown';
    previewPane.hidden = mode !== 'preview';
    document.querySelectorAll('#modeTabs button').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-mode') === mode); });
    if (mode === 'wysiwyg') { try { renderEditor(md.value); } catch (e) { console.error(e); } }
    if (mode === 'preview') fetchPreview(md.value, preview);
  }
  document.getElementById('modeTabs').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-mode]'); if (b) setMode(b.getAttribute('data-mode'));
  });

  // ============================ dirty + save ==============================
  wzEditor.addEventListener('input', markDirty);
  md.addEventListener('input', markDirty);
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
    setState('Saving…');
    var payload = {
      _csrf: csrf, slug: F.slug.value, title: F.title.value, description: F.desc.value,
      group_name: F.group.value, icon: F.icon.value, sort: F.sort.value,
      internal: F.internal.checked ? 1 : 0, division: F.division ? F.division.value : '', content: md.value,
    };
    fetch('/admin/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json(); }).then(function (d) {
        if (!d.ok) { setState(d.error || 'Save failed', 'error'); return; }
        dirty = false; setState('Saved', 'saved');
        if (isNew || d.slug !== originalSlug) window.location.href = '/admin/edit?slug=' + encodeURIComponent(d.slug);
      }).catch(function () { setState('Network error', 'error'); });
  }
  saveBtn.addEventListener('click', save);
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    else if (current === 'wysiwyg' && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); exec('link'); }
  });
  window.addEventListener('beforeunload', function (e) { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  var delBtn = document.getElementById('deleteBtn');
  if (delBtn) delBtn.addEventListener('click', function () {
    if (!confirm('Delete this page? This cannot be undone.')) return;
    fetch('/admin/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ _csrf: csrf, slug: originalSlug }) })
      .then(function (r) { return r.json(); }).then(function (d) { if (d.ok) { dirty = false; window.location.href = '/admin/pages'; } });
  });
  document.querySelectorAll('.restore-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      if (!confirm('Restore this revision? Current content will be replaced.')) return;
      fetch('/admin/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ _csrf: csrf, id: b.getAttribute('data-id') }) })
        .then(function (r) { return r.json(); }).then(function (d) { if (d.ok) window.location.reload(); });
    });
  });

  // ============================ init ======================================
  try { renderEditor(md.value); setState(isNew ? 'New page' : ''); }
  catch (e) { console.error('WYSIWYG init failed, using Markdown mode', e); current = 'markdown'; wzPane.hidden = true; mdPane.hidden = false; document.querySelectorAll('#modeTabs button').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-mode') === 'markdown'); }); }
})();
