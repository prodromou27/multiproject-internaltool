import React, { useState, useEffect, useRef, useCallback } from 'react';
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
        className="topbar-action"
        onClick={() => setOpen(o => !o)}
        style={{
          position: 'relative', background: 'none', border: 'none',
          cursor: 'pointer', padding: 6, borderRadius: 8,
          color: open ? 'var(--primary)' : 'var(--gray-500)',
          display: 'flex', alignItems: 'center',
          transition: 'color .15s',
        }}
        aria-label="Notifications"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <Bell size={18} />
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: 2, right: 2,
            background: '#ef4444', color: '#fff',
            fontSize: 9, fontWeight: 800, lineHeight: 1,
            borderRadius: 10, minWidth: 15, height: 15,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '0 3px', border: '2px solid var(--surface)',
          }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="topbar-popover notification-popover" role="menu" aria-label="Notifications" style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0,
          width: 340, maxHeight: 480, overflowY: 'auto',
          background: 'var(--surface)', borderRadius: 12,
          boxShadow: '0 12px 40px rgba(0,0,0,.15)',
          border: '1px solid var(--gray-100)', zIndex: 2000,
        }}>
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 14px', borderBottom: '1px solid var(--gray-100)',
            position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1,
          }}>
            <span style={{ fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Bell size={13} /> Notifications
              {unread > 0 && (
                <span style={{ background: '#ef4444', color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 10, padding: '1px 6px' }}>
                  {unread} new
                </span>
              )}
            </span>
            <div className="flex gap-6">
              {unread > 0 && (
                <button onClick={markAllRead} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: 3, padding: '2px 6px', borderRadius: 4 }}>
                  <CheckCheck size={12} /> Mark all read
                </button>
              )}
              {notifs.length > 0 && (
                <button onClick={clearAll} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--gray-400)', display: 'flex', alignItems: 'center', gap: 3, padding: '2px 6px', borderRadius: 4 }}>
                  <Trash2 size={12} /> Dismiss all
                </button>
              )}
            </div>
          </div>

          <div style={{ display:'flex',gap:6,padding:'8px 12px',borderBottom:'1px solid var(--gray-100)',position:'sticky',top:45,background:'var(--surface)',zIndex:1 }}>
            {[['all','All'],['unread',`Unread (${unread})`],['action_required',`Action (${actionRequired})`]].map(([value,label]) => <button key={value} type="button" onClick={() => setFilter(value)} className={`btn btn-sm ${filter===value?'btn-primary':'btn-ghost'}`} style={{ flex:1 }}>{label}</button>)}
          </div>

          {/* List */}
          {notifs.length === 0
            ? (
              <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--gray-400)', fontSize: 13 }}>
                <Bell size={28} style={{ marginBottom: 8, opacity: .3 }} />
                <div>No notifications yet</div>
              </div>
            )
            : notifs.map(n => (
              <div
                key={n.id}
                onClick={() => clickNotif(n)}
                style={{
                  display: 'flex', gap: 10, padding: '10px 14px',
                  cursor: n.link ? 'pointer' : 'default',
                  background: n.read ? 'var(--surface)' : 'var(--highlight)',
                  borderBottom: '1px solid var(--gray-50)',
                  transition: 'background .1s',
                  alignItems: 'flex-start',
                }}
                onMouseEnter={e => { if (n.link) e.currentTarget.style.background = n.read ? 'var(--gray-50)' : 'var(--highlight-strong)'; }}
                onMouseLeave={e => e.currentTarget.style.background = n.read ? 'var(--surface)' : 'var(--highlight)'}
              >
                <div style={{ width: 28, height: 28, borderRadius: 8, background: n.read ? 'var(--gray-100)' : 'var(--highlight-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                  {NOTIF_ICONS[n.type] || <Bell size={14} color="var(--gray-500)" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div style={{ fontSize: 12, fontWeight: n.read ? 500 : 700, color: 'var(--gray-900)', marginBottom: 2 }}>{n.title}{['high','critical'].includes(n.priority) && <span style={{ marginLeft:6,fontSize:9,textTransform:'uppercase',color:n.priority==='critical'?'#dc2626':'#d97706' }}>{n.priority}</span>}</div>
                  {n.body && <div style={{ fontSize: 11, color: 'var(--gray-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.body}</div>}
                  <div style={{ fontSize: 10, color: 'var(--gray-400)', marginTop: 3 }}>{timeSinceNotif(n.created_at)}</div>
                  {['high','critical'].includes(n.priority) && !n.acknowledged_at && <button type="button" onClick={e => acknowledge(n,e)} style={{ background:'none',border:0,padding:'4px 0 0',fontSize:10,color:'var(--primary)',cursor:'pointer',fontWeight:700 }}><CheckCheck size={11} style={{ verticalAlign:'middle',marginRight:3 }} />Acknowledge</button>}
                </div>
                <button onClick={e => dismiss(n.id, e)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-300)', padding: 2, borderRadius: 4, flexShrink: 0 }}
                  onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                  onMouseLeave={e => e.currentTarget.style.color = 'var(--gray-300)'}
                >
                  <X size={12} />
                </button>
              </div>
            ))
          }
          {page<pages && <div style={{ padding:10,textAlign:'center' }}><button type="button" className="btn btn-ghost btn-sm" onClick={() => load(page+1,true)}>Load older notifications</button></div>}
        </div>
      )}
    </div>
  );
}
