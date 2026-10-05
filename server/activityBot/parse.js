/**
 * Rule-based reading of an engineer's message about work done, e.g.
 *   "1h on Northwind, upgraded the FortiGate NW-FW-01 to 7.6.0, ticket 4521"
 * into activity fields. Nothing leaves the server: customers, categories,
 * technologies and assets are matched against the lists the engineer is
 * allowed to log against. Anything ambiguous is returned as choices so the
 * conversation can ask, rather than guessed.
 */

// Lower-case, Greek accents removed, punctuation that separates words turned into spaces.
const fold = text => String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const words = text => fold(text).split(/[^a-z0-9Ͱ-Ͽ.#-]+/).filter(Boolean);
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A whole-word (or whole-phrase) match, tolerant of punctuation around it.
const hasPhrase = (haystack, phrase) => {
  const needle = fold(phrase).trim();
  if (!needle) return false;
  return new RegExp(`(^|[^a-z0-9\\u0370-\\u03ff])${escape(needle)}($|[^a-z0-9\\u0370-\\u03ff])`).test(haystack);
};

// Words that say nothing about which customer is meant.
const COMMON = new Set(['the', 'and', 'ltd', 'limited', 'inc', 'llc', 'plc', 'group', 'company', 'co', 'corp', 'corporation', 'holdings', 'services', 'service', 'solutions', 'systems', 'international', 'logistics', 'bank', 'hotel', 'hotels', 'cyprus', 'our', 'infrastructure', 'internal']);

// Everyday words for the usual activity categories. A category also matches by its own name.
const CATEGORY_WORDS = [
  [/upgrad|firmware update|new version|αναβαθμ/, ['upgrade']],
  [/\bpatch|hotfix|security update|firmware/, ['patch', 'firmware', 'update']],
  [/troubleshoot|investigat|diagnos|fix(ed)?\b|issue|problem|outage|incident|προβλημ/, ['troubleshoot', 'incident', 'investigation']],
  [/health ?check|review(ed)?\b|audit/, ['health check', 'review']],
  [/backup|restore/, ['backup']],
  [/monitor/, ['monitoring']],
  [/configur|config\b|rule|policy|change(d)?\b/, ['configuration change', 'change']],
  [/meeting|call with|συναντ/, ['meeting']],
  [/document/, ['documentation']],
  [/user (account|admin)|password reset|new user|onboard/, ['user administration']],
  [/test(ed|ing)?\b|validat/, ['testing']],
  [/vendor|supplier|tac case/, ['vendor']],
  [/maintenance|preventive|συντηρ/, ['maintenance']],
  [/support|help(ed)?\b|assist|υποστηρ/, ['support']],
];

const pad = value => String(value).padStart(2, '0');
const isoOf = (year, month, day) => `${year}-${pad(month)}-${pad(day)}`;
const addDays = (iso, days) => { const date = new Date(`${iso}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };
const validIso = iso => { const date = new Date(`${iso}T00:00:00Z`); return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso; };

// End of a word for Latin and Greek letters alike (\b only knows Latin).
const END = '(?![a-z0-9\\u0370-\\u03ff])';
const HOURS = `(?:h|hr|hrs|hours?|ωρα|ωρες|ωρων)${END}`;
const MINUTES = `(?:m|min|mins|minutes?|λεπτα|λεπτο)${END}`;
function parseDuration(text) {
  const t = fold(text);
  const hm = t.match(new RegExp(`(\\d+)\\s*(?:h|hr|hrs|hours?|ωρα|ωρες)\\s*(?:and\\s*)?(\\d{1,2})\\s*(?:${MINUTES})?${END}`));
  if (hm) return Number(hm[1]) * 60 + Number(hm[2]);
  const hours = t.match(new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*${HOURS}`));
  if (hours) return Math.round(Number(hours[1].replace(',', '.')) * 60);
  const colon = t.match(/\b(\d{1,2}):([0-5]\d)\s*(?:h|hrs?|hours?)\b/);
  if (colon) return Number(colon[1]) * 60 + Number(colon[2]);
  const minutes = t.match(new RegExp(`(\\d{1,4})\\s*${MINUTES}`));
  if (minutes) return Number(minutes[1]);
  if (/\bhalf (an )?hour\b|μιση ωρα/.test(t)) return 30;
  if (/\ban hour\b|μια ωρα/.test(t)) return 60;
  return null;
}

const WEEKDAYS = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 0 };
/** The activity date: today, yesterday, a weekday (the most recent one), dd/mm(/yyyy) or yyyy-mm-dd. Never in the future. */
function parseDate(text, today) {
  const t = fold(text);
  if (/\btoday\b|σημερα/.test(t)) return today;
  if (/\byesterday\b|χθες/.test(t)) return addDays(today, -1);
  const iso = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso && validIso(iso[0])) return iso[0] <= today ? iso[0] : null;
  const dm = t.match(/\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\b/);
  if (dm && !/\d[/.]\d+[/.]\d+[/.]/.test(t)) {
    let year = dm[3] ? Number(dm[3].length === 2 ? `20${dm[3]}` : dm[3]) : Number(today.slice(0, 4));
    let date = isoOf(year, Number(dm[2]), Number(dm[1]));
    if (!dm[3] && date > today) date = isoOf(year - 1, Number(dm[2]), Number(dm[1]));
    if (validIso(date) && date <= today) return date;
  }
  const weekday = t.match(/\b(?:last |on )?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  if (weekday) {
    const todayDow = new Date(`${today}T00:00:00Z`).getUTCDay();
    const back = (todayDow - WEEKDAYS[weekday[1]] + 7) % 7;
    return addDays(today, -back);
  }
  return null;
}

