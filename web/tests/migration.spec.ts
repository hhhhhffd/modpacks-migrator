import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';

const archive = Buffer.from('UEsDBBQAAAAAACmSb13pMpUbEwAAABMAAAANAAAAbW9kcy90ZXN0LmphcnN5bnRoZXRpYyBqYXIgYnl0ZXNQSwECFAMUAAAAAAApkm9d6TKVGxMAAAATAAAADQAAAAAAAAAAAAAAgAEAAAAAbW9kcy90ZXN0LmphclBLBQYAAAAAAQABADsAAAA+AAAAAAA=', 'base64');
const jar = Buffer.from('synthetic jar bytes');
const sha512 = createHash('sha512').update(jar).digest('hex');
const sha1 = createHash('sha1').update(jar).digest('hex');
function version(id: string, channel: string, date: string) {
  return { project_id: 'testmod', id, name: `Test ${id}`, version_number: id, version_type: channel, date_published: date, game_versions: ['1.21.1'], loaders: ['fabric'], dependencies: [], files: [{ primary: true, filename: `${id}.jar`, url: 'https://cdn.modrinth.com/test.jar', size: jar.length, hashes: { sha1, sha512 } }] };
}
test('analyzes a local ZIP, reviews alpha, and downloads a report', async ({ page, context }) => {
  await context.route('https://api.modrinth.com/**', async route => {
    const url = route.request().url();
    if (url.includes('/version_files')) await route.fulfill({ json: { [sha512]: version('old', 'release', '2024-01-01T00:00:00Z') }, headers: { 'access-control-allow-origin': '*' } });
    else if (url.includes('/project/testmod/version')) await route.fulfill({ json: [version('alpha1', 'alpha', '2025-01-01T00:00:00Z'), version('stable', 'release', '2024-01-01T00:00:00Z')], headers: { 'access-control-allow-origin': '*' } });
    else await route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' } });
  });
  await context.route('https://api.curseforge.com/**', route => route.fulfill({ json: { data: { exactMatches: [] } }, headers: { 'access-control-allow-origin': '*' } }));
  await context.route('https://cdn.modrinth.com/**', route => route.fulfill({ body: jar, headers: { 'access-control-allow-origin': '*' } }));
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({ name: 'pack.zip', mimeType: 'application/zip', buffer: archive });
  await page.getByPlaceholder('e.g. 1.21.1').fill('1.21.1');
  await page.getByRole('button', { name: /Analyze pack/ }).click();
  await expect(page.getByRole('heading', { name: 'Check the matches' })).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.badge.alpha')).toHaveText('alpha');
  await page.getByLabel('Version for mods/test.jar').selectOption('stable');
  await expect(page.locator('.badge.release')).toHaveText('release');
  await page.getByRole('button', { name: 'Exclude' }).click();
  await expect(page.getByRole('button', { name: 'Include' })).toBeVisible();
  await page.getByRole('button', { name: 'Include' }).click();
  await expect(page.locator('.badge.alpha')).toHaveText('alpha');
  await page.getByRole('button', { name: /Confirm and prepare ZIP/ }).click();
  await expect(page.getByRole('heading', { name: 'Your pack is ready' })).toBeVisible({ timeout: 30000 });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /Download report/ }).click();
  expect((await download).suggestedFilename()).toBe('migration-report.json');
});

test('cancels an in-flight provider request', async ({ page, context }) => {
  let signalRequest!: () => void;
  const requested = new Promise<void>(resolve => { signalRequest = resolve; });
  await context.route('https://api.modrinth.com/**', async route => {
    signalRequest();
    await new Promise(resolve => setTimeout(resolve, 1000));
    await route.fulfill({ json: {}, headers: { 'access-control-allow-origin': '*' } }).catch(() => {});
  });
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({ name: 'pack.zip', mimeType: 'application/zip', buffer: archive });
  await page.getByPlaceholder('e.g. 1.21.1').fill('1.21.1');
  await page.getByRole('button', { name: /Analyze pack/ }).click();
  await requested;
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('alert')).toContainText('cancelled');
  await expect(page.getByRole('button', { name: /Analyze pack/ })).toBeEnabled();
});

test('rejects invalid ZIP without a server fallback', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({ name: 'invalid.zip', mimeType: 'application/zip', buffer: Buffer.from('not a zip') });
  await page.getByPlaceholder('e.g. 1.21.1').fill('1.21.1');
  await page.getByRole('button', { name: /Analyze pack/ }).click();
  await expect(page.getByRole('alert')).toContainText('ZIP');
});
