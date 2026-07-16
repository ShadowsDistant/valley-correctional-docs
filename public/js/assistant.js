// VCF Assistant — floating AI helper for logged-in staff. Grounded in the
// documentation the current user can access (the server builds that context);
// streams the model's thinking and answer live. Lives outside <main>, so it
// survives client-side (PJAX) navigation untouched.
(function () {
  'use strict';
  if (!document.body.hasAttribute('data-authed') || window.__vcfAssistant) return;
  window.__vcfAssistant = true;

  // ---------- tiny safe markdown renderer ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function inline(s) {
    return s
      .replace(/`([^`]+)`/g, function (m, c) { return '<code>' + c + '</code>'; })
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((\/[^)\s]+)\)/g, '<a href="$2">$1</a>'); // same-site links only
  }
  function mdLite(src) {
    var lines = esc(String(src || '')).split('\n');
    var out = [], list = null, code = false, codeBuf = [];
    function closeList() { if (list) { out.push(list === 'ul' ? '</ul>' : '</ol>'); list = null; } }
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (/^```/.test(l)) { if (code) { out.push('<pre><code>' + codeBuf.join('\n') + '</code></pre>'); codeBuf = []; } code = !code; continue; }
      if (code) { codeBuf.push(l); continue; }
      // pipe table: consume the whole run of |-rows at once
      if (/^\s*\|.*\|\s*$/.test(l)) {
        closeList();
        var rows = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(lines[i].trim()); i++; }
        i--;
        var t = '<table class="ai-table">';
        rows.forEach(function (row, ri) {
          var cells = row.replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (c) { return c.trim(); });
          if (cells.every(function (c) { return /^:?-{2,}:?$/.test(c); })) return; // separator row
          var tag = ri === 0 ? 'th' : 'td';
          t += '<tr>' + cells.map(function (c) { return '<' + tag + '>' + inline(c) + '</' + tag + '>'; }).join('') + '</tr>';
        });
        out.push(t + '</table>');
        continue;
      }
      var h = /^(#{1,4})\s+(.*)$/.exec(l);
      var ul = /^\s*[-*]\s+(.*)$/.exec(l);
      var ol = /^\s*\d+[.)]\s+(.*)$/.exec(l);
      if (h) { closeList(); out.push('<h4>' + inline(h[2]) + '</h4>'); }
      else if (ul) { if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; } out.push('<li>' + inline(ul[1]) + '</li>'); }
      else if (ol) { if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; } out.push('<li>' + inline(ol[1]) + '</li>'); }
      else if (!l.trim()) { closeList(); }
      else { closeList(); out.push('<p>' + inline(l) + '</p>'); }
    }
    if (code && codeBuf.length) out.push('<pre><code>' + codeBuf.join('\n') + '</code></pre>');
    closeList();
    return out.join('');
  }

  // ---------- DOM ----------
  var fab = document.createElement('button');
  fab.id = 'aiFab'; fab.type = 'button';
  fab.setAttribute('aria-label', 'Open the VCF Assistant');
  fab.setAttribute('data-tip', 'Ask the VCF Assistant'); fab.setAttribute('data-tip-pos', 'left');
  fab.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7L12 3z"/><path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14z"/></svg>';

  var panel = document.createElement('div');
  panel.id = 'aiPanel'; panel.hidden = true;
  panel.innerHTML =
    '<div class="ai-head">' +
      '<span class="ai-head-ico"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7L12 3z"/></svg></span>' +
      '<div class="ai-head-t"><strong>VCF Assistant</strong><span>Answers from your documentation</span></div>' +
      '<button type="button" class="ai-head-btn" id="aiClear" data-tip="New conversation" data-tip-pos="bottom"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg></button>' +
      '<button type="button" class="ai-head-btn" id="aiClose" aria-label="Close"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>' +
    '</div>' +
    '<div class="ai-msgs" id="aiMsgs"></div>' +
    '<div class="ai-composer">' +
      '<textarea id="aiInput" rows="1" placeholder="Ask about any handbook or policy…" maxlength="4000"></textarea>' +
      '<button type="button" id="aiSend" aria-label="Send"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg></button>' +
    '</div>';

  document.body.appendChild(fab);
  document.body.appendChild(panel);

  var msgsEl = panel.querySelector('#aiMsgs');
  var input = panel.querySelector('#aiInput');
  var sendBtn = panel.querySelector('#aiSend');

  // ---------- state (survives full loads within the tab) ----------
  var history = [];
  try { history = JSON.parse(sessionStorage.getItem('vcfAiChat') || '[]') || []; } catch (e) { history = []; }
  function persist() { try { sessionStorage.setItem('vcfAiChat', JSON.stringify(history.slice(-12))); } catch (e) {} }

  var streaming = false, aborter = null;

  function scrollBottom() { msgsEl.scrollTop = msgsEl.scrollHeight; }
  function addUser(text) {
    var d = document.createElement('div'); d.className = 'ai-msg ai-user';
    d.innerHTML = '<div class="ai-bubble">' + esc(text) + '</div>';
    msgsEl.appendChild(d); scrollBottom();
  }
  function addAssistantShell() {
    var d = document.createElement('div'); d.className = 'ai-msg ai-bot';
    d.innerHTML =
      '<div class="ai-think" hidden>' +
        '<button type="button" class="ai-think-toggle"><span class="ai-think-dot"></span><span class="ai-think-label">Thinking…</span><svg class="ai-think-caret" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg></button>' +
        '<div class="ai-think-body"></div>' +
      '</div>' +
      '<div class="ai-bubble ai-answer"><span class="ai-cursor"></span></div>';
    msgsEl.appendChild(d); scrollBottom();
    var think = d.querySelector('.ai-think');
    think.querySelector('.ai-think-toggle').addEventListener('click', function () { think.classList.toggle('open'); scrollBottom(); });
    return d;
  }
  function renderEmpty() {
    if (msgsEl.children.length) return;
    var w = document.createElement('div'); w.className = 'ai-empty';
    w.innerHTML =
      '<div class="ai-empty-ico"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7L12 3z"/><path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14z"/></svg></div>' +
      '<p>Ask me anything covered by the documentation you have access to — handbooks, policies, procedures.</p>' +
      '<div class="ai-sugg">' +
        '<button type="button">What are the punishment escalation steps?</button>' +
        '<button type="button">How do I report a document leak?</button>' +
        '<button type="button">What does the staff policy say about screenshots?</button>' +
      '</div>';
    msgsEl.appendChild(w);
    w.querySelector('.ai-sugg').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      input.value = b.textContent; send();
    });
  }
  function restore() {
    msgsEl.innerHTML = '';
    history.forEach(function (m) {
      if (m.role === 'user') addUser(m.content);
      else {
        var d = document.createElement('div'); d.className = 'ai-msg ai-bot';
        d.innerHTML = '<div class="ai-bubble ai-answer">' + mdLite(m.content) + '</div>';
        msgsEl.appendChild(d);
      }
    });
    renderEmpty(); scrollBottom();
  }

  function setStreaming(on) {
    streaming = on;
    sendBtn.innerHTML = on
      ? '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>'
      : '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>';
    sendBtn.setAttribute('aria-label', on ? 'Stop' : 'Send');
  }

  function send() {
    var q = input.value.trim();
    if (streaming) { if (aborter) aborter.abort(); return; }
    if (!q) return;
    var empty = msgsEl.querySelector('.ai-empty'); if (empty) empty.remove();
    input.value = ''; input.style.height = 'auto';
    addUser(q);
    history.push({ role: 'user', content: q }); persist();

    var shell = addAssistantShell();
    var thinkEl = shell.querySelector('.ai-think');
    var thinkBody = shell.querySelector('.ai-think-body');
    var thinkLabel = shell.querySelector('.ai-think-label');
    var answerEl = shell.querySelector('.ai-answer');
    var thinkTxt = '', answerTxt = '', thinkStart = 0, answering = false;

    aborter = (window.AbortController ? new AbortController() : null);
    setStreaming(true);

    fetch('/api/ai/chat', {
      method: 'POST',
      signal: aborter && aborter.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: history.slice(-12) }),
    }).then(function (r) {
      if (!r.ok || !r.body) return r.json().then(function (j) { throw new Error((j && j.error) || 'Request failed (' + r.status + ')'); }, function () { throw new Error('Request failed (' + r.status + ')'); });
      var reader = r.body.getReader(), dec = new TextDecoder(), buf = '';
      function finishThinking() {
        if (!thinkStart || answering) return;
        answering = true;
        var secs = Math.max(1, Math.round((Date.now() - thinkStart) / 1000));
        thinkLabel.textContent = 'Thought for ' + secs + 's';
        thinkEl.classList.remove('open'); thinkEl.classList.add('done');
      }
      function pump() {
        return reader.read().then(function (step) {
          if (step.done) return;
          buf += dec.decode(step.value, { stream: true });
          var lines = buf.split('\n'); buf = lines.pop();
          lines.forEach(function (line) {
            var s = line.trim(); if (s.indexOf('data:') !== 0) return;
            var j; try { j = JSON.parse(s.slice(5)); } catch (e) { return; }
            if (j.t === 'think') {
              if (!thinkStart) { thinkStart = Date.now(); thinkEl.hidden = false; thinkEl.classList.add('open'); }
              thinkTxt += j.d; thinkBody.textContent = thinkTxt; scrollBottom();
            } else if (j.t === 'text') {
              finishThinking();
              answerTxt += j.d;
              answerEl.innerHTML = mdLite(answerTxt) + '<span class="ai-cursor"></span>';
              scrollBottom();
            } else if (j.t === 'err') { throw new Error(j.d); }
          });
          return pump();
        });
      }
      return pump();
    }).then(function () {
      finishUp();
    }).catch(function (e) {
      if (e && e.name === 'AbortError') { finishUp(true); return; }
      answerEl.innerHTML = '<span class="ai-err">' + esc((e && e.message) || 'Something went wrong — please try again.') + '</span>';
      finishUp(true);
    });

    function finishUp(failed) {
      setStreaming(false); aborter = null;
      var cur = answerEl.querySelector('.ai-cursor'); if (cur) cur.remove();
      if (!answering && thinkStart) { // stream ended while still thinking
        thinkLabel.textContent = 'Thought for ' + Math.max(1, Math.round((Date.now() - thinkStart) / 1000)) + 's';
        thinkEl.classList.remove('open'); thinkEl.classList.add('done');
      }
      if (answerTxt) { history.push({ role: 'assistant', content: answerTxt }); persist(); }
      else if (!failed) { answerEl.innerHTML = '<span class="ai-err">No answer received — please try again.</span>'; }
      scrollBottom();
    }
  }

  // ---------- wiring ----------
  function setOpen(open) {
    panel.hidden = !open;
    fab.classList.toggle('open', open);
    if (open) { restore(); setTimeout(function () { input.focus(); }, 60); }
  }
  fab.addEventListener('click', function () { setOpen(panel.hidden); });
  panel.querySelector('#aiClose').addEventListener('click', function () { setOpen(false); });
  panel.querySelector('#aiClear').addEventListener('click', function () {
    if (streaming && aborter) aborter.abort();
    history = []; persist(); msgsEl.innerHTML = ''; renderEmpty(); input.focus();
  });
  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    if (e.key === 'Escape') setOpen(false);
  });
  input.addEventListener('input', function () { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px'; });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !panel.hidden && document.activeElement !== input) setOpen(false); });
})();
