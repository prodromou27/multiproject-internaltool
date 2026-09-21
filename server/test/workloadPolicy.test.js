const test = require('node:test');
const assert = require('node:assert/strict');
const { defaults,validatePolicy,statusWeight,pressureForEngineer } = require('../workloadPolicy');
const { planningWeeks,capacityForEngineer } = require('../workloadModel');

test('policy requires an expected version and bounded numeric weights', () => {
  assert.deepEqual(validatePolicy({ ...defaults(),version: 0 }),defaults());
  for (const mutate of [
    body => delete body.version,
    body => { body.version='0'; },
    body => { body.status_weights.task.open=-0.1; },
    body => { body.status_weights.visit.scheduled=1.01; },
    body => { body.status_weights.task.open='0.5'; },
    body => { body.status_weights.task=[]; },
    body => { body.status_weights.task.constructor=1; },
    body => { body.pressure.overdue=Infinity; },
    body => { body.pressure.priority.high=101; },
    body => { body.pressure.extra=1; },
    body => { body.status_weights.task=Object.fromEntries(Array.from({ length: 101 },(_,i) => [`state${i}`,1])); },
  ]) {
    const body={ ...defaults(),version: 0 }; mutate(body);
    assert.throws(() => validatePolicy(body),error => error.status===400);
  }
  assert.equal(statusWeight(defaults(),'task','custom'),1);
  assert.equal(statusWeight(defaults(),'task','constructor'),1);
});

test('capacity weights remaining effort and retains the unweighted total', () => {
  const weeks=planningWeeks('2026-09-18'),policy=defaults();
  policy.status_weights.task.paused=0;
  const items=[
    { user_id: 1,kind: 'task',status: 'waiting_customer',date: '2026-09-18',remaining_hours: 8 },
    { user_id: 1,kind: 'task',status: 'paused',date: '2026-09-18',remaining_hours: null },
  ];
  const availability=[{ user_id: 1,week_start: weeks[0].start,available_hours: 10 }];
  const week=capacityForEngineer({ id: 1 },weeks,items,availability,policy).weeks[0];
  assert.equal(week.estimated_hours,2);
  assert.equal(week.unweighted_hours,8);
  assert.equal(week.capacity_percent,20);
  assert.equal(week.unknown_estimates,0);
  policy.status_weights.task.paused=0.1;
  assert.equal(capacityForEngineer({ id: 1 },weeks,items,availability,policy).weeks[0].capacity_percent,null);
});

test('pressure keeps date urgency and report obligations independent of status factors', () => {
  const result=pressureForEngineer({ id: 1 },[
    { id: 1,kind: 'task',status: 'waiting_customer',priority: 'high',date: '2026-09-17' },
    { id: 2,kind: 'report',status: 'completed',date: '2026-09-17' },
    { id: 3,kind: 'follow_up',date: null },
    { id: 4,kind: 'visit',status: 'scheduled',date: '2026-09-24' },
    { id: 5,kind: 'visit',status: 'scheduled',date: '2026-09-25' },
  ],'2026-09-18',defaults());
  assert.equal(result.pressure_points,10.75);
  assert.equal(result.breakdown.task.points,2.75);
  assert.equal(result.breakdown.report.points,4);
  assert.equal(result.overdue_count,2);
  assert.equal(result.undated_count,1);
  assert.equal(result.items[0].kind,'report');
  const capped=pressureForEngineer({ id: 1 },Array.from({ length: 60 },(_,id) => ({ id,kind: 'follow_up',date: null })),'2026-09-18',defaults());
  assert.equal(capped.items.length,50);
  assert.equal(capped.items_total,60);
  assert.equal(capped.pressure_points,60);
});
