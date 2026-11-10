import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

// 22:30 UTC on 13 October is 14 October in Cyprus (the organisation's zone):
// a task due on the 13th is overdue for everyone, whatever their browser's zone.
for (const timezoneId of ['UTC', 'America/New_York', 'Asia/Nicosia']) {
  test.describe(`a browser in ${timezoneId}`, () => {
    test.use({ timezoneId });
    test('sees the same overdue state as the organisation', async ({ page }) => {
      await page.clock.setFixedTime(new Date('2026-10-13T22:30:00Z'));
      const api = await mockApi(page, { role: 'manager' });
      api.override('GET /api/settings/localization', () => ({ body: { timezone: 'Asia/Nicosia', date_format: 'DD/MM/YYYY', time_format: '24h', number_format: '1,000.00' } }));
      const rows = [
        { id: 1, title: 'Due yesterday in Cyprus', status: 'todo', priority: 'medium', deadline: '2026-10-13', assigned_to: 1, assigned_to_name: 'Alex Mercer' },
        { id: 2, title: 'Due today in Cyprus', status: 'todo', priority: 'medium', deadline: '2026-10-14', assigned_to: 1, assigned_to_name: 'Alex Mercer' },
      ];
      api.override('GET /api/tasks', () => ({ body: { total: 2, counts: { all: 2 }, rows } }));
      await page.goto('/tasks');
      const deadline = title => page.getByRole('row', { name: new RegExp(title) }).locator('td.overdue');
      await expect(deadline('Due yesterday in Cyprus')).toHaveCount(1);
      await expect(deadline('Due today in Cyprus')).toHaveCount(0);
    });
  });
}
