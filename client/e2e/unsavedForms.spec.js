import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

test('Escape or × never silently loses what was typed', async ({ page }) => {
  await mockApi(page, { role: 'manager' });
  await page.goto('/projects');
  await page.getByRole('button', { name: /New Project/ }).first().click();
  const dialog = page.getByRole('dialog');
  // Nothing typed: Escape closes at once.
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  await page.getByRole('button', { name: /New Project/ }).first().click();
  await dialog.getByRole('textbox').first().fill('Core network refresh');
  await page.keyboard.press('Escape');
  await expect(dialog.getByText('You have changes that are not saved. Discard them?')).toBeVisible();
  await dialog.getByRole('button', { name: 'Keep editing' }).click();
  await expect(dialog.getByRole('textbox').first()).toHaveValue('Core network refresh');
  await dialog.getByRole('button', { name: 'Close' }).click();
  await dialog.getByRole('button', { name: 'Discard' }).click();
  await expect(dialog).toHaveCount(0);

  // The draft is offered when the form opens again, and is only used when chosen.
  await page.getByRole('button', { name: /New Project/ }).first().click();
  await expect(dialog.getByText(/You have an unsaved draft from/)).toBeVisible();
  await expect(dialog.getByRole('textbox').first()).toHaveValue('');
  await dialog.getByRole('button', { name: 'Restore draft' }).click();
  await expect(dialog.getByRole('textbox').first()).toHaveValue('Core network refresh');
  await expect(dialog.getByText('This is your restored draft. It is not saved until you press Save.')).toBeVisible();
});

test('Discard draft removes it', async ({ page }) => {
  await mockApi(page, { role: 'manager' });
  await page.goto('/projects');
  await page.getByRole('button', { name: /New Project/ }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox').first().fill('Short-lived idea');
  await dialog.getByRole('button', { name: 'Close' }).click();
  await dialog.getByRole('button', { name: 'Discard' }).click();
  await page.getByRole('button', { name: /New Project/ }).first().click();
  await dialog.getByRole('button', { name: 'Discard draft' }).click();
  await expect(dialog.getByText(/unsaved draft/)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /New Project/ }).first().click();
  await expect(dialog.getByText(/unsaved draft/)).toHaveCount(0);
});
