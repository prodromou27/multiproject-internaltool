const iso = date => date.toISOString().slice(0,10);
function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number(value.slice(0,4)) >= 1900 && Number(value.slice(0,4)) <= 9998 && Number.isFinite(Date.parse(value)) && iso(new Date(value)) === value;
}
function planningWeeks(asOf) {
  const monday = new Date(`${asOf}T00:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay()+6)%7);
  return Array.from({ length: 4 }, (_, index) => {
    const start = new Date(monday); start.setUTCDate(start.getUTCDate()+index*7);
    const end = new Date(start); end.setUTCDate(end.getUTCDate()+6);
    return { start: iso(start), end: iso(end) };
  });
}
function capacityForEngineer(engineer, weeks, items, availability) {
  const own = items.filter(item => item.user_id === engineer.id);
  const outside = own.filter(item => !item.date || item.date > weeks.at(-1).end).length;
  const result = weeks.map((week,index) => {
    // Overdue outstanding work belongs to the first planning week, visibly.
    const jobs = own.filter(item => item.date && item.date <= week.end && (index === 0 || item.date >= week.start));
    const known = jobs.filter(item => item.remaining_hours !== null);
    const estimated = Math.round(known.reduce((sum,item) => sum+Number(item.remaining_hours),0)*100)/100;
    const available = availability.find(row => row.user_id === engineer.id && row.week_start === week.start);
    const unknown = jobs.length-known.length;
    return { ...week, item_count: jobs.length, unknown_estimates: unknown, estimated_hours: estimated, available_hours: available ? Number(available.available_hours) : null, availability_version: available?.version ?? 0,
      capacity_percent: !unknown && available && Number(available.available_hours)>0 ? Math.round(estimated/Number(available.available_hours)*1000)/10 : null,
      items: [...jobs].sort((a,b) => Number(b.remaining_hours === null)-Number(a.remaining_hours === null)).slice(0,50), items_total: jobs.length };
  });
  return { ...engineer, outside_window_count: outside, weeks: result };
}
module.exports = { validDate, planningWeeks, capacityForEngineer };
