import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

const page1 = {
  products: [
    { id: 1, name: 'FortiOS', vendor: 'Fortinet', source: 'fortinet', last_checked_at: '2026-10-07 06:00:00', last_error: null, releases: [
      { branch: '7.6', latest_version: '7.6.7', link: 'https://docs.fortinet.com/document/fortigate/7.6.7/fortios-release-notes', support_end: '2028-07-25', eol: '2030-01-25', maintained: 1 },
      { branch: '7.2', latest_version: '7.2.11', support_end: '2026-09-30', eol: '2027-03-31', maintained: 1 },
    ] },
    { id: 2, name: 'Check Point Jumbo Hotfix', vendor: 'Check Point', source: 'checkpoint', last_checked_at: '2026-10-07 06:00:00', last_error: null, releases: [
      { branch: 'R81.20', latest_version: 'Take 170', latest_date: '2026-09-22', recommended_version: 'Take 161', recommended_date: '2026-08-10', maintained: 1 },
    ] },
  ],
  events: [{ id: 1, product_name: 'FortiOS', branch: '7.6', kind: 'latest', version: '7.6.7', previous: '7.6.6', detected_at: '2026-10-06 06:00:00' }],
  news: [{ id: 1, title: 'R81.20 Jumbo Take 170 released', link: 'https://example.com/a', feed_name: 'CheckMates', published_at: '2026-09-22T08:00:00Z', summary: 'New take' }],
  feeds: 1, last_sync: { at: '2026-10-07T06:00:00Z', running: false },
};

test('everyone sees the latest versions, what was released and vendor news', async ({ page }) => {
  const api = await mockApi(page, { role: 'engineer' });
  api.override('GET /api/software', () => ({ body: page1 }));
  await page.goto('/software');
  await expect(page.getByRole('heading', { name: 'Software versions' })).toBeVisible();
  await expect(page.getByRole('row', { name: /^7\.6/ })).toContainText('7.6.7');
  await expect(page.getByRole('row', { name: /^7\.2/ })).toContainText('Security fixes only');
  await expect(page.getByRole('row', { name: /R81\.20/ })).toContainText('Take 161');
  await expect(page.getByText('FortiOS 7.6: 7.6.7')).toBeVisible();
  await expect(page.getByRole('link', { name: 'R81.20 Jumbo Take 170 released' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Products and feeds' })).toHaveCount(0, { timeout: 1000 });
});

test('managers follow a product entered by hand and add a news feed', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  let products = [{ id: 1, name: 'FortiOS', source: 'fortinet', enabled: true, config: { product: 'fortigate', document: 'fortios-release-notes', eol_slug: 'fortios', branches: [] }, releases: [] }];
  let created = null, release = null, feed = null;
  api.override('GET /api/software', () => ({ body: page1 }));
  api.override('GET /api/software/admin', () => ({ body: { products, feeds: feed ? [{ id: 9, ...feed, enabled: true }] : [], sources: [] } }));
  api.override('POST /api/software/admin/products', ({ body }) => { created = body; products = [...products, { id: 5, ...body, releases: [] }]; return { status: 201, body: { id: 5, check_error: null } }; });
  api.override('PUT /api/software/admin/products/5/releases', ({ body }) => { release = body; return { body: { ok: true } }; });
  api.override('POST /api/software/admin/feeds', ({ body }) => { feed = body; return { status: 201, body: { id: 9, items: 3 } }; });

  await page.goto('/software');
  await page.getByRole('button', { name: 'Products and feeds' }).click();
  await page.getByRole('button', { name: 'Follow a product' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Where its versions come from').selectOption('manual');
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Sophos Firewall');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => created).toMatchObject({ name: 'Sophos Firewall', source: 'manual' });

  await page.getByLabel('Version line').fill('21.0');
  await page.getByLabel('Latest version').fill('21.0 MR2');
  await page.getByRole('button', { name: 'Save version' }).click();
  await expect.poll(() => release).toMatchObject({ branch: '21.0', latest_version: '21.0 MR2' });

  await page.getByRole('button', { name: 'Add a feed' }).click();
  const feedDialog = page.getByRole('dialog');
  await feedDialog.getByRole('textbox', { name: 'Name', exact: true }).fill('CheckMates announcements');
  await feedDialog.getByLabel('RSS or Atom address').fill('https://community.example.com/rss');
  await feedDialog.getByLabel('Only items mentioning').fill('Jumbo, R81.20');
  await feedDialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved: 3 matching items')).toBeVisible();
  expect(feed).toMatchObject({ name: 'CheckMates announcements', keywords: 'Jumbo, R81.20' });
});
