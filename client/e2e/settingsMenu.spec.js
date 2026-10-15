import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

test('Settings has ten pages; related settings are sections of one page', async ({ page }) => {
  await mockApi(page, { role: 'manager' });
  await page.goto('/settings');
  const menu = page.getByRole('complementary', { name: 'Settings sections' });
  await expect(menu.getByRole('button')).toHaveText(['Overview', 'Users & teams', 'Access & sign-in', 'Lists', 'Templates', 'Weekly report', 'Email & notifications', 'Integrations', 'Time & region', 'Backups & health']);

  await menu.getByRole('button', { name: 'Lists' }).click();
  await expect(page).toHaveURL(/\/settings\/lists$/);
  const onPage = page.getByRole('navigation', { name: 'On this page' });
  await expect(onPage.getByRole('link')).toHaveText(['Activity categories', 'Project statuses', 'Contract types', 'SLAs']);
  for (const name of ['Activity categories', 'Project statuses', 'Contract types', 'SLAs']) await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();

  // Search finds a page by a section on it.
  await page.getByLabel('Search settings').fill('grafana');
  await expect(menu.getByRole('button')).toHaveText(['Integrations']);
});

test('an old section address opens its page at that section', async ({ page }) => {
  await mockApi(page, { role: 'manager' });
  await page.goto('/settings/teams');
  await expect(page.getByRole('complementary', { name: 'Settings sections' }).getByRole('button', { name: 'Users & teams' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: 'Teams', exact: true })).toBeInViewport();
  await page.goto('/settings/contract_types');
  await expect(page.getByRole('heading', { name: 'Contract types', exact: true })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Settings sections' }).getByRole('button', { name: 'Lists' })).toHaveAttribute('aria-current', 'page');
});
