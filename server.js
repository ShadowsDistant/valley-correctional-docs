'use strict';

require('dotenv').config();
const path = require('path');
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
app.get('/assets/icons.css', (req, res) => {
  res.type('text/css');
  if (isProd) res.set('Cache-Control', 'public, max-age=604800');
  res.send(ICONS_CSS);
});

app.use('/assets', express.static(path.join(__dirname, 'public'), { maxAge: isProd ? '7d' : 0 }));

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
app.use((req, res, next) => {
  if (req.session && req.session.user) {
    const fresh = db.prepare('SELECT id, username, email, role, divisions, suspended, agreed_policy FROM users WHERE id = ?').get(req.session.user.id);
    if (!fresh) return req.session.destroy(() => res.redirect('/'));
    req.session.user = {
      id: fresh.id, username: fresh.username, email: fresh.email,
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
    db.prepare(
      `INSERT INTO page_views (path, slug, day, visitor, referrer, ua, authed)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      req.path,
      page ? page.slug : null,
      day,
      visitor,
      (req.headers.referer || '').slice(0, 300),
      ua,
      req.session && req.session.user ? 1 : 0
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
    return res.status(401).render('login', {
      title: 'Staff Login',
      next: reqNext || '/admin',
      error: 'Invalid username or password.',
      layout: false,
    });
  }
  if (auth.isSuspended(user)) {
    return res.status(403).render('login', {
      title: 'Account suspended',
      next: reqNext || '/admin',
      error: 'This account is suspended. Contact an administrator to be reinstated.',
      layout: false,
    });
  }
  db.prepare('UPDATE users SET last_login = datetime(\'now\') WHERE id = ?').run(user.id);
  // Division-limited staff can't use the admin panel — land them on the site.
  const landing = auth.canEdit(user) ? '/admin' : '/home';
  const nextUrl = reqNext && !(reqNext.startsWith('/admin') && !auth.canEdit(user)) ? reqNext : landing;
  req.session.regenerate((err) => {
    if (err) return res.status(500).send('Session error');
    req.session.user = { id: user.id, username: user.username, role: user.role, email: user.email, divisions: user.divisions || '' };
    req.session.save(() => res.redirect(nextUrl));
  });
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// --- search index ----------------------------------------------------------

app.get('/search-index.json', (req, res) => {
  const user = req.session && req.session.user;
  const pages = navPages().filter((p) => auth.canViewPage(user, p));
  const index = pages.map((p) => {
    const { toc } = md.render(p.content);
    return {
      slug: p.slug,
      title: p.title,
      group: p.group_name,
      internal: !!p.internal,
      description: p.description,
      // headings become deep-link search hits
      headings: toc.map((h) => ({ text: h.text, id: h.id })),
      text: md.toPlainText(p.content).slice(0, 4000),
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

// Record acceptance of the first-login staff policy agreement.
app.post('/account/agree', auth.requireAuth, (req, res) => {
  db.prepare('UPDATE users SET agreed_policy = 1 WHERE id = ?').run(req.session.user.id);
  req.session.user.agreed_policy = 1;
  audit(req.session.user.username, 'user.agree', req.session.user.username, 'accepted staff policy agreement');
  const ref = req.get('referer') || '';
  res.redirect(ref.includes('://' + req.get('host')) ? ref : '/home');
});

// --- admin: dashboard + editor + analytics ---------------------------------

const adminRouter = express.Router();
adminRouter.use(auth.requireEditor);
adminRouter.use(auth.csrfToken);

adminRouter.get('/', (req, res) => {
  const pageCount = db.prepare('SELECT COUNT(*) AS n FROM pages').get().n;
  const views7 = db.prepare(
    "SELECT COUNT(*) AS n FROM page_views WHERE day >= date('now','-6 days')"
  ).get().n;
  const views30 = db.prepare(
    "SELECT COUNT(*) AS n FROM page_views WHERE day >= date('now','-29 days')"
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
  });
});

// Live preview endpoint — renders markdown exactly like the public site.
adminRouter.post('/preview', (req, res) => {
  const { html } = md.render(req.body.content || '');
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

adminRouter.post('/delete', auth.verifyCsrf, (req, res) => {
  if (req.session.user.role !== 'admin') return res.status(403).json({ ok: false, error: 'Only administrators can delete pages.' });
  const slug = normalizeSlug(req.body.slug);
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
adminRouter.get('/logs', (req, res) => {
  const events = db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 200').all();
  res.render('admin/logs', { title: 'Admin · Activity', section: 'logs', events });
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

// Analytics dashboard (detailed)
adminRouter.get('/analytics', (req, res) => {
  const days = [7, 30, 90].includes(+req.query.days) ? +req.query.days : 30;
  const since = `-${days - 1} days`;

  const rows = db.prepare(
    `SELECT day, COUNT(*) AS views, COUNT(DISTINCT visitor) AS visitors
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
    viewsToday: one("SELECT COUNT(*) AS n FROM page_views WHERE day = date('now')"),
    viewsRange: one('SELECT COUNT(*) AS n FROM page_views WHERE day >= date(\'now\', ?)', since),
    visitorsRange: one('SELECT COUNT(DISTINCT visitor) AS n FROM page_views WHERE day >= date(\'now\', ?)', since),
    views: one('SELECT COUNT(*) AS n FROM page_views'),
    visitors: one('SELECT COUNT(DISTINCT visitor) AS n FROM page_views'),
  };
  totals.avgPerDay = Math.round(totals.viewsRange / days);
  const busiest = rows.slice().sort((a, b) => b.views - a.views)[0];
  totals.busiestDay = busiest ? busiest.day : '—';
  totals.busiestViews = busiest ? busiest.views : 0;

  const topPages = db.prepare(
    `SELECT slug, COUNT(*) AS views, COUNT(DISTINCT visitor) AS visitors FROM page_views
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
    `SELECT slug, ts, authed, referrer FROM page_views ORDER BY id DESC LIMIT 12`
  ).all().map((r) => { const p = getPageAny.get(r.slug); return { title: p ? p.title : r.slug, slug: r.slug, ts: r.ts, authed: r.authed }; });

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
  const users = db.prepare('SELECT id, username, email, role, divisions, suspended, created_at, last_login FROM users ORDER BY id').all();
  res.render('admin/staff', { title: 'Admin · Staff', section: 'staff', users, divisions: auth.DIVISIONS });
});

adminRouter.post('/staff/create', auth.requireAdmin, auth.verifyCsrf, (req, res) => {
  const username = (req.body.username || '').trim();
  const email = (req.body.email || '').trim();
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
    db.prepare('INSERT INTO users (username, email, password, role, divisions) VALUES (?, ?, ?, ?, ?)')
      .run(username, email, auth.hashPassword(password), role, divisions);
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
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(auth.hashPassword(password), id);
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
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.redirect('/admin/staff');
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

  const { html, toc } = md.render(stripDocTitle(page.content, page.title));
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
