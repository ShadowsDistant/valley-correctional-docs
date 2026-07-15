'use strict';
// Foul-language gate for the public feedback system (submissions + chats).
// Normalizes evasion attempts (leetspeak, diacritics, repeated letters,
// separators), then matches a small severe-only wordlist. Token-bounded
// matching keeps innocent words (Scunthorpe, assess, class) safe.

const { WORDS, SUBSTRINGS } = require('./profanity-words');

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's', '!': 'i' };

function normalize(text) {
  let t = String(text || '').toLowerCase();
  try { t = t.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) { /* older runtimes */ }
  t = t.replace(/[013457@$!]/g, (c) => LEET[c] || c);
  t = t.replace(/([a-z])\1{2,}/g, '$1'); // "fuuuck" -> "fuck"
  return t;
}

const WORD_RE = new RegExp('(^|[^a-z])(' + WORDS.join('|') + ')([^a-z]|$)');

// Returns the first offending term, or null when the text is clean.
function findProfanity(text) {
  const norm = normalize(text);
  const m = WORD_RE.exec(norm);
  if (m) return m[2];
  const squashed = norm.replace(/[^a-z]/g, ''); // defeats "f a g g o t" spacing
  for (const s of SUBSTRINGS) if (squashed.includes(s)) return s;
  return null;
}

function isClean(text) { return findProfanity(text) === null; }

module.exports = { findProfanity, isClean, normalize };
