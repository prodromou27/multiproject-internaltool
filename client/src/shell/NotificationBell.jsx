import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckSquare, X, Bell, CheckCheck, Trash2, Briefcase, WrenchIcon, FileText, AtSign } from 'lucide-react';
import { api } from '../api';

/* ── Notification Bell ───────────────────────────────────── */
const NOTIF_ICONS = {
  'task.assigned':    <CheckSquare size={14} color="#3b82f6" />,
  'visit.assigned':   <WrenchIcon  size={14} color="#f59e0b" />,
  'visit.reminder':   <WrenchIcon  size={14} color="#ef4444" />,
  'project.assigned': <Briefcase   size={14} color="#8b5cf6" />,
  'report.submitted': <FileText    size={14} color="#10b981" />,
  'managed_report.submitted': <FileText size={14} color="#f59e0b" />,
  'managed_report.approved':  <FileText size={14} color="#10b981" />,
  'managed_report.rejected':  <FileText size={14} color="#ef4444" />,
  'managed_report.finalized': <FileText size={14} color="#10b981" />,
  'managed_report.reopened':  <FileText size={14} color="#f59e0b" />,
  'mention':          <AtSign      size={14} color="#ec4899" />,
};

function timeSinceNotif(dt) {
  if (!dt) return '';
  const diff = (Date.now() - new Date(dt).getTime()) / 1000;
  if (diff < 60)    return 'just now';
  if (diff < 3600)  return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}

