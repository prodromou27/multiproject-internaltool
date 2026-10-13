import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

test('the menu is one short list; the other pages open from the top bar, the account menu or their page', async ({ page }) => {
  await mockApi(page, { role: 'manager' });
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link')).toHaveText(['Dashboard', 'Tasks', 'Projects', 'Customers', 'Maintenance Visits', 'Activity Log', 'Advisories', 'Reports']);
  await expect(nav.getByRole('button')).toHaveCount(0); // no groups to fold
  const pinned = page.getByRole('navigation', { name: 'Notes and settings' });
  await expect(pinned.getByRole('link', { name: 'Settings' })).toBeVisible();

  // Calendar and Reminders sit in the top bar, My Notes in the account menu.
  await page.locator('.desktop-topbar').getByRole('link', { name: 'Calendar' }).click();
  await expect(page).toHaveURL(/\/calendar$/);
  await page.locator('summary[aria-label="Account menu"]').filter({ visible: true }).click();
  await expect(page.getByRole('link', { name: 'My Notes' })).toBeVisible();

  // Pages that open from another light that one up: Workload is part of Reports, Users of Settings.
  await page.goto('/workload');
  await expect(nav.getByRole('link', { name: 'Reports' })).toHaveClass(/active/);
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
  await page.goto('/scorecards');
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Reports', exact: true })).toBeInViewport(); // Scorecards opens from Reports
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
});
