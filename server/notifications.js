/**
 * Notification dispatcher — Teams (Workflows / legacy connector webhook) and
 * Cisco Webex (Bot API). All sends are fire-and-forget so they never block
 * request handlers.
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
// Non-2xx responses reject; 429/5xx are retried once after a short back-off.
function rawPost(u, data, extraHeaders) {
  return new Promise((resolve, reject) => {
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
      let text = '';
      res.on('data', d => { if (text.length < 2000) text += d; });
      res.on('end', () => resolve({ status: res.statusCode, body: text, headers: res.headers }));
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(data);
    req.end();
  });
}

let transport = rawPost;
/** Test hook: replace the network layer. Call with no argument to restore it. */
function _setTransport(fn) { transport = fn || rawPost; }

async function postJSON(url, body, extraHeaders = {}) {
  const u = await assertPublicHttpUrl(url, { label: 'Outbound notification URL' });
  const data = JSON.stringify(body);
  let res = await transport(u, data, extraHeaders);
  if (res.status === 429 || res.status >= 500) {
    const wait = Math.min(Math.max(Number(res.headers?.['retry-after']) || 1, 1), 5) * 1000;
    await new Promise(r => setTimeout(r, wait));
    res = await transport(u, data, extraHeaders);
  }
  if (res.status < 200 || res.status >= 300) {
    const detail = String(res.body || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    throw new Error(`HTTP ${res.status}${detail ? ': ' + detail : ''}`);
  }
  return res;
}

// ── Teams ────────────────────────────────────────────────────────────────────
// Legacy Office 365 connector URLs (*.webhook.office.com) take a MessageCard;
// Workflows / Power Automate URLs ("Post to a channel when a webhook request is
// received") take an Adaptive Card wrapped in a message envelope.
function isLegacyTeamsUrl(url) {
  try { return /(^|\.)webhook\.office(365)?\.com$/i.test(new URL(url).hostname); } catch { return false; }
}

function teamsPayload(url, msg) {
  const facts = (msg.facts || []).map(f => ({ name: String(f.name), value: String(f.value ?? '') }));
  if (isLegacyTeamsUrl(url)) {
    return {
      '@type':    'MessageCard',
      '@context': 'http://schema.org/extensions',
      themeColor: '0078D4',
      summary:    msg.title,
      sections: [{
        activityTitle:    msg.title,
        activitySubtitle: msg.subtitle || '',
        activityText:     msg.body,
        facts,
        markdown: true,
      }],
    };
  }
  return {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      contentUrl:  null,
      content: {
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        type:    'AdaptiveCard',
        version: '1.4',
        body: [
          { type: 'TextBlock', text: msg.title, weight: 'Bolder', size: 'Medium', wrap: true },
          ...(msg.subtitle ? [{ type: 'TextBlock', text: msg.subtitle, isSubtle: true, spacing: 'None', wrap: true }] : []),
          { type: 'TextBlock', text: msg.body, wrap: true },
          ...(facts.length ? [{ type: 'FactSet', facts: facts.map(f => ({ title: f.name, value: f.value })) }] : []),
        ],
      },
    }],
  };
}

async function sendTeams(cfg, msg) {
  if (!cfg?.enabled || !cfg?.webhook_url) return;
  await postJSON(cfg.webhook_url, teamsPayload(cfg.webhook_url, msg));
}

// ── Webex Bot API ────────────────────────────────────────────────────────────
function webexMarkdown(msg) {
  return `## ${msg.title}\n${msg.body}${msg.facts?.length
    ? '\n\n' + msg.facts.map(f => `**${f.name}:** ${f.value}`).join('  \n')
    : ''}`;
}

async function sendWebex(cfg, msg, engineerEmail) {
  if (!cfg?.enabled || !cfg?.bot_token) return;

  const headers = { Authorization: `Bearer ${cfg.bot_token}` };
  const markdown = webexMarkdown(msg);
  const url = 'https://webexapis.com/v1/messages';
  const sends = [];

  // Direct message to engineer
  if ((cfg.mode === 'direct' || cfg.mode === 'both') && engineerEmail) {
    sends.push(postJSON(url, { toPersonEmail: engineerEmail, markdown }, headers));
  }

  // Team Space / Room
  if ((cfg.mode === 'space' || cfg.mode === 'both') && cfg.space_id) {
    sends.push(postJSON(url, { roomId: cfg.space_id, markdown }, headers));
  }

  const results = await Promise.allSettled(sends);
  const failed = results.find(r => r.status === 'rejected');
  if (failed) throw failed.reason;
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
        const today = (await db.prepare('SELECT app_today() AS d').get()).d;
        try {
          const exists = await db.prepare(
            `SELECT 1 FROM notifications WHERE user_id = ? AND link = ? AND substr(created_at,1,10) = ?`
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

      // A submitted report goes to managers, so never DM the submitting engineer.
      const dmEmail = event === 'report.submitted' ? null : data.engineer_email;
      const results = await Promise.allSettled([
        sendTeams(settings.teams, msg),
        sendWebex(settings.webex, msg, dmEmail),
      ]);
      results.forEach((r, i) => {
        if (r.status === 'rejected') console.error(`[${i ? 'Webex' : 'Teams'} notify]`, r.reason?.message);
      });
    } catch (e) {
      console.error('[notify]', e.message);
    }
  });
}

/** sendTest — used by the Admin "Test" button; rejects with the real delivery error. */
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
    if (!settings.teams?.webhook_url) throw new Error('Enter the Teams webhook URL first');
    await sendTeams({ ...settings.teams, enabled: true }, msg);
    return { ok: true };
  } else if (platform === 'webex') {
    const w = settings.webex || {};
    if (!w.bot_token) throw new Error('Enter the Webex bot token first');
    const dm = (w.mode === 'direct' || w.mode === 'both') && w.test_email;
    const space = (w.mode === 'space' || w.mode === 'both') && w.space_id;
    if (!dm && !space) throw new Error('Set a test email (direct) or a space ID (space) to send the test to');
    await sendWebex({ ...w, enabled: true }, msg, w.test_email || null);
    return { ok: true };
  }
  throw new Error('Unknown platform');
}

module.exports = { notify, sendTest, teamsPayload, isLegacyTeamsUrl, webexMarkdown, postJSON, _setTransport };
