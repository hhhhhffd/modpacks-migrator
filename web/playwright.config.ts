import { defineConfig } from '@playwright/test';

const useFirefox = process.env.PLAYWRIGHT_BROWSER === 'firefox';

export default defineConfig({
  testDir: './tests',
  workers: useFirefox ? 2 : undefined,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: useFirefox ? 'firefox' : 'chromium',
    launchOptions: useFirefox ? {} : {
      executablePath: (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? '/usr/sbin/chromium') || undefined,
      chromiumSandbox: true,
    },
  },
  webServer: { command: 'npm run dev -- --port 4173', url: 'http://127.0.0.1:4173', reuseExistingServer: false },
});
