import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import {
  Search, X, FolderOpen, CheckSquare, Wrench, Building2,
  AlertTriangle, ChevronDown, ChevronUp, Zap, User,
  Calendar, Clock, ArrowRight,
} from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../App';
import { fmtDate, StatusBadge, PriorityBadge } from '../components/Shared';

// ─────────────────────────────────────────────────────────────────────────────
// Natural-language query parser
// Returns { filters, chips, textQ }
// ─────────────────────────────────────────────────────────────────────────────
function parseQuery(raw, users, customers) {
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
    chips.push({ key: 'status', label: 'Pending Closure', color: '#b45309', bg: '#fef3c7' });
    strip(/\bpending[ -]?(approv(al|ed)|clos(ure|ed)?)\b/g, /\bawaiting[ -]?approv(al|ed)\b/g);
  } else if (/\bclos(ed|ure)?\b/.test(s)) {
    filters.status = 'closed';
    chips.push({ key: 'status', label: 'Closed', color: '#6b7280', bg: '#f9fafb' });
    strip(/\bclos(ed|ure)?\b/g);
  } else if (/\bon[ -]?hold\b/.test(s)) {
    filters.status = 'on_hold';
    chips.push({ key: 'status', label: 'On Hold', color: '#6b7280', bg: '#f1f5f9' });
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
    chips.push({ key: 'overdue', label: 'Overdue', color: '#dc2626', bg: '#fef2f2' });
    strip(/\boverdue\b/g, /\bpast.due\b/g);
  }

  // ── Priority ──────────────────────────────────────────────────────────────
  if (/\bhigh[ -]?priority\b|\burgent\b|\bcritical\b/.test(s)) {
    filters.priority = 'high';
    chips.push({ key: 'priority', label: 'High Priority', color: '#dc2626', bg: '#fef2f2' });
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
    chips.push({ key: 'unassigned', label: 'Unassigned', color: '#6b7280', bg: '#f1f5f9' });
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

// ─────────────────────────────────────────────────────────────────────────────
// Result cards
// ─────────────────────────────────────────────────────────────────────────────
const STATUS_BG = {
  active: '#ecfdf5', on_hold: '#f1f5f9', pending_closure: '#fef3c7', closed: '#f9fafb',
  open: '#eff6ff', in_progress: '#eff6ff', done: '#ecfdf5', cancelled: '#f9fafb',
  scheduled: '#eff6ff', completed: '#ecfdf5',
};
const STATUS_COLOR = {
  active: '#059669', on_hold: '#6b7280', pending_closure: '#b45309', closed: '#6b7280',
  open: '#2563eb', in_progress: '#2563eb', done: '#059669', cancelled: '#6b7280',
  scheduled: '#2563eb', completed: '#059669',
};
const STATUS_LABEL = {
  active: 'Active', on_hold: 'On Hold', pending_closure: 'Pending Closure', closed: 'Closed',
  open: 'Open', in_progress: 'In Progress', done: 'Done', cancelled: 'Cancelled',
  scheduled: 'Scheduled', completed: 'Completed',
};
const PRIORITY_COLOR = { high: '#dc2626', medium: '#d97706', low: '#16a34a' };

function SBadge({ s }) {
  if (!s) return null;
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
      background: STATUS_BG[s] || '#f1f5f9',
      color: STATUS_COLOR[s] || '#6b7280',
    }}>{STATUS_LABEL[s] || s}</span>
  );
}

function PBadge({ p }) {
  if (!p) return null;
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
      background: p === 'high' ? '#fef2f2' : p === 'medium' ? '#fffbeb' : '#ecfdf5',
      color: PRIORITY_COLOR[p] || '#6b7280',
    }}>
      {p === 'high' ? '↑' : p === 'medium' ? '→' : '↓'} {p}
    </span>
  );
}

