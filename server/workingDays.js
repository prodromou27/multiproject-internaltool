// Count Mon–Fri days from startStr (exclusive) to endStr (inclusive). Dates are pinned to
// midday so daylight-saving changes cannot shift a day.
function workingDaysBetween(startStr, endStr) {
  const start = new Date(startStr.slice(0, 10) + 'T12:00:00');
  const end   = new Date(endStr.slice(0, 10)   + 'T12:00:00');
  if (end <= start) return 0;
  let count = 0;
  const cur = new Date(start);
  cur.setDate(cur.getDate() + 1);
  while (cur <= end) {
    const d = cur.getDay(); // 0=Sun, 6=Sat
    if (d !== 0 && d !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

module.exports = { workingDaysBetween };
