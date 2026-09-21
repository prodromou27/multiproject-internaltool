import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

// Each event type once used a hardcoded light background, so in dark mode the chips
// stayed pale with light text. They now use theme colours that flip together.
test('dark mode gives calendar event chips a dark, translucent background', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-21T10:00:00'));
  await page.addInitScript(() => localStorage.setItem('hub_theme', 'dark'));
  await mockApi(page, { role: 'manager' });
  await page.goto('/calendar');

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const chip = page.getByText(/Renew firewall support contract with a deliberately/).first();
  await expect(chip).toBeVisible();
  const background = await chip.evaluate(node => {
    let el = node;
    while (el && getComputedStyle(el).backgroundColor === 'rgba(0, 0, 0, 0)') el = el.parentElement;
    return getComputedStyle(el).backgroundColor;
  });
  const alpha = background.startsWith('rgba') ? Number(background.split(',')[3].replace(')', '')) : 1;
  expect(alpha).toBeLessThan(0.6);
});

test('the theme toggle switches between light and dark', async ({ page }) => {
  await mockApi(page, { role: 'engineer' });
  await page.goto('/tasks');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: /dark mode/i }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: /light mode/i }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
