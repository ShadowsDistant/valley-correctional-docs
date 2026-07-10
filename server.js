'use strict';

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const SqliteStore = require('better-sqlite3-session-store')(session);

const db = require('./lib/db');
const { seed } = require('./lib/seed');
const nav = require('./lib/nav');
const md = require('./lib/markdown');
const auth = require('./lib/auth');
const icons = require('./lib/icons');

seed(); // idempotent: seeds pages + first admin on first boot

// --- editable settings (key/value) -----------------------------------------
const getSettingStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
const setSettingStmt = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);
const setting = (key, def) => { const r = getSettingStmt.get(key); return r ? r.value : def; };
const setSetting = (key, value) => setSettingStmt.run(key, String(value));

// Staff policy agreement: the clauses are admin-editable and versioned. Bumping
// the version re-prompts every user (their agreed_policy stores the version they
// last accepted). POLICY_SEED_VERSION (below) re-seeds these defaults on deploy.
const DEFAULT_POLICY_CLAUSES = [
  'I will comply with **all** Valley Correctional Facility policies — the community rules, my division handbook, the General Staff Handbook, and the Chain of Command — and act with professionalism, impartiality, and integrity at all times.',
  'I understand that **all internal documents are strictly confidential** and are not to be shared, screenshotted, copied, paraphrased, or discussed with anyone outside the authorized staff team.',
  '**I understand that leaking, disclosing, or facilitating access to any internal or classified VCF document — whether during or after my time on staff — is a Tier 3 offense that will result in immediate termination and a permanent employment blacklist, and may be escalated to platform moderation.**',
  'I understand that my access is logged and monitored, and that violations are investigated by the Specialized Investigations Division.',
  'I understand that any evidence gathered while investigating a leak or other policy violation is confidential and **will not be shared** with the person under investigation or with any other party.',
  'I understand that **faction auditors are independent oversight and are not counted as members of the VCF staff team.**',
  '**I understand that my employment at Valley Correctional Facility is a privilege, not a right, and that it may be revoked at any time.**',
  'I accept that continued access is contingent on my ongoing compliance, and that VCF leadership may revise these policies at any time.',
];
// Canonical policy revision. Bump this whenever DEFAULT_POLICY_CLAUSES changes;
// on deploy it overwrites the stored clauses and re-prompts every staff member.
const POLICY_SEED_VERSION = 3;
(function seedPolicy() {
  const seeded = Number(setting('policy_seed_version', '0')) || 0;
  if (seeded < POLICY_SEED_VERSION) {
    setSetting('policy_clauses', JSON.stringify(DEFAULT_POLICY_CLAUSES));
    const nextVer = Math.max((Number(setting('policy_version', '1')) || 1) + 1, 2);
    setSetting('policy_version', String(nextVer));
    setSetting('policy_seed_version', String(POLICY_SEED_VERSION));
  }
})();
const policyVersion = () => Number(setting('policy_version', '1')) || 1;
function policyClauses() {
  try { return JSON.parse(setting('policy_clauses', '[]')); } catch (e) { return DEFAULT_POLICY_CLAUSES; }
}

// --- asset cache-busting ----------------------------------------------------
// Every CSS/JS URL carries ?v=<hash>. The hash changes whenever any static asset
// changes, so a deploy instantly invalidates stale browser caches (previously a
// 7-day cache served old CSS against new HTML → the broken/partial renders).
function computeAssetVersion() {
  const h = crypto.createHash('sha1');
  const dirs = ['css', 'js'].map((d) => path.join(__dirname, 'public', d));
  for (const dir of dirs) {
    let files = [];
    try { files = fs.readdirSync(dir).sort(); } catch (e) { continue; }
    for (const f of files) {
      try { h.update(f).update(fs.readFileSync(path.join(dir, f))); } catch (e) { /* ignore */ }
    }
  }
  return h.digest('hex').slice(0, 10);
}

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

app.set('trust proxy', Number(process.env.TRUST_PROXY || 1));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.json({ limit: '2mb' }));

// Generated icon stylesheet (custom SVG icons as CSS masks).
const ICONS_CSS = icons.css();
// One token that changes on any asset change; appended as ?v= to every asset URL.
const ASSET_VERSION = crypto.createHash('sha1').update(computeAssetVersion()).update(ICONS_CSS).digest('hex').slice(0, 10);
app.get('/assets/icons.css', (req, res) => {
  res.type('text/css');
  if (isProd) res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(ICONS_CSS);
});

// Assets are content-versioned via ?v=, so they can be cached hard & immutable.
app.use('/assets', express.static(path.join(__dirname, 'public'), {
  maxAge: isProd ? '365d' : 0,
  immutable: isProd,
}));

// Dynamic HTML must always revalidate so browsers pick up the new ?v= links
// immediately after a deploy (never serve a stale page from cache).
app.use((req, res, next) => {
  if (!req.path.startsWith('/assets') && !req.path.startsWith('/api')) {
    res.set('Cache-Control', 'no-cache');
  }
  next();
});

app.use(
  session({
    store: new SqliteStore({
      client: db,
      expired: { clear: true, intervalMs: 900000 },
    }),
    secret: process.env.SESSION_SECRET || 'dev-insecure-secret-change-me',
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
      maxAge: 1000 * 60 * 60 * 24 * 14, // 14 days
    },
  })
);

