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
    description: 'Official documentation hub for Valley Correctional Facility, the largest faction for Valley Prison. Find shift schedules, community rules, and division info.',
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
  { slug: 'shifts/shift-schedule', title: 'Shift Schedule', group: 'Shifts', icon: 'calendar', sort: 30,
    description: 'The latest shift schedule for VCF, including upcoming session dates, times, and where to find event announcements.',
    file: 'shift-schedule.md' },
  { slug: 'shifts/marketplaces', title: 'Marketplaces', group: 'Shifts', icon: 'cart', sort: 40,
    description: 'Marketplace rules, participation requirements, and trading mechanics for the underground economy at VCF.',
    file: 'marketplaces.md' },

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

// Force every manifest page back to its file content. Overwrites edits made
// in the admin editor — intended for dev/demo sync, not routine production use.
function syncPages() {
  const tx = db.transaction(() => {
    for (const p of PAGES) {
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
  console.log(`[sync] force-updated ${PAGES.length} pages from content files`);
}

function seedAdmin() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count > 0) return;
  const username = process.env.ADMIN_USERNAME || 'admin';
  const email = process.env.ADMIN_EMAIL || '';
  const password = process.env.ADMIN_PASSWORD || 'changeme';
  db.prepare(
    'INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)'
  ).run(username, email, hashPassword(password), 'admin');
  console.log(`[seed] created initial admin "${username}"`);
  if (password === 'changeme') {
    console.warn('[seed] WARNING: default admin password is "changeme" — change it immediately.');
  }
}

function seed() {
  seedPages();
  seedAdmin();
}

module.exports = { seed, syncPages, PAGES, CONTENT_DIR };