function parseTicket(text) {
  // A prefixed id (INC2135, CHG-0042) first, so its prefix is kept.
  const match = String(text).match(/\b((?:INC|REQ|RITM|CHG|CASE|RT)-?\d{2,10})\b/i)
    || String(text).match(/\b(?:ticket|tkt|case|rt|req|request|incident|inc)\s*(?:no\.?|number|#|:)?\s*#?\s*((?=[A-Za-z0-9_-]*\d)[A-Za-z0-9][A-Za-z0-9_-]{1,40})\b/i)
    || String(text).match(/(?:^|\s)#(\d{2,10})\b/);
  return match ? match[1].toUpperCase() : null;
}

/** "to 7.6.0", "v7.6.0", "version 7.6.0", "→ 7.6.0". */
function parseVersion(text) {
  const match = String(text).match(/(?:\bto|->|→|\bversion|\bver\.?)\s*v?(\d+(?:\.\d+){1,3}(?:[-_.][A-Za-z0-9]+)?)\b/i)
    || String(text).match(/\bv(\d+(?:\.\d+){1,3})\b/i);
  return match ? match[1] : null;
}

function parseBillable(text) {
  const t = fold(text);
  if (/non[- ]?billable|not billable|free of charge|no charge/.test(t)) return 'non_billable';
  if (/\bbillable\b|chargeable|to (be )?charge|invoice/.test(t)) return 'billable';
  if (/in(cluded in)? (the )?contract|under contract|covered by (the )?contract/.test(t)) return 'included_in_contract';
  return null;
}

function parseStatus(text, statuses) {
  const t = fold(text);
  const values = (statuses || []).map(status => status.value);
  const pick = pattern => values.find(value => pattern.test(value));
  if (/\b(in progress|ongoing|still working|not finished|continuing)\b/.test(t)) return pick(/progress/) || null;
  if (/\b(planned|scheduled|will do|tomorrow)\b/.test(t)) return pick(/plan|sched/) || null;
  return null;
}

/** The customers named in the text, best first, with how sure we are. */
function matchCustomers(text, customers) {
  const t = fold(text);
  const scored = [];
  for (const customer of customers) {
    let score = 0;
    if (hasPhrase(t, customer.name)) score = 100;
    else if (customer.customer_code && hasPhrase(t, customer.customer_code)) score = 90;
    else {
      const significant = words(customer.name).filter(word => word.length >= 3 && !COMMON.has(word) && !/^\d+$/.test(word));
      const hits = significant.filter(word => hasPhrase(t, word));
      if (hits.length) score = 40 + Math.round(40 * hits.length / significant.length);
    }
    if (customer.is_internal && /\b(in[- ]?house|our (own )?(infra|infrastructure|network|office|servers?)|internal)\b/.test(t)) score = Math.max(score, 85);
    if (score) scored.push({ ...customer, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.name.length - b.name.length);
}

function matchCategory(text, categories) {
  const t = fold(text);
  const byName = categories.filter(category => hasPhrase(t, category.name));
  if (byName.length) return { categories: byName.sort((a, b) => b.name.length - a.name.length).slice(0, 1) };
  for (const [pattern, hints] of CATEGORY_WORDS) {
    if (!pattern.test(t)) continue;
    const found = categories.filter(category => hints.some(hint => fold(category.name).includes(hint)));
    if (found.length) return { categories: found };
  }
  return { categories: [] };
}

function matchSubcategory(text, category) {
  const t = fold(text);
  return (category?.subcategories || []).find(sub => hasPhrase(t, sub.name)) || null;
}

function matchTechnologies(text, technologies) {
  const t = fold(text);
  return technologies.filter(tech => hasPhrase(t, tech.name));
}

/** Assets named by name, hostname or tag; failing that, one asset of a named type ("the firewall"). */
function matchAssets(text, assets) {
  const t = fold(text);
  const named = assets.filter(asset => [asset.name, asset.hostname, asset.asset_tag].some(value => value && hasPhrase(t, value)));
  if (named.length) return named;
  const byType = assets.filter(asset => asset.asset_type && hasPhrase(t, asset.asset_type));
  return byType.length === 1 ? byType : [];
}

/** Everything recognisable in one message. Missing pieces are simply absent. */
function parseMessage(text, { customers = [], categories = [], technologies = [], statuses = [], today }) {
  const result = {};
  const duration = parseDuration(text); if (duration && duration > 0 && duration <= 1440) result.duration_minutes = duration;
  const date = parseDate(text, today); if (date) result.activity_date = date;
  const ticket = parseTicket(text); if (ticket) result.ticket_reference = ticket;
  const version = parseVersion(text); if (version) result.version = version;
  const billable = parseBillable(text); if (billable) result.billable_classification = billable;
  const status = parseStatus(text, statuses); if (status) result.status = status;
  const customerMatches = matchCustomers(text, customers);
  if (customerMatches.length) {
    const best = customerMatches[0];
    const close = customerMatches.filter(item => item.score >= best.score - 10);
    if (close.length === 1 || best.score === 100 && close.filter(item => item.score === 100).length === 1) result.customer = best;
    else result.customer_choices = close.slice(0, 5);
  }
  const { categories: categoryMatches } = matchCategory(text, categories);
  if (categoryMatches.length === 1) result.category = categoryMatches[0];
  else if (categoryMatches.length > 1) result.category_choices = categoryMatches.slice(0, 6);
  if (result.category) { const sub = matchSubcategory(text, result.category); if (sub) result.subcategory = sub; }
  const techs = matchTechnologies(text, technologies); if (techs.length) result.technologies = techs;
  return result;
}

module.exports = { fold, parseMessage, parseDuration, parseDate, parseTicket, parseVersion, parseBillable, matchCustomers, matchCategory, matchAssets, matchTechnologies, addDays };
