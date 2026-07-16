'use strict';

const fs = require('fs');
const path = require('path');
const db = require('./db');
const { hashPassword } = require('./auth');

const CONTENT_DIR = path.join(__dirname, '..', 'content');

// Ordered manifest of every seeded page. `file` is relative to /content.
const PAGES = [
  // --- Overview (matches docs.json group order) ---
  { slug: 'home', title: 'Home', group: 'Overview', icon: 'home', sort: 0,
    description: 'Official documentation hub for Valley Correctional Facility, the largest faction for Valley Prison. Find the event schedule, community rules, and division info.',
    file: 'home.md' },
  { slug: 'information', title: 'Community Information', group: 'Overview', icon: 'message', sort: 10,
    description: 'Answers to common questions about VCF, including how to join shifts, appeal bans, apply for teams, and connect on console.',
    file: 'information.md' },
  { slug: 'notices', title: 'Notices', group: 'Overview', icon: 'bell', sort: 20,
    description: 'Stay up to date with official announcements, leadership changes, application openings, and important community notices.',
    file: 'notices.md' },

  // --- Our Divisions ---
  { slug: 'our-divisions/management-division', title: 'Management Division', group: 'Our Divisions', icon: 'users', sort: 10,
    description: 'Leadership structure, operational responsibilities, and the roles of the Community Manager and division managers.',
    file: 'management-division.md' },
  { slug: 'our-divisions/moderation-division', title: 'Moderation Division', group: 'Our Divisions', icon: 'shield', sort: 20,
    description: 'The Moderation Division: its role in community enforcement, how to report a moderator, and how to apply.',
    file: 'moderation-division.md' },
  { slug: 'our-divisions/specialized-investigations-division', title: 'Specialized Investigations Division', group: 'Our Divisions', icon: 'briefcase', sort: 30,
    description: 'The Specialized Investigations Division: its mission, jurisdiction, and how to report staff misconduct.',
    file: 'specialized-investigations-division.md' },

  // --- Community Rules ---
  { slug: 'community-rules/our-rules', title: 'Our Rules', group: 'Community Rules', icon: 'list', sort: 10,
    description: 'Complete list of Discord, voice chat, shift, and roleplay rules enforced in VCF. Read before joining any community activities.',
    file: 'our-rules.md' },

  // --- Shifts ---
  { slug: 'shifts/shift-information', title: 'Shift Information', group: 'Shifts', icon: 'clipboard', sort: 10,
    description: 'Shift procedures, team structures, inmate classifications, and whitelisted roles like CERT, FSP, and the Sheriff\'s Department.',
    file: 'shift-information.md' },
  { slug: 'shifts/roleplay-information', title: 'Roleplay Information', group: 'Shifts', icon: 'mask', sort: 20,
    description: 'Guidelines for roleplay during VCF shifts — hostage situations, baiting, powergaming, metagaming, and the standards expected of participants.',
    file: 'roleplay-information.md' },
  { slug: 'shifts/shift-schedule', title: 'Event Schedule', group: 'Shifts', icon: 'calendar', sort: 30,
    description: 'The community calendar of upcoming VCF events — roleplay shifts, gamenights, trainings, and recruitment sessions.',
    file: 'shift-schedule.md' },

  // --- Miscellaneous (docs.json order: updates, then tos-enforcement-changes) ---
  { slug: 'miscellaneous/updates', title: 'Updates', group: 'Miscellaneous', icon: 'scroll', sort: 10,
    description: 'Changelog of updates to the VCF documentation site, including new pages, content revisions, and feature additions by version.',
    file: 'updates.md' },
  { slug: 'public-documents/tos-enforcement-changes', title: 'ToS Enforcement Changes', group: 'Miscellaneous', icon: 'scale', sort: 20,
    description: 'How VCF uses the TASE moderation bot to enforce Roblox Terms of Service and remove users involved with condos.',
    file: 'tos-enforcement-changes.md' },

  // --- Internal Documents (staff only; ordered per docs.json dropdowns) ---
  { slug: 'internal-documents/management-division-handbook', title: 'Management Division Handbook', group: 'Internal Documents', icon: 'users', sort: 10, internal: 1, division: 'management',
    description: 'Operating procedures and responsibilities for the Management Division.',
    file: 'internal-management-division-handbook.md' },
  { slug: 'internal-documents/moderation-division-handbook', title: 'Moderation Division Handbook', group: 'Internal Documents', icon: 'shield', sort: 20, internal: 1, division: 'moderation',
    description: 'Enforcement procedures, punishment matrix, and expectations for moderators.',
    file: 'internal-moderation-division-handbook.md' },
  { slug: 'internal-documents/specialized-investigations-division-handbook', title: 'Specialized Investigations Division Handbook', group: 'Internal Documents', icon: 'briefcase', sort: 30, internal: 1, division: 'sid',
    description: 'Investigative standards, confidentiality protocols, and casework procedures for SID.',
    file: 'internal-sid-handbook.md' },
  { slug: 'internal-documents/oversight-committee', title: 'Oversight Committee', group: 'Internal Documents', icon: 'eye', sort: 40, internal: 1, division: 'osc',
    description: 'Purpose, membership, and authority of the VCF Oversight Committee.',
    file: 'internal-oversight-committee.md' },
  { slug: 'internal-documents/chain-of-command', title: 'Chain of Command', group: 'Internal Documents', icon: 'sitemap', sort: 50, internal: 1, division: 'all',
    description: 'The reporting structure and escalation path across every VCF division.',
    file: 'internal-chain-of-command.md' },
  { slug: 'internal-documents/general-staff-handbook', title: 'General Staff Handbook', group: 'Internal Documents', icon: 'book', sort: 60, internal: 1, division: 'all',
    description: 'Baseline expectations, conduct, and procedures for all VCF staff.',
    file: 'internal-general-staff-handbook.md' },
];

