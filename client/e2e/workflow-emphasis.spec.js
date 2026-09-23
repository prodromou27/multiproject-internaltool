import { test,expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

const overview={
  scope:'personal',as_of:'2026-09-21',
  tasks:{ open:2,overdue:0,due_today:0,waiting_customer:0,awaiting_approval:0,attention:[] },
  projects:{ active:1,overdue:0,awaiting_approval:0,waiting_customer:0,commitments:[] },
  visits:{ reports_pending:0,upcoming:1,customer_delivery_pending:0,reports:[],upcoming_items:[] },
  approvals:{ managed_reports:0,reports:[] },
  service:{ enabled:true,today:2,week:7,hours:4.5,pending:1,due:1,follow_ups:[{ id:8,title:'Confirm gateway upgrade',follow_up_date:'2026-09-21' }],recent:[{ id:9,title:'Reviewed firewall policy',activity_date:'2026-09-20' }] },
};

test('Managed Services emphasis leads with customer operations while shared delivery modules remain available',async ({ page }) => {
  const api=await mockApi(page,{ teams:[{ id:1,name:'Managed Services',service_activity_enabled:1,managed_service_operations:1,project_delivery_enabled:0 }] });
  api.override('GET /api/operations/overview',() => ({ body:overview }));
  api.override('GET /api/operations/my-managed-customers',() => ({ body:{ rows:[{ id:12,name:'Northwind',activities_this_month:5,ticketing_enabled:true,open_tickets:2 }] } }));
  await page.goto('/my-day');
  await expect(page.getByText('Managed Services focus')).toBeVisible();
  await expect(page.locator('.workflow-banner').getByRole('link',{ name:'Log activity' })).toBeVisible();
  await expect(page.getByRole('link',{ name:'Northwind' })).toBeVisible();
  await expect(page.getByRole('link',{ name:'Projects' }).first()).toBeVisible();
  await expect(page.getByRole('link',{ name:'Tasks' }).first()).toBeVisible();
  await expect(page.getByRole('link',{ name:'Maintenance Visits' }).first()).toBeVisible();
});

test('Project Delivery emphasis leads with delivery actions and keeps authorized service work available',async ({ page }) => {
  const api=await mockApi(page,{ teams:[{ id:2,name:'Delivery',service_activity_enabled:1,managed_service_operations:0,project_delivery_enabled:1 }] });
  api.override('GET /api/operations/overview',() => ({ body:overview }));
  await page.goto('/my-day');
  await expect(page.getByText('Project Delivery focus')).toBeVisible();
  await expect(page.locator('.workflow-banner').getByRole('link',{ name:'Open tasks' })).toHaveClass(/btn-primary/);
  await expect(page.getByRole('link',{ name:'Activity Log' }).first()).toBeVisible();
});
