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
const profanity = require('./lib/profanity');
const collab = require('./lib/collab');

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
        connectSrc: ["'self'", 'wss:'].concat(isProd ? [] : ['ws:']),
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.json({ limit: '6mb' })); // headroom for base64 evidence uploads

// Uploaded evidence files (staff dashboard). Size/type validated on upload.
const UPLOAD_DIR = path.join(__dirname, 'data', 'uploads');
try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (e) { /* ignore */ }
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: isProd ? '30d' : 0 }));

// Total evidence storage is capped so uploads can never fill the 25 GB VM.
// Override with UPLOAD_TOTAL_CAP_MB. The running total is cached in memory and
// seeded once by scanning the directory, so uploads stay O(1).
const UPLOAD_CAP = (Number(process.env.UPLOAD_TOTAL_CAP_MB) || 4096) * 1024 * 1024; // 4 GB default
let uploadBytes = -1;
function uploadsTotal() {
  if (uploadBytes < 0) {
    uploadBytes = 0;
    try { for (const f of fs.readdirSync(UPLOAD_DIR)) { try { uploadBytes += fs.statSync(path.join(UPLOAD_DIR, f)).size; } catch (e) {} } } catch (e) {}
  }
  return uploadBytes;
}

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

// dashboard.<domain> serves the staff dashboard at its root (assets shared).
app.use((req, res, next) => {
  const host = (req.headers.host || '').toLowerCase();
  res.locals.isDashboardHost = host.startsWith('dashboard.');
  if (res.locals.isDashboardHost && (req.path === '/' || req.path === '/home')) {
    return res.redirect('/dashboard');
  }
  next();
});

// Named so the collab WebSocket upgrade can run the same session parsing.
const sessionMw = session({
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
    // Shared across subdomains (docs.* + dashboard.*) so login persists.
    domain: process.env.COOKIE_DOMAIN || undefined,
    maxAge: 1000 * 60 * 60 * 24 * 14, // 14 days
  },
});
app.use(sessionMw);

