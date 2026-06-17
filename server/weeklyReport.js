/**
 * Weekly Status Report — data gathering + HTML email builder.
 */
const db         = require('./db');
const { sendEmail } = require('./email');

// ── Date helpers ─────────────────────────────────────────────────────────────
function fmtDate(str) {
  if (!str) return '—';
  const d = new Date(str + (str.length === 10 ? 'T00:00:00' : ''));
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function isOverdue(str) {
  if (!str) return false;
  return new Date(str + 'T23:59:59') < new Date();
}
function daysDiff(str) {
  if (!str) return null;
  return Math.round((new Date() - new Date(str + 'T00:00:00')) / 86400000);
}

// ── Gather all report data ────────────────────────────────────────────────────
async function gatherReportData() {
  const now        = new Date();
  const todayStr   = now.toISOString().slice(0, 10);
  const past1Str   = new Date(now - 1  * 86400000).toISOString().slice(0, 10);
  const past3Str   = new Date(now - 3  * 86400000).toISOString().slice(0, 10);
  const past7Str   = new Date(now - 7  * 86400000).toISOString().slice(0, 10);
  const next7Str   = new Date(now + 7  * 86400000).toISOString().slice(0, 10);
  const next14Str  = new Date(now + 14 * 86400000).toISOString().slice(0, 10);
  // 'YYYY-MM-DD HH:MM:SS' cutoff matching how timestamps are stored
  const past7DateTime = new Date(now - 7 * 86400000).toISOString().slice(0, 19).replace('T', ' ');

  // 1. Projects opened in past 7 days
  const projectsOpened = await db.prepare(`
    SELECT p.id, p.title, p.priority, p.deadline, p.status,
           cu.name AS customer_name, u.name AS created_by_name
    FROM projects p
    LEFT JOIN customers cu ON p.customer_id = cu.id
    LEFT JOIN users u ON p.created_by = u.id
    WHERE date(p.created_at) >= ?
    ORDER BY p.created_at DESC
  `).all(past7Str);

  // 2. Upcoming deadlines (next 14 days) — projects + tasks
  const upcomingProjectDeadlines = await db.prepare(`
    SELECT 'project' AS type, p.id, p.title, p.deadline, p.status, p.priority,
           cu.name AS customer_name, NULL AS assigned_to
    FROM projects p
    LEFT JOIN customers cu ON p.customer_id = cu.id
    WHERE p.deadline IS NOT NULL AND p.deadline >= ? AND p.deadline <= ?
      AND p.status NOT IN ('closed','cancelled')
    ORDER BY p.deadline ASC LIMIT 20
  `).all(todayStr, next14Str);

  const upcomingTaskDeadlines = await db.prepare(`
    SELECT 'task' AS type, t.id, t.title, t.deadline, t.status, t.priority,
           p.title AS customer_name, u.name AS assigned_to
    FROM tasks t
    LEFT JOIN projects p ON t.project_id = p.id
    LEFT JOIN users u ON t.assigned_to = u.id
    WHERE t.deadline IS NOT NULL AND t.deadline >= ? AND t.deadline <= ?
      AND t.status NOT IN ('done','cancelled')
    ORDER BY t.deadline ASC LIMIT 20
  `).all(todayStr, next14Str);

  const upcomingDeadlines = [...upcomingProjectDeadlines, ...upcomingTaskDeadlines]
    .sort((a, b) => (a.deadline > b.deadline ? 1 : -1))
    .slice(0, 30);

  // 3. Open high-priority tasks
  const highPriorityTasks = await db.prepare(`
    SELECT t.id, t.title, t.status, t.deadline, t.created_at,
           p.title AS project_title, u.name AS assigned_to_name,
           cu.name AS customer_name
    FROM tasks t
    LEFT JOIN projects p  ON t.project_id  = p.id
    LEFT JOIN users u     ON t.assigned_to  = u.id
    LEFT JOIN customers cu ON p.customer_id = cu.id
    WHERE t.priority = 'high' AND t.status NOT IN ('done','cancelled')
    ORDER BY t.deadline ASC, t.created_at ASC
    LIMIT 30
  `).all();

  // 4. Maintenance visits this week (past 7 days + next 7 days)
  const maintenanceVisits = await db.prepare(`
    SELECT mv.id, mv.title, mv.status, mv.scheduled_date,
           mv.report_sent, mv.report_sent_to_customer,
           cu.name AS customer_name,
           (SELECT GROUP_CONCAT(u2.name, ', ')
            FROM maintenance_visit_engineers mve2
            JOIN users u2 ON mve2.user_id = u2.id
            WHERE mve2.visit_id = mv.id) AS engineer_names
    FROM maintenance_visits mv
    JOIN customers cu ON mv.customer_id = cu.id
    WHERE mv.scheduled_date >= ? AND mv.scheduled_date <= ?
      AND mv.status != 'cancelled'
    ORDER BY mv.scheduled_date ASC
  `).all(past7Str, next7Str);

  // 5. All reports pending (completed/passed visits without report)
  const reportsPending = await db.prepare(`
    SELECT mv.id, mv.title, mv.scheduled_date,
           cu.name AS customer_name,
           (SELECT GROUP_CONCAT(u2.name, ', ')
            FROM maintenance_visit_engineers mve2
            JOIN users u2 ON mve2.user_id = u2.id
            WHERE mve2.visit_id = mv.id) AS engineer_names
    FROM maintenance_visits mv
    JOIN customers cu ON mv.customer_id = cu.id
    WHERE mv.report_sent = 0 AND mv.status != 'cancelled'
      AND mv.scheduled_date < ?
    ORDER BY mv.scheduled_date ASC
  `).all(todayStr);

  // 6. Engineer workload
  const engineerWorkload = await db.prepare(`
    SELECT u.id, u.name,
           COUNT(CASE WHEN t.status IN ('open','in_progress') THEN 1 END)              AS open_tasks,
           COUNT(CASE WHEN t.status IN ('open','in_progress') AND t.priority='high' THEN 1 END) AS high_tasks,
           COUNT(CASE WHEN t.status='done' AND date(t.updated_at) >= ? THEN 1 END)    AS done_this_week,
           COUNT(CASE WHEN t.deadline < ? AND t.status NOT IN ('done','cancelled') THEN 1 END) AS overdue_tasks,
           COUNT(DISTINCT pa.project_id) AS project_count
    FROM users u
    LEFT JOIN tasks t ON t.assigned_to = u.id
    LEFT JOIN project_assignments pa ON pa.user_id = u.id
    LEFT JOIN projects p ON pa.project_id = p.id AND p.status IN ('active','on_hold')
    WHERE u.role = 'engineer' AND u.active = 1
    GROUP BY u.id, u.name
    ORDER BY open_tasks DESC
  `).all(past7Str, todayStr);

  // 7. Closure approvals pending
  const closurePending = await db.prepare(`
    SELECT p.id, p.title, p.priority, p.deadline, p.closure_requested_at,
           cu.name AS customer_name
    FROM projects p
    LEFT JOIN customers cu ON p.customer_id = cu.id
    WHERE p.status = 'pending_closure'
    ORDER BY p.closure_requested_at ASC
  `).all();

  // 8. New customers this week
  const newCustomers = await db.prepare(`
    SELECT id, name, contact_name, contact_email
    FROM customers
    WHERE date(created_at) >= ?
    ORDER BY created_at DESC
  `).all(past7Str);

  // 9. SLA snapshot. Date-modifier cutoffs (SQLite date('now','-N days')) are
  // computed in JS and passed as parameters since Postgres has no such function.
  const slaSnapshot = {
    mvReportBreaches:   (await db.prepare(`SELECT COUNT(*) AS n FROM maintenance_visits WHERE report_sent=0 AND status!='cancelled' AND scheduled_date < ?`).get(past7Str)).n,
    closureBreaches:    (await db.prepare(`SELECT COUNT(*) AS n FROM projects WHERE status='pending_closure' AND closure_requested_at < ?`).get(past3Str)).n,
    highTaskBreaches:   (await db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE priority='high' AND status NOT IN ('done','cancelled') AND date(created_at) < ?`).get(past1Str)).n,
    staleProjects:      (await db.prepare(`SELECT COUNT(*) AS n FROM projects WHERE status IN ('active','on_hold') AND updated_at < ?`).get(past7DateTime)).n,
  };

  // 10. Summary stats
  const stats = {
    activeProjects:  (await db.prepare(`SELECT COUNT(*) AS n FROM projects WHERE status IN ('active','on_hold')`).get()).n,
    openTasks:       (await db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE status IN ('open','in_progress')`).get()).n,
    overdueProjects: (await db.prepare(`SELECT COUNT(*) AS n FROM projects WHERE deadline < ? AND status NOT IN ('closed','cancelled')`).get(todayStr)).n,
    pendingClosure:  closurePending.length,
  };

  return {
    generatedAt: now,
    period: { from: past7Str, to: next7Str, today: todayStr },
    stats,
    projectsOpened,
    upcomingDeadlines,
    highPriorityTasks,
    maintenanceVisits,
    reportsPending,
    engineerWorkload,
    closurePending,
    newCustomers,
    slaSnapshot,
  };
}

