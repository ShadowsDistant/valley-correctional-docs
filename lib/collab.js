'use strict';
// Realtime co-editing for the page editor. One Y.Doc per page slug lives in
// memory (single-process app); clients exchange Yjs updates + awareness over
// a WebSocket at /ws/edit?slug=…, authenticated with the normal session
// cookie. The doc's Y.Text('content') holds the page markdown and is
// persisted (debounced) back into the pages table.
//
// Protocol: 1-byte frame type + payload.
//   0x01 full doc state   (both directions on connect — idempotent merge)
//   0x02 incremental update
//   0x03 awareness update (presence: name, color, focused segment)

const Y = require('yjs');
const awarenessProtocol = require('y-protocols/awareness');
const { WebSocketServer } = require('ws');
const db = require('./db');
const auth = require('./auth');

const MSG_STATE = 1, MSG_UPDATE = 2, MSG_AWARENESS = 3;

const rooms = new Map(); // slug -> { doc, awareness, conns:Set, saveT, saveMaxT, dirty, participants:Set }

function frame(type, payload) {
  const buf = Buffer.alloc(1 + payload.length);
  buf[0] = type;
  Buffer.from(payload).copy(buf, 1);
  return buf;
}

function persist(slug, room, editor) {
  const content = room.doc.getText('content').toString();
  const row = db.prepare('SELECT content FROM pages WHERE slug = ?').get(slug);
  if (!row || row.content === content) { room.dirty = false; return; }
  db.prepare("UPDATE pages SET content = ?, updated_at = datetime('now'), updated_by = ? WHERE slug = ?")
    .run(content, editor || Array.from(room.participants).join(', ') || 'collab', slug);
  room.dirty = false;
  if (module.exports.onPersist) module.exports.onPersist(slug);
}

function schedulePersist(slug, room) {
  room.dirty = true;
  clearTimeout(room.saveT);
  room.saveT = setTimeout(() => { clearTimeout(room.saveMaxT); room.saveMaxT = null; persist(slug, room); }, 2000);
  if (!room.saveMaxT) room.saveMaxT = setTimeout(() => { clearTimeout(room.saveT); room.saveMaxT = null; persist(slug, room); }, 15000);
}

function getRoom(slug) {
  let room = rooms.get(slug);
  if (room) return room;
  const doc = new Y.Doc();
  const row = db.prepare('SELECT content FROM pages WHERE slug = ?').get(slug);
  if (row && row.content) doc.getText('content').insert(0, row.content);
  const awareness = new awarenessProtocol.Awareness(doc);
  room = { doc, awareness, conns: new Set(), saveT: null, saveMaxT: null, dirty: false, participants: new Set() };
  doc.on('update', (update, origin) => {
    // relay to everyone except the connection the change came from
    const msg = frame(MSG_UPDATE, update);
    room.conns.forEach((c) => { if (c !== origin && c.readyState === 1) c.send(msg); });
    schedulePersist(slug, room);
  });
  awareness.on('update', ({ added, updated, removed }, origin) => {
    const ids = added.concat(updated, removed);
    // remember which awareness clientIDs each socket owns, for cleanup on close
    if (origin && origin._awIds) added.concat(updated).forEach((id) => origin._awIds.add(id));
    const msg = frame(MSG_AWARENESS, awarenessProtocol.encodeAwarenessUpdate(awareness, ids));
    room.conns.forEach((c) => { if (c !== origin && c.readyState === 1) c.send(msg); });
  });
  rooms.set(slug, room);
  return room;
}

