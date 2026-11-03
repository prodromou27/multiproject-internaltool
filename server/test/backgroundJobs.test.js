const test=require('node:test');
const assert=require('node:assert/strict');
const jobs=require('../backgroundJobs');
const harness=require('./lib/harness');

test('background job payload parsing is bounded to valid JSON objects',() => {
  assert.deepEqual(jobs.safeJson('{"customer_id":42}'),{ customer_id:42 });
  assert.deepEqual(jobs.safeJson('invalid'),{});
  assert.deepEqual(jobs.safeJson(null),{});
});

test('background job timestamps use the sortable database format',() => {
  assert.equal(jobs.dbTimestamp('2026-09-24T12:34:56.789Z'),'2026-09-24 12:34:56');
  assert.match(jobs.isoAfter(1000),/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test('PostgreSQL queue deduplicates and atomically claims work',{ skip:process.env.TEST_DATABASE_URL ? false : 'needs TEST_DATABASE_URL (pg-mem does not implement SKIP LOCKED)' },async () => {
  const h=await harness.start({});
  try {
    const key=`queue-test-${Date.now()}`;
    const first=await jobs.enqueue('ticket_sync',{ customer_id:7 },{ dedupeKey:key });
    const duplicate=await jobs.enqueue('ticket_sync',{ customer_id:7 },{ dedupeKey:key });
    assert.equal(duplicate.id,first.id);assert.equal(duplicate.deduplicated,true);
    const claimed=await jobs.claim();
    assert.equal(claimed.id,first.id);assert.equal(claimed.status,'running');assert.equal(claimed.attempts,1);
    assert.equal(await jobs.claim(),undefined);
    await h.db.prepare('DELETE FROM background_jobs WHERE id=?').run(first.id);
  } finally { await h.stop(); }
});
