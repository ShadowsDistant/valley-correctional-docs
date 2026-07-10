'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'vcf.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    username     TEXT UNIQUE NOT NULL,
    password     TEXT NOT NULL,
    role         TEXT NOT NULL DEFAULT 'editor',   -- 'admin' | 'editor'
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    last_login   TEXT
  );

  -- Simple key/value store for editable app settings (e.g. the staff policy).
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS pages (
    slug         TEXT PRIMARY KEY,
    title        TEXT NOT NULL,
    description  TEXT DEFAULT '',
    group_name   TEXT DEFAULT '',
    icon         TEXT DEFAULT '',
    content      TEXT DEFAULT '',
    internal     INTEGER NOT NULL DEFAULT 0,
    sort         INTEGER NOT NULL DEFAULT 0,
    published    INTEGER NOT NULL DEFAULT 1,
    updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by   TEXT
  );

  -- Full version history for every save (live-edit audit trail / rollback).
  CREATE TABLE IF NOT EXISTS page_revisions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    slug         TEXT NOT NULL,
    title        TEXT,
    content      TEXT,
    editor       TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_rev_slug ON page_revisions(slug, created_at);

  -- One row per page view for the built-in traffic analytics.
  CREATE TABLE IF NOT EXISTS page_views (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    path         TEXT NOT NULL,
    slug         TEXT,
    ts           TEXT NOT NULL DEFAULT (datetime('now')),
    day          TEXT NOT NULL,                      -- YYYY-MM-DD (server local)
    visitor      TEXT,                               -- hashed IP+UA, coarse
    referrer     TEXT,
    ua           TEXT,
    authed       INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_views_day ON page_views(day);
  CREATE INDEX IF NOT EXISTS idx_views_slug ON page_views(slug);
`);
// NOTE: the `sessions` table is created and owned by better-sqlite3-session-store.

// --- lightweight migrations (add columns if an older DB predates them) ------
function addColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}
// Divisions a division-limited user may read/edit handbooks for (CSV of keys).
addColumn('users', 'divisions', "divisions TEXT DEFAULT ''");
// Which division an internal page belongs to (management/moderation/sid/osc/all).
addColumn('pages', 'division', "division TEXT DEFAULT ''");
// Suspended accounts keep their data but lose all access until reinstated.
addColumn('users', 'suspended', 'suspended INTEGER NOT NULL DEFAULT 0');
// Whether the staff member has accepted the policy agreement (stores the policy
// version they last agreed to; they are re-prompted when the version increases).
addColumn('users', 'agreed_policy', 'agreed_policy INTEGER NOT NULL DEFAULT 0');
// Logged-in username on a page view, so per-staff document activity can be shown.
addColumn('page_views', 'username', "username TEXT");
db.exec('CREATE INDEX IF NOT EXISTS idx_views_user ON page_views(username, ts)');

// Email was removed from staff accounts — drop the column if an older DB has it.
(function dropColumn(table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (cols.some((c) => c.name === column)) {
    try { db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`); } catch (e) { /* older SQLite */ }
  }
})('users', 'email');

// Shift schedule — managed from the admin panel, shown on the public schedule.
db.exec(`
  CREATE TABLE IF NOT EXISTS shifts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    date       TEXT NOT NULL,               -- YYYY-MM-DD
    time       TEXT NOT NULL DEFAULT '',    -- free text, e.g. "2:00 PM – 5:00 PM EST"
    type       TEXT NOT NULL DEFAULT 'Standard Shift',
    host       TEXT NOT NULL DEFAULT '',
    notes      TEXT NOT NULL DEFAULT '',
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_shifts_date ON shifts(date);
`);

// Activity/audit log: who did what, when (page edits, deletes, account changes).
db.exec(`
  CREATE TABLE IF NOT EXISTS audit_log (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    ts       TEXT NOT NULL DEFAULT (datetime('now')),
    actor    TEXT,
    action   TEXT NOT NULL,
    target   TEXT,
    details  TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts);
`);

module.exports = db;