// Reload the logged-in user from the DB on every request so role, division,
// and suspension changes take effect immediately on the next navigation
// (the realtime guard handles the page they're already looking at).
const touchLastSeen = db.prepare(
  "UPDATE users SET last_seen = datetime('now') WHERE id = ? AND (last_seen IS NULL OR last_seen < datetime('now','-60 seconds'))"
);
// Expired timed suspensions lift automatically (both fields compare as UTC strings).
const clearExpiredSuspension = db.prepare(
  "UPDATE users SET suspended=0, suspended_until=NULL WHERE id=? AND suspended=1 AND terminated=0 AND suspended_until IS NOT NULL AND suspended_until <= datetime('now')"
);
app.use((req, res, next) => {
  if (req.session && req.session.user) {
    let fresh = db.prepare('SELECT id, username, role, divisions, suspended, suspended_until, agreed_policy, rank, ranks, terminated, deleted FROM users WHERE id = ?').get(req.session.user.id);
    if (!fresh || fresh.deleted) return req.session.destroy(() => res.redirect('/'));
    if (fresh.suspended && clearExpiredSuspension.run(fresh.id).changes) {
      audit(fresh.username, 'user.suspension_expired', fresh.username, 'timed suspension lifted');
      fresh = Object.assign({}, fresh, { suspended: 0, suspended_until: null });
    }
    try { touchLastSeen.run(fresh.id); } catch (e) { /* non-critical */ }
    req.session.user = {
      id: fresh.id, username: fresh.username,
      role: fresh.role, divisions: fresh.divisions || '', suspended: fresh.suspended,
      suspended_until: fresh.suspended_until || null,
      agreed_policy: fresh.agreed_policy, rank: fresh.rank || '', ranks: fresh.ranks || '', terminated: fresh.terminated || 0,
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
  res.locals.canStaffDashboard = auth.canStaffDashboard(req.session && req.session.user);
  res.locals.canManageStaffNav = auth.canManageStaff(req.session && req.session.user);
  res.locals.canModerate = auth.canModerate(req.session && req.session.user);
  res.locals.canSID = auth.canSID(req.session && req.session.user);
  res.locals.canFeedbackStaff = auth.canFeedbackStaff(req.session && req.session.user);
  res.locals.openFeedback = res.locals.canFeedbackStaff
    ? db.prepare("SELECT COUNT(*) AS n FROM feedback WHERE status='open'").get().n : 0;
  // Staff-policy agreement state for the first-login / policy-changed gate.
  const u = req.session && req.session.user;
  res.locals.policyVersion = policyVersion();
  res.locals.needsPolicy = !!(u && Number(u.agreed_policy || 0) < res.locals.policyVersion);
  res.locals.policyClauses = policyClauses();
  // Render a single policy clause: escape it, then allow simple **bold** spans.
  res.locals.policyLine = (s) =>
    res.locals.escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // SEO: keep staff/app surfaces out of search indexes. Public doc pages stay
  // indexable (internal handbooks are additionally excluded in head.ejs).
  res.locals.noindex = /^\/(admin|dashboard|account|login|feedback|api)\b/.test(req.path);
  res.locals.isDashboardHost = res.locals.isDashboardHost || false;
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

// --- render cache: markdown is expensive; cache HTML per (slug, updated_at) ---
const renderCache = new Map();
function renderPage(page) {
  const key = page.slug;
  const cached = renderCache.get(key);
  if (cached && cached.v === page.updated_at) return cached;
  const stripped = stripDocTitle(page.content, page.title);
  const out = md.render(stripped);
  const rec = { v: page.updated_at, html: out.html, toc: out.toc, plain: md.toPlainText(page.content).slice(0, 4000) };
  renderCache.set(key, rec);
  return rec;
}
function invalidateRenderCache(slug) { if (slug) renderCache.delete(slug); else renderCache.clear(); searchIndexCache = null; }

// Search index is rebuilt only when content changes (invalidated on save).
let searchIndexCache = null;
function buildSearchIndex() {
  if (searchIndexCache) return searchIndexCache;
  searchIndexCache = navPages().map((p) => {
    const content = String(p.content || '').replace(/\[\[SHIFTS_TABLE\]\]/g, '');
    const { toc } = md.render(content);
    return {
      slug: p.slug, title: p.title, group: p.group_name, internal: !!p.internal,
      description: p.description,
      headings: toc.map((h) => ({ text: h.text, id: h.id })),
      text: md.toPlainText(content).slice(0, 4000),
    };
  });
  return searchIndexCache;
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

function recordViewRow(req, { slug, area }) {
  try {
    const ua = (req.headers['user-agent'] || '').slice(0, 300);
    const ip = req.ip || '';
    const visitor = crypto.createHash('sha256').update(ip + '|' + ua).digest('hex').slice(0, 16);
    const day = new Date().toISOString().slice(0, 10);
    const u = req.session && req.session.user;
    db.prepare(
      `INSERT INTO page_views (path, slug, day, visitor, referrer, ua, authed, username, area)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      req.path,
      slug || null,
      day,
      visitor,
      (req.headers.referer || '').slice(0, 300),
      ua,
      u ? 1 : 0,
      u ? u.username : null,
      area || 'docs'
    );
  } catch (e) {
    // analytics must never break a page render
  }
}
function recordView(req, page) {
  recordViewRow(req, { slug: page ? page.slug : null, area: 'docs' });
}
// Records admin/dashboard page visits (staff-activity trail). Synthesized slugs
// use an "area:path" form that can never collide with real page slugs.
function viewRecorder(area) {
  return (req, res, next) => {
    res.on('finish', () => {
      if (req.method !== 'GET' || res.statusCode >= 400) return;
      if (!String(res.get('Content-Type') || '').includes('text/html')) return;
      const slug = area + ':' + (String(req.baseUrl + req.path).replace(/^\/+|\/+$/g, '') || area);
      recordViewRow(req, { slug, area });
    });
    next();
  };
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
  // no-store: a cached/bfcached login form carries a stale CSRF token, which
  // locks users out after logout until they clear the cache.
  res.set('Cache-Control', 'no-store');
  if (req.session.user) return res.redirect('/admin');
  res.render('login', {
    title: 'Staff Login',
    next: req.query.next || '/admin',
    error: null,
    layout: false,
  });
});

app.post('/login', loginLimiter, auth.csrfToken, auth.verifyCsrf, (req, res) => {
  res.set('Cache-Control', 'no-store');
  const { username, password } = req.body;
  // Only allow same-site relative paths (reject protocol-relative //evil.com).
  const reqNext = typeof req.body.next === 'string' && /^\/(?!\/)/.test(req.body.next) ? req.body.next : '';
  let user = auth.findUserByUsername((username || '').trim());
  if (!user || !auth.verifyPassword(password || '', user.password)) {
    audit((username || '').trim() || 'unknown', 'user.login_fail', (username || '').trim(), 'invalid credentials · ' + (req.ip || ''));
    return res.status(401).render('login', {
      title: 'Staff Login',
      next: reqNext || '/admin',
      error: 'Invalid username or password.',
      layout: false,
    });
  }
  // A timed suspension that has run out lifts itself at the door.
  if (user.suspended && !user.terminated && clearExpiredSuspension.run(user.id).changes) {
    audit(user.username, 'user.suspension_expired', user.username, 'timed suspension lifted at login');
    user = Object.assign({}, user, { suspended: 0, suspended_until: null });
  }
  if (auth.isSuspended(user)) {
    audit(user.username, 'user.login_blocked', user.username, (user.terminated ? 'terminated' : 'suspended') + ' account attempted login');
    const until = user.suspended_until ? new Date(user.suspended_until.replace(' ', 'T') + 'Z') : null;
    return res.status(403).render('login', {
      title: 'Account suspended',
      next: reqNext || '/admin',
      error: user.terminated
        ? 'This account has been terminated and can no longer sign in.'
        : 'This account is suspended' + (until && !isNaN(until) ? ' until ' + until.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' (UTC)' : '') + '. Contact an administrator to be reinstated.',
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
    req.session.user = { id: user.id, username: user.username, role: user.role, divisions: user.divisions || '', rank: user.rank || '', ranks: user.ranks || '', terminated: user.terminated || 0 };
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
  const index = buildSearchIndex().filter((p) => {
    const pg = getPageAny.get(p.slug);
    return pg && auth.canViewPage(user, pg);
  });
  res.set('Cache-Control', 'no-store');
  res.json(index);
});

// --- SEO: robots.txt + sitemap.xml (public, non-internal pages only) --------
function siteOrigin(req) {
  return (process.env.SITE_URL || (req.protocol + '://' + req.get('host'))).replace(/\/+$/, '');
}
app.get('/robots.txt', (req, res) => {
  const origin = siteOrigin(req);
  res.type('text/plain').send(
    'User-agent: *\n' +
    'Allow: /\n' +
    'Disallow: /admin\nDisallow: /dashboard\nDisallow: /account\nDisallow: /login\nDisallow: /feedback\nDisallow: /api\nDisallow: /internal-documents\n\n' +
    'Sitemap: ' + origin + '/sitemap.xml\n'
  );
});
app.get('/sitemap.xml', (req, res) => {
  const origin = siteOrigin(req);
  const pages = db.prepare("SELECT slug, updated_at FROM pages WHERE published = 1 AND internal = 0 ORDER BY sort").all();
  const esc = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
  const urls = pages.map((p) => {
    const lastmod = (p.updated_at || '').slice(0, 10);
    return '  <url><loc>' + esc(origin + '/' + p.slug) + '</loc>' + (lastmod ? '<lastmod>' + lastmod + '</lastmod>' : '') + '<changefreq>weekly</changefreq></url>';
  }).join('\n');
  res.type('application/xml').send(
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls + '\n</urlset>\n'
  );
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

// Browser-reported IANA timezone (shown on the staff overview page).
app.post('/api/tz', auth.requireAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  const tz = String((req.body && req.body.tz) || '').slice(0, 64);
  if (/^[A-Za-z_]+(\/[A-Za-z0-9_+\-]+){0,2}$/.test(tz)) {
    db.prepare('UPDATE users SET timezone = ? WHERE id = ?').run(tz, req.session.user.id);
  }
  res.json({ ok: true });
});

// Screenshot / capture attempt reported by protect.js — logged & traced.
const screenshotLimiter = rateLimit({ windowMs: 10000, max: 8, standardHeaders: false, legacyHeaders: false });
app.post('/api/screenshot-attempt', screenshotLimiter, (req, res) => {
  res.set('Cache-Control', 'no-store');
  const u = req.session && req.session.user;
  const who = u ? u.username : 'anonymous';
  const method = String((req.body && req.body.method) || 'unknown').slice(0, 40);
  const slug = String((req.body && req.body.slug) || '').slice(0, 120);
  audit(who, 'security.screenshot', slug || '(page)', method + ' · ' + (req.ip || ''));
  res.json({ ok: true });
});

// Live analytics feed — active users + rolling event stream (polled by the page).
app.get('/api/analytics/live', auth.requireAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (req.session.user.role !== 'admin') return res.status(403).json({ ok: false });
  const active = db.prepare(
    "SELECT COUNT(DISTINCT visitor) AS n FROM page_views WHERE ts >= datetime('now','-5 minutes')"
  ).get().n;
  const activeStaff = db.prepare(
    "SELECT COUNT(DISTINCT username) AS n FROM page_views WHERE username IS NOT NULL AND ts >= datetime('now','-5 minutes')"
  ).get().n;
  const perMin = db.prepare(
    "SELECT strftime('%H:%M', ts) AS m, COUNT(*) AS n FROM page_views WHERE ts >= datetime('now','-30 minutes') GROUP BY m ORDER BY m"
  ).all();
  const recent = db.prepare(
    'SELECT slug, path, ts, authed, username FROM page_views ORDER BY id DESC LIMIT 15'
  ).all().map((r) => ({ title: (r.slug && getPageAny.get(r.slug) || {}).title || r.slug || r.path, slug: r.slug, ts: r.ts, who: r.username || (r.authed ? 'Staff' : 'Anon') }));
  const onlineNow = db.prepare(
    "SELECT username, MAX(ts) AS ts FROM page_views WHERE username IS NOT NULL AND ts >= datetime('now','-5 minutes') GROUP BY username ORDER BY ts DESC LIMIT 12"
  ).all();
  res.json({ ok: true, active, activeStaff, perMin, recent, onlineNow, serverTime: new Date().toISOString() });
});

// --- self-service account: any logged-in user can change their own password --
function accountData(req) {
  const uname = req.session.user.username;
  // A staff member may see their OWN infractions (record transparency). Evidence
  // and the issuing investigator are withheld — confidentiality per the handbook.
  const myInfractions = db.prepare(
    "SELECT type, points, reason, outcome, created_at FROM infractions WHERE staff_user = ? COLLATE NOCASE AND status='active' AND voided=0 ORDER BY created_at DESC LIMIT 50"
  ).all(uname);
  const row = db.prepare('SELECT ranks, rank FROM users WHERE id = ?').get(req.session.user.id) || {};
  const rankLabels = Object.values(auth.userRanks(row)).map(auth.rankLabel).filter(Boolean);
  return { myInfractions, myPoints: staffPoints(uname), rankLabels };
}
app.get('/account', auth.requireAuth, auth.csrfToken, (req, res) => {
  res.render('account', Object.assign({
    title: 'Your account', done: req.query.updated === '1', error: null,
  }, accountData(req)));
});

app.post('/account/password', auth.requireAuth, auth.csrfToken, auth.verifyCsrf, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
  const current = req.body.current || '', next_ = req.body.new || '', confirm = req.body.confirm || '';
  let error = null;
  if (!u || !auth.verifyPassword(current, u.password)) error = 'Your current password is incorrect.';
  else if (next_.length < 6) error = 'New password must be at least 6 characters.';
  else if (next_ !== confirm) error = 'New passwords do not match.';
  if (error) return res.status(400).render('account', Object.assign({ title: 'Your account', done: false, error }, accountData(req)));
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
adminRouter.use(viewRecorder('admin'));

adminRouter.get('/', (req, res) => {
  const pageCount = db.prepare('SELECT COUNT(*) AS n FROM pages').get().n;
  // Views are counted per user (unique visitor × page × day), not per raw hit.
  const UNIQV = "COUNT(DISTINCT visitor || '¦' || COALESCE(slug, path))";
  const views7 = db.prepare(
    `SELECT ${UNIQV} AS n FROM page_views WHERE area='docs' AND day >= date('now','-6 days')`
  ).get().n;
  const views30 = db.prepare(
    `SELECT ${UNIQV} AS n FROM page_views WHERE area='docs' AND day >= date('now','-29 days')`
  ).get().n;
  const visitors30 = db.prepare(
    "SELECT COUNT(DISTINCT visitor) AS n FROM page_views WHERE area='docs' AND day >= date('now','-29 days')"
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
    iconNames: Object.keys(icons.ICONS),
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
    iconNames: Object.keys(icons.ICONS),
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

  // No-op saves are acknowledged but never logged — saving without changes
  // must not create a revision or an activity-log entry.
  if (existing
    && existing.title === payload.title && existing.description === payload.description
    && existing.group_name === payload.group_name && existing.icon === payload.icon
    && existing.content === payload.content && Number(existing.internal) === payload.internal
    && Number(existing.sort) === payload.sort && (existing.division || '') === payload.division) {
    return res.json({ ok: true, slug, url: '/' + slug, unchanged: true });
  }

  // If a live co-editing session holds this page, merge the content into the
  // shared doc (instead of clobbering concurrent edits) and only write meta.
  const liveHandled = existing && collab.applyExternalSave(slug, payload.content);

  if (existing && liveHandled) {
    db.prepare(
      `UPDATE pages SET title=@title, description=@description, group_name=@group_name,
        icon=@icon, internal=@internal, sort=@sort, division=@division,
        updated_at=datetime('now'), updated_by=@editor WHERE slug=@slug`
    ).run({ ...payload, editor });
  } else if (existing) {
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
  invalidateRenderCache();

  res.json({ ok: true, slug, url: '/' + slug });
});

// Core pages that must always exist and cannot be deleted from the editor.
const UNDELETABLE_SLUGS = ['shifts/shift-schedule', 'home'];
adminRouter.post('/delete', auth.verifyCsrf, (req, res) => {
  if (req.session.user.role !== 'admin') return res.status(403).json({ ok: false, error: 'Only administrators can delete pages.' });
  const slug = normalizeSlug(req.body.slug);
  if (UNDELETABLE_SLUGS.includes(slug)) {
    return res.status(400).json({ ok: false, error: 'This page is protected and cannot be deleted. The Event Schedule is managed from the Event Scheduler.' });
  }
  const page = getPageAny.get(slug);
  db.prepare('DELETE FROM pages WHERE slug = ?').run(slug);
  audit(req.session.user.username, 'page.delete', '/' + slug, page ? page.title : '');
  invalidateRenderCache();
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
  invalidateRenderCache();
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
     FROM page_views WHERE area='docs' AND day >= date('now', ?) GROUP BY day ORDER BY day`
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
    viewsToday: one(`SELECT ${UNIQV} AS n FROM page_views WHERE area='docs' AND day = date('now')`),
    viewsRange: one(`SELECT ${UNIQV} AS n FROM page_views WHERE area='docs' AND day >= date('now', ?)`, since),
    visitorsRange: one("SELECT COUNT(DISTINCT visitor) AS n FROM page_views WHERE area='docs' AND day >= date('now', ?)", since),
    views: one(`SELECT ${UNIQV} AS n FROM page_views WHERE area='docs'`),
    visitors: one("SELECT COUNT(DISTINCT visitor) AS n FROM page_views WHERE area='docs'"),
  };
  totals.avgPerDay = Math.round(totals.viewsRange / days);
  const busiest = rows.slice().sort((a, b) => b.views - a.views)[0];
  totals.busiestDay = busiest ? busiest.day : '—';
  totals.busiestViews = busiest ? busiest.views : 0;

  const topPages = db.prepare(
    `SELECT slug, COUNT(DISTINCT visitor) AS views, COUNT(DISTINCT visitor) AS visitors FROM page_views
     WHERE area='docs' AND slug IS NOT NULL AND day >= date('now', ?) GROUP BY slug ORDER BY views DESC LIMIT 12`
  ).all(since).map((r) => {
    const p = getPageAny.get(r.slug);
    return { slug: r.slug, title: p ? p.title : r.slug, internal: p ? !!p.internal : false, views: r.views, visitors: r.visitors };
  });

  const referrers = db.prepare(
    `SELECT referrer, COUNT(*) AS n FROM page_views
     WHERE area='docs' AND referrer IS NOT NULL AND referrer != '' AND day >= date('now', ?)
     GROUP BY referrer ORDER BY n DESC LIMIT 8`
  ).all(since);

  // authenticated vs anonymous
  const authedRow = db.prepare(`SELECT SUM(authed) AS a, COUNT(*) AS t FROM page_views WHERE area='docs' AND day >= date('now', ?)`).get(since);
  const authed = { staff: authedRow.a || 0, anon: (authedRow.t || 0) - (authedRow.a || 0) };

  // internal vs public
  const intRow = db.prepare(
    `SELECT SUM(CASE WHEN p.internal=1 THEN 1 ELSE 0 END) AS i, COUNT(*) AS t
     FROM page_views v LEFT JOIN pages p ON p.slug = v.slug WHERE v.area='docs' AND v.day >= date('now', ?)`
  ).get(since);
  const scope = { internal: intRow.i || 0, public: (intRow.t || 0) - (intRow.i || 0) };

  // views by hour of day
  const hourRows = db.prepare(
    `SELECT CAST(strftime('%H', ts) AS INTEGER) AS h, COUNT(*) AS n FROM page_views WHERE area='docs' AND day >= date('now', ?) GROUP BY h`
  ).all(since);
  const hourMap = new Map(hourRows.map((r) => [r.h, r.n]));
  const byHour = []; for (let h = 0; h < 24; h++) byHour.push({ h, n: hourMap.get(h) || 0 });

  // browser / OS breakdown
  const uaRows = db.prepare(`SELECT ua, COUNT(*) AS n FROM page_views WHERE area='docs' AND day >= date('now', ?) GROUP BY ua`).all(since);
  const brow = {}, os = {};
  uaRows.forEach((r) => { brow[uaBrowser(r.ua)] = (brow[uaBrowser(r.ua)] || 0) + r.n; os[uaOS(r.ua)] = (os[uaOS(r.ua)] || 0) + r.n; });
  const toArr = (o) => Object.keys(o).map((k) => ({ label: k, n: o[k] })).sort((a, b) => b.n - a.n);

  const recent = db.prepare(
    `SELECT slug, ts, authed, username FROM page_views WHERE area='docs' ORDER BY id DESC LIMIT 12`
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
// Staff page: admins + managers. Managers are scoped to their governed divisions.
function requireStaffMgr(req, res, next) {
  if (auth.canManageStaff(req.session && req.session.user)) return next();
  return res.status(403).render('error', { title: 'Forbidden', heading: '403 — No staff access', message: 'Only administrators and Managers can manage staff accounts.' });
}
// Filter a submitted divisions CSV to only those the actor may assign.
function scopedDivisions(actor, body) {
  return parseDivisions(body).split(',').filter(Boolean).filter((d) => auth.canAssignDivision(actor, d)).join(',');
}
function scopedRanks(actor, body, divisions) {
  // A rank exists only while its division is held — removing a division
  // removes that division's rank (management/osc included).
  const map = {};
  const divList = divisions.split(',');
  ['moderation', 'sid', 'management', 'osc'].forEach((d) => {
    const key = body['rank_' + d];
    if (auth.RANKS[key] && auth.RANKS[key].division === d && divList.includes(d) && auth.canAssignRank(actor, key)) map[d] = key;
  });
  return Object.keys(map).length ? JSON.stringify(map) : '';
}

adminRouter.get('/staff', requireStaffMgr, (req, res) => {
  const actor = req.session.user;
  const tab = req.query.tab === 'past' ? 'past' : 'active';
  const all = db.prepare('SELECT id, username, role, divisions, suspended, suspended_until, terminated, deleted, created_at, last_login, last_seen, rank, ranks FROM users ORDER BY id').all();
  const viewCounts = new Map(
    db.prepare('SELECT username, COUNT(*) AS n FROM page_views WHERE username IS NOT NULL GROUP BY username').all()
      .map((r) => [r.username, r.n])
  );
  all.forEach((u) => {
    u.doc_views = viewCounts.get(u.username) || 0;
    u.rankMod = auth.rankForDivision(u, 'moderation');
    u.rankSID = auth.rankForDivision(u, 'sid');
    u.rankLabels = [u.rankMod, u.rankSID].filter(Boolean).map(auth.rankLabel);
    u.rankMgmt = auth.rankForDivision(u, 'management');
    u.rankOSC = auth.rankForDivision(u, 'osc');
    if (u.rankMgmt) u.rankLabels.push(auth.rankLabel(u.rankMgmt));
    if (u.rankOSC) u.rankLabels.push(auth.rankLabel(u.rankOSC));
  });
  const isPast = (u) => u.deleted || u.terminated;
  const users = all.filter((u) => (tab === 'past' ? isPast(u) : !isPast(u)));
  const pastCount = all.filter(isPast).length;
  const ranksByDiv = { moderation: [], sid: [], management: [], osc: [] };
  Object.keys(auth.RANKS).forEach((k) => { const r = auth.RANKS[k]; if (ranksByDiv[r.division]) ranksByDiv[r.division].push({ key: k, label: r.label }); });
  res.render('admin/staff', {
    title: 'Admin · Staff', section: 'staff', users, tab, pastCount, divisions: auth.DIVISIONS, ranksByDiv,
    governed: auth.governedDivisions(actor), canGrantEditor: auth.canGrantEditor(actor),
    canAdminActions: auth.canAdminStaffActions(actor), isAdmin: actor.role === 'admin',
    filter: { division: String(req.query.division || ''), rank: String(req.query.rank || ''), q: String(req.query.q || '') },
  });
});

adminRouter.post('/staff/create', requireStaffMgr, auth.verifyCsrf, (req, res) => {
  const actor = req.session.user;
  const username = (req.body.username || '').trim();
  let role = ['admin', 'editor', 'staff'].includes(req.body.role) ? req.body.role : 'staff';
  // Managers may only create 'staff' (or 'editor' if they're a Community Manager).
  if (actor.role !== 'admin') { if (role === 'admin') role = 'staff'; if (role === 'editor' && !auth.canGrantEditor(actor)) role = 'staff'; }
  const divisions = usesDivisions(role) ? scopedDivisions(actor, req.body) : '';
  const ranks = scopedRanks(actor, req.body, divisions);
  const password = req.body.password || '';
  if (!username || password.length < 6) {
    return res.status(400).render('error', { title: 'Invalid', heading: 'Could not create staff member', message: 'Username is required and password must be at least 6 characters.' });
  }
  try {
    db.prepare('INSERT INTO users (username, password, role, divisions, ranks) VALUES (?, ?, ?, ?, ?)')
      .run(username, auth.hashPassword(password), role, divisions, ranks);
    audit(actor.username, 'user.create', username, role + (divisions ? ' [' + divisions + ']' : ''));
  } catch (e) {
    return res.status(400).render('error', { title: 'Invalid', heading: 'Could not create staff member', message: 'That username is already taken.' });
  }
  res.redirect('/admin/staff');
});

// Update a member's role and/or division access (managers are scoped).
adminRouter.post('/staff/access', requireStaffMgr, auth.verifyCsrf, (req, res) => {
  const actor = req.session.user;
  const id = Number(req.body.id);
  const target = db.prepare('SELECT id, username, role, divisions, ranks, rank FROM users WHERE id = ?').get(id);
  if (!target) return res.redirect('/admin/staff');
  let role = ['admin', 'editor', 'staff'].includes(req.body.role) ? req.body.role : 'staff';
  if (actor.role !== 'admin') {
    // Managers can't set admin, and only Community Managers can set editor.
    if (role === 'admin') role = target.role === 'admin' ? 'admin' : 'staff';
    if (role === 'editor' && !auth.canGrantEditor(actor)) role = target.role;
  }
  if (id === actor.id && role !== 'admin' && actor.role === 'admin') {
    return res.status(400).render('error', { title: 'Invalid', heading: 'Cannot demote yourself', message: 'You cannot change your own account out of the admin role.' });
  }
  // Divisions: keep the ones the actor can't touch; apply the actor's scoped set.
  const existingDivs = (target.divisions || '').split(',').filter(Boolean);
  const keepDivs = existingDivs.filter((d) => !auth.canAssignDivision(actor, d));
  const newScoped = usesDivisions(role) ? scopedDivisions(actor, req.body).split(',').filter(Boolean) : [];
  const divisions = Array.from(new Set([...keepDivs, ...newScoped])).join(',');
  // Ranks: preserve ranks in divisions the actor can't govern; apply scoped ranks.
  let existingRanks = {}; try { existingRanks = target.ranks ? JSON.parse(target.ranks) : {}; } catch (e) {}
  const keepRanks = {};
  Object.keys(existingRanks).forEach((d) => { if (!auth.governedDivisions(actor).includes(d)) keepRanks[d] = existingRanks[d]; });
  let scoped = {}; try { scoped = JSON.parse(scopedRanks(actor, req.body, divisions) || '{}'); } catch (e) {}
  const finalRanks = Object.assign({}, keepRanks, scoped);
  // Removing a division removes that division's rank — no exceptions. Ranks in
  // ungoverned divisions survive only while the target still holds the division.
  Object.keys(finalRanks).forEach((d) => { if (!divisions.split(',').includes(d)) delete finalRanks[d]; });
  const ranksJson = Object.keys(finalRanks).length ? JSON.stringify(finalRanks) : '';
  db.prepare("UPDATE users SET role = ?, divisions = ?, ranks = ?, rank = '' WHERE id = ?").run(role, divisions, ranksJson, id);
  const rankSummary = Object.values(finalRanks).map(auth.rankLabel).join(', ');
  audit(actor.username, 'user.role', target.username, role + (divisions ? ' [' + divisions + ']' : '') + (rankSummary ? ' · ' + rankSummary : ''));
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
    const admins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND suspended=0 AND deleted=0 AND terminated=0").get().n;
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

// Archive (soft delete): the account is locked out and moved to "Past staff",
// but every log, punishment, and infraction it appears in is retained.
adminRouter.post('/staff/delete', auth.requireAdmin, auth.verifyCsrf, (req, res) => {
  const id = Number(req.body.id);
  if (id === req.session.user.id) {
    return res.status(400).render('error', {
      title: 'Invalid', heading: 'Cannot archive yourself', message: 'You cannot archive the account you are logged in as.',
    });
  }
  const admins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND deleted = 0 AND terminated = 0").get().n;
  const target = db.prepare('SELECT role FROM users WHERE id = ?').get(id);
  if (target && target.role === 'admin' && admins <= 1) {
    return res.status(400).render('error', {
      title: 'Invalid', heading: 'Cannot archive last admin', message: 'There must be at least one active administrator.',
    });
  }
  const delTarget = db.prepare('SELECT username FROM users WHERE id = ?').get(id);
  db.prepare('UPDATE users SET deleted = 1, suspended = 1 WHERE id = ?').run(id);
  audit(req.session.user.username, 'user.archive', delTarget ? delTarget.username : '#' + id, 'account archived (logs retained)');
  res.redirect('/admin/staff?tab=past');
});

// Reinstate a terminated/archived account back to active staff.
adminRouter.post('/staff/reinstate', auth.requireAdmin, auth.verifyCsrf, (req, res) => {
  const id = Number(req.body.id);
  const target = db.prepare('SELECT username FROM users WHERE id = ?').get(id);
  db.prepare('UPDATE users SET terminated = 0, suspended = 0, deleted = 0, suspended_until = NULL WHERE id = ?').run(id);
  audit(req.session.user.username, 'user.reinstate', target ? target.username : '#' + id, 'restored from past staff');
  res.redirect('/admin/staff');
});

// Rename a staff account. Usernames are soft foreign keys across the logs, so
// every referencing column is rewritten in one transaction. The audit log is
// deliberately left as-is (history records what actually happened) — a
// user.rename entry ties the two names together.
adminRouter.post('/staff/rename', auth.requireAdmin, auth.verifyCsrf, (req, res) => {
  const id = Number(req.body.id);
  const next_ = String(req.body.username || '').trim();
  const target = db.prepare('SELECT id, username FROM users WHERE id = ?').get(id);
  if (!target) return res.redirect('/admin/staff');
  if (!/^[A-Za-z0-9_]{3,20}$/.test(next_)) {
    return res.status(400).render('error', { title: 'Invalid', heading: 'Invalid username', message: 'Usernames are 3–20 characters: letters, numbers, and underscores (matching Roblox).' });
  }
  const clash = db.prepare('SELECT id FROM users WHERE lower(username) = lower(?) AND id != ?').get(next_, id);
  if (clash) {
    return res.status(400).render('error', { title: 'Invalid', heading: 'Username taken', message: 'Another account already uses that username.' });
  }
  const old = target.username;
  const rename = db.transaction(() => {
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run(next_, id);
    [
      ['pages', 'updated_by'], ['page_revisions', 'editor'], ['page_views', 'username'],
      ['shifts', 'created_by'], ['shifts', 'host'],
      ['punishments', 'moderator'], ['punishments', 'approved_by'], ['punishments', 'voided_by'],
      ['infractions', 'staff_user'], ['infractions', 'issued_by'], ['infractions', 'approved_by'], ['infractions', 'voided_by'],
      ['feedback', 'submitted_by'], ['feedback', 'status_by'], ['feedback_messages', 'sender_name'],
    ].forEach(([t, c]) => db.prepare(`UPDATE ${t} SET ${c} = ? WHERE ${c} = ? COLLATE NOCASE`).run(next_, old));
  });
  rename();
  audit(req.session.user.username, 'user.rename', next_, 'was ' + old);
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

// --- event scheduler -------------------------------------------------------
// Managed by admins + Management/Oversight staff; shown on the public schedule.
const SHIFT_TYPES = ['Roleplay Shift', 'Gamenight', 'Training Event', 'Recruitment Event'];
const MAX_EVENTS = 3; // hard cap on scheduled events (total rows)
const upcomingShiftsStmt = db.prepare("SELECT * FROM shifts WHERE date >= date('now','-1 day') ORDER BY COALESCE(starts_at, date || 'T00:00'), time");
const allShiftsStmt = db.prepare("SELECT * FROM shifts ORDER BY COALESCE(starts_at, date || 'T00:00') DESC, time");

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

const activeHostsStmt = db.prepare('SELECT username FROM users WHERE suspended = 0 AND terminated = 0 AND deleted = 0 ORDER BY username COLLATE NOCASE');
app.get('/admin/shifts', requireShiftManager, auth.csrfToken, viewRecorder('admin'), (req, res) => {
  const shifts = allShiftsStmt.all();
  res.render('admin/shifts', {
    title: 'Admin · Event Scheduler',
    section: 'shifts',
    shifts,
    shiftTypes: SHIFT_TYPES,
    hosts: activeHostsStmt.all().map((r) => r.username),
    maxEvents: MAX_EVENTS,
    atCap: shifts.length >= MAX_EVENTS,
    saved: req.query.saved === '1',
  });
});

app.post('/admin/shifts/add', requireShiftManager, auth.csrfToken, auth.verifyCsrf, (req, res) => {
  // Times arrive as exact UTC instants composed client-side from the scheduler's
  // local timezone; every viewer sees them converted to their own timezone.
  const startsAt = String(req.body.starts_at || '').trim();
  const endsAt = String(req.body.ends_at || '').trim();
  const isIso = (s) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$/.test(s);
  if (!isIso(startsAt)) {
    return res.status(400).render('error', { title: 'Invalid', heading: 'Invalid date/time', message: 'Pick a valid event date and start time.' });
  }
  if (endsAt && (!isIso(endsAt) || endsAt <= startsAt)) {
    return res.status(400).render('error', { title: 'Invalid', heading: 'Invalid end time', message: 'The end time must be after the start time.' });
  }
  const type = SHIFT_TYPES.includes(req.body.type) ? req.body.type : SHIFT_TYPES[0];
  const host = String(req.body.host || '').trim().slice(0, 80);
  if (host && !activeHostsStmt.all().some((r) => r.username.toLowerCase() === host.toLowerCase())) {
    return res.status(400).render('error', { title: 'Invalid', heading: 'Unknown host', message: 'The host must be an active staff member.' });
  }
  const notes = String(req.body.notes || '').trim().slice(0, 200);
  const date = startsAt.slice(0, 10); // UTC date keeps legacy queries working
  const add = db.transaction(() => {
    if (db.prepare('SELECT COUNT(*) AS n FROM shifts').get().n >= MAX_EVENTS) return false;
    db.prepare('INSERT INTO shifts (date, time, type, host, notes, created_by, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(date, '', type, host, notes, req.session.user.username, startsAt, endsAt || null);
    return true;
  });
  if (!add()) {
    return res.status(400).render('error', { title: 'Limit reached', heading: 'Event limit reached', message: `Only ${MAX_EVENTS} events can be scheduled at a time (${MAX_EVENTS} of ${MAX_EVENTS} used). Remove an event to schedule another.` });
  }
  audit(req.session.user.username, 'shift.create', date, type + ' · ' + startsAt);
  res.redirect('/admin/shifts?saved=1');
});

app.post('/admin/shifts/delete', requireShiftManager, auth.csrfToken, auth.verifyCsrf, (req, res) => {
  const id = Number(req.body.id);
  const s = db.prepare('SELECT date, type FROM shifts WHERE id = ?').get(id);
  db.prepare('DELETE FROM shifts WHERE id = ?').run(id);
  if (s) audit(req.session.user.username, 'shift.delete', s.date, s.type);
  res.redirect('/admin/shifts');
});

// --- community feedback -----------------------------------------------------
// Anyone (logged in or anonymous) may submit feedback. Anonymous submitters
// hold a device secret (localStorage); the server stores only its sha256, so
// a DB leak can't impersonate a submitter. Management/Oversight staff triage.
const tokenHash = (t) => (t ? crypto.createHash('sha256').update(String(t)).digest('hex') : null);
const feedbackLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false });
const feedbackChatLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });

function feedbackAccess(req, row) {
  if (!row) return false;
  const u = req.session && req.session.user;
  if (u && auth.canFeedbackStaff(u)) return true;
  if (u && row.submitted_by && row.submitted_by.toLowerCase() === u.username.toLowerCase()) return true;
  const t = tokenHash(req.query.token || (req.body && req.body.token));
  return !!(t && row.device_token && row.device_token === t);
}

app.get('/feedback', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.render('feedback', { title: 'Share Feedback' });
});

const FEEDBACK_CATEGORIES = ['idea', 'bug', 'improvement', 'other'];
app.post('/api/feedback', feedbackLimiter, (req, res) => {
  res.set('Cache-Control', 'no-store');
  const title = String((req.body && req.body.title) || '').trim().slice(0, 120);
  const body = String((req.body && req.body.body) || '').trim().slice(0, 4000);
  const roblox = String((req.body && req.body.roblox_user) || '').trim().slice(0, 60);
  const category = FEEDBACK_CATEGORIES.includes(req.body && req.body.category) ? req.body.category : 'idea';
  const token = tokenHash(req.body && req.body.token);
  if (!title || !body) return res.status(400).json({ ok: false, error: 'A title and description are required.' });
  const bad = profanity.findProfanity(title) || profanity.findProfanity(body) || profanity.findProfanity(roblox);
  if (bad) {
    audit((req.session.user && req.session.user.username) || 'anonymous', 'feedback.blocked', title.slice(0, 60), 'profanity: ' + bad);
    return res.status(400).json({ ok: false, error: 'Please remove inappropriate language and try again.' });
  }
  const u = req.session && req.session.user;
  const info = db.prepare('INSERT INTO feedback (title, body, roblox_user, category, submitted_by, device_token) VALUES (?, ?, ?, ?, ?, ?)')
    .run(title, body, roblox, category, u ? u.username : null, token);
  audit(u ? u.username : 'anonymous', 'feedback.create', title.slice(0, 60), category + (roblox ? ' · roblox: ' + roblox : ''));
  res.json({ ok: true, id: info.lastInsertRowid });
});

app.get('/api/feedback/mine', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const u = req.session && req.session.user;
  const t = tokenHash(req.query.token);
  if (!u && !t) return res.json({ ok: true, items: [] });
  const items = db.prepare(
    `SELECT f.id, f.title, f.category, f.status, f.created_at, f.last_msg_at,
            (SELECT COUNT(*) FROM feedback_messages m WHERE m.feedback_id = f.id) AS msgs,
            (SELECT sender FROM feedback_messages m WHERE m.feedback_id = f.id ORDER BY m.id DESC LIMIT 1) AS last_sender
     FROM feedback f
     WHERE (f.device_token IS NOT NULL AND f.device_token = ?) OR (? IS NOT NULL AND f.submitted_by = ? COLLATE NOCASE)
     ORDER BY COALESCE(f.last_msg_at, f.created_at) DESC LIMIT 50`
  ).all(t, u ? u.username : null, u ? u.username : null);
  res.json({ ok: true, items });
});

app.get('/api/feedback/:id/messages', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const row = db.prepare('SELECT * FROM feedback WHERE id = ?').get(Number(req.params.id));
  if (!feedbackAccess(req, row)) return res.status(403).json({ ok: false });
  const messages = db.prepare('SELECT sender, sender_name, body, created_at FROM feedback_messages WHERE feedback_id = ? ORDER BY id LIMIT 200').all(row.id);
  res.json({ ok: true, feedback: { id: row.id, title: row.title, body: row.body, roblox_user: row.roblox_user, category: row.category, status: row.status, created_at: row.created_at, submitted_by: row.submitted_by }, messages });
});

app.post('/api/feedback/:id/message', feedbackChatLimiter, (req, res) => {
  res.set('Cache-Control', 'no-store');
  const row = db.prepare('SELECT * FROM feedback WHERE id = ?').get(Number(req.params.id));
  if (!feedbackAccess(req, row)) return res.status(403).json({ ok: false });
  const body = String((req.body && req.body.body) || '').trim().slice(0, 2000);
  if (!body) return res.status(400).json({ ok: false, error: 'Write a message first.' });
  const bad = profanity.findProfanity(body);
  const u = req.session && req.session.user;
  const asStaff = !!(u && auth.canFeedbackStaff(u));
  if (bad) {
    audit(asStaff ? u.username : 'submitter', 'feedback.blocked', '#' + row.id, 'profanity in chat: ' + bad);
    return res.status(400).json({ ok: false, error: 'Please remove inappropriate language and try again.' });
  }
  const info = db.prepare('INSERT INTO feedback_messages (feedback_id, sender, sender_name, body) VALUES (?, ?, ?, ?)')
    .run(row.id, asStaff ? 'staff' : 'submitter', asStaff ? u.username : null, body);
  db.prepare("UPDATE feedback SET last_msg_at = datetime('now') WHERE id = ?").run(row.id);
  const msg = db.prepare('SELECT sender, sender_name, body, created_at FROM feedback_messages WHERE id = ?').get(info.lastInsertRowid);
  res.json({ ok: true, message: msg });
});

// Staff triage (Management/Oversight any rank + admins). Registered on app —
// the adminRouter would wrongly gate these behind the editor role.
function requireFeedbackStaff(req, res, next) {
  const u = req.session && req.session.user;
  if (u && auth.canFeedbackStaff(u)) return next();
  if (u) return res.status(403).render('error', { title: 'Forbidden', heading: '403 — Feedback triage', message: 'Only Management and Oversight staff can review community feedback.' });
  return res.redirect('/login?next=' + encodeURIComponent('/admin/feedback'));
}
app.get('/admin/feedback', requireFeedbackStaff, auth.csrfToken, viewRecorder('admin'), (req, res) => {
  res.set('Cache-Control', 'no-store');
  // Return everything; filtering (status / category / search) happens instantly
  // client-side so switching tabs never reloads the page. The query params only
  // pre-select the initial filter for deep links.
  const status = ['open', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : '';
  const category = FEEDBACK_CATEGORIES.includes(req.query.category) ? req.query.category : '';
  const q = String(req.query.q || '').trim().slice(0, 80);
  const items = db.prepare(
    `SELECT f.*,
            (SELECT COUNT(*) FROM feedback_messages m WHERE m.feedback_id = f.id) AS msgs,
            (SELECT sender FROM feedback_messages m WHERE m.feedback_id = f.id ORDER BY m.id DESC LIMIT 1) AS last_sender
     FROM feedback f
     ORDER BY COALESCE(f.last_msg_at, f.created_at) DESC LIMIT 300`
  ).all();
  const counts = {
    all: items.length,
    open: items.filter((f) => f.status === 'open').length,
    approved: items.filter((f) => f.status === 'approved').length,
    rejected: items.filter((f) => f.status === 'rejected').length,
    // Threads whose latest message is from the submitter — a staff reply is due.
    needsReply: items.filter((f) => f.last_sender === 'submitter').length,
  };
  res.render('admin/feedback', { title: 'Admin · Feedback', section: 'feedback', items, counts, status, category, q, categories: FEEDBACK_CATEGORIES });
});
app.post('/admin/feedback/status', requireFeedbackStaff, auth.csrfToken, auth.verifyCsrf, (req, res) => {
  const id = Number(req.body.id);
  const status = ['open', 'approved', 'rejected'].includes(req.body.status) ? req.body.status : 'open';
  const row = db.prepare('SELECT title FROM feedback WHERE id = ?').get(id);
  if (row) {
    db.prepare("UPDATE feedback SET status = ?, status_by = ?, status_at = datetime('now') WHERE id = ?").run(status, req.session.user.username, id);
    audit(req.session.user.username, 'feedback.status', '#' + id, status + ' · ' + row.title.slice(0, 60));
  }
  res.redirect('/admin/feedback');
});

// Build the markdown table injected into the public Event Schedule page.
// Timed rows emit <time data-time> cells that the client converts to the
// viewer's local timezone (UTC text is the no-JS fallback).
function shiftScheduleMarkdown() {
  const rows = upcomingShiftsStmt.all();
  if (!rows.length) {
    return '_No events are currently scheduled. Check the Discord **#events** channel for the latest announcements._';
  }
  const esc = (s) => String(s || '').replace(/\|/g, '\\|').replace(/</g, '&lt;');
  const fmtDate = (d) => {
    const dt = new Date(d + 'T00:00:00');
    return isNaN(dt) ? d : dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };
  const utcTime = (iso) => new Date(iso).toISOString().slice(11, 16) + ' UTC';
  let out = '| Date | Time | Type | Host | Notes |\n| :--- | :--- | :--- | :--- | :--- |\n';
  for (const r of rows) {
    let dateCell, timeCell;
    if (r.starts_at) {
      dateCell = `<time data-time="${r.starts_at}" data-time-format="date">${fmtDate(r.starts_at.slice(0, 10))}</time>`;
      timeCell = `<time data-time="${r.starts_at}"${r.ends_at ? ` data-time-end="${r.ends_at}"` : ''} data-time-format="range">${utcTime(r.starts_at)}${r.ends_at ? ' – ' + utcTime(r.ends_at) : ''}</time>`;
    } else {
      dateCell = fmtDate(r.date);
      timeCell = esc(r.time) || 'TBA';
    }
    out += `| ${dateCell} | ${timeCell} | ${esc(r.type)} | ${esc(r.host) || '—'} | ${esc(r.notes) || '—'} |\n`;
  }
  return '_All times are shown in your local timezone._\n\n' + out;
}

// Staff Overview: Roblox details, disciplinary records (issued + received), and
// document activity. Record sections are hidden from viewers outside the division.
function staffOverview(req, res) {
  const viewer = req.session.user;
  const target = db.prepare('SELECT id, username, role, divisions, ranks, rank, last_login, last_seen, created_at, suspended, suspended_until, terminated, deleted, timezone FROM users WHERE id = ?').get(Number(req.query.id));
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
  items.reverse();
  // Disciplinary records, gated by the viewer's division visibility.
  const seeMod = auth.canSeeModRecords(viewer), seeSID = auth.canSeeSIDRecords(viewer);
  const punReceived = seeMod ? db.prepare('SELECT * FROM punishments WHERE roblox_user = ? COLLATE NOCASE ORDER BY created_at DESC LIMIT 100').all(target.username) : null;
  const punIssued = seeMod ? db.prepare('SELECT * FROM punishments WHERE moderator = ? COLLATE NOCASE ORDER BY created_at DESC LIMIT 100').all(target.username) : null;
  const infReceived = seeSID ? db.prepare('SELECT * FROM infractions WHERE staff_user = ? COLLATE NOCASE ORDER BY created_at DESC LIMIT 100').all(target.username) : null;
  const infIssued = seeSID ? db.prepare('SELECT * FROM infractions WHERE issued_by = ? COLLATE NOCASE ORDER BY created_at DESC LIMIT 100').all(target.username) : null;
  const rankLabels = ['moderation', 'sid', 'management', 'osc'].map((d) => auth.rankForDivision(target, d)).filter(Boolean).map(auth.rankLabel);
  res.render('admin/activity', {
    title: 'Overview · ' + target.username, section: 'staff',
    target, stats, items: items.slice(0, 300),
    rankLabels, seeMod, seeSID, punReceived, punIssued, infReceived, infIssued,
    points: seeSID ? staffPoints(target.username) : null,
  });
}
adminRouter.get('/staff/overview', requireStaffMgr, staffOverview);
adminRouter.get('/staff/activity', requireStaffMgr, staffOverview); // legacy alias

// --- staff dashboard (BETA) — Moderation punishments + SID infractions ------
const { PUNISH_TYPES, PUNISH_PRESETS, INFRACTION_PRESETS } = require('./lib/dashboard');

// Roblox usernames == staff usernames. Rolling 6-month active point total.
function staffPoints(staffUser) {
  return db.prepare(
    "SELECT COALESCE(SUM(points),0) AS n FROM infractions WHERE staff_user = ? COLLATE NOCASE AND status='active' AND voided=0 AND created_at >= datetime('now','-6 months')"
  ).get(staffUser).n;
}
// Apply the point-system outcome to the staff account (auto verbal/suspend/terminate).
function applyPointOutcome(staffUser, mandatory) {
  const pts = staffPoints(staffUser);
  let outcome = 'No action';
  if (mandatory || pts >= 6) outcome = 'Termination';
  else if (pts >= 3) outcome = '7-day Suspension';
  else if (pts >= 1) outcome = 'Verbal Warning';
  const target = db.prepare('SELECT id, role, username FROM users WHERE lower(username) = lower(?)').get(staffUser);
  if (target && target.role !== 'admin') {
    if (outcome === 'Termination') { db.prepare("UPDATE users SET terminated=1, suspended=1, suspended_until=NULL, rank='', ranks='' WHERE id=?").run(target.id); audit('system', 'user.terminated', target.username, 'auto — ' + (mandatory ? 'mandatory offense' : pts + ' pts')); }
    else if (outcome === '7-day Suspension') { db.prepare("UPDATE users SET suspended=1, suspended_until=datetime('now','+7 days') WHERE id=?").run(target.id); audit('system', 'user.suspend', target.username, 'auto — ' + pts + ' pts (7-day suspension)'); }
  }
  return { points: pts, outcome };
}

function requireDashboard(req, res, next) {
  const u = req.session && req.session.user;
  if (u && auth.canStaffDashboard(u)) return next();
  if (u) return res.status(403).render('error', { title: 'Forbidden', heading: '403 — No dashboard access', message: 'The staff dashboard is limited to Moderation and Specialized Investigations staff.' });
  return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl || '/dashboard'));
}

// SID infraction scope (per chain of command): not themselves, not admins, not
// the Oversight Committee (SID reports TO the OSC). The Community Manager may
// only be infracted with Lead Overseer authority. Admins may target anyone.
function sidTargets(user) {
  const isAdmin = user.role === 'admin';
  const isLeadOver = auth.userRanks(user).osc === 'lead_over';
  return db.prepare('SELECT id, username, role, divisions, ranks, rank FROM users WHERE suspended=0 AND terminated=0 AND deleted=0').all()
    .filter((s) => {
      if (s.username.toLowerCase() === user.username.toLowerCase()) return false;
      if (isAdmin) return s.role !== 'admin';
      if (s.role === 'admin') return false;
      if ((s.divisions || '').split(',').includes('osc')) return false;
      const sr = auth.userRanks(s);
      if ((sr.management === 'community_mgr' || sr.management === 'asst_community_mgr') && !isLeadOver) return false;
      return true;
    })
    .map((s) => s.username).sort();
}

app.get('/dashboard', requireDashboard, auth.csrfToken, viewRecorder('dashboard'), (req, res) => {
  const u = req.session.user;
  const q = String(req.query.q || '').trim();
  const like = '%' + q + '%';
  const isMod = auth.canModerate(u), isSID = auth.canSID(u);
  let punishments = [], infractions = [], pendingPun = [], pendingInf = [];
  if (isMod) {
    punishments = q
      ? db.prepare("SELECT * FROM punishments WHERE status='active' AND roblox_user LIKE ? ORDER BY created_at DESC LIMIT 100").all(like)
      : db.prepare("SELECT * FROM punishments WHERE status='active' ORDER BY created_at DESC LIMIT 50").all();
  }
  if (isSID) {
    infractions = q
      ? db.prepare("SELECT * FROM infractions WHERE status='active' AND staff_user LIKE ? ORDER BY created_at DESC LIMIT 100").all(like)
      : db.prepare("SELECT * FROM infractions WHERE status='active' ORDER BY created_at DESC LIMIT 50").all();
  }
  if (isMod && auth.canApprove(u, 'moderation')) pendingPun = db.prepare("SELECT * FROM punishments WHERE status='pending' ORDER BY created_at DESC LIMIT 100").all();
  if (isSID && auth.canApprove(u, 'sid')) pendingInf = db.prepare("SELECT * FROM infractions WHERE status='pending' ORDER BY created_at DESC LIMIT 100").all();
  const cnt = (sql) => db.prepare(sql).get().n;
  const stats = {
    punTotal: cnt("SELECT COUNT(*) AS n FROM punishments WHERE voided=0 AND status='active'"),
    pun7: cnt("SELECT COUNT(*) AS n FROM punishments WHERE voided=0 AND status='active' AND created_at >= datetime('now','-7 days')"),
    infTotal: cnt("SELECT COUNT(*) AS n FROM infractions WHERE voided=0 AND status='active'"),
    inf7: cnt("SELECT COUNT(*) AS n FROM infractions WHERE voided=0 AND status='active' AND created_at >= datetime('now','-7 days')"),
    pending: pendingPun.length + pendingInf.length,
  };
  const myRanks = [auth.rankForDivision(u, 'moderation'), auth.rankForDivision(u, 'sid')].filter(Boolean).map(auth.rankLabel);
  res.render('dashboard', {
    title: 'Staff Dashboard', bodyClass: 'has-dashboard',
    punishments, infractions, pendingPun, pendingInf, stats, q,
    punishTypes: PUNISH_TYPES,
    punishPresets: PUNISH_PRESETS, infractionPresets: INFRACTION_PRESETS,
    myRanks,
    needsApprovalMod: auth.needsApproval(u, 'moderation'), needsApprovalSID: auth.needsApproval(u, 'sid'),
    canApproveMod: auth.canApprove(u, 'moderation'), canApproveSID: auth.canApprove(u, 'sid'),
    canVoidPun: auth.canVoidPunishment(u), canVoidInf: auth.canVoidInfraction(u),
    staffList: isSID ? sidTargets(u) : [],
  });
});

// Roblox username lookup (any logged-in staff — public Roblox data). Includes
// the user's prior active punishment count for escalation.
app.get('/api/roblox/:username', auth.requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const name = String(req.params.username || '').trim().slice(0, 60);
  if (!name) return res.json({ ok: false });
  try {
    const r = await fetch('https://users.roblox.com/v1/usernames/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernames: [name], excludeBannedUsers: false }),
    });
    const j = await r.json();
    const usr = j && j.data && j.data[0];
    if (!usr) return res.json({ ok: false });
    let avatar = null;
    try {
      const t = await fetch('https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=' + usr.id + '&size=150x150&format=Png&isCircular=false');
      const tj = await t.json();
      avatar = tj && tj.data && tj.data[0] && tj.data[0].imageUrl;
    } catch (e) { /* avatar optional */ }
    const prior = db.prepare("SELECT COUNT(*) AS n FROM punishments WHERE roblox_user = ? COLLATE NOCASE AND status='active' AND voided=0").get(usr.name).n;
    res.json({ ok: true, id: usr.id, name: usr.name, displayName: usr.displayName, avatar, priorPunishments: prior });
  } catch (e) {
    res.json({ ok: false, error: 'Roblox lookup failed' });
  }
});

// Roblox username autocomplete (matching users dropdown, with headshots).
// Public (rate-limited): also used by the anonymous feedback form.
// Autocomplete fires per keystroke (debounced) — a low cap made the dropdown
// go quiet mid-typing. Higher cap; the client caches per query to stay well under it.
const robloxSearchLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });
app.get('/api/roblox-search', robloxSearchLimiter, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ ok: true, data: [] });
  try {
    const r = await fetch('https://users.roblox.com/v1/users/search?keyword=' + encodeURIComponent(q) + '&limit=10');
    const j = await r.json();
    const data = (j && j.data ? j.data : []).map((usr) => ({ id: usr.id, name: usr.name, displayName: usr.displayName, avatar: null }));
    // One batch thumbnails call fills in the suggestion avatars.
    if (data.length) {
      try {
        const t = await fetch('https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=' + data.map((d) => d.id).join(',') + '&size=48x48&format=Png&isCircular=true');
        const tj = await t.json();
        const byId = new Map(((tj && tj.data) || []).map((d) => [d.targetId, d.imageUrl]));
        data.forEach((d) => { d.avatar = byId.get(d.id) || null; });
      } catch (e) { /* avatars optional */ }
    }
    res.json({ ok: true, data });
  } catch (e) { res.json({ ok: false, data: [] }); }
});

