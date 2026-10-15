/**
 * Contextual customer responses (enhancement E07): a response text with
 * placeholders ({{customer_name}}, {{visit_date}}…) is filled from a customer, task
 * or visit the person may open. Only that record's own fields are used, and only
 * after the same access check its page uses; anything that cannot be filled stays
 * visible as {{placeholder}} and is listed, never guessed.
 */
const db = require('./db');
const appTime = require('./appTime');
const { decryptCustomer } = require('./fieldCipher');
const { canAccessCustomer } = require('./customerAccess');

const PLACEHOLDERS = {
  customer_name: 'Customer name', contact_name: 'Customer contact', customer_code: 'Customer code',
  task_title: 'Task title', task_deadline: 'Task deadline', assigned_engineer: 'Engineer on the task',
  visit_title: 'Visit title', visit_date: 'Visit date', visit_time: 'Visit start time', visit_engineers: 'Engineers on the visit',
  project_title: 'Project', my_name: 'Your name', today: "Today's date",
};
const CONTEXTS = ['customer', 'task', 'visit'];

/** The record behind a context, if this person may open it: { customerId, values } or null. */
async function contextValues(user, type, id, store = db) {
  if (!CONTEXTS.includes(type) || !Number.isSafeInteger(id) || id < 1) return null;
  const allRecords = ['manager', 'planner'].includes(user.role);
  let customerId = null;
  const values = {};
  if (type === 'customer') {
    if (!await canAccessCustomer(user, id, store)) return null;
    customerId = id;
  } else if (type === 'task') {
    const task = await store.prepare(`SELECT t.title, t.deadline, t.assigned_to, t.customer_id, u.name AS engineer, p.title AS project_title, p.customer_id AS project_customer
      FROM tasks t LEFT JOIN users u ON u.id = t.assigned_to LEFT JOIN projects p ON p.id = t.project_id WHERE t.id = ?`).get(id);
    if (!task || !(allRecords || (user.role === 'engineer' && Number(task.assigned_to) === Number(user.id)))) return null;
    customerId = task.customer_id || task.project_customer || null;
    Object.assign(values, { task_title: task.title, task_deadline: task.deadline?.slice(0, 10), assigned_engineer: task.engineer, project_title: task.project_title });
  } else {
    const visit = await store.prepare('SELECT title, scheduled_date, start_time, customer_id FROM maintenance_visits WHERE id = ?').get(id);
    if (!visit) return null;
    const engineers = await store.prepare('SELECT u.id, u.name FROM maintenance_visit_engineers e JOIN users u ON u.id = e.user_id WHERE e.visit_id = ? ORDER BY u.name').all(id);
    if (!(allRecords || (user.role === 'engineer' && engineers.some(e => Number(e.id) === Number(user.id))))) return null;
    customerId = visit.customer_id;
    Object.assign(values, { visit_title: visit.title, visit_date: visit.scheduled_date?.slice(0, 10), visit_time: visit.start_time?.slice(0, 5), visit_engineers: engineers.map(e => e.name).join(', ') });
  }
  let contactEmail = null;
  if (customerId) {
    const customer = decryptCustomer(await store.prepare('SELECT * FROM customers WHERE id = ?').get(customerId));
    if (customer) {
      Object.assign(values, { customer_name: customer.name, contact_name: customer.primary_contact || customer.contact_name, customer_code: customer.customer_code });
      contactEmail = customer.contact_email || null;
    }
  }
  Object.assign(values, { my_name: user.name, today: appTime.today() });
  return { customerId: customerId ? Number(customerId) : null, contactEmail, values };
}

/** The text with its placeholders filled; `missing` lists those with no value here. */
function fill(text, values) {
  const missing = new Set();
  const filled = String(text).replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (whole, name) => {
    if (!Object.hasOwn(PLACEHOLDERS, name)) return whole;
    const value = values[name];
    if (value === undefined || value === null || value === '') { missing.add(name); return whole; }
    return String(value);
  });
  return { text: filled, missing: [...missing] };
}

module.exports = { PLACEHOLDERS, CONTEXTS, contextValues, fill };
