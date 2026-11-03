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

test('a coverage gap becomes a learning plan with a suggested mentor; finishing it leaves the rating alone', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  api.override('GET /api/skills', () => ({ body: matrix([{ user_id: 8, technology_id: 2, level: 4 }]) }));
  let plans = [];
  let created = null, closed = null;
  api.override('GET /api/skills/plans', () => ({ body: { plans, mentors: [{ technology_id: 2, id: 8, name: 'Nikos Georgiou', level: 4 }] } }));
  api.override('POST /api/skills/plans', ({ body }) => {
    created = body;
    plans = [{ id: 31, user_id: 7, technology_id: 2, engineer_name: 'Maria Ioannou', technology_name: 'Check Point', mentor_name: 'Nikos Georgiou', current_level: null, target_level: 3, target_date: body.target_date, status: 'active', overdue: false,
      steps: [{ id: 1, title: 'Shadow two upgrades', done_at: null }], reviews: [] }];
    return { status: 201, body: plans[0] };
  });
  api.override('PUT /api/skills/plans/31', ({ body }) => { closed = body; plans = plans.map(p => ({ ...p, status: body.status })); return { body: plans[0] }; });

  await page.goto('/skills');
  await page.getByRole('tab', { name: /Coverage/ }).click();
  await page.getByRole('button', { name: 'Start a learning plan for Check Point' }).click();
  const dialog = page.getByRole('dialog', { name: 'Learning plan: Check Point' });
  await expect(dialog.getByLabel('Mentor')).toHaveValue('8');
  await expect(dialog.getByLabel('Mentor').locator('option', { hasText: 'Nikos Georgiou (Expert, suggested)' })).toHaveCount(1);
  await dialog.getByLabel('Engineer *').selectOption({ label: 'Maria Ioannou' });
  await dialog.getByLabel('Target date *').fill('2027-03-31');
  await dialog.getByLabel('Evidence steps, one per line').fill('Shadow two upgrades\n\nLead one upgrade');
  await dialog.getByRole('button', { name: 'Start plan' }).click();
  expect(created).toEqual({ user_id: 7, technology_id: 2, target_level: 3, target_date: '2027-03-31', mentor_id: 8, steps: ['Shadow two upgrades', 'Lead one upgrade'] });

  await expect(page.getByRole('tab', { name: /Learning plans/ })).toHaveAttribute('aria-selected', 'true');
  const row = page.getByRole('row', { name: /Maria Ioannou Check Point/ });
  await expect(row.getByText('0 of 1 done')).toBeVisible();
  await row.getByRole('button', { name: 'Complete' }).click();
  await expect(page.getByText('Plan completed. Update the rating in the matrix if they reached the level.')).toBeVisible();
  expect(closed).toEqual({ status: 'completed' });
  expect(api.calls.some(call => call.method === 'PUT' && call.path.startsWith('/api/skills/ratings'))).toBe(false);
});

test('engineers see their learning plan in My Work and tick off its steps', async ({ page }) => {
  const api = await mockApi(page, { role: 'engineer' });
  const plan = { id: 31, user_id: 1, technology_id: 2, engineer_name: 'Alex Mercer', technology_name: 'Check Point', mentor_name: 'Nikos Georgiou', target_level: 3, target_date: '2027-03-31', status: 'active', overdue: false,
    steps: [{ id: 1, title: 'Shadow two upgrades', done_at: null }], reviews: [] };
  let ticked = null;
  api.override('GET /api/skills/plans/mine', () => ({ body: { plans: [plan] } }));
  api.override('PUT /api/skills/plans/31/steps/1', ({ body }) => { ticked = body; return { body: { ...plan, steps: [{ ...plan.steps[0], done_at: '2026-10-15T10:00:00Z' }] } }; });
  await page.goto('/my-day');
  const card = page.getByRole('region', { name: 'Learning plans' });
  await expect(card.getByText(/mentor Nikos Georgiou/)).toBeVisible();
  await card.getByLabel('Shadow two upgrades').click();
  await expect(card.getByLabel('Shadow two upgrades')).toBeChecked();
  expect(ticked).toEqual({ done: true });
});
