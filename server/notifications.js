/**
 * Notification dispatcher — Teams (Incoming Webhook) and Cisco Webex (Bot API).
 * All sends are fire-and-forget so they never block request handlers.
 */
const https = require('https');
const http  = require('http');
const db    = require('./db');
const { assertPublicHttpUrl } = require('./security');

// ── Fetch settings from DB ───────────────────────────────────────────────────
async function getSettings() {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'integrations'").get();
  if (!row) return null;
  try { return JSON.parse(row.value); } catch { return null; }
}

// Generic HTTP/S POST (no external deps). Outbound URLs are DNS-resolved and
// blocked if they target private, loopback, link-local, or metadata addresses.
async function postJSON(url, body, extraHeaders = {}) {
  const u = await assertPublicHttpUrl(url, { label: 'Outbound notification URL' });
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname: u.hostname,
      port:     u.port || (u.protocol === 'https:' ? 443 : 80),
      path:     u.pathname + u.search,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...extraHeaders,
      },
    };
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(options, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(data);
    req.end();
  });
}

// ── Teams (O365 Connector MessageCard) ──────────────────────────────────────
async function sendTeams(cfg, msg) {
  if (!cfg?.enabled || !cfg?.webhook_url) return;
  try {
    await postJSON(cfg.webhook_url, {
      '@type':    'MessageCard',
      '@context': 'http://schema.org/extensions',
      themeColor: '0078D4',
      summary:    msg.title,
      sections: [{
        activityTitle:    msg.title,
        activitySubtitle: msg.subtitle || '',
        activityText:     msg.body,
        facts: (msg.facts || []).map(f => ({ name: f.name, value: f.value })),
        markdown: true,
      }],
    });
  } catch (e) {
    console.error('[Teams notify]', e.message);
  }
}

// ── Webex Bot API ────────────────────────────────────────────────────────────
async function sendWebex(cfg, msg, engineerEmail) {
  if (!cfg?.enabled || !cfg?.bot_token) return;

  const headers = { Authorization: `Bearer ${cfg.bot_token}` };
  const markdown = `## ${msg.title}\n${msg.body}${msg.facts?.length
    ? '\n\n' + msg.facts.map(f => `**${f.name}:** ${f.value}`).join('  \n')
    : ''}`;

  const sends = [];

  // Direct message to engineer
  if ((cfg.mode === 'direct' || cfg.mode === 'both') && engineerEmail) {
    sends.push(postJSON('https://webexapis.com/v1/messages', { toPersonEmail: engineerEmail, markdown }, headers));
  }

  // Team Space / Room
  if ((cfg.mode === 'space' || cfg.mode === 'both') && cfg.space_id) {
    sends.push(postJSON('https://webexapis.com/v1/messages', { roomId: cfg.space_id, markdown }, headers));
  }

  try {
    await Promise.all(sends);
  } catch (e) {
    console.error('[Webex notify]', e.message);
  }
}

// ── Persist notification to DB for a specific user ──────────────────────────
async function persistNotification(userId, type, title, body, link) {
  try {
    await db.prepare(
      `INSERT INTO notifications (user_id, type, title, body, link) VALUES (?, ?, ?, ?, ?)`
    ).run(userId, type, title, body || null, link || null);
  } catch (e) {
    console.error('[notify persist]', e.message);
  }
}

