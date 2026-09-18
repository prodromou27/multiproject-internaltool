const db = require('./db');
const execution = require('./reportExecution');
const email = require('./email');
const { nextRun,eligibleRecipients } = require('./reportSchedule');

let timer = null;
let busy = false;
async function tick({ now = new Date(),store = db,run = execution.run,send = email.sendEmail } = {}) {
  if (busy) return;
  busy = true;
  try {
    const due = await store.prepare('SELECT * FROM custom_report_schedules WHERE enabled=1 AND next_run<=? ORDER BY next_run,report_id LIMIT 25').all(now.toISOString());
    for (const schedule of due) {
      const next = nextRun(schedule,now);
      // Claim and advance before delivery: replicas and restarts cannot resend this slot.
      const claimed = await store.prepare("UPDATE custom_report_schedules SET next_run=?,last_run=?,last_status='claimed',last_error=NULL WHERE report_id=? AND version=? AND enabled=1 AND next_run=? RETURNING report_id").get(next,now.toISOString(),schedule.report_id,schedule.version,schedule.next_run);
      if (!claimed) continue;
      let status = 'sent',error = null,disable = false;
      try {
        const report = await store.prepare('SELECT * FROM saved_custom_reports WHERE id=?').get(schedule.report_id);
        if (!report) continue;
        const recipients = JSON.parse(schedule.recipient_ids);
        await eligibleRecipients(store,report,recipients);
        const result = await run(JSON.parse(report.definition),5000);
        if (result.truncated) throw Object.assign(new Error('Export exceeds 5000 rows'),{ reportBudget: true });
        const current = await store.prepare('SELECT r.*,s.version AS schedule_version,s.enabled FROM saved_custom_reports r JOIN custom_report_schedules s ON s.report_id=r.id WHERE r.id=?').get(report.id);
        if (!current || !current.enabled || current.version!==report.version || current.schedule_version!==schedule.version) throw Object.assign(new Error('Report or schedule changed during execution'),{ status: 400 });
        const users = await eligibleRecipients(store,current,recipients);
        const attachment = { filename: 'scheduled-report.csv',content: Buffer.from(execution.csv(result),'utf8'),contentType: 'text/csv; charset=utf-8' };
        for (const user of users) await send({ to: user.email,subject: `Scheduled report: ${report.name}`,text: `Current data for ${report.name}. Generated ${now.toISOString()}. The attached CSV uses the saved filters, including fixed date ranges.`,attachments: [attachment] });
      } catch (failure) {
        disable = failure.status===400;
        status = disable ? 'blocked' : 'failed';
        error = disable ? 'Access, definition or schedule changed; review and enable delivery again.' : failure.reportBudget ? 'Report exceeds 5000 rows; narrow the saved filters.' : 'Delivery failed; check SMTP configuration or query limits. This slot is not retried automatically.';
      }
      await store.prepare('UPDATE custom_report_schedules SET last_status=?,last_error=?,enabled=?,version=version+? WHERE report_id=? AND version=? AND next_run=?').run(status,error,disable ? 0 : 1,disable ? 1 : 0,schedule.report_id,schedule.version,next);
    }
  } finally { busy = false; }
}
function start() {
  stop();
  const poll = () => tick().catch(() => console.error('[custom-reports] Scheduler poll failed'));
  timer = setInterval(poll,60_000);
  timer.unref();
  poll();
}
function stop() { if (timer) clearInterval(timer); timer = null; }
module.exports = { tick,start,stop };