function ProjectCard({ item, navigate }) {
  const today = new Date().toISOString().slice(0, 10);
  const od = item.deadline && item.deadline < today && item.status !== 'closed';
  const pct = item.task_count > 0 ? Math.round((item.done_count / item.task_count) * 100) : null;

  return (
    <div className="result-card" onClick={() => navigate(`/projects/${item.id}`)}>
      <div className="result-card-icon" style={{ background: '#f5f3ff', color: '#7c3aed' }}>
        <FolderOpen size={16} />
      </div>
      <div className="result-card-body">
        <div className="result-card-title">{item.title}</div>
        <div className="result-card-meta">
          {item.customer_name && <span><Building2 size={11} /> {item.customer_name}</span>}
          {item.deadline && (
            <span style={{ color: od ? '#dc2626' : 'inherit' }}>
              <Calendar size={11} /> {fmtDate(item.deadline)}{od ? ' · Overdue' : ''}
            </span>
          )}
          {pct !== null && <span>{pct}% tasks done ({item.done_count}/{item.task_count})</span>}
        </div>
      </div>
      <div className="result-card-badges">
        <SBadge s={item.status} />
        <PBadge p={item.priority} />
      </div>
    </div>
  );
}

function TaskCard({ item, navigate }) {
  const today = new Date().toISOString().slice(0, 10);
  const od = item.deadline && item.deadline < today && !['done', 'cancelled'].includes(item.status);

  return (
    <div className="result-card" onClick={() => item.project_id && navigate(`/projects/${item.project_id}`)}>
      <div className="result-card-icon" style={{ background: '#eff6ff', color: '#2563eb' }}>
        <CheckSquare size={16} />
      </div>
      <div className="result-card-body">
        <div className="result-card-title">{item.title}</div>
        <div className="result-card-meta">
          {item.project_title && <span><FolderOpen size={11} /> {item.project_title}</span>}
          {item.customer_name && <span><Building2 size={11} /> {item.customer_name}</span>}
          {item.assigned_to_name
            ? <span><User size={11} /> {item.assigned_to_name}</span>
            : <span style={{ color: '#9ca3af' }}>Unassigned</span>}
          {item.deadline && (
            <span style={{ color: od ? '#dc2626' : 'inherit' }}>
              <Clock size={11} /> {fmtDate(item.deadline)}{od ? ' · Overdue' : ''}
            </span>
          )}
          {item.is_adhoc ? <span style={{ color: '#7c3aed', fontSize: 10, fontWeight: 700 }}>AD-HOC</span> : null}
        </div>
      </div>
      <div className="result-card-badges">
        <SBadge s={item.status} />
        <PBadge p={item.priority} />
      </div>
    </div>
  );
}

function MVCard({ item, navigate }) {
  const today = new Date().toISOString().slice(0, 10);
  const od = item.scheduled_date < today && !['completed', 'cancelled'].includes(item.status);
  const reportLabel = item.report_sent_to_customer ? 'Sent to PM'
    : item.report_sent ? 'Report Complete' : 'Report Pending';
  const reportColor = item.report_sent_to_customer ? '#059669'
    : item.report_sent ? '#2563eb' : '#d97706';

  return (
    <div className="result-card" onClick={() => navigate('/maintenance-visits')}>
      <div className="result-card-icon" style={{ background: '#fffbeb', color: '#d97706' }}>
        <Wrench size={16} />
      </div>
      <div className="result-card-body">
        <div className="result-card-title">{item.title}</div>
        <div className="result-card-meta">
          <span><Building2 size={11} /> {item.customer_name}</span>
          <span style={{ color: od ? '#dc2626' : 'inherit' }}>
            <Calendar size={11} /> {fmtDate(item.scheduled_date)}{od ? ' · Overdue' : ''}
          </span>
          {item.engineer_names && <span><User size={11} /> {item.engineer_names}</span>}
        </div>
      </div>
      <div className="result-card-badges">
        <SBadge s={item.status} />
        <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: item.report_sent_to_customer ? '#ecfdf5' : item.report_sent ? '#eff6ff' : '#fef3c7', color: reportColor }}>{reportLabel}</span>
      </div>
    </div>
  );
}

