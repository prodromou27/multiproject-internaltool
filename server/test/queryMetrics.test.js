const test = require('node:test');
const assert = require('node:assert/strict');
const metrics = require('../queryMetrics');

test('query labels retain structure without SQL values', () => {
  assert.equal(metrics.queryLabel("SELECT * FROM customers WHERE name='Secret Customer'"),'SELECT customers');
  assert.equal(metrics.queryLabel('UPDATE tasks SET title=$1 WHERE id=$2'),'UPDATE tasks');
  assert.equal(metrics.queryLabel('CREATE TABLE IF NOT EXISTS background_jobs(id SERIAL)'),'CREATE background_jobs');
});

test('query metrics count successes and failures without retaining parameters', async () => {
  metrics.reset();
  await metrics.observeQuery('SELECT * FROM customers WHERE id=$1',async () => ({ rows:[] }));
  await assert.rejects(metrics.observeQuery('DELETE FROM tasks WHERE id=$1',async () => { throw new Error('expected'); }),/expected/);
  const result=metrics.snapshot({ totalCount:3,idleCount:2,waitingCount:1 });
  assert.equal(result.count,2);assert.equal(result.failed,1);
  assert.deepEqual(result.pool,{ total:3,idle:2,waiting:1 });
  assert.equal(JSON.stringify(result).includes('customers WHERE'),false);
});