function closeRoomIfEmpty(slug, room) {
  if (room.conns.size) return;
  clearTimeout(room.saveT); clearTimeout(room.saveMaxT);
  if (room.dirty) persist(slug, room);
  // final revision so collaborative sessions appear in history
  try {
    const row = db.prepare('SELECT title, content FROM pages WHERE slug = ?').get(slug);
    const last = db.prepare('SELECT content FROM page_revisions WHERE slug = ? ORDER BY id DESC LIMIT 1').get(slug);
    if (row && (!last || last.content !== row.content)) {
      db.prepare('INSERT INTO page_revisions (slug, title, content, editor) VALUES (?, ?, ?, ?)')
        .run(slug, row.title, row.content, Array.from(room.participants).join(', ') + ' (live)');
    }
  } catch (e) { /* history is best-effort */ }
  room.doc.destroy();
  rooms.delete(slug);
}

// Merge a save coming from a non-collab client (stale tab) into the live doc
// instead of letting it clobber concurrent edits. Returns true when handled.
function applyExternalSave(slug, content) {
  const room = rooms.get(slug);
  if (!room) return false;
  const ytext = room.doc.getText('content');
  const cur = ytext.toString();
  if (cur === content) return true;
  // common prefix/suffix diff -> one delete+insert
  let a = 0;
  const maxA = Math.min(cur.length, content.length);
  while (a < maxA && cur[a] === content[a]) a++;
  let b = 0;
  while (b < Math.min(cur.length, content.length) - a && cur[cur.length - 1 - b] === content[content.length - 1 - b]) b++;
  room.doc.transact(() => {
    if (cur.length - a - b > 0) ytext.delete(a, cur.length - a - b);
    const ins = content.slice(a, content.length - b);
    if (ins) ytext.insert(a, ins);
  });
  return true;
}

function attach(server, sessionMw) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    let url;
    try { url = new URL(req.url, 'http://x'); } catch (e) { socket.destroy(); return; }
    if (url.pathname !== '/ws/edit') { socket.destroy(); return; }
    const slug = String(url.searchParams.get('slug') || '').replace(/^\/+|\/+$/g, '');
    // run the session middleware against the upgrade request to identify the user
    sessionMw(req, {}, () => {
      const sess = req.session && req.session.user;
      const user = sess ? db.prepare('SELECT * FROM users WHERE id = ?').get(sess.id) : null;
      const page = slug ? db.prepare('SELECT * FROM pages WHERE slug = ?').get(slug) : null;
      if (!user || user.deleted || !page || !auth.canEditPage(user, page)) { socket.destroy(); return; }
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws._slug = slug; ws._user = user.username;
        wss.emit('connection', ws, req);
      });
    });
  });

  wss.on('connection', (ws) => {
    const slug = ws._slug;
    const room = getRoom(slug);
    ws._awIds = new Set();
    room.conns.add(ws);
    room.participants.add(ws._user);
    // initial full-state exchange (merging full states is safe + idempotent)
    ws.send(frame(MSG_STATE, Y.encodeStateAsUpdate(room.doc)));
    const aw = awarenessProtocol.encodeAwarenessUpdate(room.awareness, Array.from(room.awareness.getStates().keys()));
    if (room.awareness.getStates().size) ws.send(frame(MSG_AWARENESS, aw));

    ws.on('message', (data) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (!buf.length) return;
      const type = buf[0], payload = new Uint8Array(buf.buffer, buf.byteOffset + 1, buf.length - 1);
      try {
        if (type === MSG_STATE || type === MSG_UPDATE) Y.applyUpdate(room.doc, payload, ws);
        else if (type === MSG_AWARENESS) awarenessProtocol.applyAwarenessUpdate(room.awareness, payload, ws);
      } catch (e) { /* a malformed frame must not kill the room */ }
    });
    ws.on('close', () => {
      room.conns.delete(ws);
      // drop this client's presence so their cursor chip disappears for others
      if (ws._awIds.size) awarenessProtocol.removeAwarenessStates(room.awareness, Array.from(ws._awIds), 'disconnect');
      closeRoomIfEmpty(slug, room);
    });
    ws.on('error', () => { try { ws.close(); } catch (e) {} });
  });

  return wss;
}

module.exports = { attach, applyExternalSave, onPersist: null };
