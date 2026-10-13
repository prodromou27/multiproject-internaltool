import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

const defaults = {
  title: 'Service report', intro: '', show_overview: true, closing: '', footer: '{customer} · Confidential', color: '#1f3a5f',
  sections: ['work_log', 'changes', 'tickets', 'tasks', 'recommendations', 'upcoming'], default_summary: '', default_coming_next: '',
  headings: { summary: 'Summary', work: 'Work delivered', changes: 'Changes and upgrades', tickets: 'Tickets resolved', tasks: 'Tasks completed', work_log: 'Work log', recommendations: 'Our recommendations', assets: 'Devices we look after', upcoming: 'Coming next' },
  figures: { hours: 'Hours of work', activities: 'Activities', changes: 'Changes and upgrades', tickets: 'Tickets resolved', tasks: 'Tasks completed' },
  empty: { work: 'No activities were recorded in this period.', changes: 'No changes or upgrades in this period.', tickets: 'No tickets were resolved in this period.', tasks: 'No tasks were completed in this period.', work_log: 'No activities were recorded in this period.', recommendations: 'We have no open recommendations.', assets: 'No devices are recorded.' },
};

test('managers change the wording, colour and default sections of the customer report in Settings', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  const template = { id: 3, name: 'Monthly report', description: '', sections: ['executive_summary'], default_narratives: {}, tables: {}, wording: {}, active: true, version: 1, has_word_template: false };
  let saved = null;
  api.override('GET /api/managed-report-templates', () => ({ body: { rows: [template], wording_defaults: defaults } }));
  api.override('PUT /api/managed-report-templates/3', ({ request }) => { saved = request.postDataJSON(); return { body: { ...template, ...saved, version: 2 } }; });

  await page.goto('/settings/managed_report_templates');
  const form = page.getByRole('region', { name: 'Report template' });
  await expect(form.getByLabel('Report title')).toHaveValue('Service report');
  await form.getByLabel('Report title').fill('Monthly value report');
  await form.getByLabel('Opening paragraph').fill('Dear {customer}, here is what we did.');
  await form.getByLabel('Work log (every activity)').uncheck();
  await form.getByLabel('Devices we look after').check();
  await form.getByText('Section headings').click();
  await form.getByLabel('Work delivered (hours by type of work)').fill('What we did');
  await form.getByRole('button', { name: 'Save template' }).click();
  await expect(page.getByText('Saved. New customer reports use this wording.')).toBeVisible();

  expect(saved.wording.title).toBe('Monthly value report');
  expect(saved.wording.intro).toBe('Dear {customer}, here is what we did.');
  expect(saved.wording.sections).toEqual(['changes', 'tickets', 'tasks', 'recommendations', 'upcoming', 'assets']);
  expect(saved.wording.headings.work).toBe('What we did');
  expect(saved.sections).toEqual(['executive_summary']); // the old builder's fields are left as they were
});
