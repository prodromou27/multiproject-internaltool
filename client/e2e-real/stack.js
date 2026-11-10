/* Helpers for the real-stack journeys: people with known passwords put straight
   into the test database, signing in through the login page, and API calls made
   the way the app makes them (session cookie + the CSRF header). */
import { createRequire } from 'node:module';
import { expect } from '@playwright/test';

const serverRequire = createRequire(new URL('../../server/package.json', import.meta.url));
const { Client } = serverRequire('pg');
const bcrypt = serverRequire('bcryptjs');

export const PASSWORD = 'Realstack#Pass2026';
export const PEOPLE = {
  manager: { name: 'Rita Manager', email: 'rita.manager@realstack.test', role: 'manager' },
  engineer: { name: 'Eli Engineer', email: 'eli.engineer@realstack.test', role: 'engineer' },
};

/** The people above, with PASSWORD, ready to sign in (no first-login password change). */
export async function seedPeople() {
  const client = new Client({ connectionString: process.env.REALSTACK_DATABASE_URL });
  await client.connect();
  try {
    const hash = bcrypt.hashSync(PASSWORD, 10), ids = {};
    for (const [key, person] of Object.entries(PEOPLE)) {
      const { rows } = await client.query(`INSERT INTO users (name, email, password, role, must_change_password, password_changed_at)
        VALUES ($1, $2, $3, $4, 0, to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
        ON CONFLICT (email) DO UPDATE SET password = EXCLUDED.password, active = 1, must_change_password = 0, role = EXCLUDED.role, custom_role_id = NULL RETURNING id`,
      [person.name, person.email, hash, person.role]);
      ids[key] = rows[0].id;
      await client.query('DELETE FROM user_permission_overrides WHERE user_id = $1', [ids[key]]);
    }
    return ids;
  } finally { await client.end(); }
}

/** Signs in through the login page. */
export async function signIn(page, who) {
  await page.goto('/login');
  await page.getByLabel('Username or Email').fill(PEOPLE[who].email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** An API call from the signed-in page, as the app sends it. */
export async function call(page, method, path, body) {
  const response = await page.request.fetch(`/api${path}`, {
    method, headers: { 'Content-Type': 'application/json', 'X-SolutionsHub-Request': '1' },
    data: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null; try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status(), data };
}