export function NotificationBell() {
  const [notifs, setNotifs]   = useState([]);
  const [unread, setUnread]   = useState(0);
  const [actionRequired,setActionRequired]=useState(0);
  const [filter,setFilter]=useState('all');
  const [page,setPage]=useState(1);
  const [pages,setPages]=useState(1);
  const [open, setOpen]       = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();

  const load = useCallback((nextPage=1,append=false) => {
    api.notifications({ status:filter,page:nextPage,page_size:30 }).then(d => {
      setNotifs(current => append ? [...current,...(d.notifications || [])] : (d.notifications || []));
      setUnread(d.unread || 0);
      setActionRequired(d.action_required || 0);
      setPage(d.page || 1);setPages(d.pages || 1);
    }).catch(() => {});
  }, [filter]);

  // Initial load + poll every 60 s; pause when tab is hidden
  useEffect(() => {
    load();
    let t = setInterval(load, 60000);
    const onVisibility = () => {
      if (document.hidden) {
        clearInterval(t);
      } else {
        load(); // immediate refresh on tab focus
        t = setInterval(load, 60000);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [load]);

  // Close on outside click or Escape (keyboard users had no way to dismiss it)
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', esc); };
  }, []);

  async function markAllRead() {
    await api.markAllNotificationsRead().catch(() => {});
    setNotifs(n => filter==='unread' ? [] : n.map(x => ({ ...x,read:1,read_at:x.read_at || new Date().toISOString() })));
    setUnread(0);
  }

  async function clearAll() {
    await api.clearNotifications().catch(() => {});
    setNotifs([]);
    setUnread(0);
    setActionRequired(0);
  }

  async function dismiss(id, e) {
    e.stopPropagation();
    await api.deleteNotification(id).catch(() => {});
    const item=notifs.find(x => x.id===id);
    setNotifs(n => n.filter(x => x.id !== id));
    if (item && !item.read) setUnread(u => Math.max(0,u-1));
    if (item && ['high','critical'].includes(item.priority) && !item.acknowledged_at) setActionRequired(value => Math.max(0,value-1));
  }

  async function acknowledge(n,e) {
    e.stopPropagation();
    try { await api.acknowledgeNotification(n.id); } catch { return; }
    setNotifs(current => filter==='action_required' ? current.filter(item => item.id!==n.id) : current.map(item => item.id===n.id ? { ...item,read:1,acknowledged_at:new Date().toISOString() } : item));
    if (!n.read) setUnread(value => Math.max(0,value-1));
    setActionRequired(value => Math.max(0,value-1));
  }

  async function clickNotif(n) {
    if (!n.read) {
      await api.markNotificationRead(n.id).catch(() => {});
      setNotifs(prev => prev.map(x => x.id === n.id ? { ...x, read: 1 } : x));
      setUnread(u => Math.max(0, u - 1));
    }
    // Guard against open redirects: only follow absolute same-origin paths (not protocol-relative //host/...)
    if (n.link && /^\/[^/]/.test(n.link)) {
      if (n.link.startsWith('/api/')) window.location.assign(n.link);
      else navigate(n.link);
    }
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      {/* Bell button */}
      <button
        className="topbar-action u-83eb2d8"
        onClick={() => setOpen(o => !o)}
        style={{ color: open ? 'var(--primary)' : 'var(--gray-500)' }}
        aria-label="Notifications"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="u-1c0e4a4">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="topbar-popover notification-popover u-1d4fe15" role="menu" aria-label="Notifications">
          {/* Header */}
          <div className="u-4a42a84">
            <span className="u-af08a6d">
              <Bell size={13} /> Notifications
              {unread > 0 && (
                <span className="u-64a9ece">
                  {unread} new
                </span>
              )}
            </span>
            <div className="flex gap-6">
              {unread > 0 && (
                <button onClick={markAllRead} className="u-059aecf">
                  <CheckCheck size={12} /> Mark all read
                </button>
              )}
              {notifs.length > 0 && (
                <button onClick={clearAll} className="u-3bcf89e">
                  <Trash2 size={12} /> Dismiss all
                </button>
              )}
            </div>
          </div>

          <div className="u-23d8d35">
            {[['all','All'],['unread',`Unread (${unread})`],['action_required',`Action (${actionRequired})`]].map(([value,label]) => <button key={value} type="button" onClick={() => setFilter(value)} className={`btn btn-sm ${filter===value?'btn-primary':'btn-ghost'} u-97445a8`}>{label}</button>)}
          </div>

          {/* List */}
          {notifs.length === 0
            ? (
              <div className="u-76d08c4">
                <Bell size={28} style={{ marginBottom: 8, opacity: .3 }} />
                <div>No notifications yet</div>
              </div>
            )
            : notifs.map(n => (
              <div
                key={n.id}
                onClick={() => clickNotif(n)}
                className="u-eede90f" style={{ cursor: n.link ? 'pointer' : 'default', background: n.read ? 'var(--surface)' : 'var(--highlight)' }}
                onMouseEnter={e => { if (n.link) e.currentTarget.style.background = n.read ? 'var(--gray-50)' : 'var(--highlight-strong)'; }}
                onMouseLeave={e => e.currentTarget.style.background = n.read ? 'var(--surface)' : 'var(--highlight)'}
              >
                <div className="u-fc3d83c" style={{ background: n.read ? 'var(--gray-100)' : 'var(--highlight-strong)' }}>
                  {NOTIF_ICONS[n.type] || <Bell size={14} color="var(--gray-500)" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="u-1cdd083" style={{ fontWeight: n.read ? 500 : 700 }}>{n.title}{['high','critical'].includes(n.priority) && <span className="u-887bf25" style={{ color:n.priority==='critical'?'#dc2626':'#d97706' }}>{n.priority}</span>}</div>
                  {n.body && <div className="u-2bb9ee0">{n.body}</div>}
                  <div className="u-8459551">{timeSinceNotif(n.created_at)}</div>
                  {['high','critical'].includes(n.priority) && !n.acknowledged_at && <button type="button" onClick={e => acknowledge(n,e)} className="u-0a9b857"><CheckCheck size={11} style={{ verticalAlign:'middle',marginRight:3 }} />Acknowledge</button>}
                </div>
                <button onClick={e => dismiss(n.id, e)} className="u-7044ba7"
                  onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                  onMouseLeave={e => e.currentTarget.style.color = 'var(--gray-300)'}
                >
                  <X size={12} />
                </button>
              </div>
            ))
          }
          {page<pages && <div className="u-b203686"><button type="button" className="btn btn-ghost btn-sm" onClick={() => load(page+1,true)}>Load older notifications</button></div>}
        </div>
      )}
    </div>
  );
}
