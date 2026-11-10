const { compileReport } = require('./customReports');
const { canAccessReport } = require('./reportAccess');
const invalid = message => { throw Object.assign(new Error(message),{ status: 400 }); };
function validateSchedule(body) {
  if (!body || typeof body.enabled!=='boolean' || !['daily','weekly','monthly'].includes(body.frequency)
    || !Number.isInteger(body.hour) || body.hour<0 || body.hour>23
    || !Number.isInteger(body.minute) || body.minute<0 || body.minute>59
    || !Number.isInteger(body.day) || (body.frequency==='weekly' ? body.day<0 || body.day>6 : body.frequency==='monthly' ? body.day<1 || body.day>28 : body.day!==0)
    || !Number.isSafeInteger(body.version) || body.version<0) invalid('Invalid schedule: use UTC time, weekly day 0-6 or monthly day 1-28 and an expected version');
  if (!Array.isArray(body.recipient_ids) || body.recipient_ids.length>20 || body.recipient_ids.some(id => !Number.isSafeInteger(id) || id<1)
    || new Set(body.recipient_ids).size!==body.recipient_ids.length || (body.enabled && !body.recipient_ids.length)) invalid('Select 1-20 distinct manager recipients for an enabled schedule');
}
function nextRun(schedule,now = new Date()) {
  const date = new Date(now);
  date.setUTCHours(schedule.hour,schedule.minute,0,0);
  if (schedule.frequency==='weekly') {
    date.setUTCDate(date.getUTCDate()+(schedule.day-date.getUTCDay()+7)%7);
    if (date<=now) date.setUTCDate(date.getUTCDate()+7);
  } else if (schedule.frequency==='monthly') {
    date.setUTCDate(schedule.day);
    if (date<=now) date.setUTCMonth(date.getUTCMonth()+1);
  } else if (date<=now) date.setUTCDate(date.getUTCDate()+1);
  return date.toISOString();
}
async function eligibleRecipients(db,report,ids) {
  const owner = await db.prepare('SELECT role,active,must_change_password FROM users WHERE id=?').get(report.owner_id);
  if (!owner || owner.role!=='manager' || !owner.active || owner.must_change_password) invalid('Report owner is not currently eligible');
  if (!ids.length || ids.length>20 || new Set(ids).size!==ids.length || ids.some(id => !Number.isSafeInteger(id) || id<1)) invalid('Invalid stored recipients');
  const users = await db.prepare(`SELECT id,email FROM users WHERE id IN (${ids.map(() => '?').join(',')}) AND role='manager' AND active=1 AND must_change_password=0`).all(...ids);
  if (users.length!==ids.length || users.some(user => typeof user.email!=='string' || user.email.length>254 || !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(user.email))) invalid('All recipients must be active managers with valid email addresses and current access');
  for (const user of users) if (!await canAccessReport(db,report,user.id)) invalid('Every recipient must currently have access to the saved report');
  compileReport(JSON.parse(report.definition),5000);
  return users;
}
module.exports = { validateSchedule,nextRun,eligibleRecipients };