// Batch Roblox headshots by username (staff usernames == Roblox usernames).
app.post('/api/roblox-thumbs', auth.requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  let names = (req.body && req.body.usernames) || [];
  if (!Array.isArray(names)) names = [];
  names = names.map((n) => String(n || '').slice(0, 60)).filter(Boolean).slice(0, 60);
  if (!names.length) return res.json({ ok: true, avatars: {} });
  try {
    const r = await fetch('https://users.roblox.com/v1/usernames/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernames: names, excludeBannedUsers: false }),
    });
    const j = await r.json();
    const users = (j && j.data) || [];
    const byId = new Map(users.map((u) => [u.id, u.requestedUsername || u.name]));
    if (!users.length) return res.json({ ok: true, avatars: {} });
    const t = await fetch('https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=' + users.map((u) => u.id).join(',') + '&size=150x150&format=Png&isCircular=false');
    const tj = await t.json();
    const avatars = {};
    (tj && tj.data ? tj.data : []).forEach((d) => { const uname = byId.get(d.targetId); if (uname && d.imageUrl) avatars[uname.toLowerCase()] = d.imageUrl; });
    res.json({ ok: true, avatars });
  } catch (e) { res.json({ ok: false, avatars: {} }); }
});

// Unified user file: a Roblox/staff name's punishments + infractions + points.
app.get('/api/user-file', requireDashboard, (req, res) => {
  res.set('Cache-Control', 'no-store');
  const u = req.session.user;
  const name = String(req.query.user || '').trim();
  if (!name) return res.json({ ok: false });
  // Sections the viewer has no authority over are omitted (null), not sent
  // empty — the client hides them entirely so nothing leaks across divisions.
  const punishments = auth.canModerate(u)
    ? db.prepare("SELECT id, type, reason, duration, moderator, created_at, voided, void_reason, voided_by FROM punishments WHERE roblox_user = ? COLLATE NOCASE ORDER BY created_at DESC LIMIT 200").all(name) : null;
  const infractions = auth.canSID(u)
    ? db.prepare("SELECT id, type, points, reason, outcome, issued_by, created_at, voided, void_reason, voided_by, status FROM infractions WHERE staff_user = ? COLLATE NOCASE ORDER BY created_at DESC LIMIT 200").all(name) : null;
  res.json({ ok: true, user: name, punishments, infractions, points: auth.canSID(u) ? staffPoints(name) : null });
});

