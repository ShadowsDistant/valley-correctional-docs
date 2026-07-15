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
  return !!(user && (user.suspended === 1 || user.suspended === true || user.terminated === 1 || user.terminated === true));
}

// Can this user reach the admin/editor tools at all? (managers get in for the
// staff page; their content-edit rights are still gated per-page separately.)
function canEdit(user) {
  return !!user && !isSuspended(user) && (user.role === 'admin' || user.role === 'editor' || isManager(user));
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

// Staff ranks (per handbooks / chain of command). `tier` gates dashboard
// approval within mod/sid (1 = junior → logs need approval; >=3 = can approve).
// `authority` is a facility-wide seniority number (who outranks who).
const RANKS = {
  // Moderation
  jr_mod:   { label: 'Junior Moderator',   division: 'moderation', tier: 1, authority: 30 },
  mod:      { label: 'Moderator',          division: 'moderation', tier: 2, authority: 50 },
  sr_mod:   { label: 'Senior Moderator',   division: 'moderation', tier: 3, authority: 60 },
  // SID
  advisor:  { label: 'Specialized Advisor',division: 'sid',        tier: 1, authority: 30 },
  inv:      { label: 'Investigator',       division: 'sid',        tier: 1, authority: 35 },
  sr_inv:   { label: 'Senior Investigator',division: 'sid',        tier: 2, authority: 50 },
  lead_inv: { label: 'Lead Investigator',  division: 'sid',        tier: 3, authority: 65 },
  // Management (each governs its own division; CM governs all)
  prison_mgr:     { label: 'Prison Administration Manager',           division: 'management', tier: 4, authority: 85, governs: ['management'] },
  asst_prison_mgr:{ label: 'Assistant Prison Administration Manager', division: 'management', tier: 4, authority: 80, governs: ['management'] },
  iom:            { label: 'Internal Operations Manager',             division: 'management', tier: 4, authority: 85, governs: ['moderation', 'sid'] },
  asst_iom:       { label: 'Assistant Internal Operations Manager',   division: 'management', tier: 4, authority: 80, governs: ['moderation', 'sid'] },
  dev_mgr:        { label: 'Development Manager',                      division: 'management', tier: 4, authority: 85, governs: [] },
  asst_dev_mgr:   { label: 'Assistant Development Manager',           division: 'management', tier: 4, authority: 80, governs: [] },
  community_mgr:  { label: 'Community Manager',                        division: 'management', tier: 5, authority: 100, governs: ['management', 'moderation', 'sid', 'osc'] },
  asst_community_mgr: { label: 'Assistant Community Manager',          division: 'management', tier: 5, authority: 95, governs: ['management', 'moderation', 'sid'] },
  // Oversight Committee
  overseer:      { label: 'Overseer',              division: 'osc', tier: 3, authority: 90 },
  asst_lead_over:{ label: 'Assistant Lead Overseer', division: 'osc', tier: 4, authority: 96 },
  lead_over:     { label: 'Lead Overseer',         division: 'osc', tier: 5, authority: 98 },
};
function rankLabel(key) { return (RANKS[key] && RANKS[key].label) || ''; }
// Per-division ranks stored as JSON on the user; falls back to the legacy single rank.
function userRanks(user) {
  if (!user) return {};
  let map = {};
  try { map = user.ranks ? JSON.parse(user.ranks) : {}; } catch (e) { map = {}; }
  if ((!map || !Object.keys(map).length) && user.rank && RANKS[user.rank]) {
    map = { [RANKS[user.rank].division]: user.rank };
  }
  return map || {};
}
function rankForDivision(user, div) { const k = userRanks(user)[div]; return RANKS[k] ? k : ''; }
function rankTier(user, div) { const k = rankForDivision(user, div); return RANKS[k] ? RANKS[k].tier : 0; }
// Highest facility-wide authority number across all of a user's ranks (admin = 999).
function authorityOf(user) {
  if (!user) return 0;
  if (user.role === 'admin') return 999;
  const map = userRanks(user);
  return Math.max(0, ...Object.values(map).map((k) => (RANKS[k] ? RANKS[k].authority : 0)));
}
// --- management / staff-admin permissions ---
function managerRank(user) { const k = userRanks(user).management; return RANKS[k] && RANKS[k].tier >= 4 ? RANKS[k] : null; }
function isManager(user) { return !!user && !isSuspended(user) && !!managerRank(user); }
function isCommunityManager(user) { const k = userRanks(user || {}).management; return k === 'community_mgr' || k === 'asst_community_mgr'; }
// Which divisions a manager may create-for / assign ranks within.
function governedDivisions(user) {
  if (!user) return [];
  if (user.role === 'admin') return ['management', 'moderation', 'sid', 'osc'];
  const r = managerRank(user);
  return r && r.governs ? r.governs.slice() : [];
}
// Can this user open the staff admin page at all (admins + managers)?
function canManageStaff(user) { return !!user && !isSuspended(user) && (user.role === 'admin' || isManager(user)); }
// Only admins may suspend / reset password / delete accounts.
function canAdminStaffActions(user) { return !!user && user.role === 'admin'; }
// May the user assign a given rank key? Div must be governed; Lead Investigator is OSC-exclusive.
function canAssignRank(user, rankKey) {
  if (!user || !RANKS[rankKey]) return false;
  if (user.role === 'admin') return true;
  const r = RANKS[rankKey];
  if (rankKey === 'lead_inv') return false; // exclusive to Oversight appointment
  return governedDivisions(user).includes(r.division) && authorityOf(user) > r.authority;
}
// May the user assign accounts to a division (grant division access)?
function canAssignDivision(user, div) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return governedDivisions(user).includes(div);
}
// May the user grant the editor role? Community Manager + admin only.
function canGrantEditor(user) { return !!user && (user.role === 'admin' || userRanks(user).management === 'community_mgr'); }
// Record visibility in a staff member's overview: admins + those in/over that division.
function canSeeModRecords(user) { return !!user && (user.role === 'admin' || canModerate(user) || governedDivisions(user).includes('moderation')); }
function canSeeSIDRecords(user) { return !!user && (user.role === 'admin' || canSID(user) || governedDivisions(user).includes('sid')); }
// A junior (tier 1, non-admin) has their logs in that division held for approval.
function needsApproval(user, div) {
  if (!user || user.role === 'admin') return false;
  if (div) return rankTier(user, div) === 1;
  return ['moderation', 'sid'].some((d) => rankTier(user, d) === 1);
}
// Seniors (tier >= 3), governing managers, and admins can approve pending logs.
function canApprove(user, div) {
  if (!user || isSuspended(user)) return false;
  if (user.role === 'admin') return true;
  const ok = (d) => rankTier(user, d) >= 3 || governedDivisions(user).includes(d);
  if (div) return ok(div);
  return ['moderation', 'sid'].some(ok);
}

// Staff dashboard (beta) access by division. Admins see everything.
function canModerate(user) { // Moderation punishment logs
  if (!user || isSuspended(user)) return false;
  return user.role === 'admin' || userDivisions(user).includes('moderation') || governedDivisions(user).includes('moderation');
}
function canSID(user) { // SID staff infractions
  if (!user || isSuspended(user)) return false;
  return user.role === 'admin' || userDivisions(user).includes('sid') || governedDivisions(user).includes('sid');
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
  rankLabel,
  userRanks,
  rankForDivision,
  rankTier,
  authorityOf,
  managerRank,
  isManager,
  isCommunityManager,
  governedDivisions,
  canManageStaff,
  canAdminStaffActions,
  canAssignRank,
  canAssignDivision,
  canGrantEditor,
  canSeeModRecords,
  canSeeSIDRecords,
  needsApproval,
  canApprove,
};
