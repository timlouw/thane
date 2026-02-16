import { defineConfig, devices } from '@playwright/test';

const traceMode = process.env.PW_E2E_TRACE === '1' ? 'on' : 'retain-on-failure';
const headedMode = process.env.PW_E2E_HEADED === '1';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: traceMode,
    screenshot: 'only-on-failure',
    headless: !headedMode,
  },
  webServer: {
    command: 'bun run e2e:build && bun run e2e:serve',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 180_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
});
