'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./db');

function hashPassword(plain) {
  return bcrypt.hashSync(plain, 12);
}

function verifyPassword(plain, hash) {
  try {
    return bcrypt.compareSync(plain, hash);
  } catch {
    return false;
  }
}

function findUserByUsername(username) {
  return db
    .prepare('SELECT * FROM users WHERE lower(username) = lower(?)')
    .get(username);
}

// Roles: 'admin' (full + staff mgmt), 'editor' (edit content + all internal),
// 'staff' (read-only, internal handbooks limited to assigned divisions).
const DIVISIONS = [
  { key: 'management', label: 'Management' },
  { key: 'moderation', label: 'Moderation' },
  { key: 'sid', label: 'Specialized Investigations' },
  { key: 'osc', label: 'Oversight Committee' },
];

const EDITABLE_DIVISIONS = ['management', 'moderation', 'sid', 'osc'];

function userDivisions(user) {
  if (!user || !user.divisions) return [];
  return String(user.divisions).split(',').map((s) => s.trim()).filter(Boolean);
}

function isSuspended(user) {
  return !!(user && (user.suspended === 1 || user.suspended === true));
}

// Can this user reach the admin/editor tools at all?
function canEdit(user) {
  return !!user && !isSuspended(user) && (user.role === 'admin' || user.role === 'editor');
}

function canCreatePages(user) {
  return !!user && !isSuspended(user) && user.role === 'admin';
}

// Who can manage the shift schedule: admins, plus any staff member assigned to
// Management or the Oversight Committee (covers prison administration leadership).
function canManageShifts(user) {
  if (!user || isSuspended(user)) return false;
  if (user.role === 'admin') return true;
  const divs = userDivisions(user);
  return divs.includes('management') || divs.includes('osc');
}

// Staff dashboard ranks. tier 1 = junior (logs need approval); tier >= 3 can approve.
const RANKS = {
  jr_mod:   { label: 'Junior Moderator',    division: 'moderation', tier: 1 },
  mod:      { label: 'Moderator',           division: 'moderation', tier: 2 },
  sr_mod:   { label: 'Senior Moderator',    division: 'moderation', tier: 3 },
  head_mod: { label: 'Head Moderator',      division: 'moderation', tier: 4 },
  jr_sid:   { label: 'Junior Investigator', division: 'sid',        tier: 1 },
  sid:      { label: 'Investigator',        division: 'sid',        tier: 2 },
  sr_sid:   { label: 'Senior Investigator', division: 'sid',        tier: 3 },
  lead_sid: { label: 'Lead Investigator',   division: 'sid',        tier: 4 },
};
function rankOf(user) { return (user && RANKS[user.rank]) || null; }
function rankLabel(key) { return (RANKS[key] && RANKS[key].label) || ''; }
// A junior (tier 1, non-admin) has their moderation/infraction logs held for approval.
function needsApproval(user) {
  if (!user || user.role === 'admin') return false;
  const r = rankOf(user);
  return !!r && r.tier <= 1;
}
// Seniors (tier >= 3) and admins can approve/reject pending logs.
function canApprove(user) {
  if (!user || isSuspended(user)) return false;
  if (user.role === 'admin') return true;
  const r = rankOf(user);
  return !!r && r.tier >= 3;
}

// Staff dashboard (beta) access by division. Admins see everything.
function canModerate(user) { // Moderation punishment logs
  if (!user || isSuspended(user)) return false;
  return user.role === 'admin' || userDivisions(user).includes('moderation');
}
function canSID(user) { // SID staff infractions
  if (!user || isSuspended(user)) return false;
  return user.role === 'admin' || userDivisions(user).includes('sid');
}
function canStaffDashboard(user) { return canModerate(user) || canSID(user); }

// Can this user EDIT a specific page?
//  - admin: any page
//  - editor: only the internal handbook(s) for the division(s) assigned to them
//  - everyone else: no
function canEditPage(user, page) {
  if (!user || isSuspended(user)) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'editor') {
    const div = (page.division || '').trim();
    return !!page.internal && EDITABLE_DIVISIONS.includes(div) && userDivisions(user).includes(div);
  }
  return false;
}

// Can this (possibly null) user view a given page?
function canViewPage(user, page) {
  if (!page.internal) return true;              // public page — anyone
  if (!user || isSuspended(user)) return false; // internal needs an active login
  if (user.role === 'admin' || user.role === 'editor') return true;
  // division-limited staff: 'all' pages (e.g. chain of command) are open to
  // every staff member; otherwise the page's division must be assigned.
  const div = (page.division || '').trim();
  if (!div || div === 'all') return true;
  return userDivisions(user).includes(div);
}

// Make the current user (if any) available to every template.
function attachUser(req, res, next) {
  res.locals.user = req.session && req.session.user ? req.session.user : null;
  res.locals.canEdit = canEdit(res.locals.user);
  res.locals.currentPath = req.path;
  next();
}

// Content editing / admin panel: admins and editors only (not division staff).
function requireEditor(req, res, next) {
  if (req.session && req.session.user && canEdit(req.session.user)) return next();
  if (req.session && req.session.user) {
    return res.status(403).render('error', {
      title: 'Forbidden',
      heading: '403 — Staff accounts cannot edit',
      message: 'Your account can read assigned handbooks but cannot access the editor or admin tools.',
    });
  }
  const next_ = encodeURIComponent(req.originalUrl || '/admin');
  return res.redirect(`/login?next=${next_}`);
}

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  const next_ = encodeURIComponent(req.originalUrl || '/admin');
  return res.redirect(`/login?next=${next_}`);
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'admin') {
    return next();
  }
  return res.status(403).render('error', {
    title: 'Forbidden',
    heading: '403 — Administrators only',
    message: 'You need an administrator account to manage staff.',
  });
}

// --- Lightweight per-session CSRF protection for state-changing forms ---
function ensureCsrf(req) {
  if (!req.session.csrf) {
    req.session.csrf = crypto.randomBytes(24).toString('hex');
  }
  return req.session.csrf;
}

function csrfToken(req, res, next) {
  res.locals.csrfToken = ensureCsrf(req);
  next();
}

function verifyCsrf(req, res, next) {
  const token = req.body && req.body._csrf;
  if (token && req.session.csrf && token === req.session.csrf) return next();
  return res.status(403).render('error', {
    title: 'Session expired',
    heading: 'Security check failed',
    message: 'Your session token was invalid or expired. Please go back and try again.',
  });
}

module.exports = {
  hashPassword,
  verifyPassword,
  findUserByUsername,
  attachUser,
  requireAuth,
  requireAdmin,
  requireEditor,
  csrfToken,
  verifyCsrf,
  ensureCsrf,
  DIVISIONS,
  userDivisions,
  isSuspended,
  canEdit,
  canCreatePages,
  canManageShifts,
  canModerate,
  canSID,
  canStaffDashboard,
  canEditPage,
  canViewPage,
  RANKS,
  rankOf,
  rankLabel,
  needsApproval,
  canApprove,
};
