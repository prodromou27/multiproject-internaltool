import { useState } from 'react';

/* ── Widget definitions per role ─────────────────────────── */
export const WIDGET_DEFS = {
  manager: [
    // The project counts repeat what "Where attention is needed" and Insights show.
    { id: 'stat_cards',        label: 'Stats Overview', hiddenByDefault: true },
    { id: 'insights',          label: 'Insights: charts and what needs attention' },
    { id: 'project_health',    label: 'Project Health (RAG)'         },
    // Insights shows tasks and engineers' work in more detail, so this starts hidden.
    { id: 'task_overview',     label: 'Task Overview & Workload', hiddenByDefault: true },
    { id: 'pending_closure',   label: 'Pending Closure Approvals'    },
    { id: 'incomplete_visits', label: 'Incomplete Maintenance Visits' },
    { id: 'mv_review',         label: 'Reports to Approve for PM'    },
    { id: 'mv_this_month',     label: 'Visits This Month'            },
    // Full lists live on the Projects and Tasks pages; available here on request.
    { id: 'projects',          label: 'Active Projects', hiddenByDefault: true },
    { id: 'tasks',             label: 'Open Tasks', hiddenByDefault: true },
  ],
  engineer: [
    { id: 'stat_cards',        label: 'Stats Overview', hiddenByDefault: true },
    { id: 'due_week',          label: 'Due This Week'                },
    // Renders nothing (see engineerWidget's default-null pattern) unless
    // your team is the responsible team for at least one managed customer —
    // most engineers won't see this, which is deliberate, not a bug.
    { id: 'managed_customers', label: 'My Managed Customers'         },
    { id: 'pending_reports',   label: 'Reports Pending (→ Mgmt)'    },
    { id: 'mv_this_month',     label: 'Visits This Month'            },
    // My Work has the task board; these lists are available on request.
    { id: 'projects',          label: 'My Projects', hiddenByDefault: true },
    { id: 'tasks',             label: 'My Open Tasks', hiddenByDefault: true },
  ],
  planner: [
    { id: 'stat_cards',        label: 'Stats Overview'               },
    { id: 'upcoming_visits',   label: 'Upcoming Visits'              },
  ],
  pm: [
    { id: 'stat_cards',        label: 'Stats Overview'               },
    { id: 'pm_visits',         label: 'Visits Awaiting Completion'   },
    { id: 'projects',          label: 'All Active Projects'          },
  ],
};

/* ── Widget preferences — localStorage, per user+role ──────── */
// Raised when widgets become hidden by default, so layouts saved before then
// hide them once too; the person can show them again from Customize.
const LAYOUT_VERSION = 2;
const HIDDEN_IN_VERSION_2 = ['stat_cards', 'projects', 'tasks'];

export function useWidgetPrefs(userId, role) {
  const storageKey = `dash_widgets_${userId}_${role}`;
  const defs       = WIDGET_DEFS[role] ?? WIDGET_DEFS.engineer;
  const defaultIds = defs.map(d => d.id);
  const defaultHidden = defs.filter(d => d.hiddenByDefault).map(d => d.id);

  const [prefs, setPrefsState] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (saved?.order) {
        const valid   = saved.order.filter(id => defaultIds.includes(id));
        // Widgets added since the layout was saved go where they belong by default, not at the end.
        const order = [...valid];
        defaultIds.forEach((id, index) => { if (!order.includes(id)) order.splice(Math.min(index, order.length), 0, id); });
        const hidden = (saved.hidden ?? []).filter(id => defaultIds.includes(id));
        if ((saved.version ?? 1) < LAYOUT_VERSION) defaultHidden.filter(id => HIDDEN_IN_VERSION_2.includes(id)).forEach(id => { if (!hidden.includes(id)) hidden.push(id); });
        return { order, hidden, version: LAYOUT_VERSION };
      }
    } catch {}
    return { order: defaultIds, hidden: defaultHidden, version: LAYOUT_VERSION };
  });

  function persist(p) {
    setPrefsState(p);
    try { localStorage.setItem(storageKey, JSON.stringify(p)); } catch {}
  }

  return {
    prefs,
    defs,
    isVisible: id => !prefs.hidden.includes(id),
    toggle:    id => persist({
      ...prefs,
      hidden: prefs.hidden.includes(id)
        ? prefs.hidden.filter(h => h !== id)
        : [...prefs.hidden, id],
    }),
    reorder: (from, to) => {
      const o = [...prefs.order];
      o.splice(to, 0, o.splice(from, 1)[0]);
      persist({ ...prefs, order: o });
    },
    reset: () => persist({ order: defaultIds, hidden: defaultHidden, version: LAYOUT_VERSION }),
  };
}
