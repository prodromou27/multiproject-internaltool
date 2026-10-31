/* Real-stack journeys (review I06): the real server, database, cookies and CSRF.
   One manager and one engineer work through the main daily paths in order. */
import { test, expect } from '@playwright/test';
import { PEOPLE, call, seedPeople, signIn } from './stack.js';

test.describe.configure({ mode: 'serial' });
const stamp = Date.now().toString(36);
const shared = {};

test.beforeAll(async () => { shared.ids = await seedPeople(); });

test('the session is a cookie, and a request without the app header is refused (CSRF)', async ({ page }) => {
  await signIn(page, 'manager');
  const cookies = await page.context().cookies();
  const session = cookies.find(cookie => cookie.httpOnly && cookie.path === '/api');
  expect(session, 'an HttpOnly session cookie scoped to /api').toBeTruthy();
  expect(session.sameSite).toBe('Strict');
  expect((await call(page, 'GET', '/auth/me')).data.email).toBe(PEOPLE.manager.email);
  const forged = await page.request.post('/api/customers', { data: { name: 'Forged' } });
  expect(forged.status()).toBe(403);
  const signedOut = await page.request.fetch('/api/auth/me', { headers: { Cookie: '' } });
  expect([401, 403]).toContain(signedOut.status());
});

test('a manager adds a customer and gives an engineer a task for it', async ({ page }) => {
  await signIn(page, 'manager');
  await page.goto('/customers');
  await page.getByRole('button', { name: '+ New Customer' }).click();
  await page.getByLabel('Customer Name *').fill(`Realstack Shipping ${stamp}`);
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const found = await call(page, 'GET', `/customers?paged=1&search=${encodeURIComponent(stamp)}`);
  shared.customerId = found.data.rows.find(row => row.name === `Realstack Shipping ${stamp}`)?.id;
  expect(shared.customerId, 'the customer is saved (and its encrypted name searchable)').toBeTruthy();

  await page.goto('/tasks');
  await page.getByRole('button', { name: '+ New Task' }).click();
  await page.getByLabel('Title *').fill(`Replace firewall ${stamp}`);
  await page.locator('#task-customer').fill(stamp);
  await page.getByRole('option', { name: `Realstack Shipping ${stamp}` }).click();
  await page.getByLabel('Who does it').selectOption({ label: PEOPLE.engineer.name });
  await page.getByRole('dialog').getByRole('button', { name: /Create|Save|Add/ }).last().click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const tasks = await call(page, 'GET', `/tasks?page=1&page_size=50&search=${encodeURIComponent(stamp)}`);
  const task = (tasks.data.rows || tasks.data).find(row => row.title === `Replace firewall ${stamp}`);
  expect(task.assigned_to).toBe(shared.ids.engineer);
  shared.taskId = task.id;
});

test('the engineer sees it, logs time and marks it done', async ({ page }) => {
  await signIn(page, 'engineer');
  await expect(page).toHaveURL(/\/my-day/, { timeout: 15_000 });
  await expect(page.getByText(`Replace firewall ${stamp}`).first()).toBeVisible();
  const logged = await call(page, 'POST', '/time-logs', { task_id: shared.taskId, hours: 1.5, description: 'Replaced and tested' });
  expect([200, 201]).toContain(logged.status);
  await page.goto('/tasks');
  await page.getByRole('button', { name: `Mark Replace firewall ${stamp} as done` }).click();
  const statusOf = async () => { const list = (await call(page, 'GET', `/tasks?page=1&page_size=50&search=${encodeURIComponent(stamp)}`)).data; return (list.rows || list).find(row => row.id === shared.taskId)?.status; };
  await expect.poll(statusOf).toBe('completed');
});

test('a visit report goes from the engineer to the manager', async ({ page, browser }) => {
  await signIn(page, 'manager');
  const day = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const visit = await call(page, 'POST', '/maintenance-visits', { customer_id: shared.customerId, title: `Quarterly check ${stamp}`, scheduled_date: day, engineer_ids: [shared.ids.engineer], confirm_warnings: true });
  expect(visit.status).toBe(200);
  const engineer = await browser.newPage();
  await signIn(engineer, 'engineer');
  expect((await call(engineer, 'POST', `/maintenance-visits/${visit.data.id}/report-sent`)).status).toBe(200);
  await engineer.close();
  const row = (await call(page, 'GET', `/maintenance-visits/${visit.data.id}`)).data;
  expect(Number(row.report_sent)).toBe(1);
});

test('a project closure is requested by the engineer and approved by the manager', async ({ page, browser }) => {
  await signIn(page, 'manager');
  const project = await call(page, 'POST', '/projects', { project_code: `PRJ-${stamp}`, title: `Core refresh ${stamp}`, description: 'Core switch refresh', start_date: '2026-10-01', customer_id: shared.customerId, member_ids: [shared.ids.engineer] });
  expect([200, 201]).toContain(project.status);
  shared.projectId = project.data.id;
  const engineer = await browser.newPage();
  await signIn(engineer, 'engineer');
  expect((await call(engineer, 'POST', `/projects/${shared.projectId}/request-closure`, {})).status).toBe(200);
  await engineer.close();
  await page.goto('/approvals');
  await expect(page.getByText(`Core refresh ${stamp}`).first()).toBeVisible();
  expect((await call(page, 'POST', `/projects/${shared.projectId}/approve-closure`, {})).status).toBe(200);
  expect((await call(page, 'GET', `/projects/${shared.projectId}`)).data.status).toBe('closed');
});

test('an attachment is stored encrypted and downloads as uploaded', async ({ page }) => {
  await signIn(page, 'manager');
  const pdf = Buffer.from('%PDF-1.4\n% realstack\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');
  const upload = await page.request.post(`/api/attachments/${shared.projectId}`, {
    headers: { 'X-SolutionsHub-Request': '1' },
    multipart: { file: { name: 'scope.pdf', mimeType: 'application/pdf', buffer: pdf } },
  });
  expect(upload.status(), await upload.text()).toBeLessThan(300);
  const list = await call(page, 'GET', `/attachments/${shared.projectId}`);
  const file = (list.data.rows || list.data).find(row => /scope\.pdf/.test(row.original_name || row.name || ''));
  expect(file).toBeTruthy();
  const download = await page.request.get(`/api/attachments/${shared.projectId}/download/${file.id}`);
  expect(download.status()).toBe(200);
  expect(Buffer.from(await download.body()).equals(pdf)).toBe(true);
});

test('turning off a module for the engineer closes it at once', async ({ page, browser }) => {
  await signIn(page, 'manager');
  const rule = await call(page, 'PUT', '/permissions/rule', { scope: 'user', user_id: shared.ids.engineer, permission_key: 'tasks.access', allowed: false, version: 0 });
  expect(rule.status).toBe(200);
  const engineer = await browser.newPage();
  await signIn(engineer, 'engineer');
  expect((await call(engineer, 'GET', '/tasks')).status).toBe(403);
  expect((await call(engineer, 'GET', `/time-logs?task_id=${shared.taskId}`)).status).toBe(403);
  await expect(engineer.getByRole('navigation').getByRole('link', { name: 'Tasks', exact: true })).toHaveCount(0);
  await engineer.close();
  await call(page, 'PUT', '/permissions/rule', { scope: 'user', user_id: shared.ids.engineer, permission_key: 'tasks.access', allowed: null, version: 1 });
});
