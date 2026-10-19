import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

test('Settings has ten pages; a page with several sections shows them as tabs, one at a time', async ({ page }) => {
  await mockApi(page, { role: 'manager' });
  await page.goto('/settings');
  const menu = page.getByRole('complementary', { name: 'Settings sections' });
  await expect(menu.getByRole('button')).toHaveText(['Overview', 'Users & teams', 'Access & sign-in', 'Lists', 'Templates', 'Weekly report', 'Email & notifications', 'Integrations', 'Time & region', 'Backups & health']);

  await menu.getByRole('button', { name: 'Integrations' }).click();
  await expect(page).toHaveURL(/\/settings\/integrations$/);
  const tabs = page.getByRole('tablist', { name: 'Integrations sections' });
  await expect(tabs.getByRole('tab')).toHaveText(['Request Tracker', 'Grafana devices', 'Activity bot']);
  await expect(tabs.getByRole('tab', { name: 'Request Tracker' })).toHaveAttribute('aria-selected', 'true');
  const panel = page.getByRole('tabpanel', { name: 'Request Tracker' });
  // Request Tracker: five steps, one on screen.
  const steps = panel.getByRole('tablist', { name: 'Request Tracker steps' });
  await expect(steps.getByRole('tab')).toHaveCount(5);
  await steps.getByRole('tab', { name: '4. Status mapping' }).click();
  await expect(page).toHaveURL(/step=mapping/);
  await expect(panel.getByRole('region', { name: 'Status mapping' })).toBeVisible();
  await expect(panel.getByRole('region', { name: 'Connection' })).toHaveCount(0);

  // Another tab replaces it; its address is the section's own.
  await tabs.getByRole('tab', { name: 'Grafana devices' }).click();
  await expect(page).toHaveURL(/\/settings\/grafana$/);
  await expect(page.getByRole('tabpanel', { name: 'Grafana devices' })).toBeVisible();
  await expect(page.getByRole('tablist', { name: 'Request Tracker steps' })).toHaveCount(0);

  // Search finds a page by a section on it, and opens that section.
  await page.getByLabel('Search settings').fill('activity bot');
  await expect(menu.getByRole('button')).toHaveText(['Integrations']);
  await menu.getByRole('button', { name: 'Integrations' }).click();
  await expect(page).toHaveURL(/\/settings\/activity_bot$/);
  await expect(tabs.getByRole('tab', { name: 'Activity bot' })).toHaveAttribute('aria-selected', 'true');
});

test('a section address opens its page with that tab', async ({ page }) => {
  await mockApi(page, { role: 'manager' });
  await page.goto('/settings/teams');
  await expect(page.getByRole('complementary', { name: 'Settings sections' }).getByRole('button', { name: 'Users & teams' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('tablist', { name: 'Users & teams sections' }).getByRole('tab', { name: 'Teams' })).toHaveAttribute('aria-selected', 'true');
  await page.goto('/settings/contract_types');
  await expect(page.getByRole('tablist', { name: 'Lists sections' }).getByRole('tab', { name: 'Contract types' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('complementary', { name: 'Settings sections' }).getByRole('button', { name: 'Lists' })).toHaveAttribute('aria-current', 'page');
  // A one-section page has no tabs.
  await page.goto('/settings/weekly_report');
  await expect(page.getByRole('tablist', { name: /sections/ })).toHaveCount(0);
});