function CustomerCard({ item, navigate }) {
  return (
    <div className="result-card" onClick={() => navigate('/customers')}>
      <div className="result-card-icon" style={{ background: '#ecfdf5', color: '#059669' }}>
        <Building2 size={16} />
      </div>
      <div className="result-card-body">
        <div className="result-card-title">{item.name}</div>
        <div className="result-card-meta">
          {item.contact_name && <span><User size={11} /> {item.contact_name}</span>}
          {item.contact_email && <span>{item.contact_email}</span>}
          {item.contact_phone && <span>{item.contact_phone}</span>}
          <span><FolderOpen size={11} /> {item.project_count} project{item.project_count !== 1 ? 's' : ''}</span>
          <span><Wrench size={11} /> {item.visit_count} visit{item.visit_count !== 1 ? 's' : ''}</span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Example queries
// ─────────────────────────────────────────────────────────────────────────────
const EXAMPLES = [
  { label: 'Open projects',                   q: 'open projects' },
  { label: 'Overdue tasks',                   q: 'overdue tasks' },
  { label: 'High priority tasks',             q: 'high priority tasks' },
  { label: 'Unassigned tasks',                q: 'unassigned tasks' },
  { label: 'Projects pending approval',       q: 'projects pending approval' },
  { label: 'Reports not sent',                q: 'maintenance visits reports not sent' },
  { label: 'Visits awaiting approval',        q: 'visits awaiting approval' },
  { label: 'Closed projects',                 q: 'closed projects' },
  { label: 'My tasks',                        q: 'my tasks' },
  { label: 'In progress tasks',               q: 'tasks in progress' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Advanced filter panel
// ─────────────────────────────────────────────────────────────────────────────
function AdvancedFilters({ filters, setFilters, users, customers, isManager }) {
  const engineers = users.filter(u => u.role === 'engineer');
  const set = (k, v) => setFilters(f => ({ ...f, [k]: v }));

  return (
    <div style={{
      background: 'var(--gray-50)', border: '1px solid var(--gray-200)',
      borderRadius: 10, padding: 16, display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12,
    }}>
      {/* Entity */}
      <div className="form-group" style={{ margin: 0 }}>
        <label style={{ fontSize: 11 }}>Type</label>
        <select value={filters.entity || 'all'} onChange={e => set('entity', e.target.value)}>
          <option value="all">All types</option>
          <option value="projects">Projects</option>
          <option value="tasks">Tasks</option>
          <option value="mv">Maintenance Visits</option>
          {isManager && <option value="customers">Customers</option>}
        </select>
      </div>

      {/* Status */}
      <div className="form-group" style={{ margin: 0 }}>
        <label style={{ fontSize: 11 }}>Status</label>
        <select value={filters.status || ''} onChange={e => set('status', e.target.value)}>
          <option value="">Any status</option>
          <optgroup label="Projects">
            <option value="active">Active</option>
            <option value="on_hold">On Hold</option>
            <option value="pending_closure">Pending Closure</option>
            <option value="closed">Closed</option>
          </optgroup>
          <optgroup label="Tasks">
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="done">Done</option>
            <option value="cancelled">Cancelled</option>
          </optgroup>
          <optgroup label="Visits">
            <option value="scheduled">Scheduled</option>
            <option value="completed">Completed</option>
          </optgroup>
        </select>
      </div>

      {/* Priority */}
      <div className="form-group" style={{ margin: 0 }}>
        <label style={{ fontSize: 11 }}>Priority</label>
        <select value={filters.priority || ''} onChange={e => set('priority', e.target.value)}>
          <option value="">Any priority</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>

      {/* Customer */}
      {isManager && customers.length > 0 && (
        <div className="form-group" style={{ margin: 0 }}>
          <label style={{ fontSize: 11 }}>Customer</label>
          <select value={filters.customer_id || ''} onChange={e => set('customer_id', e.target.value)}>
            <option value="">Any customer</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}

      {/* Engineer */}
      {isManager && engineers.length > 0 && (
        <div className="form-group" style={{ margin: 0 }}>
          <label style={{ fontSize: 11 }}>Assigned to</label>
          <select value={filters.engineer_id || ''} onChange={e => set('engineer_id', e.target.value)}>
            <option value="">Anyone</option>
            {engineers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
      )}

      {/* Report status */}
      <div className="form-group" style={{ margin: 0 }}>
        <label style={{ fontSize: 11 }}>Report Status</label>
        <select value={filters.report_status || ''} onChange={e => set('report_status', e.target.value)}>
          <option value="">Any</option>
          <option value="pending">Report Pending</option>
          <option value="complete">Report Complete</option>
          <option value="sent_to_pm">Sent to PM</option>
        </select>
      </div>

      {/* Date range */}
      <div className="form-group" style={{ margin: 0 }}>
        <label style={{ fontSize: 11 }}>From Date</label>
        <input type="date" value={filters.date_from || ''} onChange={e => set('date_from', e.target.value)} />
      </div>
      <div className="form-group" style={{ margin: 0 }}>
        <label style={{ fontSize: 11 }}>To Date</label>
        <input type="date" value={filters.date_to || ''} onChange={e => set('date_to', e.target.value)} />
      </div>

      {/* Boolean toggles */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'flex-end' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', userSelect: 'none' }}>
          <input type="checkbox" checked={!!filters.overdue} onChange={e => set('overdue', e.target.checked ? '1' : '')} style={{ width: 'auto' }} />
          Overdue only
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', userSelect: 'none' }}>
          <input type="checkbox" checked={!!filters.unassigned} onChange={e => set('unassigned', e.target.checked ? '1' : '')} style={{ width: 'auto' }} />
          Unassigned only
        </label>
        {isManager && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', userSelect: 'none' }}>
            <input type="checkbox" checked={!!filters.my_tasks} onChange={e => set('my_tasks', e.target.checked ? '1' : '')} style={{ width: 'auto' }} />
            My items only
          </label>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────
export default function SearchPage() {
  const { user } = useAuth();
  const isManager = user.role === 'manager';
  const location  = useLocation();
  const navigate  = useNavigate();
  const inputRef  = useRef(null);

  // Seed query from URL ?q=
  const initQ = new URLSearchParams(location.search).get('q') || '';
  const [query,        setQuery]        = useState(initQ);
  const [chips,        setChips]        = useState([]);
  const [parsedFilters, setParsedFilters] = useState({});
  const [manualFilters, setManualFilters] = useState({ entity: 'all' });
  const [results,      setResults]      = useState(null);
  const [loading,      setLoading]      = useState(false);
  const [activeTab,    setActiveTab]    = useState('all');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [users,        setUsers]        = useState([]);
  const [customers,    setCustomers]    = useState([]);

  // Load users + customers for parser
  useEffect(() => {
    api.users().then(setUsers).catch(() => {});
    if (isManager) api.customers().then(setCustomers).catch(() => {});
  }, []);

  // Auto-focus on mount
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Parse query whenever text, users, or customers change
  useEffect(() => {
    if (!query.trim()) {
      setChips([]);
      setParsedFilters({});
      return;
    }
    const { filters, chips: c } = parseQuery(query, users, customers);
    setChips(c);
    setParsedFilters(filters);
  }, [query, users, customers]);

  // Debounced search — fires on parsed filters + manual filter changes
  const doSearch = useCallback(async (merged) => {
    // Need at least a query or one active filter
    const hasInput = query.trim().length >= 1 || Object.values(merged).some(v => v && v !== 'all');
    if (!hasInput) { setResults(null); return; }

    setLoading(true);
    try {
      const data = await api.smartSearch(merged);
      setResults(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    const combined = { ...parsedFilters, ...Object.fromEntries(Object.entries(manualFilters).filter(([, v]) => v && v !== 'all')) };
    const t = setTimeout(() => doSearch(combined), 300);
    return () => clearTimeout(t);
  }, [parsedFilters, manualFilters, doSearch]);

  // Remove a chip → clear that filter from manual override
  function removeChip(key) {
    const next = { ...parsedFilters };
    delete next[key];
    setParsedFilters(next);
    // Also clear from manual filters
    setManualFilters(f => {
      const n = { ...f };
      if (key === 'entity')        n.entity = 'all';
      if (key === 'status')        delete n.status;
      if (key === 'overdue')       delete n.overdue;
      if (key === 'priority')      delete n.priority;
      if (key === 'customer_id')   delete n.customer_id;
      if (key === 'engineer_id')   delete n.engineer_id;
      if (key === 'report_status') delete n.report_status;
      if (key === 'my_tasks')      delete n.my_tasks;
      if (key === 'unassigned')    delete n.unassigned;
      return n;
    });
  }

  function clearAll() {
    setQuery('');
    setChips([]);
    setParsedFilters({});
    setManualFilters({ entity: 'all' });
    setResults(null);
    inputRef.current?.focus();
  }

  const total     = results ? (results.projects?.length || 0) + (results.tasks?.length || 0) + (results.mv?.length || 0) + (results.customers?.length || 0) : 0;
  const hasQuery  = query.trim().length > 0 || Object.values(manualFilters).some(v => v && v !== 'all');
  const tabs      = [
    { key: 'all',       label: 'All',       count: total },
    { key: 'projects',  label: 'Projects',  count: results?.projects?.length  || 0, icon: FolderOpen },
    { key: 'tasks',     label: 'Tasks',     count: results?.tasks?.length     || 0, icon: CheckSquare },
    { key: 'mv',        label: 'Visits',    count: results?.mv?.length        || 0, icon: Wrench },
    ...(isManager ? [{ key: 'customers', label: 'Customers', count: results?.customers?.length || 0, icon: Building2 }] : []),
  ].filter(t => t.key === 'all' || t.count > 0 || (results && total === 0));

  function renderResults() {
    if (!results) return null;
    if (total === 0) {
      return (
        <div className="empty" style={{ marginTop: 40 }}>
          <div className="empty-icon"><Search size={36} strokeWidth={1.2} /></div>
          <p style={{ fontWeight: 600, marginBottom: 4 }}>No results found</p>
          <p style={{ fontSize: 13, color: 'var(--gray-500)' }}>Try adjusting your search or removing some filters</p>
        </div>
      );
    }

    const show = (type) => activeTab === 'all' || activeTab === type;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {show('projects') && results.projects?.length > 0 && (
          <div>
            {activeTab === 'all' && <div className="result-section-label"><FolderOpen size={13} /> Projects ({results.projects.length})</div>}
            {results.projects.map(p => <ProjectCard key={p.id} item={p} navigate={navigate} />)}
          </div>
        )}
        {show('tasks') && results.tasks?.length > 0 && (
          <div>
            {activeTab === 'all' && <div className="result-section-label"><CheckSquare size={13} /> Tasks ({results.tasks.length})</div>}
            {results.tasks.map(t => <TaskCard key={t.id} item={t} navigate={navigate} />)}
          </div>
        )}
        {show('mv') && results.mv?.length > 0 && (
          <div>
            {activeTab === 'all' && <div className="result-section-label"><Wrench size={13} /> Maintenance Visits ({results.mv.length})</div>}
            {results.mv.map(v => <MVCard key={v.id} item={v} navigate={navigate} />)}
          </div>
        )}
        {show('customers') && results.customers?.length > 0 && (
          <div>
            {activeTab === 'all' && <div className="result-section-label"><Building2 size={13} /> Customers ({results.customers.length})</div>}
            {results.customers.map(c => <CustomerCard key={c.id} item={c} navigate={navigate} />)}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="page" style={{ maxWidth: 860, margin: '0 auto' }}>
      {/* Page header */}
      <div style={{ marginBottom: 24 }}>
        <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <Zap size={20} color="var(--primary)" /> Smart Search
        </h1>
        <p style={{ fontSize: 13, color: 'var(--gray-500)', margin: 0 }}>
          Search in plain English — by status, customer, engineer, date and more.
          <span style={{ marginLeft: 8, background: 'var(--gray-100)', border: '1px solid var(--gray-200)', borderRadius: 4, padding: '1px 5px', fontSize: 11, fontFamily: 'monospace', color: 'var(--gray-600)' }}>Ctrl K</span>
        </p>
      </div>

      {/* Search box */}
      <div style={{ position: 'relative', marginBottom: 12 }}>
        <Search size={17} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--gray-400)', pointerEvents: 'none' }} />
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Escape' && clearAll()}
          placeholder='Try: "open projects for Acme", "overdue tasks assigned to John", "reports not sent"…'
          style={{ paddingLeft: 42, paddingRight: query ? 40 : 16, height: 48, fontSize: 15, borderRadius: 12, fontWeight: 400 }}
        />
        {query && (
          <button onClick={clearAll} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-400)', padding: 4, display: 'flex', alignItems: 'center', borderRadius: 4 }}>
            <X size={15} />
          </button>
        )}
      </div>

      {/* Interpretation chips */}
      {chips.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--gray-400)', fontWeight: 600, marginRight: 2 }}>INTERPRETED AS</span>
          {chips.map(chip => (
            <span key={chip.key} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              background: chip.bg, color: chip.color,
              border: `1px solid ${chip.color}33`,
              borderRadius: 20, padding: '3px 10px', fontSize: 12, fontWeight: 600,
            }}>
              {chip.label}
              <button onClick={() => removeChip(chip.key)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: chip.color, padding: 0, display: 'flex', lineHeight: 1, opacity: 0.6 }}>
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Advanced filters toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <button
          onClick={() => setShowAdvanced(v => !v)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: showAdvanced ? 'var(--primary)' : 'none', color: showAdvanced ? '#fff' : 'var(--gray-600)', border: '1px solid ' + (showAdvanced ? 'var(--primary)' : 'var(--gray-200)'), borderRadius: 8, padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
        >
          <Search size={13} /> Filters {showAdvanced ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
        {hasQuery && (
          <button onClick={clearAll} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--gray-400)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <X size={12} /> Clear all
          </button>
        )}
        {loading && <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>Searching…</span>}
        {!loading && results && <span style={{ fontSize: 12, color: 'var(--gray-500)', marginLeft: 'auto' }}>{total} result{total !== 1 ? 's' : ''}</span>}
      </div>

      {showAdvanced && (
        <div style={{ marginBottom: 16 }}>
          <AdvancedFilters filters={{ ...parsedFilters, ...manualFilters }} setFilters={setManualFilters} users={users} customers={customers} isManager={isManager} />
        </div>
      )}

      {/* Examples (shown when no query) */}
      {!hasQuery && !results && (
        <div className="card" style={{ padding: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 12 }}>
            Example searches
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {EXAMPLES.map(ex => (
              <button
                key={ex.q}
                onClick={() => setQuery(ex.q)}
                style={{
                  background: 'var(--gray-50)', border: '1px solid var(--gray-200)',
                  borderRadius: 20, padding: '5px 12px', fontSize: 12, cursor: 'pointer',
                  color: 'var(--gray-700)', fontWeight: 500,
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  transition: 'all .15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.color = 'var(--primary)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--gray-200)'; e.currentTarget.style.color = 'var(--gray-700)'; }}
              >
                <ArrowRight size={11} /> {ex.label}
              </button>
            ))}
          </div>

          {/* Tips */}
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--gray-100)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>Tips</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 24px', fontSize: 12, color: 'var(--gray-600)' }}>
              {[
                ['"open projects for Acme"',         'Filter by customer + status'],
                ['"overdue tasks assigned to John"',  'Filter by engineer + overdue'],
                ['"reports not sent"',                'MV report workflow filter'],
                ['"projects pending approval"',       'Closure workflow filter'],
                ['"high priority unassigned tasks"',  'Combine multiple filters'],
                ['"my tasks"',                        'Show your own items'],
              ].map(([ex, desc]) => (
                <div key={ex} style={{ display: 'flex', gap: 6 }}>
                  <code style={{ background: 'var(--gray-100)', borderRadius: 4, padding: '1px 5px', fontSize: 11, flexShrink: 0, cursor: 'pointer', color: 'var(--gray-700)' }} onClick={() => setQuery(ex.replace(/"/g, ''))}>{ex}</code>
                  <span style={{ color: 'var(--gray-400)', fontSize: 11 }}>{desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      {results && total > 0 && (
        <div className="filter-bar" style={{ marginBottom: 12 }}>
          {tabs.map(t => (
            <button
              key={t.key}
              className={'filter-pill' + (activeTab === t.key ? ' active' : '')}
              onClick={() => setActiveTab(t.key)}
            >
              {t.label}{t.key !== 'all' ? ` (${t.count})` : ` (${total})`}
            </button>
          ))}
        </div>
      )}

      {/* Results */}
      {renderResults()}
    </div>
  );
}
