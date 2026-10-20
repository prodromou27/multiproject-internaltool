/**
 * The chat bot's quick commands, besides logging service activities (conversation.js):
 * your tasks and day, what you logged, visits, and changing a task (start, done, waiting,
 * an update) or adding one. Like the rest of the bot, everything goes through the app's
 * own API as the person writing (appApi.js), so their permissions and every rule apply.
 * handleCommand() answers a command, or returns null for anything else.
 */
const appTime = require('../appTime');
const api = require('./appApi');
const parse = require('./parse');

const STATUS = { open: 'Open', in_progress: 'In progress', waiting_customer: 'Waiting for the customer', waiting_vendor: 'Waiting for the vendor',
  completed: 'Completed', closed: 'Closed', cancelled: 'Cancelled', pending_approval: 'Pending approval' };
const LIST_MAX = 10;

const COMMANDS_HELP = [
  '**Your work**',
  '• **tasks**: your open tasks · **overdue** · **today**: your day at a glance',
  '• **logged**: what you logged today · **week**: this week\'s activities and hours',
  '• **visits**: your next maintenance visits',
  '**A task** (use its number, e.g. 123)',
  '• **task 123**: its details · **start 123** · **done 123**',
  '• **waiting 123 the customer sends the licence key**',
  '• **update 123 firmware uploaded, rebooting tonight**',
  '• **new task Renew the SSL certificate for Northwind due Friday**',
].join('\n');

const iso = value => String(value || '').slice(0, 10);
const day = value => { const [y, m, d] = iso(value).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }); };
const hours = minutes => { const h = Math.floor(minutes / 60), m = minutes % 60; return h ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`; };
const linkTo = (appUrl, path) => (appUrl ? `${appUrl.replace(/\/+$/, '')}${path}` : null);
const taskPath = task => (task.customer_id ? `/customers/${task.customer_id}/service-profile?section=tasks&task=${task.id}` : '/tasks');

function taskLine(task, today) {
  const due = task.deadline ? ` · due ${day(task.deadline)}${iso(task.deadline) < today && !['completed', 'closed', 'cancelled'].includes(task.status) ? ' ⚠️' : ''}` : '';
  const where = task.customer_name || task.project_title;
  const who = !task.assigned_to && task.team_name ? ` · ${task.team_name} (team)` : '';
  return `• **#${task.id}** ${task.title}${where ? ` · ${where}` : ''}${due} · ${STATUS[task.status] || task.status}${who}`;
}
const listOf = (rows, line, more) => [...rows.slice(0, LIST_MAX).map(line), ...(rows.length > LIST_MAX ? [`…and ${rows.length - LIST_MAX} more${more ? `: ${more}` : ''}`] : [])].join('\n');

/** A due date in plain words: today, tomorrow, a weekday (the next one), "in 3 days", "next week", dd/mm(/yyyy), yyyy-mm-dd. */
function parseDue(text, today) {
  const t = parse.fold(text).trim();
  if (/^(today|σημερα)$/.test(t)) return today;
  if (/^(tomorrow|αυριο)$/.test(t)) return parse.addDays(today, 1);
  if (/^next week$/.test(t)) return parse.addDays(today, 7);
  const inDays = t.match(/^in (\d{1,3}) days?$/);
  if (inDays) return parse.addDays(today, Number(inDays[1]));
  const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const named = weekdays.findIndex(name => t === name || (t.length >= 3 && name.startsWith(t)) || t === `next ${name}`);
  if (named >= 0) {
    const now = new Date(`${today}T00:00:00Z`).getUTCDay();
    return parse.addDays(today, ((named - now + 7) % 7) || 7);
  }
  const isoDate = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDate) return Number.isNaN(Date.parse(t)) ? null : t;
  const dm = t.match(/^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?$/);
  if (dm) {
    const pad = n => String(n).padStart(2, '0');
    let year = dm[3] ? Number(dm[3].length === 2 ? `20${dm[3]}` : dm[3]) : Number(today.slice(0, 4));
    let date = `${year}-${pad(dm[2])}-${pad(dm[1])}`;
    if (!dm[3] && date < today) date = `${year + 1}-${pad(dm[2])}-${pad(dm[1])}`;
    const check = new Date(`${date}T00:00:00Z`);
    return !Number.isNaN(check.getTime()) && check.toISOString().slice(0, 10) === date ? date : null;
  }
  return null;
}

