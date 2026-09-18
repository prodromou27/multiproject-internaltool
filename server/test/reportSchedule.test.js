const test = require('node:test');
const assert = require('node:assert/strict');
const { nextRun,validateSchedule } = require('../reportSchedule');
test('report schedules validate bounds and calculate future UTC occurrences', () => {
  const schedule = { frequency: 'daily',day: 0,hour: 9,minute: 0,enabled: true,recipient_ids: [1],version: 0 };
  assert.doesNotThrow(() => validateSchedule(schedule));
  assert.equal(nextRun(schedule,new Date('2026-12-31T09:00:00Z')),'2027-01-01T09:00:00.000Z');
  assert.equal(nextRun({ ...schedule,frequency: 'weekly',day: 1 },new Date('2026-12-31T10:00:00Z')),'2027-01-04T09:00:00.000Z');
  assert.equal(nextRun({ ...schedule,frequency: 'monthly',day: 28 },new Date('2024-01-31T10:00:00Z')),'2024-02-28T09:00:00.000Z');
  assert.equal(nextRun({ ...schedule,frequency: 'monthly',day: 1 },new Date('2026-12-31T10:00:00Z')),'2027-01-01T09:00:00.000Z');
  for (const changes of [{ day: 1 },{ hour: 24 },{ minute: -1 },{ enabled: 1 },{ recipient_ids: [] },{ recipient_ids: [1,1] },{ recipient_ids: ['1'] },{ frequency: 'monthly',day: 29 },{ version: -1 }]) assert.throws(() => validateSchedule({ ...schedule,...changes }),error => error.status===400);
  assert.doesNotThrow(() => validateSchedule({ ...schedule,enabled: false,recipient_ids: [] }));
});
