import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

const project = { id: 1, title: 'Network refresh', description: '', status: 'in_progress', priority: 'medium', members: [], updates: [], created_by: 1, edit_version: 3 };

test('a save over someone else\'s change keeps the input and shows what they changed', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  api.override('GET /api/projects/1', () => ({ body: project }));
  const theirs = { ...project, title: 'Network refresh, phase 2', priority: 'high', edit_version: 4 };
  const saves = [];
  api.override('PUT /api/projects/1', ({ body }) => {
    saves.push(body);
    return body.version === 3
      ? { status: 409, body: { error: 'This project was changed by someone else after you opened it.', code: 'EDIT_CONFLICT', current: theirs } }
      : { body: { ok: true } };
  });
  await page.goto('/projects/1');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const title = dialog.getByRole('textbox').first();
  await title.fill('Network refresh, Rotterdam');
  await dialog.getByRole('button', { name: 'Save' }).click();

  // Refused: the form stays with what was typed, and the panel lists their changes.
  const panel = dialog.getByRole('alert').filter({ hasText: 'Someone else saved this project after you opened it.' });
  await expect(panel).toBeVisible();
  await expect(title).toHaveValue('Network refresh, Rotterdam');
  await expect(panel.getByRole('row', { name: /Title Network refresh, phase 2 Network refresh, Rotterdam/ })).toBeVisible();
  await expect(panel.getByRole('row', { name: /Priority high medium/ })).toBeVisible();

  // "Use theirs" loads their values; nothing is saved until Save.
  await panel.getByRole('button', { name: 'Use theirs' }).click();
  await expect(title).toHaveValue('Network refresh, phase 2');
  await expect(panel).toHaveCount(0);
  expect(saves).toHaveLength(1);

  // A second conflict, then "Keep my changes" saves over the newer version.
  api.override('PUT /api/projects/1', ({ body }) => {
    saves.push(body);
    return body.version === 4
      ? { status: 409, body: { error: 'changed', code: 'EDIT_CONFLICT', current: { ...theirs, description: 'Scope agreed', edit_version: 5 } } }
      : { body: { ok: true } };
  });
  await title.fill('Mine again');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByText('Their changes were to details not shown in this form.')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Keep my changes' }).click();
  await expect(dialog).toHaveCount(0);
  expect(saves.at(-1)).toMatchObject({ title: 'Mine again', version: 5 });
});