// ── Reading ──────────────────────────────────────────────────────────────────
// Soonest due first; those without a due date last.
const byDue = (a, b) => (a.deadline ? 0 : 1) - (b.deadline ? 0 : 1) || iso(a.deadline).localeCompare(iso(b.deadline)) || Number(a.id) - Number(b.id);
const myTasks = async (user, filter) => ((await api.get(user, `/tasks?filter=${filter}&assigned_to=${user.id}`)) || []).sort(byDue);
const myActivities = async (user, from, to) => {
  const page = await api.get(user, `/service-activities?from=${from}&to=${to}&page_size=200`);
  // Managers see everyone's: keep their own.
  return (page?.rows || []).filter(row => user.role !== 'manager' || row.engineer_name === user.name);
};

async function tasksReply(user, filter, title, empty, appUrl) {
  const today = appTime.today();
  const rows = await myTasks(user, filter);
  if (!rows.length) return empty;
  return `**${title}** (${rows.length})\n${listOf(rows, task => taskLine(task, today), linkTo(appUrl, '/tasks'))}\n\nReply **task 123** for one task's details.`;
}

async function activitiesReply(user, from, to, title) {
  let rows;
  try { rows = await myActivities(user, from, to); }
  catch (error) { if ([401, 403].includes(error.status)) return 'Your account doesn\'t log service activities.'; throw error; }
  if (!rows.length) return `${title}: nothing logged yet. Tell me what you did and I'll log it.`;
  const total = rows.reduce((sum, row) => sum + (Number(row.duration_minutes) || 0), 0);
  const line = row => `• ${day(row.activity_date)} · **${row.activity_reference}** ${row.customer_name} · ${row.category_name}${row.duration_minutes ? ` · ${hours(Number(row.duration_minutes))}` : ''}`;
  return `**${title}**: ${rows.length} activit${rows.length === 1 ? 'y' : 'ies'}${total ? `, ${hours(total)}` : ''}\n${listOf(rows, line)}`;
}

async function todayReply(user) {
  const today = appTime.today();
  const [due, overdue, visits] = await Promise.all([
    myTasks(user, 'due_today'), myTasks(user, 'overdue'),
    api.get(user, `/maintenance-visits?filter=upcoming${user.role === 'manager' ? `&engineer_id=${user.id}` : ''}`).catch(() => []),
  ]);
  const visitsToday = (visits || []).filter(visit => iso(visit.scheduled_date) === today);
  let logged = [];
  try { logged = await myActivities(user, today, today); } catch { /* no activity tracking */ }
  const minutes = logged.reduce((sum, row) => sum + (Number(row.duration_minutes) || 0), 0);
  const parts = [`**Today, ${day(today)}**`];
  parts.push(due.length ? `Due today (${due.length}):\n${listOf(due, task => taskLine(task, today))}` : 'Nothing due today.');
  if (overdue.length) parts.push(`⚠️ Overdue (${overdue.length}):\n${listOf(overdue, task => taskLine(task, today))}`);
  if (visitsToday.length) parts.push(`Visits today:\n${visitsToday.map(visit => `• ${visit.title} · ${visit.customer_name}`).join('\n')}`);
  parts.push(logged.length ? `Logged so far: ${logged.length} activit${logged.length === 1 ? 'y' : 'ies'}${minutes ? `, ${hours(minutes)}` : ''}.` : 'Nothing logged yet today.');
  return parts.join('\n\n');
}

async function visitsReply(user) {
  const rows = await api.get(user, `/maintenance-visits?filter=upcoming${user.role === 'manager' ? `&engineer_id=${user.id}` : ''}`);
  if (!rows?.length) return 'You have no upcoming maintenance visits.';
  return `**Your next visits**\n${listOf(rows, visit => `• ${day(visit.scheduled_date)}${visit.scheduled_time ? ` ${String(visit.scheduled_time).slice(0, 5)}` : ''} · ${visit.title} · ${visit.customer_name}`)}`;
}