// Pages that have been retired — deleted from the DB on sync so they disappear
// from existing deployments (not just fresh ones).
const REMOVED_PAGES = ['shifts/marketplaces'];

function readContent(file) {
  const p = path.join(CONTENT_DIR, file);
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return `# ${file}\n\n_Content file missing._`;
  }
}

const insertPage = db.prepare(`
  INSERT INTO pages (slug, title, description, group_name, icon, content, internal, sort, division, published, updated_by)
  VALUES (@slug, @title, @description, @group_name, @icon, @content, @internal, @sort, @division, 1, 'system')
  ON CONFLICT(slug) DO NOTHING
`);

function seedPages() {
  const existing = db.prepare('SELECT COUNT(*) AS n FROM pages').get().n;
  const tx = db.transaction(() => {
    for (const p of PAGES) {
      insertPage.run({
        slug: p.slug,
        title: p.title,
        description: p.description || '',
        group_name: p.group || '',
        icon: p.icon || '',
        content: readContent(p.file),
        internal: p.internal ? 1 : 0,
        sort: p.sort || 0,
        division: p.division || '',
      });
    }
  });
  tx();
  const now = db.prepare('SELECT COUNT(*) AS n FROM pages').get().n;
  if (now > existing) console.log(`[seed] pages: ${existing} → ${now}`);
}

const upsertPage = db.prepare(`
  INSERT INTO pages (slug, title, description, group_name, icon, content, internal, sort, division, published, updated_by)
  VALUES (@slug, @title, @description, @group_name, @icon, @content, @internal, @sort, @division, 1, 'system')
  ON CONFLICT(slug) DO UPDATE SET
    title=@title, description=@description, group_name=@group_name, icon=@icon,
    content=@content, internal=@internal, sort=@sort, division=@division,
    updated_at=datetime('now'), updated_by='system'
`);

// Push manifest pages back to their file content.
//
// Locally-edited pages (updated_by != 'system') are SKIPPED unless force=true,
// so this can't silently destroy staff work. `npm run sync-content` is safe;
// `npm run sync-content -- --force` is the deliberate, destructive version.
function syncPages(force) {
  const editedSlugs = new Set(
    db.prepare("SELECT slug FROM pages WHERE updated_by != 'system'").all().map((r) => r.slug)
  );
  const skipped = [];
  const tx = db.transaction(() => {
    for (const p of PAGES) {
      if (!force && editedSlugs.has(p.slug)) { skipped.push(p.slug); continue; }
      upsertPage.run({
        slug: p.slug,
        title: p.title,
        description: p.description || '',
        group_name: p.group || '',
        icon: p.icon || '',
        content: readContent(p.file),
        internal: p.internal ? 1 : 0,
        sort: p.sort || 0,
        division: p.division || '',
      });
    }
  });
  tx();
  if (skipped.length) {
    console.log(`[sync] skipped ${skipped.length} locally-edited page(s): ${skipped.join(', ')}`);
    console.log('[sync] re-run with --force to overwrite them (this discards those edits).');
  }
  const del = db.prepare('DELETE FROM pages WHERE slug = ?');
  let removed = 0;
  for (const slug of REMOVED_PAGES) removed += del.run(slug).changes;
  console.log(`[sync] force-updated ${PAGES.length} pages from content files` + (removed ? `, removed ${removed} retired page(s)` : ''));
}

function seedAdmin() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count > 0) return;
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'changeme';
  db.prepare(
    'INSERT INTO users (username, password, role) VALUES (?, ?, ?)'
  ).run(username, hashPassword(password), 'admin');
  console.log(`[seed] created initial admin "${username}"`);
  if (password === 'changeme') {
    console.warn('[seed] WARNING: default admin password is "changeme" — change it immediately.');
  }
}

