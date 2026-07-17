'use strict';

// Custom line-icon set. Each icon is a stroke-based SVG rendered as a CSS mask
// so it inherits the current text color and stays crisp on every OS (no more
// per-platform emoji). Icons are used in templates via icon(name) and in
// markdown content via the :i[name]: shortcode.

const V = "viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'";

const ICONS = {
  home: "<path d='M3 10.5 12 3l9 7.5'/><path d='M5 9.5V21h14V9.5'/>",
  message: "<path d='M21 11.5a8.5 8.5 0 0 1-12.6 7.4L3 21l2.1-5.4A8.5 8.5 0 1 1 21 11.5Z'/>",
  bell: "<path d='M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9'/><path d='M13.7 21a2 2 0 0 1-3.4 0'/>",
  building: "<rect x='4' y='3' width='16' height='18' rx='1.5'/><path d='M9 21v-4h6v4'/><path d='M8 7h.01M12 7h.01M16 7h.01M8 11h.01M12 11h.01M16 11h.01'/>",
  shield: "<path d='M12 3 5 6v5c0 5 3.5 8 7 10 3.5-2 7-5 7-10V6l-7-3Z'/>",
  briefcase: "<rect x='3' y='7' width='18' height='13' rx='2'/><path d='M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18'/>",
  list: "<path d='M8 6h13M8 12h13M8 18h13'/><path d='M3.5 6h.01M3.5 12h.01M3.5 18h.01'/>",
  clock: "<circle cx='12' cy='12' r='9'/><path d='M12 7v5l3 2'/>",
  clipboard: "<rect x='5' y='4' width='14' height='17' rx='2'/><path d='M9 4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V6H9V4.5Z'/><path d='M9 12h6M9 16h4'/>",
  mask: "<path d='M3 5.5s3-1.5 9-1.5 9 1.5 9 1.5-1.5 8-4 10-4.5 1.5-5 1.5-2.5.5-5-1.5S3 5.5 3 5.5Z'/><path d='M8.5 10h.01M15.5 10h.01'/>",
  calendar: "<rect x='3' y='5' width='18' height='16' rx='2'/><path d='M3 9h18M8 3v4M16 3v4'/>",
  cart: "<circle cx='9' cy='20' r='1.4'/><circle cx='18' cy='20' r='1.4'/><path d='M2 3h3l2.4 12.1a2 2 0 0 0 2 1.6H18l2-9H6'/>",
  scroll: "<path d='M6 3h10a2 2 0 0 1 2 2v12a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V6'/><path d='M4 6a2 2 0 0 1 2-2M9 8h6M9 12h6M9 16h4'/>",
  scale: "<path d='M12 3v18M7.5 21h9M6 7l-3 6a3 3 0 0 0 6 0L6 7Zm12 0-3 6a3 3 0 0 0 6 0l-3-6ZM4 7h16'/>",
  cabinet: "<rect x='4' y='3' width='16' height='18' rx='2'/><path d='M4 9h16M4 15h16M10 6h4M10 12h4M10 18h4'/>",
  lock: "<rect x='5' y='11' width='14' height='9' rx='2'/><path d='M8 11V8a4 4 0 0 1 8 0v3'/>",
  unlock: "<rect x='5' y='11' width='14' height='9' rx='2'/><path d='M8 11V8a4 4 0 0 1 7.7-2'/>",
  file: "<path d='M14 3v5h5'/><path d='M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z'/>",
  files: "<path d='M9 3h6l4 4v10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z'/><path d='M15 3v4h4'/><path d='M4 8v11a2 2 0 0 0 2 2h9'/>",
  book: "<path d='M6 3h11a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6.5A2.5 2.5 0 0 1 4 18.5V5.5A2.5 2.5 0 0 1 6.5 3'/><path d='M8 3v18'/>",
  users: "<circle cx='9' cy='8' r='3'/><path d='M3.5 20a5.5 5.5 0 0 1 11 0'/><path d='M16 6a3 3 0 0 1 0 6M20.5 20a5.5 5.5 0 0 0-4-5.3'/>",
  eye: "<path d='M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z'/><circle cx='12' cy='12' r='3'/>",
  sitemap: "<rect x='9' y='3' width='6' height='4' rx='1'/><rect x='3' y='17' width='6' height='4' rx='1'/><rect x='15' y='17' width='6' height='4' rx='1'/><path d='M12 7v4M6 17v-3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v3'/>",
  search: "<circle cx='11' cy='11' r='7'/><path d='M21 21l-4.3-4.3'/>",
  info: "<circle cx='12' cy='12' r='9'/><path d='M12 11v5M12 8h.01'/>",
  check: "<circle cx='12' cy='12' r='9'/><path d='M8.5 12.5l2.4 2.4 4.6-5'/>",
  warning: "<path d='M12 4 2.6 20.5h18.8L12 4Z'/><path d='M12 10v4M12 17.5h.01'/>",
  danger: "<path d='M8.2 3h7.6l5.2 5.2v7.6L15.8 21H8.2L3 15.8V8.2L8.2 3Z'/><path d='M12 8v4M12 16h.01'/>",
  edit: "<path d='M4 20h4L19 9a2 2 0 0 0-3-3L5 17v3Z'/><path d='M14 6l3 3'/>",
  chart: "<path d='M4 4v16h16'/><path d='M8 16v-4M12 16V8M16 16v-6'/>",
  external: "<path d='M14 4h6v6M20 4l-8.5 8.5M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4'/>",
  plus: "<path d='M12 5v14M5 12h14'/>",
  trash: "<path d='M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13'/>",
  discord: "<path fill='%23000' stroke='none' d='M20.317 4.492c-1.53-.69-3.17-1.2-4.885-1.49a.075.075 0 0 0-.079.036c-.21.369-.444.85-.608 1.23a18.27 18.27 0 0 0-5.487 0 12.6 12.6 0 0 0-.617-1.23A.077.077 0 0 0 8.562 3c-1.714.29-3.354.8-4.885 1.491a.07.07 0 0 0-.032.027C.533 9.093-.32 13.555.099 17.961a.08.08 0 0 0 .031.055 20.03 20.03 0 0 0 6.031 3.03.078.078 0 0 0 .084-.028c.464-.634.878-1.302 1.234-2.004a.076.076 0 0 0-.041-.106 13.2 13.2 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.099.246.198.373.291a.077.077 0 0 1-.006.127c-.598.35-1.22.644-1.873.892a.077.077 0 0 0-.041.107c.363.702.777 1.37 1.233 2.003a.076.076 0 0 0 .084.028 19.96 19.96 0 0 0 6.032-3.03.077.077 0 0 0 .032-.054c.5-5.094-.838-9.52-3.549-13.442a.06.06 0 0 0-.031-.028ZM8.02 15.278c-1.182 0-2.157-1.086-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.332-.956 2.418-2.157 2.418Zm7.975 0c-1.183 0-2.157-1.086-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.332-.946 2.418-2.157 2.418Z'/>",
  sun: "<circle cx='12' cy='12' r='4'/><path d='M12 2v2M12 20v2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M18.4 5.6l1.4-1.4M4.2 19.8l1.4-1.4'/>",
  bold: "<path d='M7 5h6a3.5 3.5 0 0 1 0 7H7Zm0 7h7a3.5 3.5 0 0 1 0 7H7Z'/>",
  italic: "<path d='M19 5h-6M11 19H5M15 5 9 19'/>",
  strike: "<path d='M4 12h16M7 8a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3M8 16a3 3 0 0 0 3 3h3'/>",
  code: "<path d='M9 8l-4 4 4 4M15 8l4 4-4 4'/>",
  link: "<path d='M10 13a4 4 0 0 0 5.7.5l2.5-2.5a4 4 0 0 0-5.6-5.7l-1.4 1.4M14 11a4 4 0 0 0-5.7-.5L5.8 13a4 4 0 0 0 5.6 5.7l1.4-1.4'/>",
  quote: "<path d='M7 7H4v6h5V7a3 3 0 0 0-3-3M18 7h-3v6h5V7a3 3 0 0 0-3-3'/>",
  heading: "<path d='M6 5v14M16 5v14M6 12h10'/>",
  divider: "<path d='M4 12h16'/>",
  table: "<rect x='3' y='4' width='18' height='16' rx='2'/><path d='M3 10h18M9 4v16'/>",
  menu: "<path d='M4 7h16M4 12h16M4 17h16'/>",
  logout: "<path d='M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 12H3M6 8l-3 4 3 4'/>",
  x: "<path d='M6 6l12 12M18 6 6 18'/>",
  ban: "<circle cx='12' cy='12' r='9'/><path d='M5.6 5.6 18.4 18.4'/>",
  // v6 additions — richer set for the editor's icon picker.
  star: "<path d='m12 3 2.7 5.7 6.3.8-4.6 4.3 1.2 6.2L12 17l-5.6 3 1.2-6.2L3 9.5l6.3-.8L12 3Z'/>",
  flag: "<path d='M5 21V4'/><path d='M5 4c4-2 7 2 11 0v9c-4 2-7-2-11 0'/>",
  pin: "<path d='M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11Z'/><circle cx='12' cy='10' r='2.5'/>",
  key: "<circle cx='8' cy='14' r='4.5'/><path d='M11.5 10.5 20 2M16 6l3 3M13 9l2 2'/>",
  gavel: "<path d='m9 7 6 6M12 4l6 6M8.5 7.5 15 1M17 9.5 10.5 16M3 21l7-7'/><path d='M12 21h9'/>",
  handcuffs: "<circle cx='7' cy='16' r='4'/><circle cx='17' cy='16' r='4'/><path d='M7 12V7a2 2 0 0 1 2-2M17 12V7a2 2 0 0 0-2-2'/>",
  camera: "<rect x='3' y='7' width='18' height='13' rx='2'/><path d='M8 7l1.5-3h5L16 7'/><circle cx='12' cy='13' r='3.5'/>",
  mic: "<rect x='9' y='3' width='6' height='11' rx='3'/><path d='M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6'/>",
  phone: "<path d='M5 4h4l2 5-2.5 1.5a12 12 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z'/>",
  mail: "<rect x='3' y='5' width='18' height='14' rx='2'/><path d='m3 7 9 6 9-6'/>",
  tag: "<path d='M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9Z'/><path d='M8 8h.01'/>",
  folder: "<path d='M3 6a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z'/>",
  download: "<path d='M12 3v12M7 10l5 5 5-5'/><path d='M4 21h16'/>",
  upload: "<path d='M12 15V3M7 8l5-5 5 5'/><path d='M4 21h16'/>",
  refresh: "<path d='M20 8A8 8 0 0 0 5.7 5.7L4 8'/><path d='M4 3v5h5M4 16a8 8 0 0 0 14.3 2.3L20 16'/><path d='M20 21v-5h-5'/>",
  gear: "<circle cx='12' cy='12' r='3'/><path d='M12 2.5 13.5 5h-3L12 2.5ZM12 21.5 10.5 19h3L12 21.5ZM2.5 12 5 10.5v3L2.5 12ZM21.5 12 19 13.5v-3l2.5 1.5ZM5.2 5.2l2.5.7-2 2-.5-2.7ZM18.8 18.8l-2.5-.7 2-2 .5 2.7ZM18.8 5.2l-.5 2.7-2-2 2.5-.7ZM5.2 18.8l.5-2.7 2 2-2.5.7Z'/>",
  heart: "<path d='M12 20.5S3.5 15 3.5 9A4.5 4.5 0 0 1 12 6.6 4.5 4.5 0 0 1 20.5 9c0 6-8.5 11.5-8.5 11.5Z'/>",
  thumbsup: "<path d='M7 11v9H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3Zm0 0 4-7a2 2 0 0 1 2 2v3h5a2 2 0 0 1 2 2.3l-1 5A2 2 0 0 1 17 18l-10 2'/>",
  timer: "<circle cx='12' cy='13' r='8'/><path d='M12 9v4l2.5 1.5M9 2h6M12 2v3'/>",
  award: "<circle cx='12' cy='9' r='6'/><path d='m8.5 14-1.5 7 5-3 5 3-1.5-7'/>",
  bug: "<circle cx='12' cy='13' r='5'/><path d='M12 8V5M8 3l2 2M16 3l-2 2M4 13h3M17 13h3M5 19l3-2M19 19l-3-2M5 7l3 2M19 7l-3 2'/>",
  lightbulb: "<path d='M9 18a7 7 0 1 1 6 0v1a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-1Z'/><path d='M10 22h4'/>",
  target: "<circle cx='12' cy='12' r='9'/><circle cx='12' cy='12' r='5'/><circle cx='12' cy='12' r='1'/>",
  // --- wider set for page icons -------------------------------------------
  globe: "<circle cx='12' cy='12' r='9'/><path d='M3 12h18'/><path d='M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18Z'/>",
  map: "<path d='M9 4 3 6.5v13L9 17l6 2.5 6-2.5v-13L15 6.5 9 4Z'/><path d='M9 4v13M15 6.5v13'/>",
  megaphone: "<path d='M3 11v2a1 1 0 0 0 1 1h3l7 4V6l-7 4H4a1 1 0 0 0-1 1Z'/><path d='M18 9a3 3 0 0 1 0 6'/><path d='M7 14v5h3v-4'/>",
  rocket: "<path d='M12 3c3 2 5 6 5 10l-2.5 2h-5L7 13c0-4 2-8 5-10Z'/><path d='M9.5 19c0 1.5 1 2.5 2.5 2.5s2.5-1 2.5-2.5'/><circle cx='12' cy='10' r='1.5'/>",
  crown: "<path d='M3 8l4 4 5-7 5 7 4-4v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8Z'/>",
  handshake: "<path d='M8 12 5 9l4-4 3 2 3-2 4 4-3 3'/><path d='M8 12l3 3 2-2 3 3 2-2'/><path d='M2 11l3-3M22 11l-3-3'/>",
  graduation: "<path d='M2 8.5 12 4l10 4.5L12 13 2 8.5Z'/><path d='M6 10.5V16c0 1.5 3 3 6 3s6-1.5 6-3v-5.5'/>",
  archive: "<rect x='3' y='4' width='18' height='4' rx='1'/><path d='M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8'/><path d='M10 12h4'/>",
  database: "<ellipse cx='12' cy='6' rx='8' ry='3'/><path d='M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6'/><path d='M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3'/>",
  server: "<rect x='3' y='4' width='18' height='7' rx='1.5'/><rect x='3' y='13' width='18' height='7' rx='1.5'/><path d='M7 7.5h.01M7 16.5h.01'/>",
  terminal: "<rect x='3' y='4' width='18' height='16' rx='2'/><path d='M7 9l3 3-3 3M13 15h4'/>",
  filter: "<path d='M3 5h18l-7 8v6l-4-2v-4L3 5Z'/>",
  bookmark: "<path d='M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z'/>",
  send: "<path d='M22 2 11 13'/><path d='M22 2 15 22l-4-9-9-4 20-7Z'/>",
  inbox: "<path d='M3 12h5l2 3h4l2-3h5'/><path d='M5 5h14l2 7v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6l2-7Z'/>",
  wrench: "<path d='M15 6a4 4 0 0 0 5 5l-9 9a2.8 2.8 0 0 1-4-4l9-9Z'/><path d='M15 6l3-3 3 3-3 3'/>",
  paperclip: "<path d='M20 11 11 20a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8'/>",
  image: "<rect x='3' y='4' width='18' height='16' rx='2'/><circle cx='9' cy='10' r='2'/><path d='M4 18l5-5 4 4 3-3 4 4'/>",
  video: "<rect x='3' y='6' width='13' height='12' rx='2'/><path d='M16 10.5 21 8v8l-5-2.5v-3Z'/>",
  gift: "<rect x='3' y='9' width='18' height='4' rx='1'/><path d='M5 13v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7'/><path d='M12 9v12'/><path d='M12 9C10 9 7 8.5 7 6.5S9.5 4 12 9ZM12 9c2 0 5-.5 5-2.5S14.5 4 12 9Z'/>",
  package: "<path d='M12 3 3 7.5v9L12 21l9-4.5v-9L12 3Z'/><path d='M3 7.5 12 12l9-4.5M12 12v9'/>",
  trending: "<path d='M3 17l6-6 4 4 8-8'/><path d='M15 7h6v6'/>",
  percent: "<path d='M19 5 5 19'/><circle cx='7.5' cy='7.5' r='2.5'/><circle cx='16.5' cy='16.5' r='2.5'/>",
  question: "<circle cx='12' cy='12' r='9'/><path d='M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7v.5'/><path d='M12 17h.01'/>",
  zap: "<path d='M13 2 4 14h7l-1 8 9-12h-7l1-8Z'/>",
  moon: "<path d='M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10Z'/>",
  copy: "<rect x='9' y='9' width='12' height='12' rx='2'/><path d='M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1'/>",
  save: "<path d='M5 3h11l3 3v15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z'/><path d='M8 3v6h7V3'/><rect x='8' y='13' width='8' height='6'/>",
  share: "<circle cx='18' cy='5' r='3'/><circle cx='6' cy='12' r='3'/><circle cx='18' cy='19' r='3'/><path d='M8.6 13.5l6.8 4M15.4 6.5l-6.8 4'/>",
  userplus: "<path d='M15 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'/><circle cx='8.5' cy='7' r='4'/><path d='M18 8v6M15 11h6'/>",
  door: "<path d='M4 21h16'/><path d='M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17'/><path d='M14 12h.01'/>",
  headset: "<path d='M4 13a8 8 0 0 1 16 0'/><rect x='2' y='13' width='4' height='7' rx='1.5'/><rect x='18' y='13' width='4' height='7' rx='1.5'/><path d='M20 20v1a2 2 0 0 1-2 2h-4'/>",
};

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[<>&"']/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Render an icon reference to HTML. Known names become a masked <span class="ic">;
// anything else (e.g. a stray emoji from a custom page) is passed through as text.
function icon(name, extra) {
  const key = String(name || '').trim();
  const cls = extra ? ' ' + extra : '';
  if (ICONS[key]) return `<span class="ic ic-${key}${cls}" aria-hidden="true"></span>`;
  if (!key) return '';
  return `<span class="nav-emoji${cls}">${escapeHtml(key)}</span>`;
}

function dataUri(inner) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' ${V}>${inner}</svg>`;
  // Encode the characters that break inside a CSS url("…") value.
  return svg.replace(/</g, '%3C').replace(/>/g, '%3E').replace(/#/g, '%23')
    .replace(/"/g, "'").replace(/\n/g, '');
}

// Generate the CSS that defines every .ic-<name> mask. Served at /assets/icons.css.
function css() {
  let out = `.ic{display:inline-block;width:1em;height:1em;vertical-align:-0.14em;`
    + `background-color:currentColor;flex:none;`
    + `-webkit-mask:var(--i) center/contain no-repeat;mask:var(--i) center/contain no-repeat;}`
    + `.nav-emoji{display:inline-block;line-height:1;}`;
  for (const [name, inner] of Object.entries(ICONS)) {
    out += `.ic-${name}{--i:url("data:image/svg+xml,${dataUri(inner)}")}`;
  }
  return out;
}

module.exports = { icon, css, ICONS };
