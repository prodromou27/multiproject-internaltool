// Jobs run every few hours (periodic.js): software versions and Grafana devices.
const test = require('node:test');
const assert = require('node:assert/strict');
const { everyFewHours } = require('../periodic');

const HOUR = 3600 * 1000;

test('runs when due, not again before the hours have passed, and after a restart only when the recorded run is old', async () => {
  let clock = Date.parse('2026-10-19T09:00:00Z'), recorded = null, runs = 0;
  const job = everyFewHours('test', { hours: 4, now: () => clock, firstCheckMs: 1e9, checkMs: 1e9,
    lastRunAt: async () => recorded, run: async () => { runs++; recorded = new Date(clock).toISOString(); } });
  assert.equal(await job.due(), true, 'never ran: runs');
  clock += 3 * HOUR;
  assert.equal(await job.due(), false, '3 hours later: not yet');
  clock += 1 * HOUR;
  assert.equal(await job.due(), true, '4 hours later: runs');
  assert.equal(runs, 2);
  job.stop();

  // A restart: the recorded run decides.
  const again = everyFewHours('test', { hours: 4, now: () => clock + HOUR, firstCheckMs: 1e9, checkMs: 1e9, lastRunAt: async () => recorded, run: async () => { runs++; } });
  assert.equal(await again.due(), false, 'ran an hour before the restart');
  again.stop();
});

test('a failing run is tried again hours later, not every check; runs never overlap', async () => {
  let clock = 0, runs = 0, release;
  const job = everyFewHours('test', { hours: 4, now: () => clock, firstCheckMs: 1e9, checkMs: 1e9, lastRunAt: async () => null,
    run: async () => { runs++; if (runs === 1) throw new Error('source down'); await new Promise(resolve => { release = resolve; }); } });
  clock = 10 * HOUR;
  assert.equal(await job.due(), true, 'ran (and failed)');
  clock += 10 * 60 * 1000;
  assert.equal(await job.due(), false, 'not retried 10 minutes later');
  clock += 4 * HOUR;
  const slow = job.due();                       // starts the second run, which waits
  await new Promise(resolve => setImmediate(resolve));
  clock += 4 * HOUR;
  assert.equal(await job.due(), false, 'the running one is not started again');
  release(); assert.equal(await slow, true);
  assert.equal(runs, 2);
  job.stop();
});
