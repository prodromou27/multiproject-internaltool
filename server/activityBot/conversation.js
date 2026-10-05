/**
 * The activity bot's conversation, the same for every chat channel.
 *
 * An engineer describes work in plain words; the bot drafts the activity,
 * asks for anything missing or ambiguous (offering numbered choices), and
 * saves it only when they reply "yes". The draft is kept per person and
 * channel for 30 minutes. Saving goes through the app's own API as that
 * engineer (appApi.js), so their permissions and every validation rule apply.
 */
const db = require('../db');
const appTime = require('../appTime');
const api = require('./appApi');
const parse = require('./parse');

const EXPIRES_MS = 30 * 60 * 1000;
const BILLABLE = [['included_in_contract', 'Included in the contract'], ['billable', 'Billable'], ['non_billable', 'Not billable'], ['internal', 'Internal work'], ['not_applicable', 'Not applicable']];

const HELP = [
  'Tell me what you did and I\'ll log it as a service activity. For example:',
  '• *1h on Northwind, upgraded NW-FW-01 to 7.6.0, ticket 4521*',
  '• *Contoso Bank / health check / 2h / reviewed firewall rules*',
  '• *45m troubleshooting the VPN for Contoso yesterday*',
  '',
  'I\'ll show you a draft first. Reply **yes** to save it, tell me what to change, or **cancel**. **help** shows this again.',
].join('\n');

