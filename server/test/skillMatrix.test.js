const test = require('node:test');
const assert = require('node:assert/strict');
const { coverage } = require('../skillMatrix');

test('coverage: nobody skilled is a gap, fewer than the target is at risk, one skilled is a single point', () => {
  const techs = [{ id: 1, skill_target: 2 }, { id: 2, skill_target: 2 }, { id: 3, skill_target: 2 }, { id: 4, skill_target: 1 }];
  const ratings = [
    { technology_id: 1, level: 2 }, { technology_id: 1, level: 1 },
    { technology_id: 2, level: 4 }, { technology_id: 2, level: 2 },
    { technology_id: 3, level: 3 }, { technology_id: 3, level: 4 },
    { technology_id: 4, level: 3 },
  ];
  const [gap, single, covered, enough] = coverage(techs, ratings);
  assert.deepEqual([gap.status, gap.skilled, gap.rated], ['gap', 0, 2]);
  assert.deepEqual([single.status, single.single_point, single.by_level], ['at_risk', true, { 1: 0, 2: 1, 3: 0, 4: 1 }]);
  assert.deepEqual([covered.status, covered.single_point], ['covered', false]);
  assert.deepEqual([enough.status, enough.single_point], ['covered', true], 'a target of one is met by one person, who is still a single point');
});
