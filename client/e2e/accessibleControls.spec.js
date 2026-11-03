import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

const project = { id: 1, title: 'Network refresh', status: 'in_progress', priority: 'high', members: [], updates: [], created_by: 1 };

test('tabs follow the keyboard pattern: arrows and Home/End move and open, one tab stop, panel named by its tab', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  api.override('GET /api/projects/1', () => ({ body: project }));
  await page.goto('/projects/1');
  const tabs = page.getByRole('tablist', { name: 'Project sections' });
  const tasks = tabs.getByRole('tab', { name: 'Tasks' });
  await expect(tasks).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.locator('[tabindex="0"]')).toHaveCount(1);
  await expect(page.getByRole('tabpanel', { name: 'Tasks' })).toBeVisible();

  await tasks.focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: 'Gantt' })).toBeFocused();
  await expect(tabs.getByRole('tab', { name: 'Gantt' })).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(/tab=gantt/);
  await page.keyboard.press('End');
  const last = tabs.getByRole('tab').last();
  await expect(last).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(tasks).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(last).toBeFocused();
  await page.keyboard.press('Home');
  await expect(tasks).toBeFocused();
  await expect(page.getByRole('tabpanel', { name: 'Tasks' })).toBeVisible();
});

test('every button on the main pages has a name a screen reader can say', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  api.override('GET /api/projects/1', () => ({ body: project }));
  api.override('GET /api/templates', () => ({ body: [{ id: 3, name: 'Onboarding', description: '', tasks: [{ id: 9, title: 'Kick-off call', priority: 'medium' }] }] }));
  for (const path of ['/tasks', '/projects', '/projects/1', '/reports', '/customers', '/maintenance-visits', '/workload', '/templates']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const unnamed = await page.evaluate(() => [...document.querySelectorAll('button, [role="button"], [role="tab"]')]
      .filter(el => el.offsetParent !== null)
      .filter(el => !(el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('aria-labelledby') || el.textContent.trim()))
      .map(el => el.outerHTML.slice(0, 120)));
    expect(unnamed, `unnamed buttons on ${path}`).toEqual([]);
  }
});