// Realtime dashboard feed — polled by the page to update lists live.
app.get('/api/dashboard/live', requireDashboard, (req, res) => {
  res.set('Cache-Control', 'no-store');
  const u = req.session.user;
  const isMod = auth.canModerate(u), isSID = auth.canSID(u);
  const out = { ok: true };
  if (isMod) out.punishments = db.prepare("SELECT id, roblox_user, roblox_id, type, reason, duration, evidence, moderator, created_at, voided, void_reason, voided_by FROM punishments WHERE status='active' ORDER BY created_at DESC LIMIT 50").all();
  if (isSID) out.infractions = db.prepare("SELECT id, staff_user, type, points, reason, outcome, evidence, issued_by, created_at, voided, void_reason, voided_by FROM infractions WHERE status='active' ORDER BY created_at DESC LIMIT 50").all();
  if (isMod && auth.canApprove(u, 'moderation')) out.pendingPun = db.prepare("SELECT id, roblox_user, type, reason, evidence, moderator, created_at FROM punishments WHERE status='pending' ORDER BY created_at DESC LIMIT 100").all();
  if (isSID && auth.canApprove(u, 'sid')) out.pendingInf = db.prepare("SELECT id, staff_user, type, points, reason, evidence, issued_by, created_at FROM infractions WHERE status='pending' ORDER BY created_at DESC LIMIT 100").all();
  const cnt = (sql) => db.prepare(sql).get().n;
  out.stats = {
    punTotal: cnt("SELECT COUNT(*) AS n FROM punishments WHERE voided=0 AND status='active'"),
    pun7: cnt("SELECT COUNT(*) AS n FROM punishments WHERE voided=0 AND status='active' AND created_at >= datetime('now','-7 days')"),
    infTotal: cnt("SELECT COUNT(*) AS n FROM infractions WHERE voided=0 AND status='active'"),
    inf7: cnt("SELECT COUNT(*) AS n FROM infractions WHERE voided=0 AND status='active' AND created_at >= datetime('now','-7 days')"),
    pending: (out.pendingPun ? out.pendingPun.length : 0) + (out.pendingInf ? out.pendingInf.length : 0),
  };
  res.json(out);
});

