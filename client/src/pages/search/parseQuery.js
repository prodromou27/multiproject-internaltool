
// ─────────────────────────────────────────────────────────────────────────────
// Natural-language query parser
// Returns { filters, chips, textQ }
// ─────────────────────────────────────────────────────────────────────────────
export function parseQuery(raw, users, customers) {
  if (!raw.trim()) return { filters: {}, chips: [], textQ: '' };

  let s = raw.toLowerCase();
  const filters = {};
  const chips   = [];

  const strip = (...pats) => pats.forEach(p => { s = s.replace(p, ' '); });

  // Filler words
  strip(/\b(show|all|me|list|find|get|give|the|a|an|of|in|with|that|which|have|has|are|is|and|or|no)\b/g);

  // ── Entity ────────────────────────────────────────────────────────────────
  if (/\btask[s]?\b/.test(s)) {
    filters.entity = 'tasks';
    chips.push({ key: 'entity', label: 'Tasks', color: '#2563eb', bg: '#eff6ff' });
    strip(/\btask[s]?\b/g);
  } else if (/\bproject[s]?\b/.test(s)) {
    filters.entity = 'projects';
    chips.push({ key: 'entity', label: 'Projects', color: '#7c3aed', bg: '#f5f3ff' });
    strip(/\bproject[s]?\b/g);
  } else if (/\b(maintenance[ -]?visit[s]?|visit[s]?|mv)\b/.test(s)) {
    filters.entity = 'mv';
    chips.push({ key: 'entity', label: 'Maintenance Visits', color: '#d97706', bg: '#fffbeb' });
    strip(/\b(maintenance[ -]?visit[s]?|visit[s]?|mv)\b/g);
  } else if (/\bcustomer[s]?\b/.test(s)) {
    filters.entity = 'customers';
    chips.push({ key: 'entity', label: 'Customers', color: '#059669', bg: '#ecfdf5' });
    strip(/\bcustomer[s]?\b/g);
  }

  // ── Status ────────────────────────────────────────────────────────────────
  if (/\bpending[ -]?(approv(al|ed)|clos(ure|ed)?)\b|\bawaiting[ -]?approv(al|ed)\b/.test(s)) {
    filters.status = 'pending_closure';
    if (!filters.entity) filters.entity = 'projects';
    chips.push({ key: 'status', label: 'Pending Closure', color: 'var(--tone-warning-text)', bg: 'var(--warning-light)' });
    strip(/\bpending[ -]?(approv(al|ed)|clos(ure|ed)?)\b/g, /\bawaiting[ -]?approv(al|ed)\b/g);
  } else if (/\bclos(ed|ure)?\b/.test(s)) {
    filters.status = 'closed';
    chips.push({ key: 'status', label: 'Closed', color: '#6b7280', bg: '#f9fafb' });
    strip(/\bclos(ed|ure)?\b/g);
  } else if (/\bon[ -]?hold\b/.test(s)) {
    filters.status = 'on_hold';
    chips.push({ key: 'status', label: 'On Hold', color: '#6b7280', bg: 'var(--gray-100)' });
    strip(/\bon[ -]?hold\b/g);
  } else if (/\bin[ -]?progress\b/.test(s)) {
    filters.status = 'in_progress';
    chips.push({ key: 'status', label: 'In Progress', color: '#2563eb', bg: '#eff6ff' });
    strip(/\bin[ -]?progress\b/g);
  } else if (/\b(done|complet(ed|e)?)\b/.test(s) && filters.entity !== 'mv') {
    filters.status = 'done';
    chips.push({ key: 'status', label: 'Done', color: '#059669', bg: '#ecfdf5' });
    strip(/\b(done|complet(ed|e)?)\b/g);
  } else if (/\bcompleted?\b/.test(s) && filters.entity === 'mv') {
    filters.status = 'completed';
    chips.push({ key: 'status', label: 'Completed', color: '#059669', bg: '#ecfdf5' });
    strip(/\bcompleted?\b/g);
  } else if (/\bcancell?ed?\b/.test(s)) {
    filters.status = 'cancelled';
    chips.push({ key: 'status', label: 'Cancelled', color: '#6b7280', bg: '#f9fafb' });
    strip(/\bcancell?ed?\b/g);
  } else if (/\bscheduled\b/.test(s) && filters.entity === 'mv') {
    filters.status = 'scheduled';
    chips.push({ key: 'status', label: 'Scheduled', color: '#2563eb', bg: '#eff6ff' });
    strip(/\bscheduled\b/g);
  } else if (/\bopen\b|\bactive\b/.test(s)) {
    filters.status = filters.entity === 'tasks' ? 'open' : 'active';
    chips.push({ key: 'status', label: 'Open / Active', color: '#059669', bg: '#ecfdf5' });
    strip(/\bopen\b/g, /\bactive\b/g);
  }

  // ── Overdue ───────────────────────────────────────────────────────────────
  if (/\boverdue\b|\blast\b|\bpast.due\b/.test(s)) {
    filters.overdue = '1';
    chips.push({ key: 'overdue', label: 'Overdue', color: 'var(--tone-danger-text)', bg: 'var(--danger-light)' });
    strip(/\boverdue\b/g, /\bpast.due\b/g);
  }

  // ── Priority ──────────────────────────────────────────────────────────────
  if (/\bhigh[ -]?priority\b|\burgent\b|\bcritical\b/.test(s)) {
    filters.priority = 'high';
    chips.push({ key: 'priority', label: 'High Priority', color: 'var(--tone-danger-text)', bg: 'var(--danger-light)' });
    strip(/\bhigh[ -]?priority\b/g, /\burgent\b/g, /\bcritical\b/g);
  } else if (/\blow[ -]?priority\b/.test(s)) {
    filters.priority = 'low';
    chips.push({ key: 'priority', label: 'Low Priority', color: '#059669', bg: '#ecfdf5' });
    strip(/\blow[ -]?priority\b/g);
  } else if (/\bmedium[ -]?priority\b/.test(s)) {
    filters.priority = 'medium';
    chips.push({ key: 'priority', label: 'Medium Priority', color: '#d97706', bg: '#fffbeb' });
    strip(/\bmedium[ -]?priority\b/g);
  }

  // ── Report status (MV-specific) ───────────────────────────────────────────
  if (/\breport[s]?[ \w]*not[ -]?sent\b|\breport[s]?[ \w]*pending\b/.test(s)) {
    if (!filters.entity) filters.entity = 'mv';
    filters.report_status = 'pending';
    chips.push({ key: 'report_status', label: 'Report Pending', color: '#d97706', bg: '#fffbeb' });
    strip(/\breport[s]?[ \w]*not[ -]?sent\b/g, /\breport[s]?[ \w]*pending\b/g, /\breport[s]?\b/g);
  } else if (/\bsent[ -]?to[ -]?pm\b/.test(s)) {
    if (!filters.entity) filters.entity = 'mv';
    filters.report_status = 'sent_to_pm';
    chips.push({ key: 'report_status', label: 'Sent to PM', color: '#059669', bg: '#ecfdf5' });
    strip(/\bsent[ -]?to[ -]?pm\b/g);
  } else if (/\bawaiting[ -]?(review|approval)\b/.test(s) && (!filters.entity || filters.entity === 'mv')) {
    if (!filters.entity) filters.entity = 'mv';
    filters.report_status = 'complete';
    chips.push({ key: 'report_status', label: 'Report Complete', color: '#2563eb', bg: '#eff6ff' });
    strip(/\bawaiting[ -]?(review|approval)\b/g);
  }

  // ── My items ──────────────────────────────────────────────────────────────
  if (/\bmy[ -]?(tasks?|items?|work)\b/.test(s)) {
    if (!filters.entity) filters.entity = 'tasks';
    filters.my_tasks = '1';
    chips.push({ key: 'my_tasks', label: 'My Items', color: '#7c3aed', bg: '#f5f3ff' });
    strip(/\bmy[ -]?(tasks?|items?|work)\b/g);
  }

  // ── Unassigned ────────────────────────────────────────────────────────────
  if (/\bunassigned\b/.test(s)) {
    filters.unassigned = '1';
    chips.push({ key: 'unassigned', label: 'Unassigned', color: '#6b7280', bg: 'var(--gray-100)' });
    strip(/\bunassigned\b/g);
  }

  // ── Engineer name extraction ───────────────────────────────────────────────
  // Patterns: "assigned to X", "engineer X", "for engineer X"
  const engMatch =
    s.match(/\bassigned[ -]?to\s+([a-z][a-z ]{1,28}?)(?=\s*$|\s+for\b|\s+with\b)/i) ||
    s.match(/\bengineer[:\s]+([a-z][a-z ]{1,28}?)(?=\s*$|\s+for\b)/i);
  if (engMatch) {
    const name = engMatch[1].trim();
    const match = users.find(u => u.name.toLowerCase().includes(name) || name.includes(u.name.toLowerCase().split(' ')[0]));
    if (match) {
      filters.engineer_id = match.id;
      chips.push({ key: 'engineer_id', label: match.name, color: '#7c3aed', bg: '#f5f3ff' });
      strip(new RegExp('\\bassigned[ -]?to\\s+' + name + '\\b', 'i'));
      strip(new RegExp('\\bengineer[:\\s]+' + name + '\\b', 'i'));
    }
  }

  // ── Customer name extraction ───────────────────────────────────────────────
  // Patterns: "for X", "for customer X", "customer: X"
  const custMatch =
    s.match(/\bfor\s+(?:customer\s+)?([a-z][a-z0-9 &,.'-]{1,40}?)(?=\s*$)/i) ||
    s.match(/\bcustomer[:\s]+([a-z][a-z0-9 &,.'-]{1,40}?)(?=\s*$)/i);
  if (custMatch) {
    const name = custMatch[1].trim();
    const match = customers.find(c => c.name.toLowerCase() === name) ||
                  customers.find(c => c.name.toLowerCase().startsWith(name)) ||
                  customers.find(c => c.name.toLowerCase().includes(name));
    if (match) {
      filters.customer_id = match.id;
      chips.push({ key: 'customer_id', label: match.name, color: '#059669', bg: '#ecfdf5' });
      strip(new RegExp('\\bfor\\s+(?:customer\\s+)?' + name + '\\b', 'i'));
    }
  }

  // ── Remaining text → text search ──────────────────────────────────────────
  const cleaned = s.replace(/\s+/g, ' ').trim();
  const textQ   = cleaned.length >= 2 ? cleaned : '';

  return { filters, chips, textQ };
}
