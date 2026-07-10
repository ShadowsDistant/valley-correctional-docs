'use strict';
// Reset (or create) an administrator account's password. Used by the deploy
// bootstrap when RESET_ADMIN_PASSWORD is provided. Also un-suspends the account.
//   RESET_ADMIN_PASSWORD='NewPass' [ADMIN_USERNAME=shadowsdistant] node scripts/reset-admin.js
require('dotenv').config();
const db = require('../lib/db');
const { hashPassword } = require('../lib/auth');

const username = process.env.ADMIN_USERNAME || 'admin';
const email = process.env.ADMIN_EMAIL || '';
const password = process.env.RESET_ADMIN_PASSWORD || '';

if (!password) {
  console.error('RESET_ADMIN_PASSWORD is not set — nothing to do.');
  process.exit(1);
}

const existing = db.prepare('SELECT id FROM users WHERE lower(username) = lower(?)').get(username);
if (existing) {
  db.prepare('UPDATE users SET password = ?, suspended = 0 WHERE id = ?').run(hashPassword(password), existing.id);
  console.log(`Reset password for "${username}" (account reinstated if suspended).`);
} else {
  db.prepare('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)')
    .run(username, email, hashPassword(password), 'admin');
  console.log(`Created admin "${username}".`);
}