async function taskReply(user, id, appUrl) {
  const task = await api.get(user, `/tasks/${id}`);
  const today = appTime.today();
  const lines = [`**#${task.id} ${task.title}**`, `• Status: ${STATUS[task.status] || task.status}${task.pending_from_customer && /^waiting/.test(task.status) ? ` (${task.pending_from_customer})` : ''}`];
  if (task.customer_name || task.project_title) lines.push(`• ${task.project_title ? 'Project' : 'Customer'}: ${task.project_title || task.customer_name}`);
  const people = [task.assigned_to_name || (task.team_name ? `${task.team_name} (team)` : null), ...(task.engineers || []).map(person => person.name)].filter(Boolean);
  lines.push(`• Who: ${people.join(', ') || 'Unassigned'}`);
  if (task.deadline) lines.push(`• Due: ${day(task.deadline)}${iso(task.deadline) < today && !['completed', 'closed', 'cancelled'].includes(task.status) ? ' (overdue)' : ''}`);
  if (task.priority) lines.push(`• Priority: ${task.priority}`);
  if (task.subtasks_total) lines.push(`• Subtasks: ${task.subtasks_done} of ${task.subtasks_total} done`);
  if (task.ticket_reference) lines.push(`• Ticket: ${task.ticket_reference}`);
  if (task.description) lines.push(`• Notes: ${task.description.length > 300 ? `${task.description.slice(0, 300)}…` : task.description}`);
  if (task.last_update) lines.push(`• Last update (${task.last_update.user_name}): ${String(task.last_update.message).slice(0, 200)}`);
  const link = linkTo(appUrl, taskPath(task));
  return lines.join('\n') + (link ? `\n${link}` : '');
}

// ── Changing ─────────────────────────────────────────────────────────────────
async function setStatus(user, id, status, reason) {
  await api.put(user, `/tasks/${id}`, { status, ...(reason ? { pending_from_customer: reason } : {}) });
  const task = await api.get(user, `/tasks/${id}`);
  return `✅ **#${task.id} ${task.title}** is now ${(STATUS[status] || status).toLowerCase()}${reason ? `: ${reason}` : ''}.`;
}

async function updateReply(user, id, text) {
  await api.post(user, `/tasks/${id}/comments`, { message: text });
  return `✅ Update posted on **#${id}**.`;
}

/** "new task <title> [for <customer>] [due <when>]" — a task for the person writing (engineers) or unassigned (managers). */
async function newTask(user, text, appUrl) {
  const today = appTime.today();
  let rest = text.trim(), deadline = null;
  const dueMatch = rest.match(/\s+(?:due|by|until|μεχρι)\s+(.+)$/i);
  if (dueMatch) {
    deadline = parseDue(dueMatch[1], today);
    if (!deadline) return `I didn't understand the due date "${dueMatch[1]}". Try **due Friday**, **due tomorrow**, **due 31/10** or **due in 3 days**.`;
    rest = rest.slice(0, dueMatch.index).trim();
  }
  let customers = [];
  try { customers = (await api.meta(user)).customers || []; } catch { customers = []; }
  let customer = null;
  const forMatch = rest.match(/\s+(?:for|at|για)\s+(.+)$/i);
  if (forMatch) {
    const found = parse.matchCustomers(forMatch[1], customers);
    if (found.length && found[0].score >= 80 && !(found[1] && found[1].score === found[0].score)) { customer = found[0]; rest = rest.slice(0, forMatch.index).trim(); }
    else if (found.length > 1) return `Which customer? ${found.slice(0, 5).map(item => item.name).join(', ')}. Write the name as it appears in the app.`;
  }
  if (!customer && user.role !== 'manager') {
    const found = parse.matchCustomers(rest, customers);
    if (found.length && found[0].score >= 100 && !(found[1] && found[1].score === found[0].score)) customer = found[0];
    else return 'Which customer is it for? Write it like **new task Replace the UPS battery for Northwind due Friday**.';
  }
  const title = rest.replace(/^[:\-–\s]+/, '').trim();
  if (!title) return 'What is the task? Write it like **new task Replace the UPS battery for Northwind due Friday**.';
  const made = await api.post(user, '/tasks', { title, ...(customer ? { customer_id: customer.id } : {}), ...(deadline ? { deadline } : {}) });
  const link = linkTo(appUrl, taskPath({ id: made.id, customer_id: customer?.id }));
  return `✅ Task **#${made.id} ${title}** added${customer ? ` for ${customer.name}` : ''}${deadline ? `, due ${day(deadline)}` : ''}${user.role === 'manager' ? ' (unassigned: assign it in the app)' : ', assigned to you'}.${link ? `\n${link}` : ''}`;
}

