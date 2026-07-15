'use strict';
// Handbook-derived data for the staff dashboard. Each preset links back to the
// exact handbook section it comes from (right-click a preset -> open handbook).

const MOD_HB = '/internal-documents/moderation-division-handbook';
const SID_HB = '/internal-documents/specialized-investigations-division-handbook';

const PUNISH_TYPES = ['Timeout', 'Discord Kick', 'Discord Ban', 'Discord Warning', 'Game Warning', 'Game Kick', 'Game Ban', 'Note'];

// escalate: ladder of { type, duration } climbed by the user's prior punishments.
const PUNISH_PRESETS = [
  // General & Discord Conduct
  { label: 'ToS violation (Discord/Roblox)', reason: 'Confirmed Terms of Service violation. Severe cases (CSAM, real-world threats, ban evasion, malware) are immediate permanent bans. Must be escalated to SID.', hb: MOD_HB + '#general-discord-conduct', escalate: [{ type: 'Discord Ban', duration: 'Permanent' }] },
  { label: 'Harassment & bullying', reason: 'Harassment or bullying of community members.', hb: MOD_HB + '#general-discord-conduct', escalate: [{ type: 'Timeout', duration: '1–24h' }, { type: 'Discord Ban', duration: '3–7 days' }, { type: 'Discord Ban', duration: 'Permanent' }] },
  { label: 'Disclosure of classified info', reason: 'Disclosure of classified information. Malicious leaks are an immediate permanent ban and an SID referral.', hb: MOD_HB + '#general-discord-conduct', escalate: [{ type: 'Discord Ban', duration: '7–14 days' }, { type: 'Discord Ban', duration: 'Permanent' }] },
  { label: 'Sharing PII', reason: 'Sharing personally identifiable information.', hb: MOD_HB + '#general-discord-conduct', escalate: [{ type: 'Discord Kick', duration: '' }, { type: 'Discord Ban', duration: 'Permanent' }] },
  { label: 'Profanity as insult', reason: 'Profanity used as a direct insult.', hb: MOD_HB + '#general-discord-conduct', escalate: [{ type: 'Timeout', duration: '12h' }, { type: 'Timeout', duration: '24h' }, { type: 'Discord Ban', duration: '7+ days' }] },
  { label: 'Spamming / mass mentioning', reason: 'Spamming or mass mentioning.', hb: MOD_HB + '#general-discord-conduct', escalate: [{ type: 'Discord Warning', duration: '' }, { type: 'Timeout', duration: '1–12h' }, { type: 'Timeout', duration: '24h' }] },
  { label: 'Channel misuse', reason: 'Posting in the wrong channel / channel misuse.', hb: MOD_HB + '#general-discord-conduct', escalate: [{ type: 'Discord Warning', duration: '' }, { type: 'Timeout', duration: '1h' }, { type: 'Timeout', duration: '12h' }] },
  { label: 'Self-promotion / advertising', reason: 'Self-promotion or advertising. DM poaching may warrant a first-offense temp ban.', hb: MOD_HB + '#general-discord-conduct', escalate: [{ type: 'Discord Warning', duration: '' }, { type: 'Discord Kick', duration: '' }, { type: 'Discord Ban', duration: '3 days' }] },
  { label: 'VC misuse', reason: 'Voice-channel misuse.', hb: MOD_HB + '#general-discord-conduct', escalate: [{ type: 'Timeout', duration: '1h' }, { type: 'Timeout', duration: '24h' }, { type: 'Discord Ban', duration: '1 day' }] },
  // In-Game Roleplay Conduct
  { label: 'Fail roleplay (FRP)', reason: 'Failure to follow roleplay standards. Educate first.', hb: MOD_HB + '#in-game-roleplay-conduct', escalate: [{ type: 'Game Warning', duration: '' }, { type: 'Game Kick', duration: '' }, { type: 'Game Ban', duration: '7 days' }] },
  { label: 'Powergaming / metagaming', reason: 'Powergaming or metagaming.', hb: MOD_HB + '#in-game-roleplay-conduct', escalate: [{ type: 'Game Warning', duration: '' }, { type: 'Game Kick', duration: '' }, { type: 'Game Ban', duration: '7 days' }] },
  { label: 'Baiting / trolling / intrusion', reason: 'Baiting, trolling, or intrusion.', hb: MOD_HB + '#in-game-roleplay-conduct', escalate: [{ type: 'Game Kick', duration: '' }, { type: 'Game Ban', duration: '7 days' }, { type: 'Game Ban', duration: '14 days' }] },
  { label: 'Unauthorized team access', reason: 'Accessing a team without authorization.', hb: MOD_HB + '#in-game-roleplay-conduct', escalate: [{ type: 'Game Kick', duration: '' }, { type: 'Game Ban', duration: '7 days' }, { type: 'Game Ban', duration: '14 days' }] },
  { label: 'Forbidden RP themes', reason: 'Engaging in forbidden roleplay themes.', hb: MOD_HB + '#in-game-roleplay-conduct', escalate: [{ type: 'Game Kick', duration: '' }, { type: 'Game Ban', duration: '31 days' }, { type: 'Game Ban', duration: 'Permanent' }] },
  { label: 'Non-compliance with staff (OOC)', reason: 'Out-of-character non-compliance with staff.', hb: MOD_HB + '#in-game-roleplay-conduct', escalate: [{ type: 'Game Kick', duration: '' }, { type: 'Game Ban', duration: '14 days' }, { type: 'Game Ban', duration: 'Permanent' }] },
  { label: 'Behavioral note', reason: 'Logged for awareness — no action taken.', hb: MOD_HB + '#verbal-warning-logging', escalate: [{ type: 'Note', duration: '' }] },
];