// ── HTML helpers ─────────────────────────────────────────────────────────────
const priorityPill = p => {
  const map = { high: '#fee2e2:#dc2626', medium: '#fef9c3:#b45309', low: '#f0fdf4:#16a34a' };
  const [bg, color] = (map[p] || map.medium).split(':');
  return `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;background:${bg};color:${color}">${p}</span>`;
};
const statusPill = s => {
  const map = {
    active:'#dbeafe:#1d4ed8', on_hold:'#fef9c3:#b45309', pending_closure:'#ede9fe:#6d28d9',
    closed:'#f0fdf4:#15803d', open:'#dbeafe:#1d4ed8', in_progress:'#fef9c3:#b45309',
    done:'#dcfce7:#15803d', scheduled:'#ede9fe:#6d28d9', completed:'#dcfce7:#15803d',
    cancelled:'#f1f5f9:#64748b',
  };
  const [bg, color] = (map[s] || '#f1f5f9:#64748b').split(':');
  const label = s?.replace(/_/g, ' ') || '—';
  return `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;background:${bg};color:${color}">${label}</span>`;
};

const tableHead = (...cols) =>
  `<thead><tr>${cols.map(c => `<th style="background:#f8fafc;text-align:left;padding:8px 10px;font-weight:600;color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid #e2e8f0">${c}</th>`).join('')}</tr></thead>`;