// ── Build message from event + data ─────────────────────────────────────────
function buildMessage(event, data) {
  switch (event) {
    case 'task.assigned':
      return {
        title:    '📋 New Task Assigned',
        subtitle: `Assigned to: ${data.engineer_name}`,
        body:     `**${data.engineer_name}** has been assigned a task.`,
        facts:    [
          { name: 'Task',        value: data.task_title },
          { name: 'Assigned to', value: data.engineer_name },
          ...(data.project_title ? [{ name: 'Project', value: data.project_title }] : []),
          ...(data.deadline      ? [{ name: 'Deadline', value: data.deadline }]     : []),
          { name: 'Priority',    value: data.priority || 'medium' },
          ...(data.is_adhoc      ? [{ name: 'Type', value: 'Ad-hoc' }]             : []),
        ],
      };

    case 'project.assigned':
      return {
        title:    '📁 Project Assigned',
        subtitle: `Assigned to: ${data.engineer_name}`,
        body:     `**${data.engineer_name}** has been added to project **${data.project_title}**.`,
        facts:    [
          { name: 'Project',  value: data.project_title },
          { name: 'Engineer', value: data.engineer_name },
          ...(data.deadline   ? [{ name: 'Deadline', value: data.deadline }] : []),
          ...(data.priority   ? [{ name: 'Priority', value: data.priority }] : []),
        ],
      };

    case 'visit.assigned':
      return {
        title:    '🔧 Maintenance Visit Assigned',
        subtitle: `Assigned to: ${data.engineer_name}`,
        body:     `**${data.engineer_name}** has been assigned a maintenance visit.`,
        facts:    [
          { name: 'Visit',    value: data.visit_title },
          { name: 'Customer', value: data.customer_name },
          { name: 'Date',     value: data.scheduled_date },
          { name: 'Engineer', value: data.engineer_name },
        ],
      };

    case 'report.submitted':
      return {
        title:    '📄 Report Submitted',
        subtitle: `Submitted by: ${data.engineer_name}`,
        body:     `**${data.engineer_name}** has submitted a report for a maintenance visit.`,
        facts:    [
          { name: 'Visit',    value: data.visit_title },
          { name: 'Customer', value: data.customer_name },
          { name: 'Engineer', value: data.engineer_name },
        ],
      };

    case 'visit.reminder':
      return {
        title:    '🔔 Maintenance Visit Tomorrow',
        subtitle: `Reminder for: ${data.engineer_name}`,
        body:     `**${data.engineer_name}**, you have a maintenance visit scheduled for tomorrow.`,
        facts:    [
          { name: 'Visit',    value: data.visit_title },
          { name: 'Customer', value: data.customer_name },
          { name: 'Date',     value: data.scheduled_date },
          { name: 'Engineer', value: data.engineer_name },
        ],
      };

    default:
      return null;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────
/**
 * notify(event, data)
 *   event: 'task.assigned' | 'project.assigned' | 'visit.assigned'
 *   data:  { engineer_name, engineer_email, ... }
 * Non-blocking — errors are caught and logged.
 */
function notify(event, data) {
  // Always fire-and-forget — never await in route handlers
  setImmediate(async () => {
    try {
      const msg = buildMessage(event, data);
      if (!msg) return;

      // ── Persist in-app notifications to DB ────────────────────────────────
      if (event === 'task.assigned' && data.engineer_id) {
        const body = data.project_title
          ? `${data.task_title} · ${data.project_title}`
          : data.task_title;
        await persistNotification(data.engineer_id, event, 'New task assigned to you', body, '/tasks');
      } else if (event === 'project.assigned' && data.engineer_id) {
        const link = data.project_id ? `/projects/${data.project_id}` : '/projects';
        await persistNotification(data.engineer_id, event, `Added to project: ${data.project_title}`, null, link);
      } else if (event === 'visit.assigned' && data.engineer_id) {
        const body = `${data.visit_title} · ${data.customer_name} · ${data.scheduled_date}`;
        await persistNotification(data.engineer_id, event, 'Maintenance visit assigned to you', body, '/maintenance-visits');
      } else if (event === 'visit.reminder' && data.engineer_id) {
        // Dedup: only create one reminder per visit per user per day
        const dedupLink = `/maintenance-visits?reminder=${data.visit_id}`;
        const today = new Date().toISOString().slice(0, 10);
        try {
          const exists = await db.prepare(
            `SELECT 1 FROM notifications WHERE user_id = ? AND link = ? AND date(created_at) = ?`
          ).get(data.engineer_id, dedupLink, today);
          if (!exists) {
            const body = `${data.visit_title} · ${data.customer_name} · ${data.scheduled_date}`;
            await persistNotification(data.engineer_id, event, '🔔 Visit tomorrow: ' + data.visit_title, body, dedupLink);
          }
        } catch (e) {
          console.error('[notify visit.reminder dedup]', e.message);
        }
      } else if (event === 'report.submitted') {
        // Notify all active managers
        try {
          const managers = await db.prepare("SELECT id FROM users WHERE role = 'manager' AND active = 1").all();
          const body = `${data.visit_title} · ${data.customer_name} · by ${data.engineer_name}`;
          for (const m of managers) {
            await persistNotification(m.id, event, 'Report submitted for review', body, '/maintenance-visits');
          }
        } catch (e) {
          console.error('[notify persist managers]', e.message);
        }
      }

      // ── External channels (Teams / Webex) ─────────────────────────────────
      const settings = await getSettings();
      if (!settings) return;

      const notifyOn = settings.notify_on || {};
      const eventKey = event.replace('.', '_');  // e.g. task.assigned → task_assigned
      // visit.reminder defaults to enabled unless explicitly disabled
      if (notifyOn[eventKey] === false) return;

      await Promise.all([
        sendTeams(settings.teams, msg),
        sendWebex(settings.webex, msg, data.engineer_email),
      ]);
    } catch (e) {
      console.error('[notify]', e.message);
    }
  });
}

/** sendTest — used by the Admin "Test" button */
async function sendTest(platform, settings) {
  const msg = {
    title:    '🔔 Test Notification',
    subtitle: 'Solutions Hub integration test',
    body:     'If you see this, your notification integration is working correctly.',
    facts:    [
      { name: 'Platform', value: platform === 'teams' ? 'Microsoft Teams' : 'Cisco Webex' },
      { name: 'Sent at',  value: new Date().toLocaleString() },
    ],
  };

  if (platform === 'teams') {
    await sendTeams(settings.teams, msg);
    return { ok: true };
  } else if (platform === 'webex') {
    // For test: if direct mode pick first engineer's email, or use the test_email from body
    await sendWebex(settings.webex, msg, settings.webex?.test_email || null);
    return { ok: true };
  }
  throw new Error('Unknown platform');
}

module.exports = { notify, sendTest };