// One-off, idempotent title/content fixes for pages that already exist in a
// deployed DB (seedPages does nothing on conflict, so renames need this).
// Versioned refreshes are tracked in settings so they run exactly once.
function migrationDone(key) {
  return !!db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
}
function markMigration(key) {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, datetime('now')) ON CONFLICT(key) DO NOTHING").run(key);
}
// Refresh stock pages from the repo's content files.
//
// HARD RULE: never overwrite a page a human has edited. Pages seeded/migrated
// by us keep updated_by='system'; the moment anyone saves in the editor it
// becomes their username. So the UPDATE is scoped to updated_by='system' and
// an edited page is skipped, recorded, and surfaced on Admin → System for the
// admin to merge deliberately. A deploy must never destroy staff work.
function refreshPagesFromFiles(slugs, why) {
  const upd = db.prepare(
    "UPDATE pages SET content=@content, updated_at=datetime('now'), updated_by='system' WHERE slug=@slug AND updated_by='system'"
  );
  const isEdited = db.prepare("SELECT updated_by FROM pages WHERE slug = ? AND updated_by != 'system'");
  let n = 0; const skipped = [];
  for (const slug of slugs) {
    const man = PAGES.find((p) => p.slug === slug);
    if (!man) continue;
    const edited = isEdited.get(slug);
    if (edited) { skipped.push({ slug, editedBy: edited.updated_by, why, at: new Date().toISOString() }); continue; }
    n += upd.run({ slug, content: readContent(man.file) }).changes;
  }
  if (n) console.log(`[migrate] refreshed ${n} stock page(s): ${why}`);
  if (skipped.length) {
    console.log(`[migrate] SKIPPED ${skipped.length} locally-edited page(s) — not overwriting: ` +
      skipped.map((s) => s.slug).join(', '));
    recordSkipped(skipped);
  }
}

// Remember skipped content updates so Admin → System can show "a newer version
// of this document shipped, but your copy is edited".
function recordSkipped(list) {
  let cur = [];
  try { cur = JSON.parse(db.prepare("SELECT value FROM settings WHERE key='pages.pendingContent'").get().value) || []; } catch (e) { cur = []; }
  const bySlug = new Map(cur.map((x) => [x.slug, x]));
  list.forEach((x) => bySlug.set(x.slug, x));
  db.prepare("INSERT INTO settings (key, value) VALUES ('pages.pendingContent', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(JSON.stringify(Array.from(bySlug.values())));
}
function runPageMigrations() {
  // Shift Schedule -> Event Schedule. Only touches the stock page, never a
  // page an admin has since renamed themselves. This page is placeholder-driven
  // ([[SHIFTS_TABLE]]) and not hand-edited, so we refresh its body from the file.
  const ren = db.prepare(
    "UPDATE pages SET title='Event Schedule' WHERE slug='shifts/shift-schedule' AND title='Shift Schedule'"
  ).run().changes;
  if (ren) {
    const man = PAGES.find((p) => p.slug === 'shifts/shift-schedule') || {};
    // same rule: only refresh the body if nobody has edited this page
    db.prepare("UPDATE pages SET content=@content, description=@description WHERE slug='shifts/shift-schedule' AND updated_by='system'")
      .run({ content: readContent('shift-schedule.md'), description: man.description || '' });
    console.log('[migrate] renamed Shift Schedule -> Event Schedule');
  }

  // v6 policy refresh: Facility Administration rename, leak-punishment update
  // (termination + employment blacklist + case-by-case ban), ToS = ban regardless
  // of severity, and removal of the Internal Information dropdowns.
  if (!migrationDone('migrate.v6-policy')) {
    refreshPagesFromFiles([
      'internal-documents/chain-of-command',
      'internal-documents/management-division-handbook',
      'internal-documents/moderation-division-handbook',
      'internal-documents/specialized-investigations-division-handbook',
      'internal-documents/general-staff-handbook',
      'internal-documents/oversight-committee',
      'our-divisions/management-division',
      'community-rules/our-rules',
      'public-documents/tos-enforcement-changes',
    ], 'v6 policy updates');
    markMigration('migrate.v6-policy');
  }
}

// Ranks now strictly imply division membership (removing a division removes
// its rank). Backfill: any user holding a rank in a division they aren't
// listed under gets that division added, so nothing is silently stripped.
function backfillRankDivisions() {
  if (migrationDone('migrate.rank-divisions')) return;
  const rows = db.prepare("SELECT id, divisions, ranks FROM users WHERE ranks != '' AND ranks IS NOT NULL").all();
  const upd = db.prepare('UPDATE users SET divisions = ? WHERE id = ?');
  let n = 0;
  for (const r of rows) {
    let map = {};
    try { map = JSON.parse(r.ranks) || {}; } catch (e) { continue; }
    const divs = new Set(String(r.divisions || '').split(',').filter(Boolean));
    const before = divs.size;
    Object.keys(map).forEach((d) => divs.add(d));
    if (divs.size > before) { upd.run(Array.from(divs).join(','), r.id); n++; }
  }
  if (n) console.log(`[migrate] backfilled rank divisions on ${n} account(s)`);
  markMigration('migrate.rank-divisions');
}

function seed() {
  seedPages();
  runPageMigrations();
  backfillRankDivisions();
  seedAdmin();
}

module.exports = { seed, syncPages, PAGES, CONTENT_DIR };