const tdStyle = 'padding:9px 10px;border-bottom:1px solid #f1f5f9;color:#334155;vertical-align:top;font-size:13px';

function sectionWrapper(emoji, title, count, body, accent = '#3b82f6') {
  const badge = count != null
    ? `<span style="margin-left:8px;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;background:${accent}20;color:${accent}">${count}</span>`
    : '';
  return `
  <div style="padding:24px 28px;border-bottom:1px solid #f1f5f9">
    <div style="font-size:15px;font-weight:700;color:#1e293b;margin-bottom:14px">
      ${emoji} ${title}${badge}
    </div>
    ${body}
  </div>`;
}

function emptyNote(msg) {
  return `<p style="color:#94a3b8;font-size:13px;font-style:italic;padding:4px 0">${msg}</p>`;
}

// ── Build full HTML email ─────────────────────────────────────────────────────
function buildReportHtml(data) {
  const { generatedAt, period, stats, projectsOpened, upcomingDeadlines,
    highPriorityTasks, maintenanceVisits, reportsPending,
    engineerWorkload, closurePending, newCustomers, slaSnapshot } = data;

  const fmtGenerated = generatedAt.toLocaleDateString('en-GB', {
    weekday:'long', year:'numeric', month:'long', day:'numeric',
  }) + ' at ' + generatedAt.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });

  // ── Header ─────────────────────────────────────────────────────────────────
  const header = `
  <div style="background:linear-gradient(135deg,#1e40af,#7c3aed);color:white;border-radius:12px 12px 0 0;padding:32px;text-align:center">
    <div style="font-size:28px;font-weight:800;margin-bottom:6px">🏢 Solutions Hub</div>
    <div style="font-size:18px;font-weight:600;margin-bottom:8px">Weekly Status Report</div>
    <div style="font-size:13px;opacity:.85">Generated ${fmtGenerated}</div>
    <div style="font-size:12px;opacity:.7;margin-top:4px">
      Reporting period: ${fmtDate(period.from)} — ${fmtDate(period.to)}
    </div>
  </div>`;

  // ── Top stats bar ──────────────────────────────────────────────────────────
  const statBar = `
  <div style="display:flex;background:white;border-bottom:1px solid #e2e8f0">
    ${[
      { v: stats.activeProjects,  l: 'Active Projects',  c: '#3b82f6' },
      { v: stats.openTasks,       l: 'Open Tasks',       c: '#8b5cf6' },
      { v: stats.overdueProjects, l: 'Overdue Projects', c: '#ef4444' },
      { v: stats.pendingClosure,  l: 'Pending Closure',  c: '#f59e0b' },
    ].map(s => `
      <div style="flex:1;text-align:center;padding:20px 8px;border-right:1px solid #e2e8f0">
        <div style="font-size:32px;font-weight:800;color:${s.c}">${s.v}</div>
        <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-top:4px">${s.l}</div>
      </div>`).join('')}
  </div>`;

  // ── SLA alert strip ────────────────────────────────────────────────────────
  const totalBreaches = slaSnapshot.mvReportBreaches + slaSnapshot.closureBreaches + slaSnapshot.highTaskBreaches;
  const slaStrip = totalBreaches > 0 ? `
  <div style="background:#fef2f2;border-left:4px solid #ef4444;padding:12px 20px;font-size:13px;color:#991b1b">
    ⚠️ <strong>${totalBreaches} SLA breach${totalBreaches !== 1 ? 'es' : ''} detected</strong>
    — ${slaSnapshot.mvReportBreaches} overdue reports · ${slaSnapshot.closureBreaches} closure delays · ${slaSnapshot.highTaskBreaches} high-priority task delays
  </div>` : `
  <div style="background:#f0fdf4;border-left:4px solid #22c55e;padding:12px 20px;font-size:13px;color:#166534">
    ✅ <strong>No SLA breaches</strong> — all metrics are within acceptable ranges
  </div>`;

  // ── Section 1: Projects opened ─────────────────────────────────────────────
  const s1Body = projectsOpened.length === 0
    ? emptyNote('No new projects opened in the past 7 days.')
    : `<table style="width:100%;border-collapse:collapse">
        ${tableHead('Project', 'Customer', 'Priority', 'Deadline', 'Status')}
        <tbody>${projectsOpened.map(p => `<tr>
          <td style="${tdStyle};font-weight:600">${p.title}</td>
          <td style="${tdStyle}">${p.customer_name || '—'}</td>
          <td style="${tdStyle}">${priorityPill(p.priority)}</td>
          <td style="${tdStyle};${isOverdue(p.deadline) ? 'color:#dc2626;font-weight:600' : ''}">${fmtDate(p.deadline)}</td>
          <td style="${tdStyle}">${statusPill(p.status)}</td>
        </tr>`).join('')}</tbody>
      </table>`;
  const sec1 = sectionWrapper('📁', 'Projects Opened This Week', projectsOpened.length, s1Body);

  // ── Section 2: Upcoming deadlines ─────────────────────────────────────────
  const s2Body = upcomingDeadlines.length === 0
    ? emptyNote('No deadlines in the next 14 days.')
    : `<table style="width:100%;border-collapse:collapse">
        ${tableHead('Type', 'Name', 'Deadline', 'Priority', 'Assigned To / Customer')}
        <tbody>${upcomingDeadlines.map(d => `<tr>
          <td style="${tdStyle}"><span style="font-size:11px;font-weight:600;padding:2px 6px;border-radius:6px;background:${d.type==='project'?'#dbeafe':'#ede9fe'};color:${d.type==='project'?'#1d4ed8':'#6d28d9'}">${d.type}</span></td>
          <td style="${tdStyle};font-weight:600">${d.title}</td>
          <td style="${tdStyle};${isOverdue(d.deadline) ? 'color:#dc2626;font-weight:700' : 'color:#0f172a'}">${fmtDate(d.deadline)}${isOverdue(d.deadline) ? ' ⚠️' : ''}</td>
          <td style="${tdStyle}">${priorityPill(d.priority)}</td>
          <td style="${tdStyle};color:#64748b">${d.assigned_to || d.customer_name || '—'}</td>
        </tr>`).join('')}</tbody>
      </table>`;
  const sec2 = sectionWrapper('📅', 'Upcoming Deadlines (Next 14 Days)', upcomingDeadlines.length, s2Body, '#8b5cf6');

  // ── Section 3: High-priority tasks ────────────────────────────────────────
  const s3Body = highPriorityTasks.length === 0
    ? emptyNote('No open high-priority tasks. 🎉')
    : `<table style="width:100%;border-collapse:collapse">
        ${tableHead('Task', 'Project', 'Assigned To', 'Status', 'Deadline')}
        <tbody>${highPriorityTasks.map(t => `<tr>
          <td style="${tdStyle};font-weight:600">${t.title}</td>
          <td style="${tdStyle};color:#64748b;font-size:12px">${t.project_title || '—'}</td>
          <td style="${tdStyle}">${t.assigned_to_name || '<span style="color:#dc2626">Unassigned</span>'}</td>
          <td style="${tdStyle}">${statusPill(t.status)}</td>
          <td style="${tdStyle};${isOverdue(t.deadline) ? 'color:#dc2626;font-weight:700' : ''}">${fmtDate(t.deadline)}${isOverdue(t.deadline) ? ' ⚠️' : ''}</td>
        </tr>`).join('')}</tbody>
      </table>`;
  const sec3 = sectionWrapper('🔴', 'Open High-Priority Tasks', highPriorityTasks.length, s3Body, '#ef4444');

  // ── Section 4: Maintenance visits ─────────────────────────────────────────
  const s4Body = maintenanceVisits.length === 0
    ? emptyNote('No maintenance visits in the reporting period.')
    : `<table style="width:100%;border-collapse:collapse">
        ${tableHead('Visit', 'Customer', 'Date', 'Engineers', 'Report')}
        <tbody>${maintenanceVisits.map(v => {
          const reportLabel = v.report_sent_to_customer
            ? '<span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;background:#dcfce7;color:#15803d">Sent to PM</span>'
            : v.report_sent
              ? '<span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;background:#dbeafe;color:#1d4ed8">Report Complete</span>'
              : '<span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;background:#fef9c3;color:#b45309">Pending</span>';
          return `<tr>
            <td style="${tdStyle};font-weight:600">${v.title}</td>
            <td style="${tdStyle}">${v.customer_name}</td>
            <td style="${tdStyle};${isOverdue(v.scheduled_date) && v.status==='scheduled' ? 'color:#dc2626;font-weight:700' : ''}">${fmtDate(v.scheduled_date)}</td>
            <td style="${tdStyle};color:#64748b;font-size:12px">${v.engineer_names || '—'}</td>
            <td style="${tdStyle}">${reportLabel} ${statusPill(v.status)}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>`;
  const sec4 = sectionWrapper('🔧', 'Maintenance Visits (±7 Days)', maintenanceVisits.length, s4Body, '#f59e0b');

  // ── Section 5: Reports pending ─────────────────────────────────────────────
  const s5Body = reportsPending.length === 0
    ? emptyNote('All visit reports have been submitted. ✅')
    : `<table style="width:100%;border-collapse:collapse">
        ${tableHead('Visit', 'Customer', 'Scheduled Date', 'Engineers', 'Days Overdue')}
        <tbody>${reportsPending.map(r => {
          const days = daysDiff(r.scheduled_date);
          return `<tr>
            <td style="${tdStyle};font-weight:600">${r.title}</td>
            <td style="${tdStyle}">${r.customer_name}</td>
            <td style="${tdStyle};color:#dc2626;font-weight:600">${fmtDate(r.scheduled_date)}</td>
            <td style="${tdStyle};color:#64748b;font-size:12px">${r.engineer_names || '—'}</td>
            <td style="${tdStyle};color:#dc2626;font-weight:700">${days != null ? days + ' days' : '—'}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>`;
  const sec5 = sectionWrapper('📄', 'Reports Pending', reportsPending.length, s5Body, reportsPending.length > 0 ? '#ef4444' : '#22c55e');

  // ── Section 6: Engineer workload ──────────────────────────────────────────
  const maxOpen = Math.max(1, ...engineerWorkload.map(e => e.open_tasks));
  const s6Body = engineerWorkload.length === 0
    ? emptyNote('No active engineers found.')
    : `<table style="width:100%;border-collapse:collapse">
        ${tableHead('Engineer', 'Open Tasks', 'High Priority', 'Done This Week', 'Overdue', 'Projects')}
        <tbody>${engineerWorkload.map(e => {
          const pct = Math.round((e.open_tasks / maxOpen) * 100);
          return `<tr>
            <td style="${tdStyle};font-weight:600">
              <div style="display:flex;align-items:center;gap:8px">
                <div style="width:26px;height:26px;border-radius:50%;background:linear-gradient(135deg,#3b82f6,#8b5cf6);display:inline-flex;align-items:center;justify-content:center;color:white;font-size:11px;font-weight:700;flex-shrink:0">${(e.name||'?').charAt(0).toUpperCase()}</div>
                ${e.name}
              </div>
            </td>
            <td style="${tdStyle}">
              <div style="display:flex;align-items:center;gap:8px">
                <div style="flex:1;height:6px;background:#e2e8f0;border-radius:3px;min-width:50px">
                  <div style="width:${pct}%;height:100%;background:#3b82f6;border-radius:3px"></div>
                </div>
                <strong>${e.open_tasks}</strong>
              </div>
            </td>
            <td style="${tdStyle};color:${e.high_tasks > 0 ? '#dc2626' : '#64748b'};font-weight:${e.high_tasks > 0 ? '700' : '400'}">${e.high_tasks}</td>
            <td style="${tdStyle};color:#16a34a;font-weight:600">${e.done_this_week}</td>
            <td style="${tdStyle};color:${e.overdue_tasks > 0 ? '#dc2626' : '#64748b'};font-weight:${e.overdue_tasks > 0 ? '700' : '400'}">${e.overdue_tasks}</td>
            <td style="${tdStyle}">${e.project_count}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>`;
  const sec6 = sectionWrapper('👷', 'Engineer Workload', engineerWorkload.length, s6Body, '#8b5cf6');

  // ── Section 7: Closure approvals pending ──────────────────────────────────
  const s7Body = closurePending.length === 0
    ? emptyNote('No projects awaiting closure approval.')
    : `<table style="width:100%;border-collapse:collapse">
        ${tableHead('Project', 'Customer', 'Priority', 'Deadline', 'Requested', 'Days Waiting')}
        <tbody>${closurePending.map(p => {
          const days = p.closure_requested_at ? daysDiff(p.closure_requested_at.slice(0,10)) : null;
          return `<tr>
            <td style="${tdStyle};font-weight:600">${p.title}</td>
            <td style="${tdStyle}">${p.customer_name || '—'}</td>
            <td style="${tdStyle}">${priorityPill(p.priority)}</td>
            <td style="${tdStyle};${isOverdue(p.deadline)?'color:#dc2626;font-weight:600':''}">${fmtDate(p.deadline)}</td>
            <td style="${tdStyle};color:#64748b">${fmtDate(p.closure_requested_at?.slice(0,10))}</td>
            <td style="${tdStyle};color:${days > 3 ? '#dc2626' : '#f59e0b'};font-weight:700">${days != null ? days + ' days' : '—'}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>`;
  const sec7 = sectionWrapper('⏳', 'Closure Approvals Pending', closurePending.length, s7Body, closurePending.length > 0 ? '#f59e0b' : '#22c55e');

  // ── Section 8: SLA status ─────────────────────────────────────────────────
  const slaItems = [
    { label: 'MV reports >7 working days overdue',    value: slaSnapshot.mvReportBreaches,  ok: slaSnapshot.mvReportBreaches === 0 },
    { label: 'Closure approvals >3 working days old', value: slaSnapshot.closureBreaches,   ok: slaSnapshot.closureBreaches  === 0 },
    { label: 'High-priority tasks >1 working day old',value: slaSnapshot.highTaskBreaches,  ok: slaSnapshot.highTaskBreaches === 0 },
    { label: 'Projects with no update in 7 days',     value: slaSnapshot.staleProjects,     ok: slaSnapshot.staleProjects    === 0 },
  ];
  const s8Body = `<table style="width:100%;border-collapse:collapse">
    ${tableHead('SLA Metric', 'Breaches', 'Status')}
    <tbody>${slaItems.map(i => `<tr>
      <td style="${tdStyle}">${i.label}</td>
      <td style="${tdStyle};font-weight:700;color:${i.ok ? '#15803d' : '#dc2626'}">${i.value}</td>
      <td style="${tdStyle}">${i.ok
        ? '<span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;background:#dcfce7;color:#15803d">✅ OK</span>'
        : '<span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;background:#fee2e2;color:#dc2626">⚠️ BREACH</span>'}</td>
    </tr>`).join('')}</tbody>
  </table>`;
  const sec8 = sectionWrapper('📊', 'SLA Compliance Summary', null, s8Body, totalBreaches > 0 ? '#ef4444' : '#22c55e');

  // ── Section 9: New customers ───────────────────────────────────────────────
  const sec9 = newCustomers.length > 0
    ? sectionWrapper('🏢', 'New Customers This Week', newCustomers.length, `
      <table style="width:100%;border-collapse:collapse">
        ${tableHead('Name', 'Contact', 'Email')}
        <tbody>${newCustomers.map(c => `<tr>
          <td style="${tdStyle};font-weight:600">${c.name}</td>
          <td style="${tdStyle}">${c.contact_name || '—'}</td>
          <td style="${tdStyle};color:#3b82f6">${c.contact_email || '—'}</td>
        </tr>`).join('')}</tbody>
      </table>`, '#0891b2')
    : '';

  // ── Footer ─────────────────────────────────────────────────────────────────
  const footer = `
  <div style="text-align:center;padding:24px;color:#94a3b8;font-size:12px;border-top:1px solid #e2e8f0">
    This report was automatically generated by <strong>Solutions Hub</strong> project management system.<br/>
    Generated on ${fmtGenerated}
  </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Solutions Hub — Weekly Status Report</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
  <div style="max-width:720px;margin:0 auto;padding:24px 16px">
    <div style="background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
      ${header}
      ${statBar}
      ${slaStrip}
      ${sec1}
      ${sec2}
      ${sec3}
      ${sec4}
      ${sec5}
      ${sec6}
      ${sec7}
      ${sec8}
      ${sec9}
      ${footer}
    </div>
  </div>
</body>
</html>`;
}

// ── Build subject line ────────────────────────────────────────────────────────
function buildSubject(data) {
  const { stats, slaSnapshot } = data;
  const totalBreaches = slaSnapshot.mvReportBreaches + slaSnapshot.closureBreaches + slaSnapshot.highTaskBreaches;
  const alert = totalBreaches > 0 ? ` ⚠️ ${totalBreaches} SLA breach${totalBreaches > 1 ? 'es' : ''}` : '';
  const week  = new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
  return `[Solutions Hub] Weekly Report — ${week}${alert} | ${stats.activeProjects} projects · ${stats.openTasks} open tasks`;
}

// ── Get report recipients from DB ─────────────────────────────────────────────
async function getRecipients() {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'weekly_report_config'").get();
  if (!row) return [];
  try {
    const cfg = JSON.parse(row.value);
    if (!cfg.recipients?.length) return [];
    // Fetch emails for recipient user IDs
    const users = await db.prepare(
      `SELECT email FROM users WHERE id IN (${cfg.recipients.map(() => '?').join(',')}) AND active = 1`
    ).all(...cfg.recipients);
    return users.map(u => u.email);
  } catch { return []; }
}

// ── Main entry: gather + build + send ─────────────────────────────────────────
async function sendWeeklyReport() {
  console.log('[weekly-report] Generating report…');
  try {
    const data       = await gatherReportData();
    const html       = buildReportHtml(data);
    const subject    = buildSubject(data);
    const recipients = await getRecipients();

    if (!recipients.length) {
      console.log('[weekly-report] No recipients configured — skipping send.');
      return { ok: false, reason: 'No recipients configured' };
    }

    await sendEmail({ to: recipients, subject, html });

    // Record last sent timestamp
    const row = await db.prepare("SELECT value FROM settings WHERE key = 'weekly_report_config'").get();
    if (row) {
      try {
        const cfg = JSON.parse(row.value);
        cfg.last_sent = new Date().toISOString();
        await db.prepare("UPDATE settings SET value = ? WHERE key = 'weekly_report_config'").run(JSON.stringify(cfg));
      } catch(_) {}
    }

    console.log(`[weekly-report] Sent to: ${recipients.join(', ')}`);
    return { ok: true, recipients, subject };
  } catch (e) {
    console.error('[weekly-report] Error:', e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = { gatherReportData, buildReportHtml, buildSubject, sendWeeklyReport };