// Evidence file upload (base64 JSON). Restricted type + size.
const UPLOAD_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const MAX_UPLOAD = 4 * 1024 * 1024; // 4 MB
app.post('/api/upload', requireDashboard, (req, res) => {
  res.set('Cache-Control', 'no-store');
  const type = String((req.body && req.body.type) || '');
  if (!UPLOAD_TYPES[type]) return res.status(400).json({ ok: false, error: 'File type not allowed (png/jpg/gif/webp/pdf).' });
  const buf = Buffer.from(String((req.body && req.body.data) || '').replace(/^data:[^,]+,/, ''), 'base64');
  if (!buf.length) return res.status(400).json({ ok: false, error: 'Empty file.' });
  if (buf.length > MAX_UPLOAD) return res.status(400).json({ ok: false, error: 'File too large (max 4 MB).' });
  if (uploadsTotal() + buf.length > UPLOAD_CAP) return res.status(507).json({ ok: false, error: 'Evidence storage is full. Ask an admin to archive or remove old uploads before adding more.' });
  const name = crypto.randomBytes(10).toString('hex') + '.' + UPLOAD_TYPES[type];
  try { fs.writeFileSync(path.join(UPLOAD_DIR, name), buf); } catch (e) { return res.status(500).json({ ok: false, error: 'Save failed.' }); }
  uploadBytes = uploadsTotal() + buf.length;
  audit(req.session.user.username, 'file.upload', name, type + ' · ' + Math.round(buf.length / 1024) + ' KB');
  res.json({ ok: true, url: '/uploads/' + name });
});

