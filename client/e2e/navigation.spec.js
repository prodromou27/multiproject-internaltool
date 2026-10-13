import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

test('the menu shows every page in groups, and remembers folded groups', async ({ page }) => {
  await mockApi(page, { role: 'manager' });
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Main' });
  for (const name of ['Dashboard', 'Projects', 'Customers', 'Workload', 'Skill matrix', 'Reports'])
    await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
  const pinned = page.getByRole('navigation', { name: 'Notes and settings' });
  await expect(pinned.getByRole('link', { name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'All modules' })).toHaveCount(0);

  const team = nav.getByRole('button', { name: 'Team & performance' });
  await team.click();
  await expect(team).toHaveAttribute('aria-expanded', 'false');
  await expect(nav.getByRole('link', { name: 'Workload' })).toBeHidden();
  await page.reload();
  await expect(nav.getByRole('link', { name: 'Workload' })).toBeHidden();
  await team.click();
  await expect(nav.getByRole('link', { name: 'Workload' })).toBeVisible();

  // Pages that live inside another light up that one: Users is part of Settings.
  await page.goto('/users');
  await expect(page).toHaveURL(/\/settings\/users$/);
  await expect(pinned.getByRole('link', { name: 'Settings' })).toHaveClass(/active/);
});

test('the desktop navigation rail remembers its compact mode', async ({ page }) => {
  await mockApi(page, { role: 'manager' });
  await page.goto('/');

  await page.getByRole('button', { name: 'Collapse' }).click();
  await expect(page.locator('.operations-shell')).toHaveClass(/nav-compact/);
  await expect(page.getByRole('link', { name: 'Projects' }).first()).toBeVisible();
  await page.reload();
  await expect(page.locator('.operations-shell')).toHaveClass(/nav-compact/);
  await expect(page.getByRole('button', { name: 'Expand navigation' })).toBeVisible();
});

test('workspace density is optional and persists per account', async ({ page }) => {
  await mockApi(page, { role: 'manager' });
  await page.goto('/tasks');

  await page.locator('summary[aria-label="Account menu"]').filter({ visible: true }).click();
  await page.getByRole('button', { name: 'Compact spacing' }).click();
  await expect(page.locator('.operations-shell')).toHaveClass(/density-compact/);
  await page.reload();
  await expect(page.locator('.operations-shell')).toHaveClass(/density-compact/);
  await page.locator('summary[aria-label="Account menu"]').filter({ visible: true }).click();
  await expect(page.getByRole('button', { name: 'Comfortable spacing' })).toBeVisible();
});

test('on a short screen the current page is scrolled into view in the menu', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 600 });
  await mockApi(page, { role: 'manager' });
  await page.goto('/sla');
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'SLA' })).toBeInViewport();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
});
