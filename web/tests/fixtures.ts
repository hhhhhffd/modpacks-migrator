import { test as base, expect } from '@playwright/test';

export const gameVersions = [
  { version: '1.21.5', version_type: 'release', date: '2025-03-25T00:00:00Z', major: true },
  { version: '1.21.1', version_type: 'release', date: '2024-08-08T00:00:00Z', major: false },
  { version: '1.20.1', version_type: 'release', date: '2023-06-12T00:00:00Z', major: false },
  { version: '25w10a', version_type: 'snapshot', date: '2025-03-05T00:00:00Z', major: false },
];

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route('https://api.modrinth.com/v2/tag/game_version', route => route.fulfill({
      json: gameVersions,
      headers: { 'access-control-allow-origin': '*' },
    }));
    await use(page);
  },
});

export { expect };