app.post('/dashboard/punishment', requireDashboard, auth.csrfToken, auth.verifyCsrf, (req, res) => {
  const u = req.session.user;
  if (!auth.canModerate(u)) return res.status(403).render('error', { title: 'Forbidden', heading: 'Moderation only', message: 'Only Moderation staff can log punishments.' });
  const rblx = String(req.body.roblox_user || '').trim().slice(0, 60);
  if (!rblx) return res.status(400).render('error', { title: 'Invalid', heading: 'Roblox user required', message: 'Enter the Roblox username being punished.' });
  const type = PUNISH_TYPES.includes(req.body.type) ? req.body.type : 'Game Warning';
  const status = auth.needsApproval(u, 'moderation') ? 'pending' : 'active';
  db.prepare('INSERT INTO punishments (roblox_user, roblox_id, type, reason, evidence, duration, moderator, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(rblx, String(req.body.roblox_id || '').trim().slice(0, 40), type,
      String(req.body.reason || '').trim().slice(0, 500), String(req.body.evidence || '').trim().slice(0, 500),
      String(req.body.duration || '').trim().slice(0, 40), u.username, status);
  audit(u.username, 'punish.create', rblx, type + (status === 'pending' ? ' (pending approval)' : ''));
  // Land on the punished user's file so the moderator sees the updated record.
  res.redirect('/dashboard?tab=file&open=' + encodeURIComponent(rblx));
});