// Reload the logged-in user from the DB on every request so role, division,
// and suspension changes take effect immediately on the next navigation
// (the realtime guard handles the page they're already looking at).
const touchLastSeen = db.prepare(
  "UPDATE users SET last_seen = datetime('now') WHERE id = ? AND (last_seen IS NULL OR last_seen < datetime('now','-60 seconds'))"
);
app.use((req, res, next) => {
  if (req.session && req.session.user) {
    const fresh = db.prepare('SELECT id, username, role, divisions, suspended, agreed_policy FROM users WHERE id = ?').get(req.session.user.id);
    if (!fresh) return req.session.destroy(() => res.redirect('/'));
    try { touchLastSeen.run(fresh.id); } catch (e) { /* non-critical */ }
    req.session.user = {
      id: fresh.id, username: fresh.username,
      role: fresh.role, divisions: fresh.divisions || '', suspended: fresh.suspended,
      agreed_policy: fresh.agreed_policy,
    };
  }
  next();
});

app.use(auth.attachUser);
app.use((req, res, next) => { res.locals.suspended = auth.isSuspended(res.locals.user); next(); });
// CSRF tokens are applied only on routes that render forms (login + admin),
// so anonymous documentation readers never get a session cookie.

// Expose common data + helpers to every view.
app.use((req, res, next) => {
  res.locals.siteName = 'Valley Correctional Facility';
  res.locals.siteTagline = 'Documentation & Handbooks';
  res.locals.discord = 'https://discord.gg/GDVqmx9hdK';
  res.locals.baseUrl = (process.env.SITE_URL || (req.protocol + '://' + req.get('host'))).replace(/\/+$/, '');
  res.locals.pageUrl = res.locals.baseUrl + (req.originalUrl || '/').split('?')[0];
  res.locals.year = new Date().getFullYear();
  res.locals.escapeHtml = (s) =>
    String(s == null ? '' : s).replace(/[<>&"']/g, (c) =>
      ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c])
    );
  res.locals.icon = icons.icon;
  res.locals.assetVersion = ASSET_VERSION;
  res.locals.canManageShifts = auth.canManageShifts(req.session && req.session.user);
  // Staff-policy agreement state for the first-login / policy-changed gate.
  const u = req.session && req.session.user;
  res.locals.policyVersion = policyVersion();
  res.locals.needsPolicy = !!(u && Number(u.agreed_policy || 0) < res.locals.policyVersion);
  res.locals.policyClauses = policyClauses();
  // Render a single policy clause: escape it, then allow simple **bold** spans.
  res.locals.policyLine = (s) =>
    res.locals.escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  next();
});

// --- data helpers ----------------------------------------------------------

const getPage = db.prepare('SELECT * FROM pages WHERE slug = ? AND published = 1');
const getPageAny = db.prepare('SELECT * FROM pages WHERE slug = ?');
const allPages = db.prepare('SELECT * FROM pages WHERE published = 1');
const allPagesAny = db.prepare('SELECT * FROM pages ORDER BY group_name, sort, title');

function navPages() {
  return allPages.all();
}

// Flattened, nav-ordered list (respects group order) for prev/next links.
function orderedPages(canView) {
  const tree = nav.buildNav(navPages(), canView);
  const flat = [];
  for (const group of tree) for (const p of group.pages) flat.push(p);
  return flat;
}

// The template renders the page title as an <h1>. If the body's first top-level
// "# Heading" repeats that title, drop it so the title isn't shown twice.
function stripDocTitle(markdown, title) {
  const t = String(title || '').trim().toLowerCase();
  return String(markdown).replace(/^#[ \t]+([^\r\n]+)\r?\n?/m, (m, h) =>
    h.trim().toLowerCase() === t ? '' : m
  );
}

const auditStmt = db.prepare('INSERT INTO audit_log (actor, action, target, details) VALUES (?, ?, ?, ?)');
function audit(actor, action, target, details) {
  try { auditStmt.run(actor || 'system', action, target || '', details || ''); } catch (e) { /* never break a request */ }
}

