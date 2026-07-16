// VCF Assistant — floating AI helper for logged-in staff. Grounded in the
// documentation the current user can access (the server builds that context)
// and streams the model's reasoning + answer live. Conversations are stored
// server-side (this VM's own database), so history survives reloads and
// devices. Lives outside <main>, so it survives client-side navigation.
(function () {
  'use strict';
  if (!document.body.hasAttribute('data-authed') || window.__vcfAssistant) return;
  window.__vcfAssistant = true;

  // ---------- icons ----------
  var I = {
    // a message bubble with a spark in it — reads as "ask the assistant"
    mark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 11.6a8.4 8.4 0 0 1-9 8.4 8.7 8.7 0 0 1-3.5-.8L3.5 20.5l1.4-4.4a8.4 8.4 0 0 1-.9-3.8 8.4 8.4 0 0 1 8.4-8.4 8.4 8.4 0 0 1 8.1 7.7z"/><path d="M12.4 8.1l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9.9-2.3z" fill="currentColor" stroke="none"/></svg>',
    history: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 2.6-6.4"/><path d="M3 4v5h5"/><path d="M12 8v4l3 2"/></svg>',
    plus: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
    send: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>',
    stop: '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
    back: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>',
    doc: '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
  };

  // ---------- tiny safe markdown renderer ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function inline(s) {
    return s
      .replace(/\[\[([^\]|]{1,120})\|([a-z0-9][a-z0-9\/_\-]{0,120})\]\]/gi, function (m, t, slug) {
        return '<a class="ai-cite" href="/' + slug + '" target="_blank" rel="noopener" data-tip="Open source document">' + I.doc + '<span>' + t.trim() + '</span></a>';
      })
      .replace(/`([^`]+)`/g, function (m, c) { return '<code>' + c + '</code>'; })
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
  }
  function mdLite(src) {
    var lines = esc(String(src || '')).split('\n');
    var out = [], list = null, code = false, codeBuf = [];
    function closeList() { if (list) { out.push(list === 'ul' ? '</ul>' : '</ol>'); list = null; } }
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (/^```/.test(l)) { if (code) { out.push('<pre><code>' + codeBuf.join('\n') + '</code></pre>'); codeBuf = []; } code = !code; continue; }
      if (code) { codeBuf.push(l); continue; }
      if (/^\s*\|.*\|\s*$/.test(l)) {
        closeList();
        var rows = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(lines[i].trim()); i++; }
        i--;
        var t = '<table class="ai-table">';
        rows.forEach(function (row, ri) {
          var cells = row.replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (c) { return c.trim(); });
          if (cells.every(function (c) { return /^:?-{2,}:?$/.test(c); })) return;
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
  function ago(iso) {
    var d = new Date(String(iso).replace(' ', 'T') + (/[Zz+]/.test(iso) ? '' : 'Z'));
    var s = Math.max(0, (Date.now() - d.getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    if (s < 604800) return Math.floor(s / 86400) + 'd ago';
    return d.toLocaleDateString();
  }

  // ---------- DOM ----------
  var fab = document.createElement('button');
  fab.id = 'aiFab'; fab.type = 'button';
  fab.setAttribute('aria-label', 'Open the VCF Assistant');
  fab.setAttribute('data-tip', 'Ask the VCF Assistant'); fab.setAttribute('data-tip-pos', 'left');
  fab.innerHTML = I.mark;

  var panel = document.createElement('div');
  panel.id = 'aiPanel'; panel.hidden = true;
  panel.innerHTML =
    '<div class="ai-head">' +
      '<span class="ai-head-ico">' + I.mark + '</span>' +
      '<div class="ai-head-t"><strong>VCF Assistant</strong><span id="aiHeadSub">Answers from your documentation</span></div>' +
      '<button type="button" class="ai-head-btn" id="aiHistory" data-tip="Conversations" data-tip-pos="bottom" aria-label="Conversations">' + I.history + '</button>' +
      '<button type="button" class="ai-head-btn" id="aiNew" data-tip="New conversation" data-tip-pos="bottom" aria-label="New conversation">' + I.plus + '</button>' +
      '<button type="button" class="ai-head-btn" id="aiClose" aria-label="Close">' + I.close + '</button>' +
    '</div>' +
    '<div class="ai-drawer" id="aiDrawer" hidden>' +
      '<div class="ai-drawer-head"><button type="button" class="ai-head-btn" id="aiDrawerBack" aria-label="Back">' + I.back + '</button><strong>Conversations</strong></div>' +
      '<ul class="ai-chat-list" id="aiChatList"></ul>' +
    '</div>' +
    '<div class="ai-msgs" id="aiMsgs"></div>' +
    '<div class="ai-composer">' +
      '<textarea id="aiInput" rows="1" placeholder="Ask about any handbook or policy…" maxlength="4000"></textarea>' +
      '<button type="button" id="aiSend" aria-label="Send">' + I.send + '</button>' +
    '</div>' +
    '<div class="ai-hint"><kbd>Enter</kbd> send · <kbd>Shift+Enter</kbd> newline</div>';

  document.body.appendChild(fab);
  document.body.appendChild(panel);

  var msgsEl = panel.querySelector('#aiMsgs');
  var drawer = panel.querySelector('#aiDrawer');
  var listEl = panel.querySelector('#aiChatList');
  var input = panel.querySelector('#aiInput');
  var sendBtn = panel.querySelector('#aiSend');
  var headSub = panel.querySelector('#aiHeadSub');

  var chatId = null, streaming = false, aborter = null, loaded = false;

  function scrollBottom() { msgsEl.scrollTop = msgsEl.scrollHeight; }
  function addUser(text) {
    var d = document.createElement('div'); d.className = 'ai-msg ai-user';
    d.innerHTML = '<div class="ai-bubble">' + esc(text) + '</div>';
    msgsEl.appendChild(d); scrollBottom();
  }
  function thinkBlock(open) {
    return '<div class="ai-think"' + (open ? '' : ' hidden') + '>' +
      '<button type="button" class="ai-think-toggle"><span class="ai-think-dot"></span><span class="ai-think-label">Thinking…</span><svg class="ai-think-caret" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg></button>' +
      '<div class="ai-think-body"></div></div>';
  }
  function wireThink(root) {
    var think = root.querySelector('.ai-think');
    if (think) think.querySelector('.ai-think-toggle').addEventListener('click', function () { think.classList.toggle('open'); scrollBottom(); });
    return think;
  }
  function addBot(html, thinkingText) {
    var d = document.createElement('div'); d.className = 'ai-msg ai-bot';
    d.innerHTML = '<span class="ai-av">' + I.mark + '</span><div class="ai-col">' +
      (thinkingText ? thinkBlock(false) : '') +
      '<div class="ai-bubble ai-answer">' + html + '</div></div>';
    msgsEl.appendChild(d);
    if (thinkingText) {
      var th = wireThink(d);
      th.hidden = false; th.classList.add('done');
      th.querySelector('.ai-think-label').textContent = 'Reasoning';
      th.querySelector('.ai-think-body').innerHTML = mdLite(thinkingText);
    }
    return d;
  }
  function addAssistantShell() {
    var d = document.createElement('div'); d.className = 'ai-msg ai-bot';
    d.innerHTML = '<span class="ai-av">' + I.mark + '</span><div class="ai-col">' + thinkBlock(false) +
      '<div class="ai-bubble ai-answer"><span class="ai-cursor"></span></div></div>';
    msgsEl.appendChild(d); scrollBottom();
    wireThink(d);
    return d;
  }
  function renderEmpty() {
    if (msgsEl.children.length) return;
    var w = document.createElement('div'); w.className = 'ai-empty';
    w.innerHTML =
      '<div class="ai-empty-ico">' + I.mark + '</div>' +
      '<p>Ask anything covered by the documentation you have access to — handbooks, policies, procedures. Answers cite their source.</p>' +
      '<div class="ai-sugg">' +
        '<button type="button">What are the punishment escalation steps?</button>' +
        '<button type="button">How do I report a document leak?</button>' +
        '<button type="button">How many points until termination?</button>' +
      '</div>';
    msgsEl.appendChild(w);
    w.querySelector('.ai-sugg').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      input.value = b.textContent; send();
    });
  }
  function setStreaming(on) {
    streaming = on;
    sendBtn.innerHTML = on ? I.stop : I.send;
    sendBtn.setAttribute('aria-label', on ? 'Stop' : 'Send');
  }
  function setSub(t) { headSub.textContent = t; }

  // ---------- conversations ----------
  function loadList() {
    return fetch('/api/ai/chats', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) return;
      if (!d.chats.length) { listEl.innerHTML = '<li class="ai-chat-empty muted small">No saved conversations yet.</li>'; return; }
      listEl.innerHTML = d.chats.map(function (c) {
        return '<li class="ai-chat-item' + (c.id === chatId ? ' is-cur' : '') + '" data-chat="' + c.id + '">' +
          '<button type="button" class="ai-chat-open">' +
            '<span class="ai-chat-title">' + esc(c.title) + '</span>' +
            '<span class="ai-chat-meta">' + ago(c.updated_at) + ' · ' + c.n + ' message' + (c.n === 1 ? '' : 's') + '</span>' +
          '</button>' +
          '<button type="button" class="ai-chat-del" data-del="' + c.id + '" data-tip="Delete" data-tip-pos="left">' + I.trash + '</button></li>';
      }).join('');
    }).catch(function () { listEl.innerHTML = '<li class="ai-chat-empty muted small">Could not load conversations.</li>'; });
  }
  function openChat(id) {
    return fetch('/api/ai/chats/' + id, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) return;
      chatId = d.chat.id;
      msgsEl.innerHTML = '';
      d.messages.forEach(function (m) {
        if (m.role === 'user') addUser(m.content);
        else addBot(mdLite(m.content), m.thinking);
      });
      renderEmpty(); setSub(d.chat.title); showDrawer(false); scrollBottom();
    });
  }
  function newChat() {
    if (streaming && aborter) aborter.abort();
    chatId = null; msgsEl.innerHTML = ''; renderEmpty();
    setSub('Answers from your documentation'); showDrawer(false); input.focus();
  }
  var drawerAnim = null;
  function showDrawer(on) {
    if (on) {
      if (drawerAnim) { drawer.removeEventListener('animationend', drawerAnim); drawerAnim = null; }
      drawer.classList.remove('closing');
      drawer.hidden = false;
      loadList();
      return;
    }
    if (drawer.hidden || drawer.classList.contains('closing')) return;
    // Fade the drawer out before hiding it (the global [hidden] rule kills any
    // transition once hidden is set, so animate first, then hide on animationend).
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { drawer.hidden = true; return; }
    drawerAnim = function () {
      drawer.removeEventListener('animationend', drawerAnim); drawerAnim = null;
      drawer.classList.remove('closing');
      drawer.hidden = true;
    };
    drawer.addEventListener('animationend', drawerAnim);
    drawer.classList.add('closing');
  }

  listEl.addEventListener('click', function (e) {
    var del = e.target.closest('[data-del]');
    if (del) {
      var id = del.getAttribute('data-del');
      var go = function () {
        fetch('/api/ai/chats/' + id, { method: 'DELETE' }).then(function () {
          if (String(chatId) === String(id)) newChat();
          loadList();
        });
      };
      if (window.vcfConfirm) window.vcfConfirm({ title: 'Delete conversation', message: 'Delete this conversation permanently? Admins may already have reviewed it.', okLabel: 'Delete' }, go);
      else if (confirm('Delete this conversation?')) go();
      return;
    }
    var item = e.target.closest('.ai-chat-item');
    if (item) openChat(item.getAttribute('data-chat'));
  });

  // ---------- ask ----------
  function send() {
    var q = input.value.trim();
    if (streaming) { if (aborter) aborter.abort(); return; }
    if (!q) return;
    var empty = msgsEl.querySelector('.ai-empty'); if (empty) empty.remove();
    input.value = ''; input.style.height = 'auto';
    addUser(q);

    var shell = addAssistantShell();
    var thinkEl = shell.querySelector('.ai-think');
    var thinkBody = shell.querySelector('.ai-think-body');
    var thinkLabel = shell.querySelector('.ai-think-label');
    var answerEl = shell.querySelector('.ai-answer');
    var thinkTxt = '', answerTxt = '', thinkStart = 0, answering = false;

    aborter = (window.AbortController ? new AbortController() : null);
    setStreaming(true);

    function finishThinking() {
      if (!thinkStart || answering) return;
      answering = true;
      thinkLabel.textContent = 'Thought for ' + Math.max(1, Math.round((Date.now() - thinkStart) / 1000)) + 's';
      thinkEl.classList.remove('open'); thinkEl.classList.add('done');
    }

    fetch('/api/ai/chat', {
      method: 'POST',
      signal: aborter && aborter.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: chatId, message: q }),
    }).then(function (r) {
      if (!r.ok || !r.body) return r.json().then(function (j) { throw new Error((j && j.error) || 'Request failed (' + r.status + ')'); }, function () { throw new Error('Request failed (' + r.status + ')'); });
      var reader = r.body.getReader(), dec = new TextDecoder(), buf = '';
      function pump() {
        return reader.read().then(function (step) {
          if (step.done) return;
          buf += dec.decode(step.value, { stream: true });
          var lines = buf.split('\n'); buf = lines.pop();
          lines.forEach(function (line) {
            var s = line.trim(); if (s.indexOf('data:') !== 0) return;
            var j; try { j = JSON.parse(s.slice(5)); } catch (e) { return; }
            if (j.t === 'chat') { if (!chatId) { chatId = j.id; setSub(q.length > 42 ? q.slice(0, 40) + '…' : q); } }
            else if (j.t === 'think') {
              if (!thinkStart) { thinkStart = Date.now(); thinkEl.hidden = false; thinkEl.classList.add('open'); }
              thinkTxt += j.d; thinkBody.innerHTML = mdLite(thinkTxt); scrollBottom();
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
    }).then(function () { finishUp(); })
      .catch(function (e) {
        if (e && e.name === 'AbortError') { finishUp(true); return; }
        answerEl.innerHTML = '<span class="ai-err">' + esc((e && e.message) || 'Something went wrong — please try again.') + '</span>';
        finishUp(true);
      });

    function finishUp(failed) {
      setStreaming(false); aborter = null;
      var cur = answerEl.querySelector('.ai-cursor'); if (cur) cur.remove();
      if (!answering && thinkStart) {
        thinkLabel.textContent = 'Thought for ' + Math.max(1, Math.round((Date.now() - thinkStart) / 1000)) + 's';
        thinkEl.classList.remove('open'); thinkEl.classList.add('done');
      }
      if (thinkTxt && thinkEl) thinkLabel.textContent = thinkLabel.textContent.replace('Thinking…', 'Reasoning');
      if (!answerTxt && !failed) answerEl.innerHTML = '<span class="ai-err">No answer received — please try again.</span>';
      scrollBottom();
    }
  }

  // ---------- wiring ----------
  var closeTimer = null;
  function setOpen(open) {
    clearTimeout(closeTimer);
    fab.classList.toggle('open', open);
    if (open) {
      panel.classList.remove('closing');
      panel.hidden = false;
      void panel.offsetWidth;                 // restart the open animation
      panel.classList.add('opening');
      if (!loaded) { loaded = true; renderEmpty(); }
      setTimeout(function () { input.focus(); }, 80);
    } else {
      showDrawer(false);
      panel.classList.remove('opening');
      panel.classList.add('closing');
      var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      closeTimer = setTimeout(function () { panel.hidden = true; panel.classList.remove('closing'); }, reduce ? 0 : 170);
    }
  }
  fab.addEventListener('click', function () { setOpen(panel.hidden); });
  panel.querySelector('#aiClose').addEventListener('click', function () { setOpen(false); });
  panel.querySelector('#aiNew').addEventListener('click', newChat);
  panel.querySelector('#aiHistory').addEventListener('click', function () { showDrawer(drawer.hidden); });
  panel.querySelector('#aiDrawerBack').addEventListener('click', function () { showDrawer(false); });
  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    if (e.key === 'Escape') setOpen(false);
  });
  input.addEventListener('input', function () { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px'; });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !panel.hidden && document.activeElement !== input) setOpen(false); });
  window.addEventListener('pjax:load', function () { if (!panel.hidden) setOpen(false); });
})();