app.post('/dashboard/punishment/void', requireDashboard, auth.csrfToken, auth.verifyCsrf, (req, res) => {
  const u = req.session.user;
  if (!auth.canVoidPunishment(u)) {
    return res.status(403).render('error', { title: 'Forbidden', heading: 'Insufficient rank', message: 'Punishments may only be voided by a Senior Moderator, Internal Operations Manager, Assistant Internal Operations Manager, Assistant Community Manager, Community Manager, or Lead Overseer.' });
  }
  const reason = String(req.body.reason || '').trim().slice(0, 300);
  if (!reason) return res.status(400).render('error', { title: 'Invalid', heading: 'Reason required', message: 'A reason is required to void a punishment.' });
  const p = db.prepare('SELECT roblox_user FROM punishments WHERE id = ?').get(Number(req.body.id));
  // Voids are kept, never deleted — marked with who voided and why.
  db.prepare('UPDATE punishments SET voided = 1, void_reason = ?, voided_by = ? WHERE id = ?').run(reason, u.username, Number(req.body.id));
  if (p) audit(u.username, 'punish.void', p.roblox_user, reason);
  res.redirect('/dashboard');
});

app.post('/dashboard/punishment/review', requireDashboard, auth.csrfToken, auth.verifyCsrf, (req, res) => {
  if (!auth.canApprove(req.session.user, 'moderation')) return res.status(403).json({ ok: false });
  const id = Number(req.body.id), approve = req.body.decision === 'approve';
  const p = db.prepare("SELECT roblox_user FROM punishments WHERE id = ? AND status='pending'").get(id);
  if (p) {
    if (approve) db.prepare("UPDATE punishments SET status='active', approved_by=? WHERE id=?").run(req.session.user.username, id);
    else db.prepare('DELETE FROM punishments WHERE id=?').run(id);
    audit(req.session.user.username, approve ? 'punish.approve' : 'punish.reject', p.roblox_user, '');
  }
  res.redirect('/dashboard');
});

