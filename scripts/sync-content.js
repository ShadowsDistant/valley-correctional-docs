'use strict';
// Push seeded pages back to their content files (title, group, content, etc.).
//
// Locally-edited pages are SKIPPED by default, so this can never silently
// destroy staff work. Pass --force to overwrite them too (that discards those
// edits — edit in the admin editor instead, where revisions are kept).
//
//   npm run sync-content             # safe: stock pages only
//   npm run sync-content -- --force  # destructive: also overwrite edited pages
require('dotenv').config();
const { syncPages } = require('../lib/seed');
const force = process.argv.includes('--force');
if (force) console.log('[sync] --force given: locally-edited pages WILL be overwritten.');
syncPages(force);
console.log('Content sync complete.');
