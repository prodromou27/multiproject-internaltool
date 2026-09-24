import { useState } from 'react';

/* ── Widget definitions per role ─────────────────────────── */
export const WIDGET_DEFS = {
  manager: [
    { id: 'stat_cards',        label: 'Stats Overview'               },
    { id: 'project_health',    label: 'Project Health (RAG)'         },
    { id: 'task_overview',     label: 'Task Overview & Workload'     },
    { id: 'pending_closure',   label: 'Pending Closure Approvals'    },
    { id: 'incomplete_visits', label: 'Incomplete Maintenance Visits' },
    { id: 'mv_review',         label: 'Reports to Approve for PM'    },
    { id: 'mv_this_month',     label: 'Visits This Month'            },
    { id: 'projects',          label: 'Active Projects'              },
    { id: 'tasks',             label: 'Open Tasks'                   },
  ],
  engineer: [
    { id: 'stat_cards',        label: 'Stats Overview'               },
    { id: 'due_week',          label: 'Due This Week'                },
    // Renders nothing (see engineerWidget's default-null pattern) unless
    // your team is the responsible team for at least one managed customer —
    // most engineers won't see this, which is deliberate, not a bug.
    { id: 'managed_customers', label: 'My Managed Customers'         },
    { id: 'pending_reports',   label: 'Reports Pending (→ Mgmt)'    },
    { id: 'mv_this_month',     label: 'Visits This Month'            },
    { id: 'projects',          label: 'My Projects'                  },
    { id: 'tasks',             label: 'My Open Tasks'                },
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
export function useWidgetPrefs(userId, role) {
  const storageKey = `dash_widgets_${userId}_${role}`;
  const defs       = WIDGET_DEFS[role] ?? WIDGET_DEFS.engineer;
  const defaultIds = defs.map(d => d.id);

  const [prefs, setPrefsState] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (saved?.order) {
        const valid   = saved.order.filter(id => defaultIds.includes(id));
        const missing = defaultIds.filter(id => !valid.includes(id));
        return {
          order:  [...valid, ...missing],
          hidden: (saved.hidden ?? []).filter(id => defaultIds.includes(id)),
        };
      }
    } catch {}
    return { order: defaultIds, hidden: [] };
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
    reset: () => persist({ order: defaultIds, hidden: [] }),
  };
}