app.post('/dashboard/infraction', requireDashboard, auth.csrfToken, auth.verifyCsrf, (req, res) => {
  const u = req.session.user;
  if (!auth.canSID(u)) return res.status(403).render('error', { title: 'Forbidden', heading: 'SID only', message: 'Only Specialized Investigations staff can issue infractions.' });
  const staffUser = String(req.body.staff_user || '').trim().slice(0, 60);
  if (!staffUser) return res.status(400).render('error', { title: 'Invalid', heading: 'Staff member required', message: 'Select the staff member being issued an infraction.' });
  // Scope guard: SID can't infract admins / Management / Oversight / themselves.
  if (!sidTargets(u).some((s) => s.toLowerCase() === staffUser.toLowerCase())) {
    return res.status(403).render('error', { title: 'Forbidden', heading: 'Out of scope', message: 'You do not have authority to issue an infraction to that member.' });
  }
  let points = parseInt(req.body.points, 10); if (!(points >= 0 && points <= 6)) points = 1;
  const mandatory = req.body.mandatory === '1';
  const type = String(req.body.type || 'Infraction').trim().slice(0, 60);
  const status = auth.needsApproval(u, 'sid') ? 'pending' : 'active';
  let outcome = 'Pending approval';
  const info = db.prepare('INSERT INTO infractions (staff_user, type, points, reason, evidence, issued_by, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(staffUser, type, points, String(req.body.reason || '').trim().slice(0, 500), String(req.body.evidence || '').trim().slice(0, 500), u.username, status);
  if (status === 'active') {
    outcome = applyPointOutcome(staffUser, mandatory).outcome;
    db.prepare('UPDATE infractions SET outcome = ? WHERE id = ?').run(outcome, info.lastInsertRowid);
  }
  audit(u.username, 'infraction.create', staffUser, type + ' · ' + points + 'pt' + (status === 'pending' ? ' (pending)' : ' → ' + outcome));
  // Land on the staff member's file so the investigator sees the updated record.
  res.redirect('/dashboard?tab=file&open=' + encodeURIComponent(staffUser));
});

app.post('/dashboard/infraction/void', requireDashboard, auth.csrfToken, auth.verifyCsrf, (req, res) => {
  const u = req.session.user;
  if (!auth.canVoidInfraction(u)) {
    return res.status(403).render('error', { title: 'Forbidden', heading: 'Insufficient rank', message: 'Infractions may only be voided by the Lead Investigator, Community Manager, or Lead Overseer.' });
  }
  const reason = String(req.body.reason || '').trim().slice(0, 300);
  if (!reason) return res.status(400).render('error', { title: 'Invalid', heading: 'Reason required', message: 'A reason is required to void an infraction.' });
  const inf = db.prepare('SELECT staff_user FROM infractions WHERE id = ?').get(Number(req.body.id));
  db.prepare('UPDATE infractions SET voided = 1, void_reason = ?, voided_by = ? WHERE id = ?').run(reason, u.username, Number(req.body.id));
  if (inf) audit(u.username, 'infraction.void', inf.staff_user, reason);
  res.redirect('/dashboard');
});

app.post('/dashboard/infraction/review', requireDashboard, auth.csrfToken, auth.verifyCsrf, (req, res) => {
  if (!auth.canApprove(req.session.user, 'sid')) return res.status(403).json({ ok: false });
  const id = Number(req.body.id), approve = req.body.decision === 'approve';
  const inf = db.prepare("SELECT staff_user, points FROM infractions WHERE id = ? AND status='pending'").get(id);
  if (inf) {
    if (approve) {
      db.prepare("UPDATE infractions SET status='active', approved_by=? WHERE id=?").run(req.session.user.username, id);
      const outcome = applyPointOutcome(inf.staff_user, false).outcome;
      db.prepare('UPDATE infractions SET outcome=? WHERE id=?').run(outcome, id);
    } else db.prepare('DELETE FROM infractions WHERE id=?').run(id);
    audit(req.session.user.username, approve ? 'infraction.approve' : 'infraction.reject', inf.staff_user, '');
  }
  res.redirect('/dashboard');
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

  // The public schedule injects live events in place of [[SHIFTS_TABLE]] (not
  // cacheable); every other page uses the render cache.
  let html, toc;
  if (page.slug === 'shifts/shift-schedule') {
    const pageContent = stripDocTitle(page.content, page.title).replace(/\[\[SHIFTS_TABLE\]\]/g, shiftScheduleMarkdown());
    ({ html, toc } = md.render(pageContent));
  } else {
    ({ html, toc } = renderPage(page));
  }
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

const server = app.listen(PORT, () => {
  console.log(`Valley Correctional Facility docs running on http://localhost:${PORT}`);
});
// Realtime co-editing (WebSocket on the same port, session-authenticated).
collab.attach(server, sessionMw);
collab.onPersist = () => invalidateRenderCache();