const formatMinutes = minutes => { const h = Math.floor(minutes / 60), m = minutes % 60; return h ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`; };
const formatDay = iso => { const [y, mo, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, mo - 1, d)).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); };
const numbered = items => items.map((item, index) => `${index + 1}. ${item}`).join('\n');
const pickNumber = (text, count) => { const match = String(text).trim().match(/^(\d{1,2})\.?$/); const n = match ? Number(match[1]) : 0; return n >= 1 && n <= count ? n - 1 : -1; };

async function loadState(channel, userId) {
  const row = await db.prepare('SELECT state, updated_at FROM bot_conversations WHERE channel = ? AND user_id = ?').get(channel, userId);
  if (!row) return null;
  if (Date.now() - new Date(row.updated_at).getTime() > EXPIRES_MS) return null;
  try { return JSON.parse(row.state); } catch { return null; }
}
async function saveState(channel, userId, state) {
  if (!state) return db.prepare('DELETE FROM bot_conversations WHERE channel = ? AND user_id = ?').run(channel, userId);
  await db.prepare(`INSERT INTO bot_conversations (channel, user_id, state, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (channel, user_id) DO UPDATE SET state = EXCLUDED.state, updated_at = EXCLUDED.updated_at`).run(channel, userId, JSON.stringify(state), new Date().toISOString());
}

function describe(draft) {
  const lines = ['**Draft activity**'];
  lines.push(`• Customer: ${draft.customer?.name || '—'}`);
  lines.push(`• Category: ${draft.category?.name || '—'}${draft.subcategory ? ` – ${draft.subcategory.name}` : ''}`);
  lines.push(`• Date: ${formatDay(draft.activity_date)}`);
  if (draft.duration_minutes) lines.push(`• Time: ${formatMinutes(draft.duration_minutes)}`);
  if (draft.assets?.length) lines.push(`• Asset: ${draft.assets.map(asset => asset.name + (draft.asset_versions?.[asset.id] ? ` → ${draft.asset_versions[asset.id]}` : '')).join(', ')}`);
  if (draft.technologies?.length) lines.push(`• Technology: ${draft.technologies.map(tech => tech.name).join(', ')}`);
  if (draft.ticket_reference) lines.push(`• Ticket: ${draft.ticket_reference}`);
  if (draft.billable_classification) lines.push(`• Billing: ${BILLABLE.find(([key]) => key === draft.billable_classification)?.[1] || draft.billable_classification}`);
  if (draft.status && !/complet/.test(draft.status)) lines.push(`• Status: ${draft.status.replace(/_/g, ' ')}`);
  if (draft.description) lines.push(`• Notes: ${draft.description.length > 300 ? `${draft.description.slice(0, 300)}…` : draft.description}`);
  return lines.join('\n');
}

/** What still has to be answered before saving, in the order it is asked. */
function nextQuestion(draft) {
  if (!draft.customer) {
    return draft.customer_choices?.length
      ? { field: 'customer', text: `Which customer?\n${numbered(draft.customer_choices.map(item => item.name))}\nReply with a number or the name.`, choices: draft.customer_choices }
      : { field: 'customer', text: 'Which customer was this for?' };
  }
  if (!draft.category) {
    const choices = draft.category_choices?.length ? draft.category_choices : draft.all_categories;
    return { field: 'category', text: `Which category?\n${numbered(choices.map(item => item.name))}\nReply with a number or the name.`, choices };
  }
  const rules = draft.customer;
  if (draft.category.require_attachment) return { field: 'attachment', text: `Activities in **${draft.category.name}** need an attachment, which I can't take in chat. Please log this one in the app, or reply with a different category.`, blocking: true };
  if (draft.category.require_asset && draft.customer_assets?.length && !draft.assets?.length) {
    return { field: 'asset', text: `Which asset was worked on?\n${numbered(draft.customer_assets.slice(0, 15).map(asset => asset.name))}\nReply with a number or the asset name.`, choices: draft.customer_assets.slice(0, 15) };
  }
  if (rules.require_duration && !draft.duration_minutes) return { field: 'duration', text: 'How long did it take? (for example *45m* or *1h30*)' };
  if (rules.require_ticket_reference && !draft.ticket_reference) return { field: 'ticket', text: `${rules.name} needs a ticket reference. Which ticket?` };
  if (rules.require_technology && !draft.technologies?.length) {
    return { field: 'technology', text: `Which technology?\n${numbered(draft.all_technologies.slice(0, 20).map(item => item.name))}\nReply with a number or the name.`, choices: draft.all_technologies.slice(0, 20) };
  }
  if (rules.require_notes && !draft.description) return { field: 'notes', text: 'Add a short note on what was done.' };
  if (rules.require_billable_classification && !draft.billable_classification) {
    return { field: 'billable', text: `How is it billed?\n${numbered(BILLABLE.map(([, label]) => label))}`, choices: BILLABLE.map(([key, label]) => ({ id: key, name: label })) };
  }
  return null;
}

/** Answer to a direct question: a number from the list, or the thing itself. */
function answerQuestion(state, text, context) {
  const draft = state.draft;
  const question = state.question;
  if (!question) return false;
  const index = question.choices ? pickNumber(text, question.choices.length) : -1;
  const chosen = index >= 0 ? question.choices[index] : null;
  switch (question.field) {
    case 'customer': {
      const customer = chosen ? context.customers.find(item => item.id === chosen.id) : parse.matchCustomers(text, question.choices?.length ? question.choices : context.customers)[0];
      if (!customer) return false;
      setCustomer(draft, customer);
      return true;
    }
    case 'category': {
      const category = chosen || parse.matchCategory(text, context.categories).categories[0] || context.categories.find(item => parse.fold(item.name) === parse.fold(text).trim());
      if (!category) return false;
      draft.category = context.categories.find(item => item.id === category.id); draft.category_choices = null;
      return true;
    }
    case 'asset': {
      const asset = chosen || parse.matchAssets(text, draft.customer_assets || [])[0];
      if (!asset) return false;
      draft.assets = [asset];
      return true;
    }
    case 'duration': {
      const minutes = /^\d{1,4}$/.test(text.trim()) ? Number(text.trim()) : parse.parseDuration(text);
      if (!minutes || minutes > 1440) return false;
      draft.duration_minutes = minutes;
      return true;
    }
    case 'ticket': {
      const ticket = parse.parseTicket(text) || (/^[A-Za-z0-9-]{2,30}$/.test(text.trim()) ? text.trim().toUpperCase() : null);
      if (!ticket) return false;
      draft.ticket_reference = ticket;
      return true;
    }
    case 'technology': {
      const techs = chosen ? [chosen] : parse.matchTechnologies(text, context.technologies);
      if (!techs.length) return false;
      draft.technologies = techs;
      return true;
    }
    case 'notes': if (!text.trim()) return false; draft.description = text.trim().slice(0, 10000); return true;
    case 'billable': {
      const value = chosen?.id || parse.parseBillable(text);
      if (!value) return false;
      draft.billable_classification = value;
      return true;
    }
    default: return false;
  }
}

function setCustomer(draft, customer) {
  if (draft.customer?.id !== customer.id) { draft.assets = []; draft.asset_versions = {}; draft.customer_assets = null; }
  draft.customer = customer; draft.customer_choices = null;
}

/** Apply everything recognised in a message to the draft. Returns true if anything was understood. */
function applyParsed(draft, parsed) {
  let understood = false;
  if (parsed.customer) { setCustomer(draft, parsed.customer); understood = true; }
  else if (parsed.customer_choices && !draft.customer) { draft.customer_choices = parsed.customer_choices; understood = true; }
  if (parsed.category) { draft.category = parsed.category; draft.category_choices = null; draft.subcategory = parsed.subcategory || null; understood = true; }
  else if (parsed.category_choices && !draft.category) { draft.category_choices = parsed.category_choices; understood = true; }
  for (const key of ['duration_minutes', 'activity_date', 'ticket_reference', 'billable_classification', 'status']) {
    if (parsed[key] !== undefined) { draft[key] = parsed[key]; understood = true; }
  }
  if (parsed.technologies?.length) { draft.technologies = parsed.technologies; understood = true; }
  if (parsed.version) { draft.pending_version = parsed.version; understood = true; }
  return understood;
}

async function attachAssets(user, draft, texts) {
  if (!draft.customer) return;
  if (!draft.customer_assets) {
    try { draft.customer_assets = (await api.assets(user, draft.customer.id)).map(({ id, name, asset_type, hostname, asset_tag }) => ({ id, name, asset_type, hostname, asset_tag })); }
    catch { draft.customer_assets = []; }
  }
  if (!draft.assets?.length) {
    const found = parse.matchAssets(texts.join(' \n '), draft.customer_assets);
    if (found.length) draft.assets = found.slice(0, 5);
  }
  if (draft.pending_version && draft.assets?.length === 1) {
    draft.asset_versions = { [draft.assets[0].id]: draft.pending_version };
    draft.pending_version = null;
  }
}

function payload(draft) {
  return {
    customer_id: draft.customer.id,
    category_id: draft.category.id,
    subcategory_id: draft.subcategory?.id || null,
    activity_date: draft.activity_date,
    status: draft.status,
    duration_minutes: draft.duration_minutes || null,
    description: draft.description || null,
    ticket_reference: draft.ticket_reference || null,
    billable_classification: draft.billable_classification || (draft.customer.is_internal ? 'internal' : null),
    technology_ids: (draft.technologies || []).map(tech => tech.id),
    asset_ids: (draft.assets || []).map(asset => asset.id),
    asset_versions: draft.asset_versions || {},
  };
}

/**
 * One message in, one reply out (Markdown). `user` is the app user the chat
 * account belongs to; `channel` keeps Webex, Teams and the settings test apart.
 */
async function handleMessage({ user, channel, text, appUrl = process.env.APP_URL || '' }) {
  const message = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 4000);
  const command = parse.fold(message).replace(/[!.]+$/, '');
  if (!message || /^(help|\?|hi|hello|hey|start|βοηθεια|γεια)$/.test(command)) return HELP;
  if (/^(cancel|stop|discard|forget it|never ?mind|ακυρο|ακυρωση)$/.test(command)) {
    await saveState(channel, user.id, null);
    return 'Discarded. Tell me about the next piece of work whenever you\'re ready.';
  }

  let context;
  try { context = await api.meta(user); }
  catch (error) {
    if ([401, 403].includes(error.status)) return 'Your account can\'t log service activities. Ask a manager to add you to a team with Service Activity Tracking.';
    throw error;
  }
  if (!context.customers?.length) return 'There are no customers you can log activities for yet. A manager needs to assign your team to the customer.';
  const statuses = context.statuses || [];
  const completed = statuses.find(status => status.is_terminal && /complet/i.test(status.value))?.value || statuses[statuses.length - 1]?.value || 'completed';

  let state = await loadState(channel, user.id);
  const confirming = /^(yes|y|yep|yeah|save|save it|ok|okay|confirm|correct|ναι|σωσε|οκ)$/.test(command);

  if (confirming && state?.draft) {
    const question = nextQuestion(state.draft);
    if (question) { state.question = question; await saveState(channel, user.id, state); return `Not yet: ${question.text}`; }
    try {
      const saved = await api.createActivity(user, payload(state.draft));
      await saveState(channel, user.id, null);
      const link = appUrl ? `\n${appUrl.replace(/\/+$/, '')}/activity-log?activity=${saved.id}` : '';
      return `✅ Saved **${saved.activity_reference}** for ${state.draft.customer.name}.${link}`;
    } catch (error) {
      if (error.status >= 500 || !error.status) throw error;
      return `I couldn't save it: ${error.message}\nTell me what to change, or **cancel**.`;
    }
  }
  if (confirming) return 'There\'s nothing waiting to be saved. Tell me what you did. (**help** for examples)';

  const parseContext = { customers: context.customers, categories: context.categories || [], technologies: context.technologies || [], statuses, today: appTime.today() };
  let understood = false;
  if (state?.draft && state.question && answerQuestion(state, message, parseContext)) understood = true;
  const parsed = parse.parseMessage(message, parseContext);

  if (!state?.draft) {
    if (!parsed.customer && !parsed.customer_choices && !parsed.category && !parsed.category_choices && !parsed.duration_minutes) {
      return `I didn't recognise a customer or the kind of work in that.\n\n${HELP}`;
    }
    state = { draft: { activity_date: appTime.today(), status: completed, description: message, texts: [message] } };
  } else if (/^notes?:/i.test(message)) {
    state.draft.description = message.replace(/^notes?:\s*/i, '').slice(0, 10000);
    understood = true;
  } else {
    state.draft.texts = [...(state.draft.texts || []), message].slice(-10);
  }
  if (applyParsed(state.draft, parsed)) understood = true;

  state.draft.all_categories = parseContext.categories.map(({ id, name }) => ({ id, name }));
  state.draft.all_technologies = parseContext.technologies.map(({ id, name }) => ({ id, name }));
  await attachAssets(user, state.draft, state.draft.texts || [message]);

  if (state.draft.texts?.length > 1 && !understood) {
    await saveState(channel, user.id, state);
    return `I didn't catch a change in that.\n\n${describe(state.draft)}\n\n${state.question?.text || 'Reply **yes** to save, tell me what to change, or **cancel**.'}`;
  }
  const question = nextQuestion(state.draft);
  state.question = question;
  await saveState(channel, user.id, state);
  return question
    ? `${describe(state.draft)}\n\n${question.text}`
    : `${describe(state.draft)}\n\nReply **yes** to save, tell me what to change, or **cancel**.`;
}

module.exports = { handleMessage, HELP, EXPIRES_MS, _describe: describe, _nextQuestion: nextQuestion };
