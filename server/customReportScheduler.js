const db = require('./db');
const execution = require('./reportExecution');
const email = require('./email');
const { nextRun,eligibleRecipients } = require('./reportSchedule');

/* Scheduled custom reports (review I05). A due slot is claimed and its recipients
   written to custom_report_deliveries in one transaction, so a restart never loses
   a slot. Each recipient is then delivered on its own: a row is marked 'sending'
   before the email goes out, so a recipient who was sent the report is never sent
   it again automatically. A temporary failure is retried (MAX_ATTEMPTS, with a
   growing wait); a send that was interrupted is 'uncertain' (it may have arrived)
   and only a person's "Retry failed deliveries" sends it again. */
const MAX_ATTEMPTS = 3;
const RETRY_WAIT_MINUTES = [5,30];
const STALE_SENDING_MINUTES = 10;

let timer = null;
let busy = false;
const minutesAfter = (now,minutes) => new Date(now.getTime()+minutes*60_000).toISOString();
const short = text => String(text || '').slice(0,500);

// SMTP replies 4xx are temporary and 5xx permanent; a dropped connection while the
// message itself was being handed over may or may not have delivered it.
function classify(failure) {
  const code = Number(failure?.responseCode);
  if (failure?.command==='DATA' && !code) return 'uncertain';
  if (code>=500 || /not configured/i.test(failure?.message || '')) return 'permanent';
  return 'temporary';
}

async function claimDue(store,now) {
  const due = await store.prepare('SELECT * FROM custom_report_schedules WHERE enabled=1 AND next_run<=? ORDER BY next_run,report_id LIMIT 25').all(now.toISOString());
  for (const schedule of due) {
    await store.transaction(async tx => {
      // Claim and advance before delivery: replicas and restarts cannot repeat this slot.
      const claimed = await tx.prepare("UPDATE custom_report_schedules SET next_run=?,last_run=?,last_status='claimed',last_error=NULL WHERE report_id=? AND version=? AND enabled=1 AND next_run=? RETURNING report_id").get(nextRun(schedule,now),now.toISOString(),schedule.report_id,schedule.version,schedule.next_run);
      if (!claimed) return;
      for (const userId of JSON.parse(schedule.recipient_ids)) {
        await tx.prepare("INSERT INTO custom_report_deliveries (report_id,slot,user_id,channel,status,next_attempt_at) VALUES (?,?,?,'email','pending',?) ON CONFLICT (report_id,slot,user_id,channel) DO NOTHING").run(schedule.report_id,schedule.next_run,userId,now.toISOString());
      }
    });
  }
}

// A send that started long ago and never finished: the process stopped mid-send.
async function recoverInterrupted(store,now) {
  await store.prepare("UPDATE custom_report_deliveries SET status='uncertain',last_error=? WHERE status='sending' AND attempted_at<?")
    .run('Interrupted while sending; it may or may not have arrived. Retry only if the recipient did not get it.',minutesAfter(now,-STALE_SENDING_MINUTES));
}

async function finishSlot(store,reportId,slot,{ blocked = null,disable = false,version = null } = {}) {
  const rows = await store.prepare('SELECT status,last_error FROM custom_report_deliveries WHERE report_id=? AND slot=?').all(reportId,slot);
  const count = status => rows.filter(row => row.status===status).length;
  const sent = count('sent'),waiting = count('pending'),failed = count('failed')+count('uncertain');
  const status = blocked ? 'blocked' : failed && sent ? 'partial' : failed ? 'failed' : waiting ? 'retrying' : 'sent';
  const error = blocked
    || (failed ? `${failed} of ${rows.length} recipient${rows.length===1 ? '' : 's'} not delivered: ${rows.find(row => row.last_error && ['failed','uncertain'].includes(row.status))?.last_error || 'see deliveries'}` : null)
    || (waiting ? `${waiting} ${waiting===1 ? 'delivery' : 'deliveries'} will be retried automatically.` : null);
  if (disable) await store.prepare('UPDATE custom_report_schedules SET last_status=?,last_error=?,enabled=0,version=version+1 WHERE report_id=? AND version=?').run(status,short(error),reportId,version);
  else await store.prepare('UPDATE custom_report_schedules SET last_status=?,last_error=? WHERE report_id=?').run(status,short(error),reportId);
}

async function skipSlot(store,reportId,slot,reason) {
  await store.prepare("UPDATE custom_report_deliveries SET status='skipped',last_error=?,next_attempt_at=NULL WHERE report_id=? AND slot=? AND status='pending'").run(reason,reportId,slot);
}

