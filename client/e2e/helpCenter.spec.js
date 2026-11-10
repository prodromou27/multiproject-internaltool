import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

test('the ? button opens help for the page you are on, and the Help page has every topic, searchable', async ({ page }) => {
  await mockApi(page, { role: 'engineer' });
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Help: Tasks' });
  await expect(dialog.getByText(/Also working on it/)).toBeVisible();
  await dialog.getByRole('link', { name: 'All help topics' }).click();
  await expect(page).toHaveURL(/\/help$/);

  // The Help page is in the menu; topics are filtered by role (no manager-only Settings topic for engineers).
  await expect(page.getByRole('link', { name: 'Help', exact: true }).first()).toBeVisible();
  const topics = page.getByRole('navigation', { name: 'Help topics' });
  await expect(topics.getByRole('link', { name: 'Chat bot (Webex and Teams)' })).toBeVisible();
  await expect(topics.getByRole('link', { name: 'Settings (managers)' })).toHaveCount(0);

  await page.getByLabel('Search help').fill('waiting licence');
  await expect(topics.getByRole('link')).toHaveCount(1);
  await topics.getByRole('link', { name: 'Chat bot (Webex and Teams)' }).click();
  await expect(page).toHaveURL(/\/help\/bot$/);
  await expect(page.getByRole('heading', { name: 'Chat bot (Webex and Teams)' })).toBeVisible();
  await expect(page.getByText('new task Renew the SSL certificate for Northwind due Friday')).toBeVisible();
});

test('managers get the Settings and deleting topics', async ({ page }) => {
  await mockApi(page, { role: 'manager' });
  await page.goto('/help/deleting');
  await expect(page.getByRole('heading', { name: 'Archiving and deleting' })).toBeVisible();
  await expect(page.getByText(/Type the Project ID to confirm/)).toBeVisible();
});
