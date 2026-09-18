const test = require('node:test');
const assert = require('node:assert/strict');
const { validDate,planningWeeks,capacityForEngineer } = require('../workloadModel');

test('planning weeks use UTC Mondays and span year boundaries consistently', () => {
  assert.equal(validDate('2026-02-29'),false);
  assert.equal(validDate('2028-02-29'),true);
  assert.deepEqual(planningWeeks('2026-12-31'), [
    { start: '2026-12-28',end: '2027-01-03' }, { start: '2027-01-04',end: '2027-01-10' },
    { start: '2027-01-11',end: '2027-01-17' }, { start: '2027-01-18',end: '2027-01-24' },
  ]);
});
test('capacity remains unknown without effort or availability and excludes unscheduled work', () => {
  const weeks = planningWeeks('2026-09-18');
  const items = [
    { user_id: 1,date: '2026-09-10',remaining_hours: 5 },
    { user_id: 1,date: '2026-09-20',remaining_hours: null },
    { user_id: 1,date: null,remaining_hours: 100 },
    { user_id: 1,date: '2026-12-01',remaining_hours: 100 },
    { user_id: 2,date: '2026-09-18',remaining_hours: 100 },
  ];
  const availability = [{ user_id: 1,week_start: weeks[0].start,available_hours: 10,version: 1 }];
  const partial = capacityForEngineer({ id: 1 },weeks,items,availability);
  assert.equal(partial.outside_window_count,2);
  assert.equal(partial.weeks[0].estimated_hours,5);
  assert.equal(partial.weeks[0].unknown_estimates,1);
  assert.equal(partial.weeks[0].capacity_percent,null);
  assert.equal(partial.weeks[1].capacity_percent,null);
  items[1].remaining_hours=10;
  assert.equal(capacityForEngineer({ id: 1 },weeks,items,availability).weeks[0].capacity_percent,150);
  availability[0].available_hours=0;
  assert.equal(capacityForEngineer({ id: 1 },weeks,items,availability).weeks[0].capacity_percent,null);
});
