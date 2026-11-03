/**
 * Runs a job every few hours: every 10 minutes it looks at when the job last ran
 * (as the job recorded it) and runs it when that is `hours` ago or more. A restart
 * therefore never skips a run, and one run never overlaps the next. A run that
 * fails is tried again `hours` later, not every 10 minutes.
 */
const CHECK_MS = 10 * 60 * 1000;

function everyFewHours(name, { hours, lastRunAt, run, firstCheckMs = 90 * 1000, checkMs = CHECK_MS, now = () => Date.now() }) {
  let busy = false, lastAttempt = 0;
  const due = async () => {
    if (busy) return false;
    const recorded = Date.parse((await lastRunAt().catch(() => null)) || '') || 0;
    const last = Math.max(recorded, lastAttempt);
    if (now() - last < hours * 3600 * 1000) return false;
    busy = true; lastAttempt = now();
    try { await run(); } catch (error) { console.error(`[${name}]`, error.message); } finally { busy = false; }
    return true;
  };
  const first = setTimeout(() => { due().catch(() => {}); }, firstCheckMs); first.unref?.();
  const timer = setInterval(() => { due().catch(() => {}); }, checkMs); timer.unref?.();
  return { due, stop: () => { clearTimeout(first); clearInterval(timer); } };
}

module.exports = { everyFewHours };
