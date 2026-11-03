import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

const CORE_WORKSPACES = [
  ['/', 'Operations overview'],
  ['/projects', 'Projects'],
  ['/tasks', 'Tasks'],
  ['/maintenance-visits', 'Maintenance Visits'],
  ['/calendar', 'Calendar & Planner'],
  ['/activity-log', 'Activity log'],
  ['/customers', 'Customers'],
  ['/reports', 'Reports'],
];

for (const profile of [
  { name:'mobile light',width:390,height:844,theme:'light' },
  { name:'tablet dark',width:768,height:1024,theme:'dark' },
]) {
  for (const [path, heading] of CORE_WORKSPACES) {
    test(`${profile.name}: ${path} keeps its primary workspace usable`, async ({ page }) => {
      const runtimeErrors=[];
      page.on('pageerror',error => runtimeErrors.push(error.message));
      await page.setViewportSize({ width:profile.width,height:profile.height });
      await page.addInitScript(theme => localStorage.setItem('hub_theme',theme),profile.theme);
      await mockApi(page,{ role:'manager' });

      await page.goto(path);
      await expect(page.getByRole('heading',{ name:heading,level:1 })).toBeVisible();
      await expect(page.locator('#main-content')).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme',profile.theme);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      expect(runtimeErrors).toEqual([]);
    });
  }
}

test('keyboard users can skip navigation and operate the mobile drawer', async ({ page }) => {
  await page.setViewportSize({ width:390,height:844 });
  await mockApi(page,{ role:'manager' });
  await page.goto('/tasks');

  await expect(page.getByRole('heading',{ name:'Tasks',level:1 })).toBeVisible();
  await expect(page.locator('#primary-navigation')).toHaveAttribute('aria-hidden','true');
  await page.keyboard.press('Tab');
  const skip=page.getByRole('link',{ name:'Skip to main content' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();

  const menu=page.getByRole('button',{ name:'Toggle menu' });
  await menu.click();
  const drawer=page.locator('#primary-navigation');
  await expect(drawer).toHaveAttribute('role','dialog');
  await expect(drawer).toHaveAttribute('aria-modal','true');
  await expect(page.locator('.main')).toHaveAttribute('inert','');
  await expect(drawer.getByRole('button',{ name:/Close navigation/ })).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(menu).toHaveAttribute('aria-expanded','false');
  await expect(menu).toBeFocused();
  await expect(page.locator('.main')).not.toHaveAttribute('inert','');
});