/** A command's answer, or null when the message is not a command. */
async function handleCommand({ user, message, appUrl = '', answering = false }) {
  const text = String(message || '').trim();
  const t = parse.fold(text).replace(/[!.?]+$/, '').trim();
  let m;
  try {
    if (/^(my )?tasks?$|^(my )?open tasks$|^εργασιες$/.test(t)) return await tasksReply(user, 'open', 'Your open tasks', 'You have no open tasks. 🎉', appUrl);
    if (/^(my )?overdue( tasks)?$|^late$/.test(t)) return await tasksReply(user, 'overdue', 'Overdue tasks', 'Nothing is overdue. 👍', appUrl);
    // "today" may answer the activity draft's "which day?": then it is not the command.
    if (/^(my day|agenda|what'?s on today)$/.test(t) || (!answering && /^(today|σημερα)$/.test(t))) return await todayReply(user);
    if (/^(logged|my log|my activities|logged today|what did i log( today)?)$/.test(t)) { const today = appTime.today(); return await activitiesReply(user, today, today, 'Logged today'); }
    if (/^(this )?week$|^(my )?(hours|activities|log) this week$|^week(ly)? (log|hours)$/.test(t)) {
      const today = appTime.today(), weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
      return await activitiesReply(user, parse.addDays(today, -weekday), today, 'This week');
    }
    if (/^(my )?(next )?visits?$|^επισκεψεις$/.test(t)) return await visitsReply(user);
    if ((m = t.match(/^(?:task|show|show task)\s*#?(\d{1,9})$|^#(\d{1,9})$/))) return await taskReply(user, Number(m[1] || m[2]), appUrl);
    if ((m = t.match(/^(?:start|begin|working on)\s+#?(\d{1,9})$/))) return await setStatus(user, Number(m[1]), 'in_progress');
    if ((m = t.match(/^(?:done|complete|completed|finish|finished|close)\s+#?(\d{1,9})$/))) return await setStatus(user, Number(m[1]), 'completed');
    if ((m = text.match(/^(?:waiting|wait|pending)\s+(?:on\s+)?#?(\d{1,9})\s*[:\-–]?\s*(.{3,})$/is))) return await setStatus(user, Number(m[1]), 'waiting_customer', m[2].trim().slice(0, 1000));
    if ((m = text.match(/^(?:waiting|wait|pending)\s+(?:on\s+)?#?(\d{1,9})$/i))) return 'What are you waiting for? Write it like **waiting 123 the customer sends the licence key**.';
    if ((m = text.match(/^(?:update|note|comment|σχολιο)\s+#?(\d{1,9})\s*[:\-–]?\s*(.+)$/is))) return await updateReply(user, Number(m[1]), m[2].trim().slice(0, 10000));
    if ((m = text.match(/^(?:new task|add task|create task|task:)\s*[:\-–]?\s*(.+)$/is))) return await newTask(user, m[1], appUrl);
  } catch (error) {
    if (error.status === 404) return 'I can\'t find that task. Check its number (it is shown as #123 in **tasks**).';
    if (error.status === 403) return 'You can\'t do that on this task: it isn\'t one you work on.';
    if (error.status >= 400 && error.status < 500) return `I couldn't do that: ${error.message}`;
    throw error;
  }
  return null;
}

module.exports = { handleCommand, parseDue, COMMANDS_HELP };
