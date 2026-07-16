'use strict';
// Escalating per-IP login throttle.
//
// Base rule: 5 failed attempts per 5 minutes per IP. Cross that and the IP is
// locked out; each subsequent lockout for the same IP gets progressively
// longer (5m → 15m → 30m → 1h → 2h), so a persistent attacker is slowed to a
// crawl while a staff member who fatfingers their password a few times is only
// briefly held. A successful login clears the IP immediately.
//
// In-memory (single container). A restart clears locks — acceptable, and it
// fails safe: locks are additive protection, never the only auth control.

const WINDOW_MS = 5 * 60 * 1000;   // rolling window for counting fails
const MAX_FAILS = 5;               // fails allowed within the window
const LOCK_STEPS = [               // escalating lock durations (ms)
  5 * 60 * 1000,
  15 * 60 * 1000,
  30 * 60 * 1000,
  60 * 60 * 1000,
  120 * 60 * 1000,
];
const FORGET_MS = 6 * 60 * 60 * 1000; // drop stale records after 6h of calm

const ips = new Map(); // ip -> { count, windowStart, lockUntil, level, seen }

function prune(now) {
  if (ips.size < 500) return;
  for (const [ip, r] of ips) {
    if (r.lockUntil < now && now - r.seen > FORGET_MS) ips.delete(ip);
  }
}

// Is this IP currently locked out? Returns { locked, retryMs, level }.
function check(ip) {
  const now = Date.now();
  const r = ips.get(ip);
  if (r && r.lockUntil > now) return { locked: true, retryMs: r.lockUntil - now, level: r.level };
  return { locked: false, retryMs: 0, level: r ? r.level : 0 };
}

// Record a failed attempt; returns the same shape as check() reflecting any
// new lock this failure triggered.
function fail(ip) {
  const now = Date.now();
  let r = ips.get(ip);
  if (!r) r = { count: 0, windowStart: now, lockUntil: 0, level: 0, seen: now };
  r.seen = now;
  // fresh window once the old one elapsed and we're not mid-lock
  if (r.lockUntil <= now && now - r.windowStart > WINDOW_MS) { r.count = 0; r.windowStart = now; }
  r.count += 1;
  let justLocked = false;
  if (r.count >= MAX_FAILS) {
    r.level = Math.min(r.level + 1, LOCK_STEPS.length);
    r.lockUntil = now + LOCK_STEPS[r.level - 1];
    r.count = 0; r.windowStart = now;
    justLocked = true;
  }
  ips.set(ip, r);
  prune(now);
  return { locked: r.lockUntil > now, retryMs: Math.max(0, r.lockUntil - now), level: r.level, justLocked, remaining: MAX_FAILS - r.count };
}

// Successful login — wipe the IP's failure history.
function succeed(ip) { ips.delete(ip); }

function fmt(ms) {
  const m = Math.ceil(ms / 60000);
  if (m < 60) return m + ' minute' + (m === 1 ? '' : 's');
  const h = Math.round(m / 60 * 10) / 10;
  return h + ' hour' + (h === 1 ? '' : 's');
}

module.exports = { check, fail, succeed, fmt, MAX_FAILS };
