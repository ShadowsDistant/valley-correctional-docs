'use strict';

// Fixed display order for sidebar groups. Any group not listed here is
// appended alphabetically after these. Pages with an empty group render at
// the very top, above all groups.
const GROUP_ORDER = [
  'Overview',
  'Our Divisions',
  'Community Rules',
  'Shifts',
  'Miscellaneous',
  'Internal Documents',
];

// Groups whose pages are restricted to logged-in staff.
const INTERNAL_GROUPS = ['Internal Documents'];

/**
 * Build the ordered sidebar tree from a flat list of page rows.
 * Each page row: { slug, title, group_name, icon, internal, sort, division }
 * `canView` is a predicate (page) => boolean deciding whether a page is shown;
 * a boolean may also be passed for the old "include all internal" behavior.
 */
function buildNav(pages, canView) {
  const pred = typeof canView === 'function' ? canView : (p) => (canView ? true : !p.internal);
  const visible = pages.filter((p) => pred(p));

  const groups = new Map();
  for (const p of visible) {
    const key = p.group_name || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }

  for (const list of groups.values()) {
    list.sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title));
  }

  const orderIndex = (name) => {
    const i = GROUP_ORDER.indexOf(name);
    return i === -1 ? GROUP_ORDER.length : i;
  };

  const result = [];

  // Ungrouped pages first (rendered without a header).
  if (groups.has('')) {
    result.push({ name: '', pages: groups.get('') });
    groups.delete('');
  }

  const names = [...groups.keys()].sort(
    (a, b) => orderIndex(a) - orderIndex(b) || a.localeCompare(b)
  );
  for (const name of names) {
    result.push({ name, pages: groups.get(name), internal: INTERNAL_GROUPS.includes(name) });
  }

  return result;
}

module.exports = { GROUP_ORDER, INTERNAL_GROUPS, buildNav };