function recordView(req, page) {
  try {
    const ua = (req.headers['user-agent'] || '').slice(0, 300);
    const ip = req.ip || '';
    const visitor = crypto.createHash('sha256').update(ip + '|' + ua).digest('hex').slice(0, 16);
    const day = new Date().toISOString().slice(0, 10);
    const u = req.session && req.session.user;
    db.prepare(
      `INSERT INTO page_views (path, slug, day, visitor, referrer, ua, authed, username)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      req.path,
      page ? page.slug : null,
      day,
      visitor,
      (req.headers.referer || '').slice(0, 300),
      ua,
      u ? 1 : 0,
      u ? u.username : null
    );
  } catch (e) {
    // analytics must never break a page render
  }
}

// --- auth routes -----------------------------------------------------------

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many login attempts. Try again in 15 minutes.',
});

app.get('/login', auth.csrfToken, (req, res) => {
  if (req.session.user) return res.redirect('/admin');
  res.render('login', {
    title: 'Staff Login',
    next: req.query.next || '/admin',
    error: null,
    layout: false,
  });
});

app.post('/login', loginLimiter, auth.csrfToken, auth.verifyCsrf, (req, res) => {
  const { username, password } = req.body;
  // Only allow same-site relative paths (reject protocol-relative //evil.com).
  const reqNext = typeof req.body.next === 'string' && /^\/(?!\/)/.test(req.body.next) ? req.body.next : '';
  const user = auth.findUserByUsername((username || '').trim());
  if (!user || !auth.verifyPassword(password || '', user.password)) {
    audit((username || '').trim() || 'unknown', 'user.login_fail', (username || '').trim(), 'invalid credentials · ' + (req.ip || ''));
    return res.status(401).render('login', {
      title: 'Staff Login',
      next: reqNext || '/admin',
      error: 'Invalid username or password.',
      layout: false,
    });
  }
  if (auth.isSuspended(user)) {
    audit(user.username, 'user.login_blocked', user.username, 'suspended account attempted login');
    return res.status(403).render('login', {
      title: 'Account suspended',
      next: reqNext || '/admin',
      error: 'This account is suspended. Contact an administrator to be reinstated.',
      layout: false,
    });
  }
  db.prepare('UPDATE users SET last_login = datetime(\'now\') WHERE id = ?').run(user.id);
  audit(user.username, 'user.login', user.username, user.role + ' · ' + (req.ip || ''));
  // Division-limited staff can't use the admin panel — land them on the site.
  const landing = auth.canEdit(user) ? '/admin' : '/home';
  const nextUrl = reqNext && !(reqNext.startsWith('/admin') && !auth.canEdit(user)) ? reqNext : landing;
  req.session.regenerate((err) => {
    if (err) return res.status(500).send('Session error');
    req.session.user = { id: user.id, username: user.username, role: user.role, divisions: user.divisions || '' };
    req.session.save(() => res.redirect(nextUrl));
  });
});

app.post('/logout', (req, res) => {
  const u = req.session && req.session.user;
  if (u) audit(u.username, 'user.logout', u.username, '');
  req.session.destroy(() => res.redirect('/'));
});

// --- search index ----------------------------------------------------------

app.get('/search-index.json', (req, res) => {
  const user = req.session && req.session.user;
  const pages = navPages().filter((p) => auth.canViewPage(user, p));
  const index = pages.map((p) => {
    // Dynamic placeholders (e.g. the live shift table) shouldn't leak into search.
    const content = String(p.content || '').replace(/\[\[SHIFTS_TABLE\]\]/g, '');
    const { toc } = md.render(content);
    return {
      slug: p.slug,
      title: p.title,
      group: p.group_name,
      internal: !!p.internal,
      description: p.description,
      // headings become deep-link search hits
      headings: toc.map((h) => ({ text: h.text, id: h.id })),
      text: md.toPlainText(content).slice(0, 4000),
    };
  });
  res.set('Cache-Control', 'no-store');
  res.json(index);
});

// Realtime access check — the client polls this so a page locks the instant a
// user is suspended or loses access to the handbook they're currently reading.
app.get('/api/access', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const user = req.session && req.session.user; // already refreshed from DB
  const slug = String(req.query.slug || '').replace(/^\/+|\/+$/g, '');
  if (auth.isSuspended(user)) return res.json({ ok: false, suspended: true, reason: 'suspended' });
  const page = slug ? getPageAny.get(slug) : null;
  if (!page) return res.json({ ok: true });
  const ok = auth.canViewPage(user, page);
  res.json({ ok: ok, suspended: false, reason: ok ? '' : 'no-access' });
});

// --- self-service account: any logged-in user can change their own password --
app.get('/account', auth.requireAuth, auth.csrfToken, (req, res) => {
  res.render('account', { title: 'Your account', done: req.query.updated === '1', error: null });
});

app.post('/account/password', auth.requireAuth, auth.csrfToken, auth.verifyCsrf, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
  const current = req.body.current || '', next_ = req.body.new || '', confirm = req.body.confirm || '';
  let error = null;
  if (!u || !auth.verifyPassword(current, u.password)) error = 'Your current password is incorrect.';
  else if (next_.length < 6) error = 'New password must be at least 6 characters.';
  else if (next_ !== confirm) error = 'New passwords do not match.';
  if (error) return res.status(400).render('account', { title: 'Your account', done: false, error });
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(auth.hashPassword(next_), u.id);
  audit(u.username, 'user.password', u.username, 'changed own password');
  res.redirect('/account?updated=1');
});

// Record acceptance of the staff policy agreement (stores the accepted version).
app.post('/account/agree', auth.requireAuth, (req, res) => {
  const v = policyVersion();
  db.prepare('UPDATE users SET agreed_policy = ? WHERE id = ?').run(v, req.session.user.id);
  req.session.user.agreed_policy = v;
  audit(req.session.user.username, 'user.agree', req.session.user.username, 'accepted staff policy v' + v);
  const ref = req.get('referer') || '';
  res.redirect(ref.includes('://' + req.get('host')) ? ref : '/home');
});

// Declining the staff policy is logged and permanently deletes the account
// (a last active admin is signed out instead, to avoid locking everyone out).
app.post('/account/decline', auth.requireAuth, (req, res) => {
  const u = req.session.user;
  if (u.role === 'admin') {
    const admins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND suspended = 0").get().n;
    if (admins <= 1) {
      audit(u.username, 'policy.decline', u.username, 'declined policy — last admin, signed out (not deleted)');
      return req.session.destroy(() => res.redirect('/login'));
    }
  }
  audit(u.username, 'policy.decline', u.username, 'declined staff policy — account deleted');
  db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
  req.session.destroy(() => res.redirect('/?declined=1'));
});

// --- admin: dashboard + editor + analytics ---------------------------------

const adminRouter = express.Router();
adminRouter.use(auth.requireEditor);
adminRouter.use(auth.csrfToken);

adminRouter.get('/', (req, res) => {
  const pageCount = db.prepare('SELECT COUNT(*) AS n FROM pages').get().n;
  // Views are counted per user (unique visitor × page × day), not per raw hit.
  const UNIQV = "COUNT(DISTINCT visitor || '¦' || COALESCE(slug, path))";
  const views7 = db.prepare(
    `SELECT ${UNIQV} AS n FROM page_views WHERE day >= date('now','-6 days')`
  ).get().n;
  const views30 = db.prepare(
    `SELECT ${UNIQV} AS n FROM page_views WHERE day >= date('now','-29 days')`
  ).get().n;
  const visitors30 = db.prepare(
    "SELECT COUNT(DISTINCT visitor) AS n FROM page_views WHERE day >= date('now','-29 days')"
  ).get().n;
  const recentEdits = db
    .prepare('SELECT slug, title, editor, created_at FROM page_revisions ORDER BY created_at DESC LIMIT 8')
    .all();
  res.render('admin/dashboard', {
    title: 'Admin · Dashboard',
    section: 'dashboard',
    stats: { pageCount, views7, views30, visitors30 },
    recentEdits,
    pages: allPagesAny.all(),
  });
});

adminRouter.get('/pages', (req, res) => {
  const user = req.session.user;
  let pages = allPagesAny.all();
  if (user.role !== 'admin') pages = pages.filter((p) => auth.canEditPage(user, p));
  res.render('admin/pages', {
    title: 'Admin · Pages',
    section: 'pages',
    pages,
    canCreate: auth.canCreatePages(user),
  });
});

adminRouter.get('/new', (req, res) => {
  if (!auth.canCreatePages(req.session.user)) {
    return res.status(403).render('error', {
      title: 'Forbidden', heading: '403 — Administrators only',
      message: 'Only administrators can create new pages. Editors can edit the handbooks for their assigned divisions.',
    });
  }
  res.render('admin/edit', {
    title: 'Admin · New Page',
    section: 'pages',
    isNew: true,
    page: {
      slug: '', title: '', description: '', group_name: '', icon: '',
      content: '# New Page\n\nWrite your content here.', internal: 0, sort: 100, division: '',
    },
    groups: nav.GROUP_ORDER,
    revisions: [],
  });
});

adminRouter.get('/edit', (req, res) => {
  const page = getPageAny.get(req.query.slug || '');
  if (!page) {
    return res.status(404).render('error', {
      title: 'Not found', heading: 'Page not found', message: 'That page does not exist.',
    });
  }
  if (!auth.canEditPage(req.session.user, page)) {
    return res.status(403).render('error', {
      title: 'Forbidden', heading: '403 — No edit access',
      message: 'You can only edit the handbook(s) for the division(s) assigned to your account.',
    });
  }
  const revisions = db
    .prepare('SELECT id, editor, created_at FROM page_revisions WHERE slug = ? ORDER BY created_at DESC LIMIT 20')
    .all(page.slug);
  res.render('admin/edit', {
    title: 'Admin · Edit ' + page.title,
    section: 'pages',
    isNew: false,
    page,
    groups: nav.GROUP_ORDER,
    revisions,
    undeletable: UNDELETABLE_SLUGS.includes(page.slug),
  });
});

// Live preview endpoint — renders markdown exactly like the public site,
// including the live shift table in place of [[SHIFTS_TABLE]].
adminRouter.post('/preview', (req, res) => {
  const content = String(req.body.content || '').replace(/\[\[SHIFTS_TABLE\]\]/g, shiftScheduleMarkdown());
  const { html } = md.render(content);
  res.json({ html });
});

function normalizeSlug(s) {
  return String(s || '')
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, '-')
    .replace(/-+/g, '-');
}

// Create or update a page (JSON, from the editor).
adminRouter.post('/save', auth.verifyCsrf, (req, res) => {
  const b = req.body;
  const slug = normalizeSlug(b.slug);
  if (!slug) return res.status(400).json({ ok: false, error: 'A URL slug is required.' });
  if (!b.title || !b.title.trim()) return res.status(400).json({ ok: false, error: 'A title is required.' });

  const existing = getPageAny.get(slug);
  const user = req.session.user;
  if (existing) {
    if (!auth.canEditPage(user, existing)) return res.status(403).json({ ok: false, error: 'You do not have permission to edit this page.' });
  } else if (!auth.canCreatePages(user)) {
    return res.status(403).json({ ok: false, error: 'Only administrators can create new pages.' });
  }
  const editor = user.username;
  const payload = {
    slug,
    title: b.title.trim(),
    description: (b.description || '').trim(),
    group_name: (b.group_name || '').trim(),
    icon: (b.icon || '').trim(),
    content: b.content || '',
    internal: b.internal ? 1 : 0,
    sort: Number.isFinite(+b.sort) ? +b.sort : 100,
    division: (b.division || '').trim(),
  };

  // Non-admin editors may only change content/title/description/icon; they
  // cannot move a page's group, division, visibility, or ordering.
  if (existing && user.role !== 'admin') {
    payload.group_name = existing.group_name;
    payload.internal = existing.internal;
    payload.division = existing.division;
    payload.sort = existing.sort;
  }

  if (existing) {
    db.prepare(
      `UPDATE pages SET title=@title, description=@description, group_name=@group_name,
        icon=@icon, content=@content, internal=@internal, sort=@sort, division=@division,
        updated_at=datetime('now'), updated_by=@editor WHERE slug=@slug`
    ).run({ ...payload, editor });
  } else {
    db.prepare(
      `INSERT INTO pages (slug, title, description, group_name, icon, content, internal, sort, division, published, updated_by)
       VALUES (@slug, @title, @description, @group_name, @icon, @content, @internal, @sort, @division, 1, @editor)`
    ).run({ ...payload, editor });
  }

  db.prepare(
    'INSERT INTO page_revisions (slug, title, content, editor) VALUES (?, ?, ?, ?)'
  ).run(slug, payload.title, payload.content, editor);
  audit(editor, existing ? 'page.update' : 'page.create', '/' + slug, payload.title);

  res.json({ ok: true, slug, url: '/' + slug });
});

// Core pages that must always exist and cannot be deleted from the editor.
const UNDELETABLE_SLUGS = ['shifts/shift-schedule', 'home'];
adminRouter.post('/delete', auth.verifyCsrf, (req, res) => {
  if (req.session.user.role !== 'admin') return res.status(403).json({ ok: false, error: 'Only administrators can delete pages.' });
  const slug = normalizeSlug(req.body.slug);
  if (UNDELETABLE_SLUGS.includes(slug)) {
    return res.status(400).json({ ok: false, error: 'This page is protected and cannot be deleted. The Shift Schedule is managed from the Shift Scheduler.' });
  }
  const page = getPageAny.get(slug);
  db.prepare('DELETE FROM pages WHERE slug = ?').run(slug);
  audit(req.session.user.username, 'page.delete', '/' + slug, page ? page.title : '');
  res.json({ ok: true });
});

adminRouter.post('/restore', auth.verifyCsrf, (req, res) => {
  const rev = db.prepare('SELECT * FROM page_revisions WHERE id = ?').get(req.body.id);
  if (!rev) return res.status(404).json({ ok: false, error: 'Revision not found.' });
  const page = getPageAny.get(rev.slug);
  if (!page || !auth.canEditPage(req.session.user, page)) return res.status(403).json({ ok: false, error: 'No permission to restore this page.' });
  db.prepare(
    "UPDATE pages SET content = ?, title = ?, updated_at = datetime('now'), updated_by = ? WHERE slug = ?"
  ).run(rev.content, rev.title, req.session.user.username + ' (restore)', rev.slug);
  audit(req.session.user.username, 'page.restore', '/' + rev.slug, 'revision #' + rev.id);
  res.json({ ok: true, slug: rev.slug });
});

// --- activity / edit log ---
adminRouter.get('/logs', auth.requireAdmin, (req, res) => {
  // Optional filters: action, actor (username substring), and date range.
  const clauses = [];
  const args = [];
  const action = String(req.query.action || '').trim();
  const actor = String(req.query.actor || '').trim();
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();
  if (action) { clauses.push('action = ?'); args.push(action); }
  if (actor) { clauses.push('lower(actor) LIKE ?'); args.push('%' + actor.toLowerCase() + '%'); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) { clauses.push('ts >= ?'); args.push(from + ' 00:00:00'); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) { clauses.push('ts <= ?'); args.push(to + ' 23:59:59'); }
  const where = clauses.length ? ' WHERE ' + clauses.join(' AND ') : '';
  const events = db.prepare('SELECT * FROM audit_log' + where + ' ORDER BY id DESC LIMIT 300').all(...args);
  // Distinct action types present in the log, for the filter dropdown.
  const actions = db.prepare('SELECT DISTINCT action FROM audit_log ORDER BY action').all().map((r) => r.action);
  res.render('admin/logs', {
    title: 'Admin · Activity', section: 'logs', events, actions,
    filter: { action, actor, from, to },
  });
});

// Classify a user-agent string into a coarse browser / OS bucket.
function uaBrowser(ua) {
  ua = ua || '';
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Safari\//.test(ua)) return 'Safari';
  if (/bot|crawl|spider|curl|wget|python-requests/i.test(ua)) return 'Bot';
  return 'Other';
}
function uaOS(ua) {
  ua = ua || '';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Android/.test(ua)) return 'Android';
  if (/iPhone|iPad|iOS/.test(ua)) return 'iOS';
  if (/Mac OS X|Macintosh/.test(ua)) return 'macOS';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Other';
}

// Analytics dashboard (detailed) — admins only
adminRouter.get('/analytics', auth.requireAdmin, (req, res) => {
  const days = [7, 30, 90].includes(+req.query.days) ? +req.query.days : 30;
  const since = `-${days - 1} days`;
  // "Views" are counted per user, not per visit: repeated loads of the same page
  // by the same visitor in a day count once (distinct visitor × page × day).
  const UNIQV = "COUNT(DISTINCT visitor || '¦' || COALESCE(slug, path))";

  const rows = db.prepare(
    `SELECT day, ${UNIQV} AS views, COUNT(DISTINCT visitor) AS visitors
     FROM page_views WHERE day >= date('now', ?) GROUP BY day ORDER BY day`
  ).all(since);
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const r = byDay.get(key);
    series.push({ day: key, views: r ? r.views : 0, visitors: r ? r.visitors : 0 });
  }

  const one = (sql, ...a) => db.prepare(sql).get(...a).n;
  const totals = {
    days,
    viewsToday: one(`SELECT ${UNIQV} AS n FROM page_views WHERE day = date('now')`),
    viewsRange: one(`SELECT ${UNIQV} AS n FROM page_views WHERE day >= date('now', ?)`, since),
    visitorsRange: one('SELECT COUNT(DISTINCT visitor) AS n FROM page_views WHERE day >= date(\'now\', ?)', since),
    views: one(`SELECT ${UNIQV} AS n FROM page_views`),
    visitors: one('SELECT COUNT(DISTINCT visitor) AS n FROM page_views'),
  };
  totals.avgPerDay = Math.round(totals.viewsRange / days);
  const busiest = rows.slice().sort((a, b) => b.views - a.views)[0];
  totals.busiestDay = busiest ? busiest.day : '—';
  totals.busiestViews = busiest ? busiest.views : 0;

  const topPages = db.prepare(
    `SELECT slug, COUNT(DISTINCT visitor) AS views, COUNT(DISTINCT visitor) AS visitors FROM page_views
     WHERE slug IS NOT NULL AND day >= date('now', ?) GROUP BY slug ORDER BY views DESC LIMIT 12`
  ).all(since).map((r) => {
    const p = getPageAny.get(r.slug);
    return { slug: r.slug, title: p ? p.title : r.slug, internal: p ? !!p.internal : false, views: r.views, visitors: r.visitors };
  });

  const referrers = db.prepare(
    `SELECT referrer, COUNT(*) AS n FROM page_views
     WHERE referrer IS NOT NULL AND referrer != '' AND day >= date('now', ?)
     GROUP BY referrer ORDER BY n DESC LIMIT 8`
  ).all(since);

  // authenticated vs anonymous
  const authedRow = db.prepare(`SELECT SUM(authed) AS a, COUNT(*) AS t FROM page_views WHERE day >= date('now', ?)`).get(since);
  const authed = { staff: authedRow.a || 0, anon: (authedRow.t || 0) - (authedRow.a || 0) };

  // internal vs public
  const intRow = db.prepare(
    `SELECT SUM(CASE WHEN p.internal=1 THEN 1 ELSE 0 END) AS i, COUNT(*) AS t
     FROM page_views v LEFT JOIN pages p ON p.slug = v.slug WHERE v.day >= date('now', ?)`
  ).get(since);
  const scope = { internal: intRow.i || 0, public: (intRow.t || 0) - (intRow.i || 0) };

  // views by hour of day
  const hourRows = db.prepare(
    `SELECT CAST(strftime('%H', ts) AS INTEGER) AS h, COUNT(*) AS n FROM page_views WHERE day >= date('now', ?) GROUP BY h`
  ).all(since);
  const hourMap = new Map(hourRows.map((r) => [r.h, r.n]));
  const byHour = []; for (let h = 0; h < 24; h++) byHour.push({ h, n: hourMap.get(h) || 0 });

  // browser / OS breakdown
  const uaRows = db.prepare(`SELECT ua, COUNT(*) AS n FROM page_views WHERE day >= date('now', ?) GROUP BY ua`).all(since);
  const brow = {}, os = {};
  uaRows.forEach((r) => { brow[uaBrowser(r.ua)] = (brow[uaBrowser(r.ua)] || 0) + r.n; os[uaOS(r.ua)] = (os[uaOS(r.ua)] || 0) + r.n; });
  const toArr = (o) => Object.keys(o).map((k) => ({ label: k, n: o[k] })).sort((a, b) => b.n - a.n);

  const recent = db.prepare(
    `SELECT slug, ts, authed, username FROM page_views ORDER BY id DESC LIMIT 12`
  ).all().map((r) => { const p = getPageAny.get(r.slug); return { title: p ? p.title : r.slug, slug: r.slug, ts: r.ts, authed: r.authed, username: r.username }; });

  res.render('admin/analytics', {
    title: 'Admin · Analytics', section: 'analytics',
    series, totals, topPages, referrers, authed, scope, byHour,
    browsers: toArr(brow), oses: toArr(os), recent,
  });
});

// Normalize submitted division checkboxes to a clean CSV of valid keys.
function parseDivisions(body) {
  let vals = body.divisions;
  if (!vals) return '';
  if (!Array.isArray(vals)) vals = [vals];
  const valid = new Set(auth.DIVISIONS.map((d) => d.key));
  return vals.filter((v) => valid.has(v)).join(',');
}
// Divisions are meaningful for staff (read access) and editors (edit access).
const usesDivisions = (role) => role === 'staff' || role === 'editor';

// Staff management (admins only)
adminRouter.get('/staff', auth.requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, username, role, divisions, suspended, created_at, last_login, last_seen FROM users ORDER BY id').all();
  const viewCounts = new Map(
    db.prepare('SELECT username, COUNT(*) AS n FROM page_views WHERE username IS NOT NULL GROUP BY username').all()
      .map((r) => [r.username, r.n])
  );
  users.forEach((u) => { u.doc_views = viewCounts.get(u.username) || 0; });
  res.render('admin/staff', { title: 'Admin · Staff', section: 'staff', users, divisions: auth.DIVISIONS });
});

adminRouter.post('/staff/create', auth.requireAdmin, auth.verifyCsrf, (req, res) => {
  const username = (req.body.username || '').trim();
  const role = ['admin', 'editor', 'staff'].includes(req.body.role) ? req.body.role : 'staff';
  const divisions = usesDivisions(role) ? parseDivisions(req.body) : '';
  const password = req.body.password || '';
  if (!username || password.length < 6) {
    return res.status(400).render('error', {
      title: 'Invalid', heading: 'Could not create staff member',
      message: 'Username is required and password must be at least 6 characters.',
    });
  }
  try {
    db.prepare('INSERT INTO users (username, password, role, divisions) VALUES (?, ?, ?, ?)')
      .run(username, auth.hashPassword(password), role, divisions);
    audit(req.session.user.username, 'user.create', username, role + (divisions ? ' [' + divisions + ']' : ''));
  } catch (e) {
    return res.status(400).render('error', {
      title: 'Invalid', heading: 'Could not create staff member',
      message: 'That username is already taken.',
    });
  }
  res.redirect('/admin/staff');
});

// Update a member's role and/or division access.
adminRouter.post('/staff/access', auth.requireAdmin, auth.verifyCsrf, (req, res) => {
  const id = Number(req.body.id);
  const role = ['admin', 'editor', 'staff'].includes(req.body.role) ? req.body.role : 'staff';
  const divisions = usesDivisions(role) ? parseDivisions(req.body) : '';
  if (id === req.session.user.id && role !== 'admin') {
    return res.status(400).render('error', {
      title: 'Invalid', heading: 'Cannot demote yourself',
      message: 'You cannot change your own account out of the admin role.',
    });
  }
  const target = db.prepare('SELECT username FROM users WHERE id = ?').get(id);
  db.prepare('UPDATE users SET role = ?, divisions = ? WHERE id = ?').run(role, divisions, id);
  audit(req.session.user.username, 'user.role', target ? target.username : '#' + id, role + (divisions ? ' [' + divisions + ']' : ''));
  res.redirect('/admin/staff');
});

// Suspend / reinstate an account (keeps the record, revokes all access).
adminRouter.post('/staff/suspend', auth.requireAdmin, auth.verifyCsrf, (req, res) => {
  const id = Number(req.body.id);
  const suspend = req.body.suspend === '1';
  if (id === req.session.user.id) {
    return res.status(400).render('error', { title: 'Invalid', heading: 'Cannot suspend yourself', message: 'You cannot suspend the account you are logged in as.' });
  }
  const target = db.prepare('SELECT username, role FROM users WHERE id = ?').get(id);
  if (suspend && target && target.role === 'admin') {
    const admins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND suspended=0").get().n;
    if (admins <= 1) return res.status(400).render('error', { title: 'Invalid', heading: 'Cannot suspend last admin', message: 'There must be at least one active administrator.' });
  }
  db.prepare('UPDATE users SET suspended = ? WHERE id = ?').run(suspend ? 1 : 0, id);
  audit(req.session.user.username, suspend ? 'user.suspend' : 'user.reinstate', target ? target.username : '#' + id, '');
  res.redirect('/admin/staff');
});

adminRouter.post('/staff/password', auth.requireAdmin, auth.verifyCsrf, (req, res) => {
  const id = Number(req.body.id);
  const password = req.body.password || '';
  if (password.length < 6) {
    return res.status(400).render('error', {
      title: 'Invalid', heading: 'Password too short', message: 'Password must be at least 6 characters.',
    });
  }
  const pwTarget = db.prepare('SELECT username FROM users WHERE id = ?').get(id);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(auth.hashPassword(password), id);
  audit(req.session.user.username, 'user.password_reset', pwTarget ? pwTarget.username : '#' + id, 'admin reset password');
  res.redirect('/admin/staff');
});

adminRouter.post('/staff/delete', auth.requireAdmin, auth.verifyCsrf, (req, res) => {
  const id = Number(req.body.id);
  if (id === req.session.user.id) {
    return res.status(400).render('error', {
      title: 'Invalid', heading: 'Cannot delete yourself', message: 'You cannot delete the account you are logged in as.',
    });
  }
  const admins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;
  const target = db.prepare('SELECT role FROM users WHERE id = ?').get(id);
  if (target && target.role === 'admin' && admins <= 1) {
    return res.status(400).render('error', {
      title: 'Invalid', heading: 'Cannot delete last admin', message: 'There must be at least one administrator.',
    });
  }
  const delTarget = db.prepare('SELECT username FROM users WHERE id = ?').get(id);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  audit(req.session.user.username, 'user.delete', delTarget ? delTarget.username : '#' + id, 'account deleted');
  res.redirect('/admin/staff');
});

// Client-side tool: paste/upload a screenshot and boost brightness/contrast/
// saturation to reveal the embedded per-user watermark. Admins only.
adminRouter.get('/watermark-tool', auth.requireAdmin, (req, res) => {
  res.render('admin/watermark-tool', { title: 'Admin · Watermark Reveal', section: 'watermark' });
});

// Edit the staff policy agreement. Saving bumps the version, which re-prompts
// every staff member to read and accept the updated terms on their next page.
adminRouter.get('/policy', auth.requireAdmin, (req, res) => {
  res.render('admin/policy', {
    title: 'Admin · Staff Policy',
    section: 'policy',
    clauses: policyClauses(),
    version: policyVersion(),
    saved: req.query.saved === '1',
  });
});

adminRouter.post('/policy', auth.requireAdmin, auth.verifyCsrf, (req, res) => {
  // New editor submits one `clause` field per row; keep the old textarea format
  // (`clauses`, newline-separated) working as a fallback.
  const raw = req.body.clause;
  const list = Array.isArray(raw) ? raw : (raw != null ? [raw] : String(req.body.clauses || '').split(/\r?\n/));
  const clauses = list.map((s) => String(s).replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (!clauses.length) {
    return res.status(400).render('error', {
      title: 'Invalid', heading: 'Policy cannot be empty',
      message: 'Add at least one clause before saving.',
    });
  }
  const v = policyVersion() + 1;
  setSetting('policy_clauses', JSON.stringify(clauses));
  setSetting('policy_version', String(v));
  audit(req.session.user.username, 'policy.update', 'staff-policy', 'v' + v + ' · ' + clauses.length + ' clauses');
  res.redirect('/admin/policy?saved=1');
});

// --- shift scheduler -------------------------------------------------------
// Managed by admins + Management/Oversight staff; shown on the public schedule.
const SHIFT_TYPES = ['Standard Shift', 'Training Shift', 'Event Shift', 'Special Operation', 'Inspection'];
const upcomingShiftsStmt = db.prepare("SELECT * FROM shifts WHERE date >= date('now','-1 day') ORDER BY date, time");
const allShiftsStmt = db.prepare('SELECT * FROM shifts ORDER BY date DESC, time');

function requireShiftManager(req, res, next) {
  const u = req.session && req.session.user;
  if (u && auth.canManageShifts(u)) return next();
  if (u) {
    return res.status(403).render('error', {
      title: 'Forbidden', heading: '403 — Shift managers only',
      message: 'Only administrators and Management / Oversight staff can manage the shift schedule.',
    });
  }
  return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl || '/admin/shifts'));
}

app.get('/admin/shifts', requireShiftManager, auth.csrfToken, (req, res) => {
  res.render('admin/shifts', {
    title: 'Admin · Shift Scheduler',
    section: 'shifts',
    shifts: allShiftsStmt.all(),
    shiftTypes: SHIFT_TYPES,
    saved: req.query.saved === '1',
  });
});

app.post('/admin/shifts/add', requireShiftManager, auth.csrfToken, auth.verifyCsrf, (req, res) => {
  const date = String(req.body.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).render('error', { title: 'Invalid', heading: 'Invalid date', message: 'Pick a valid shift date.' });
  }
  const type = SHIFT_TYPES.includes(req.body.type) ? req.body.type : 'Standard Shift';
  const time = String(req.body.time || '').trim().slice(0, 80);
  const host = String(req.body.host || '').trim().slice(0, 80);
  const notes = String(req.body.notes || '').trim().slice(0, 200);
  db.prepare('INSERT INTO shifts (date, time, type, host, notes, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(date, time, type, host, notes, req.session.user.username);
  audit(req.session.user.username, 'shift.create', date, type + (time ? ' · ' + time : ''));
  res.redirect('/admin/shifts?saved=1');
});

app.post('/admin/shifts/delete', requireShiftManager, auth.csrfToken, auth.verifyCsrf, (req, res) => {
  const id = Number(req.body.id);
  const s = db.prepare('SELECT date, type FROM shifts WHERE id = ?').get(id);
  db.prepare('DELETE FROM shifts WHERE id = ?').run(id);
  if (s) audit(req.session.user.username, 'shift.delete', s.date, s.type);
  res.redirect('/admin/shifts');
});

// Build the markdown table injected into the public Shift Schedule page.
function shiftScheduleMarkdown() {
  const rows = upcomingShiftsStmt.all();
  if (!rows.length) {
    return '_No shifts are currently scheduled. Check the Discord **#events** channel for the latest announcements._';
  }
  const esc = (s) => String(s || '').replace(/\|/g, '\\|');
  const fmt = (d) => {
    const dt = new Date(d + 'T00:00:00');
    return isNaN(dt) ? d : dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };
  let out = '| Date | Time | Type | Host | Notes |\n| :--- | :--- | :--- | :--- | :--- |\n';
  for (const r of rows) {
    out += `| ${fmt(r.date)} | ${esc(r.time) || 'TBA'} | ${esc(r.type)} | ${esc(r.host) || '—'} | ${esc(r.notes) || '—'} |\n`;
  }
  return out;
}

// A staff member's document activity: pages visited, when, and how long. Time
// on a page is estimated as the gap to their next view (capped at 15 min).
adminRouter.get('/staff/activity', auth.requireAdmin, (req, res) => {
  const target = db.prepare('SELECT id, username, role, divisions, last_login, created_at, suspended FROM users WHERE id = ?').get(Number(req.query.id));
  if (!target) {
    return res.status(404).render('error', { title: 'Not found', heading: 'Staff member not found', message: 'That account does not exist.' });
  }
  const rowsAsc = db.prepare(
    'SELECT slug, path, ts FROM page_views WHERE username = ? ORDER BY ts ASC LIMIT 3000'
  ).all(target.username);
  const CAP = 15 * 60;
  const parse = (t) => Date.parse(String(t).replace(' ', 'T') + 'Z');
  const items = rowsAsc.map((r, i) => {
    let dur = null;
    if (i < rowsAsc.length - 1) {
      const a = parse(r.ts), b = parse(rowsAsc[i + 1].ts);
      if (!isNaN(a) && !isNaN(b)) dur = Math.max(0, Math.min(CAP, Math.round((b - a) / 1000)));
    }
    const p = r.slug ? getPageAny.get(r.slug) : null;
    return { slug: r.slug, path: r.path, title: p ? p.title : (r.slug || r.path), internal: p ? !!p.internal : false, ts: r.ts, duration: dur };
  });
  const stats = {
    totalViews: rowsAsc.length,
    uniquePages: new Set(rowsAsc.map((r) => r.slug || r.path)).size,
    totalTime: items.reduce((a, b) => a + (b.duration || 0), 0),
  };
  items.reverse(); // newest first
  res.render('admin/activity', {
    title: 'Admin · ' + target.username + ' activity',
    section: 'staff', target, stats, items: items.slice(0, 300),
  });
});

app.use('/admin', adminRouter);

// --- public docs (catch-all, must be last) ---------------------------------

app.get('/', (req, res) => res.redirect('/home'));

// Legacy redirects carried over from the original site's docs.json.
const REDIRECTS = {
  '/about-us': '/our-divisions/management-division',
  '/about-us/our-team': '/our-divisions/management-division',
  '/introduction': '/home',
};
app.use((req, res, next) => {
  const target = REDIRECTS[req.path.replace(/\/+$/, '')];
  if (target) return res.redirect(301, target);
  next();
});

app.get(/.*/, (req, res) => {
  const slug = req.path.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!slug) return res.redirect('/home');

  const user = req.session && req.session.user;
  const canView = (p) => auth.canViewPage(user, p);

  const page = getPage.get(slug);
  if (!page) {
    return res.status(404).render('doc404', {
      title: 'Page not found',
      nav: nav.buildNav(navPages(), canView),
    });
  }

  if (page.internal && !canView(page)) {
    return res.status(403).render('restricted', {
      title: page.title + ' · Restricted',
      page,
      loggedIn: !!user,
      nav: nav.buildNav(navPages(), canView),
      nextUrl: req.originalUrl,
    });
  }

  recordView(req, page);

  // The public shift schedule injects live shifts in place of [[SHIFTS_TABLE]].
  let pageContent = stripDocTitle(page.content, page.title);
  if (page.slug === 'shifts/shift-schedule') {
    pageContent = pageContent.replace(/\[\[SHIFTS_TABLE\]\]/g, shiftScheduleMarkdown());
  }
  const { html, toc } = md.render(pageContent);
  const flat = orderedPages(canView);
  const idx = flat.findIndex((p) => p.slug === page.slug);
  const prev = idx > 0 ? flat[idx - 1] : null;
  const next = idx >= 0 && idx < flat.length - 1 ? flat[idx + 1] : null;

  res.render('doc', {
    title: page.title,
    page,
    html,
    toc,
    prev,
    next,
    canEditThis: auth.canEditPage(user, page),
    nav: nav.buildNav(navPages(), canView),
  });
});

// --- errors ----------------------------------------------------------------

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', {
    title: 'Server error',
    heading: 'Something went wrong',
    message: isProd ? 'An unexpected error occurred.' : String(err && err.stack ? err.stack : err),
  });
});

app.listen(PORT, () => {
  console.log(`Valley Correctional Facility docs running on http://localhost:${PORT}`);
});
