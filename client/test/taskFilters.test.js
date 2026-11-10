import test from 'node:test';
import assert from 'node:assert/strict';
import { taskMatchesFilter } from '../src/utils/taskFilters.js';

test('due task views exclude terminal work and use seven calendar dates across year boundaries', () => {
  const rows = [
    { id: 1, status: 'open', deadline: '2026-12-30' },
    { id: 2, status: 'pending_approval', deadline: '2026-12-31' },
    { id: 3, status: 'open', deadline: '2027-01-06' },
    { id: 4, status: 'open', deadline: '2027-01-07' },
    { id: 5, status: 'completed', deadline: '2026-12-31' },
    { id: 6, status: 'open', deadline: null },
  ];
  const view = filter => rows.filter(row => taskMatchesFilter(row, filter, '2026-12-31')).map(row => row.id);
  assert.deepEqual(view('overdue'), [1]);
  assert.deepEqual(view('due_today'), [2]);
  assert.deepEqual(view('due_week'), [2, 3]);
  assert.deepEqual(view('pending_approval'), [2]);
});
