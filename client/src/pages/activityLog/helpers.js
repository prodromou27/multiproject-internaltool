
export const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function todayRange() { const t = iso(new Date()); return [t, t]; }

export function weekRange() {
  const now = new Date(); const day = (now.getDay() + 6) % 7;
  const start = new Date(now); start.setDate(now.getDate() - day);
  const end = new Date(start); end.setDate(start.getDate() + 6);
  return [iso(start), iso(end)];
}

export function monthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return [iso(start), iso(end)];
}

export const RANGE_LABEL = { today: 'today', this_week: 'this week', this_month: 'this month', custom: 'in this range' };

export const BILLABLE_LABELS = {
  included_in_contract: 'Included in Contract', billable: 'Billable', non_billable: 'Non-Billable',
  internal: 'Internal', not_applicable: 'Not Applicable',
};

export const WORK_LOCATION_LABELS = { remote: 'Remote', onsite: 'On-site', internal: 'Internal', hybrid: 'Hybrid' };
