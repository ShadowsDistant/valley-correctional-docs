'use strict';
// Wordlists for the feedback profanity gate. Kept deliberately small and
// severe-only to avoid false positives — this is a "keep it civil" filter,
// not a censorship engine. All matching happens on normalized text
// (lowercased, de-leeted, repeats collapsed) in lib/profanity.js.

// Matched as WHOLE TOKENS only (word boundaries), so names like "Scunthorpe"
// or words like "assess"/"class" never trip it.
const WORDS = [
  'fuck', 'fucker', 'fucking', 'fucked', 'motherfucker',
  // common vowel-swap evasions (leet handles 0/1/3/4/5/7; these cover the rest)
  'fock', 'focking', 'fuk', 'fuking', 'fck', 'fcking', 'fvck', 'fvcking', 'phuck',
  'sht', 'shite', 'btch', 'bich',
  'shit', 'shitty', 'bullshit',
  'bitch', 'bitches',
  'asshole', 'arsehole',
  'cunt', 'cunts',
  'dick', 'dickhead',
  'cock', 'cocks',
  'pussy', 'pussies',
  'whore', 'slut', 'sluts',
  'bastard',
  'wanker',
  'twat',
  'prick',
  'dumbass', 'jackass',
  'douche', 'douchebag',
  'retard', 'retarded',
];

// Matched as SUBSTRINGS after separator-stripping — reserved for slurs that
// never legitimately appear inside English words, defeating spacing evasion.
const SUBSTRINGS = [
  'nigger', 'nigga',
  'faggot',
  'kike',
  'spic',
  'chink',
  'tranny',
  'beaner',
  'wetback',
];

module.exports = { WORDS, SUBSTRINGS };