// SID infraction presets — disciplinary point values (handbook point system).
const INFRACTION_PRESETS = [
  { label: 'Inactivity', points: 1, reason: 'Failure to meet activity requirements.', hb: SID_HB + '#disciplinary-point-system' },
  { label: 'Minor procedural lapse', points: 1, reason: 'Minor procedural mistake during duties.', hb: SID_HB + '#disciplinary-point-system' },
  { label: 'Failure to moderate', points: 2, reason: 'Ignoring rule violations, or inconsistent/absent enforcement.', hb: SID_HB + '#code-of-conduct-violations' },
  { label: 'Failure to uphold standards', points: 2, reason: 'Falling short of professional or procedural standards.', hb: SID_HB + '#code-of-conduct-violations' },
  { label: 'Biased moderation', points: 3, reason: 'Allowing bias, friendships, or feelings to influence decisions.', hb: SID_HB + '#code-of-conduct-violations' },
  { label: 'Mismanagement', points: 3, reason: 'Supervisory failure affecting operations, morale, or integrity.', hb: SID_HB + '#code-of-conduct-violations' },
  { label: 'Command abuse', points: 4, reason: 'Misuse of administrative commands or permissions.', hb: SID_HB + '#code-of-conduct-violations' },
  { label: 'Disclosure of classified info', points: 6, mandatory: true, reason: 'Unauthorized disclosure of confidential information (zero-tolerance).', hb: SID_HB + '#mandatory-termination-offenses' },
  { label: 'Retaliation (whistleblower)', points: 6, mandatory: true, reason: 'Retaliation against a whistleblower — Tier 3 offense.', hb: SID_HB + '#mandatory-termination-offenses' },
  { label: 'Serious ToS violation', points: 6, mandatory: true, reason: 'Serious Terms of Service violation (CSAM, real-world threats, ban evasion).', hb: SID_HB + '#mandatory-termination-offenses' },
  { label: 'Command abuse causing harm', points: 6, mandatory: true, reason: 'Command abuse causing significant harm.', hb: SID_HB + '#mandatory-termination-offenses' },
];

module.exports = { PUNISH_TYPES, PUNISH_PRESETS, INFRACTION_PRESETS, MOD_HB, SID_HB };
