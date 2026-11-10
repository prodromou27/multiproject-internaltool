import { defineConfig } from '@playwright/test';

/* Real-stack acceptance (review I06): the built app served by the real server
   (index.js, production mode, every middleware: cookies, CSRF, permissions, file
   handling) against a disposable PostgreSQL database. Nothing is mocked except
   outside providers (no SMTP, Teams or Webex is configured).

     REALSTACK_DATABASE_URL=postgres://user:pass@host/empty_db npm run test:realstack

   The database is filled by the server on first start and by e2e-real/stack.js.
   Build the client first (npm run build): the server serves client/dist. */
const port = Number(process.env.REALSTACK_PORT || 3210);
const hex = char => char.repeat(64);

export default defineConfig({
  testDir: './e2e-real',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-realstack' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    channel: 'chrome',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node index.js',
    cwd: '../server',
    url: `http://127.0.0.1:${port}/api/health`,
    timeout: 120_000,
    reuseExistingServer: false,
    stdout: 'pipe',
    env: {
      NODE_ENV: 'production',
      PORT: String(port),
      DATABASE_URL: process.env.REALSTACK_DATABASE_URL || '',
      APP_URL: `http://127.0.0.1:${port}`,
      JWT_SECRET: 'realstack-'.repeat(5),
      CUSTOMER_FIELD_KEY: hex('a'),
      ATTACHMENT_KEY: hex('b'),
      ADMIN_PASSWORD: 'Realstack#Admin2026',
      TZ: 'UTC',
    },
  },
});
