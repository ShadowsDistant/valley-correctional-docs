'use strict';
// Re-run the page seeder. Existing pages are left untouched (ON CONFLICT DO
// NOTHING) — this only inserts pages that don't exist yet. To force a page
// back to its shipped default, delete it in the admin UI first, then run this.
require('dotenv').config();
const { seed } = require('../lib/seed');
seed();
console.log('Reseed complete.');