async function deliverSlot(store,{ report_id: reportId,slot },now,run,send) {
  const pending = await store.prepare("SELECT * FROM custom_report_deliveries WHERE report_id=? AND slot=? AND status='pending' AND next_attempt_at<=? ORDER BY id").all(reportId,slot,now.toISOString());
  const [report,schedule] = await Promise.all([
    store.prepare('SELECT * FROM saved_custom_reports WHERE id=?').get(reportId),
    store.prepare('SELECT * FROM custom_report_schedules WHERE report_id=?').get(reportId),
  ]);
  if (!pending.length) return;
  if (!report || !schedule) return skipSlot(store,reportId,slot,'The report or its schedule was removed.');
  const blocked = 'Access, definition or schedule changed; review and enable delivery again.';
  const ids = pending.map(row => row.user_id);
  let result;
  try {
    // Access is checked when the report runs, and again before anything is sent.
    await eligibleRecipients(store,report,ids);
    result = await run(JSON.parse(report.definition),5000);
    if (result.truncated) {
      await store.prepare("UPDATE custom_report_deliveries SET status='failed',last_error=?,next_attempt_at=NULL WHERE report_id=? AND slot=? AND status='pending'").run('Report exceeds 5000 rows; narrow the saved filters.',reportId,slot);
      return finishSlot(store,reportId,slot);
    }
    const current = await store.prepare('SELECT r.*,s.version AS schedule_version,s.enabled FROM saved_custom_reports r JOIN custom_report_schedules s ON s.report_id=r.id WHERE r.id=?').get(reportId);
    if (!current || !current.enabled || current.version!==report.version || current.schedule_version!==schedule.version) throw Object.assign(new Error('Report or schedule changed during execution'),{ status: 400 });
    await eligibleRecipients(store,current,ids);
  } catch (failure) {
    if (failure.status===400) {
      await skipSlot(store,reportId,slot,blocked);
      return finishSlot(store,reportId,slot,{ blocked,disable: true,version: schedule.version });
    }
    // The report could not run (database busy, query limits): try the slot again later.
    for (const row of pending) await retryOrFail(store,{ ...row,attempts: Number(row.attempts)+1 },now,'The report could not be run; it will be tried again.');
    return finishSlot(store,reportId,slot);
  }

  const users = new Map((await store.prepare(`SELECT id,email FROM users WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids)).map(user => [user.id,user]));
  const attachment = { filename: 'scheduled-report.csv',content: Buffer.from(execution.csv(result),'utf8'),contentType: 'text/csv; charset=utf-8' };
  for (const row of pending) {
    // Taken by this process only; another replica that got here first has it.
    const taken = await store.prepare("UPDATE custom_report_deliveries SET status='sending',attempts=attempts+1,attempted_at=? WHERE id=? AND status='pending' RETURNING attempts").get(now.toISOString(),row.id);
    if (!taken) continue;
    try {
      const info = await send({ to: users.get(row.user_id).email,subject: `Scheduled report: ${report.name}`,text: `Current data for ${report.name}. Generated ${now.toISOString()}. Relative date filters are resolved when the report runs.`,attachments: [attachment] });
      await store.prepare("UPDATE custom_report_deliveries SET status='sent',sent_at=?,last_error=NULL,next_attempt_at=NULL,provider_response=? WHERE id=?")
        .run(now.toISOString(),short([info?.messageId,info?.response].filter(Boolean).join(' ')) || null,row.id);
    } catch (failure) {
      const kind = classify(failure);
      const said = short(failure?.response || failure?.message);
      if (kind==='uncertain') await store.prepare("UPDATE custom_report_deliveries SET status='uncertain',last_error=?,provider_response=?,next_attempt_at=NULL WHERE id=?").run('The connection dropped while the email was being handed over; it may have arrived.',said,row.id);
      else if (kind==='permanent') await store.prepare("UPDATE custom_report_deliveries SET status='failed',last_error=?,provider_response=?,next_attempt_at=NULL WHERE id=?").run(/not configured/i.test(said) ? 'Email (SMTP) is not configured.' : 'The mail server refused this recipient.',said,row.id);
      else await retryOrFail(store,{ ...row,attempts: taken.attempts },now,'The mail server could not be reached.',said);
    }
  }
  return finishSlot(store,reportId,slot);
}

async function retryOrFail(store,row,now,error,providerResponse = null) {
  const attempts = Number(row.attempts); // including the one that just failed
  if (attempts<MAX_ATTEMPTS) {
    await store.prepare("UPDATE custom_report_deliveries SET status='pending',attempts=?,last_error=?,provider_response=?,next_attempt_at=? WHERE id=?")
      .run(attempts,`${error} Retry ${attempts} of ${MAX_ATTEMPTS-1} is scheduled.`,providerResponse,minutesAfter(now,RETRY_WAIT_MINUTES[attempts-1] ?? 30),row.id);
  } else {
    await store.prepare("UPDATE custom_report_deliveries SET status='failed',attempts=?,last_error=?,provider_response=?,next_attempt_at=NULL WHERE id=?")
      .run(attempts,`${error} Gave up after ${attempts} attempts.`,providerResponse,row.id);
  }
}

async function tick({ now = new Date(),store = db,run = execution.run,send = email.sendEmail } = {}) {
  if (busy) return;
  busy = true;
  try {
    await recoverInterrupted(store,now);
    await claimDue(store,now);
    const slots = await store.prepare("SELECT DISTINCT report_id,slot FROM custom_report_deliveries WHERE status='pending' AND next_attempt_at<=? ORDER BY slot,report_id LIMIT 25").all(now.toISOString());
    for (const slot of slots) await deliverSlot(store,slot,now,run,send);
  } finally { busy = false; }
}

/** "Retry failed deliveries": failed and uncertain recipients of a report go again on the next poll. */
async function retryFailed(store,reportId,now = new Date()) {
  return store.prepare("UPDATE custom_report_deliveries SET status='pending',attempts=0,next_attempt_at=?,last_error=NULL WHERE report_id=? AND status IN ('failed','uncertain') RETURNING id,user_id,slot").all(now.toISOString(),reportId);
}

function start() {
  stop();
  const poll = () => tick().catch(() => console.error('[custom-reports] Scheduler poll failed'));
  timer = setInterval(poll,60_000);
  timer.unref();
  poll();
}
function stop() { if (timer) clearInterval(timer); timer = null; }
module.exports = { tick,start,stop,retryFailed,MAX_ATTEMPTS };
