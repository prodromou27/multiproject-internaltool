import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

test('the module launcher exposes unpinned areas and remembers new pins', async ({ page }) => {
  await mockApi(page, { role: 'manager' });
  await page.goto('/');

  await expect(page.getByRole('navigation', { name: 'Pinned modules' }).getByRole('link')).toHaveCount(7);
  await expect(page.getByRole('navigation', { name: 'Pinned modules' }).getByRole('link', { name: 'Settings' })).toHaveCount(0);

  await page.getByRole('button', { name: 'All modules' }).click();
  const launcher = page.getByRole('dialog', { name: 'All modules' });
  await expect(launcher).toBeVisible();
  await launcher.getByPlaceholder('Find a module by name or purpose').fill('settings');
  await launcher.getByRole('button', { name: 'Pin Settings' }).click();
  await launcher.getByRole('button', { name: 'Close module launcher' }).click();

  await expect(page.getByRole('navigation', { name: 'Pinned modules' }).getByRole('link', { name: 'Settings' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Pinned modules' }).getByRole('link', { name: 'Settings' })).toBeVisible();
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

  await page.getByRole('button', { name: 'Compact spacing' }).click();
  await expect(page.locator('.operations-shell')).toHaveClass(/density-compact/);
  await page.reload();
  await expect(page.locator('.operations-shell')).toHaveClass(/density-compact/);
  await expect(page.getByRole('button', { name: 'Comfortable spacing' })).toBeVisible();
});
