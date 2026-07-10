'use strict';
// Force every seeded page back to its content file (title, group, content, etc.).
// WARNING: this overwrites any edits made through the admin editor. Use it to
// re-import updated content files in dev/demo. For production, prefer editing
// in the app so revisions are preserved.
require('dotenv').config();
const { syncPages } = require('../lib/seed');
syncPages();
console.log('Content sync complete.');
