import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

const levels = [{ value: 1, label: 'Junior' }, { value: 2, label: 'Intermediate' }, { value: 3, label: 'Senior' }, { value: 4, label: 'Expert' }];
const matrix = (ratings, targets = {}) => {
  const technologies = [
    { id: 1, name: 'FortiGate', skill_target: targets[1] || 2, devices: 40, customers: 12 },
    { id: 2, name: 'Check Point', skill_target: targets[2] || 2, devices: 8, customers: 3 },
  ];
  const coverage = technologies.map(t => {
    const rows = ratings.filter(r => r.technology_id === t.id), skilled = rows.filter(r => r.level >= 3).length;
    return { technology_id: t.id, by_level: { 1: 0, 2: 0, 3: 0, 4: 0 }, rated: rows.length, skilled, target: t.skill_target, single_point: skilled === 1,
      status: skilled === 0 ? 'gap' : skilled < t.skill_target ? 'at_risk' : 'covered' };
  });
  return {
    levels, technologies, coverage, can_manage: true, activity_since: '2025-10-10',
    engineers: [{ id: 7, name: 'Maria Ioannou', team_ids: [1] }, { id: 8, name: 'Nikos Georgiou', team_ids: [2] }],
    teams: [{ id: 1, name: 'Security Team' }, { id: 2, name: 'Network Team' }],
    ratings: ratings.map(r => ({ rated_by_name: 'Alex Mercer', rated_at: '2026-10-01T10:00:00Z', note: null, ...r })),
    activity: [{ user_id: 8, technology_id: 2, activities: 14, last_date: '2026-10-02' }],
  };
};

test('managers rate engineers and see where knowledge rests on one person', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  let ratings = [{ user_id: 7, technology_id: 1, level: 4 }], targets = {}, sent = null, target = null;
  api.override('GET /api/skills', () => ({ body: matrix(ratings, targets) }));
  api.override('PUT /api/skills/ratings/8/1', ({ body }) => { sent = body; ratings = [...ratings, { user_id: 8, technology_id: 1, level: body.level }]; return { body: { ok: true } }; });
  api.override('PUT /api/skills/technologies/2/target', ({ body }) => { target = body; targets = { 2: body.target }; return { body: { ok: true } }; });

  await page.goto('/skills');
  await expect(page.getByRole('heading', { name: 'Skill matrix' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Maria Ioannou, FortiGate' })).toHaveValue('4');
  await expect(page.getByRole('row', { name: /^FortiGate/ })).toContainText('1 of 2 skilled');
  await expect(page.getByRole('row', { name: /^Check Point/ })).toContainText('14 activities');
  await expect(page.getByRole('row', { name: /^Check Point/ })).toContainText('Gap');

  await page.getByRole('combobox', { name: 'Nikos Georgiou, FortiGate' }).selectOption({ label: 'Senior' });
  await expect.poll(() => sent).toEqual({ level: 3 });
  await expect(page.getByRole('row', { name: /^FortiGate/ })).toContainText('Covered');

  // Filtering by team narrows the engineers shown.
  await page.getByLabel('Team').selectOption({ label: 'Network Team' });
  await expect(page.getByRole('columnheader', { name: 'Maria Ioannou' })).toHaveCount(0);

  // Coverage lists the riskiest technology first, with who knows it and customer demand.
  await page.getByRole('tab', { name: /Coverage/ }).click();
  const rows = page.getByRole('table').getByRole('row');
  await expect(rows.nth(1)).toContainText('Check Point');
  await expect(rows.nth(1)).toContainText('8 devices at 3 customers');
  await expect(page.getByRole('row', { name: /^FortiGate/ })).toContainText('Maria Ioannou (Expert), Nikos Georgiou (Senior)');
  const needed = page.getByRole('spinbutton', { name: 'Skilled engineers needed for Check Point' });
  await needed.fill('1');
  await needed.blur();
  await expect.poll(() => target).toEqual({ target: 1 });
});

test('the skill matrix is not offered to engineers', async ({ page }) => {
  await mockApi(page, { role: 'engineer' });
  await page.goto('/skills');
  await expect(page.getByRole('heading', { name: 'Skill matrix' })).toHaveCount(0);
});
