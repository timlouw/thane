import { defineConfig, devices } from '@playwright/test';

const traceMode = process.env.PW_E2E_TRACE === '1' ? 'on' : 'retain-on-failure';
const headedMode = process.env.PW_E2E_HEADED === '1';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: true,
  reporter: [['list']],
  use: {
    trace: traceMode,
    screenshot: 'only-on-failure',
    headless: !headedMode,
  },
  webServer: {
    command: [
      'bun run build',
      'bun ./dist/compiler/cli/thane.js build --entry ./e2e/contract-app/main.ts --out ./dist/e2e --html ./e2e/contract-app/index.html --assets ./e2e/contract-app/assets',
      'bun ./dist/compiler/cli/thane.js build --entry ./e2e/router-app/main.ts --out ./dist/e2e-router --html ./e2e/router-app/index.html',
      'bun ./e2e/server.ts',
    ].join(' && '),
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    {
      name: 'contract-chromium',
      testIgnore: 'router.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4173' },
    },
    {
      name: 'contract-firefox',
      testIgnore: 'router.spec.ts',
      use: { ...devices['Desktop Firefox'], baseURL: 'http://127.0.0.1:4173' },
    },
    {
      name: 'contract-webkit',
      testIgnore: 'router.spec.ts',
      use: { ...devices['Desktop Safari'], baseURL: 'http://127.0.0.1:4173' },
    },
    {
      name: 'router-chromium',
      testMatch: 'router.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4174' },
    },
  ],
});
