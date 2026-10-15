import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mockApi } from './support/mockApi.js';

/* An automated accessibility check (axe, WCAG 2.1 A and AA) of the main pages, at
   desktop and phone width and in the dark theme. It finds missing names, labels,
   contrast and structure problems; keyboard use, screen readers and 200% zoom are
   still checked by hand at staging (docs/STAGING_ACCEPTANCE.md). */
const PAGES = ['/', '/my-day', '/projects', '/projects/1', '/tasks', '/my-time', '/maintenance-visits', '/calendar',
  '/activity-log', '/customers', '/managed-customers', '/managed-customers/1', '/reports', '/approvals', '/workload',
  '/vulnerabilities', '/data-quality', '/skills', '/settings', '/settings/users', '/profile'];
const project = { id: 1, title: 'Network refresh', status: 'in_progress', priority: 'high', members: [], updates: [], created_by: 1 };

const RUNS = [
  ['desktop', { width: 1440, height: 900 }, 'light'],
  ['phone', { width: 390, height: 844 }, 'light'],
  ['dark theme', { width: 1440, height: 900 }, 'dark'],
];

for (const [label, viewport, theme] of RUNS) {
  test(`main pages pass the automated accessibility check (${label})`, async ({ page }) => {
    test.setTimeout(240000);
    await page.setViewportSize(viewport);
    await page.addInitScript(value => { try { localStorage.setItem('hub_theme', value); } catch { /* none */ } }, theme);
    const api = await mockApi(page, { role: 'manager' });
    api.override('GET /api/projects/1', () => ({ body: project }));
    const found = [];
    for (const path of PAGES) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      for (const v of violations) for (const node of v.nodes.slice(0, 5)) {
        found.push(`${path} ${v.id} (${v.impact}): ${node.target.join(' ')} ${node.html.slice(0, 80)}${node.any?.[0]?.message ? ` — ${node.any[0].message}` : ''}`);
      }
    }
    expect(found, found.join('\n')).toEqual([]);
  });
}

// 200% zoom on a 1440×900 screen is a 720×450 window: pages reflow, nothing scrolls sideways.
test('main pages reflow at 200% zoom without sideways scrolling', async ({ page }) => {
  test.setTimeout(180000);
  await page.setViewportSize({ width: 720, height: 450 });
  const api = await mockApi(page, { role: 'manager' });
  api.override('GET /api/projects/1', () => ({ body: project }));
  const wide = [];
  for (const path of PAGES) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 1) wide.push(`${path} is ${overflow}px too wide`);
  }
  expect(wide, wide.join('\n')).toEqual([]);
});
