import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

const summary = { projects: { active: 0, delayed: 0 }, tasks: { visible: true, open: 0, overdue: 0 }, recommendations: { open: 0, high_risk: 0 },
  visits: { next: null, reports_pending: 0, this_year: 0 }, managed: { visible: true, state: 'active', open_tickets: 0, closed_tickets: 0 } };
const KINDS = { licence: 'Licence', subscription: 'Subscription', certificate: 'Certificate' };
const STATUSES = { open: 'Open', waiting_vendor: 'Waiting for vendor', waiting_us: 'Waiting for us', resolved: 'Resolved', closed: 'Closed' };
const SEVERITIES = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };

async function customer(page, role) {
  const api = await mockApi(page, { role });
  api.override('GET /api/customers/12', () => ({ body: { id: 12, name: 'Northwind Logistics', active: 1 } }));
  api.override('GET /api/customers/12/operations/summary', () => ({ body: summary }));
  api.override('GET /api/reminders/customer/12', () => ({ body: { team: { active: [] }, own: { active: [] } } }));
  api.override('GET /api/customers/12/contracts', () => ({ body: { contracts: [], is_managed: false, service_levels: [], can_manage: role === 'manager', can_see_assets: false, uncovered_count: 0 } }));
  return api;
}

test('licences and certificates: add one with its expiry date, see it expiring, renew it', async ({ page }) => {
  let list = [], sent = null, renewed = null;
  const api = await customer(page, 'manager');
  api.override('GET /api/customers/12/licences', () => ({ body: { licences: list, kinds: KINDS, assets: [{ id: 1, name: 'FW-HQ-01' }], can_edit: true, can_delete: true } }));
  api.override('POST /api/customers/12/licences', ({ body }) => {
    sent = body;
    list = [{ id: 3, customer_id: 12, ...body, status: 'expiring', days_left: 25, not_renewing: false, edit_version: 1 }];
    return { status: 201, body: { id: 3 } };
  });
  api.override('PUT /api/customers/12/licences/3', ({ body }) => { renewed = body; return { body: { ok: true, renewed: true } }; });

  await page.goto('/customers/12/service-profile?section=contracts');
  await expect(page.getByRole('tab', { name: 'Contracts & licences' })).toHaveAttribute('aria-selected', 'true');
  const section = page.getByRole('region', { name: 'Licences and certificates' });
  await section.getByRole('button', { name: 'Add' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a licence or certificate' });
  await dialog.getByLabel('Type').selectOption('subscription');
  await dialog.getByLabel('Name').fill('FortiGuard UTP bundle');
  await dialog.getByLabel('Vendor or issuer').fill('Fortinet');
  await dialog.getByLabel('Expires on').fill('2026-11-13');
  await dialog.getByLabel('Device').selectOption('1');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => sent).toMatchObject({ kind: 'subscription', name: 'FortiGuard UTP bundle', vendor: 'Fortinet', expires_on: '2026-11-13', asset_id: 1 });

  const row = section.getByRole('row', { name: /FortiGuard UTP bundle/ });
  await expect(row).toContainText('Expiring');
  await expect(row).toContainText('In 25 days');
  await expect(row).toContainText('FW-HQ-01');
  await row.getByRole('button', { name: 'Renew FortiGuard UTP bundle' }).click();
  const renew = page.getByRole('dialog', { name: 'Renew FortiGuard UTP bundle' });
  await expect(renew.getByLabel('Expires on')).toHaveValue('2027-11-13');
  await renew.getByRole('button', { name: 'Renew' }).click();
  await expect.poll(() => renewed).toMatchObject({ expires_on: '2027-11-13', version: 1 });
});

test('vendor cases: record a case, open it and add an update with a new status and follow-up', async ({ page }) => {
  let cases = [], created = null, update = null;
  const item = { id: 8, customer_id: 12, vendor: 'Check Point', case_number: '6-0003456789', subject: 'Cluster failover loops', severity: 'high', status: 'open', open: true,
    owner_id: 1, owner_name: 'Alex Mercer', rt_ticket: '4521', rt_url: 'https://rt.example/Ticket/Display.html?id=4521', next_follow_up: null, opened_on: '2026-10-15',
    attention: 'quiet', quiet_days: 9, edit_version: 1 };
  const api = await customer(page, 'engineer');
  api.override('GET /api/customers/12/vendor-cases', () => ({ body: { cases, statuses: STATUSES, severities: SEVERITIES, assets: [], owners: [{ id: 1, name: 'Alex Mercer' }], can_edit: true, can_delete: false } }));
  api.override('POST /api/customers/12/vendor-cases', ({ body }) => { created = body; cases = [item]; return { status: 201, body: { id: 8 } }; });
  api.override('GET /api/customers/12/vendor-cases/8', () => ({ body: { case: item, updates: [{ id: 1, note: 'Case recorded', status_to: 'open', created_at: '2026-10-15T09:00:00Z', user_name: 'Alex Mercer' }] } }));
  api.override('POST /api/customers/12/vendor-cases/8/updates', ({ body }) => {
    update = body;
    return { status: 201, body: { case: { ...item, status: body.status, attention: null, next_follow_up: body.next_follow_up },
      updates: [{ id: 2, note: body.note, status_from: 'open', status_to: body.status, created_at: '2026-10-19T09:00:00Z', user_name: 'Alex Mercer' },
        { id: 1, note: 'Case recorded', status_to: 'open', created_at: '2026-10-15T09:00:00Z', user_name: 'Alex Mercer' }] } };
  });

  await page.goto('/customers/12/service-profile?section=vendor-cases');
  await expect(page.getByText('No vendor cases recorded.')).toBeVisible();
  await page.getByRole('button', { name: 'Record a case' }).click();
  const form = page.getByRole('dialog', { name: 'Record a vendor case' });
  await form.getByLabel('Vendor').fill('Check Point');
  await form.getByLabel('Case number').fill('6-0003456789');
  await form.getByLabel('Subject').fill('Cluster failover loops');
  await form.getByLabel('Severity').selectOption('high');
  await form.getByLabel('RT ticket').fill('4521');
  await form.getByRole('button', { name: 'Save case' }).click();
  await expect.poll(() => created).toMatchObject({ vendor: 'Check Point', case_number: '6-0003456789', severity: 'high', rt_ticket: '4521', owner_id: 1 });

  const row = page.getByRole('row', { name: /6-0003456789/ });
  await expect(row).toContainText('No update for 9 days');
  await row.getByRole('button', { name: /Check Point 6-0003456789/ }).click();
  const view = page.getByRole('dialog', { name: 'Check Point case 6-0003456789' });
  await expect(view.getByRole('link', { name: /RT #4521/ })).toHaveAttribute('href', /id=4521/);
  await view.getByLabel('What happened').fill('TAC asked for cpinfo; uploaded.');
  await view.getByLabel('Status').selectOption('waiting_vendor');
  await view.getByLabel('Next follow-up').fill('2026-10-22');
  await view.getByRole('button', { name: 'Add update' }).click();
  await expect.poll(() => update).toEqual({ note: 'TAC asked for cpinfo; uploaded.', status: 'waiting_vendor', next_follow_up: '2026-10-22' });
  await expect(view).toContainText('Open → Waiting for vendor');
});

test('Renewals & cases lists what expires and the open vendor cases, each leading to its customer', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  let asked = null;
  api.override('GET /api/renewals', ({ request }) => {
    asked = new URL(request.url()).searchParams.get('days');
    return { body: { days: Number(asked), today: '2026-10-19',
      expiring: [
        { type: 'certificate', id: 4, customer_id: 12, customer_name: 'Northwind Logistics', name: 'vpn.northwind.example', detail: 'DigiCert', date: '2026-10-17', days_left: -2, not_renewing: false, section: 'contracts' },
        { type: 'support', id: 1, customer_id: 12, customer_name: 'Northwind Logistics', name: 'FW-HQ-01', detail: null, date: '2026-11-30', days_left: 42, not_renewing: false, section: 'assets' },
      ],
      vendor_cases: [{ id: 8, customer_id: 12, customer_name: 'Northwind Logistics', vendor: 'Fortinet', case_number: '7712345', subject: 'HA sync errors', severity: 'critical', status: 'waiting_us', open: true, owner_name: null, next_follow_up: '2026-10-19', attention: 'follow_up_due' }] } };
  });
  await page.goto('/renewals');
  await expect(page.getByRole('heading', { name: 'Renewals & cases' })).toBeVisible();
  const expiring = page.getByRole('region', { name: 'Expiring' });
  await expect(expiring.getByRole('row', { name: /vpn\.northwind/ })).toContainText('Expired 2 days ago');
  await expect(expiring.getByRole('link', { name: 'FW-HQ-01' })).toHaveAttribute('href', '/customers/12/service-profile?section=assets');
  await page.getByLabel('How far ahead').selectOption('30');
  await expect.poll(() => asked).toBe('30');
  const cases = page.getByRole('region', { name: 'Open vendor cases' });
  await expect(cases.getByRole('link', { name: 'Fortinet 7712345' })).toHaveAttribute('href', '/customers/12/service-profile?section=vendor-cases&case=8');
  await expect(cases).toContainText('Follow-up due');
});
