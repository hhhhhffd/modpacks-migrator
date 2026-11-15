import { createHash } from 'node:crypto';
import { test, expect } from './fixtures';

const archive = Buffer.from('UEsDBBQAAAAAACmSb13pMpUbEwAAABMAAAANAAAAbW9kcy90ZXN0LmphcnN5bnRoZXRpYyBqYXIgYnl0ZXNQSwECFAMUAAAAAAApkm9d6TKVGxMAAAATAAAADQAAAAAAAAAAAAAAgAEAAAAAbW9kcy90ZXN0LmphclBLBQYAAAAAAQABADsAAAA+AAAAAAA=', 'base64');
const jar = Buffer.from('synthetic jar bytes');
const sha512 = createHash('sha512').update(jar).digest('hex');
const sha1 = createHash('sha1').update(jar).digest('hex');
const version = {
  project_id: 'testmod', id: 'stable', name: 'Test stable', version_number: 'stable', version_type: 'release',
  date_published: '2025-01-01T00:00:00Z', game_versions: ['1.21.1'], loaders: ['fabric'], dependencies: [],
  files: [{ primary: true, filename: 'stable.jar', url: 'https://cdn.modrinth.com/test.jar', size: jar.length, hashes: { sha1, sha512 } }],
};

test('reports failed downloads and retries without repeating provider analysis', async ({ page, context }) => {
  const providerRequests: string[] = [];
  let cdnHealthy = false;
  let cdnRequests = 0;
  await context.route('https://api.modrinth.com/**', route => {
    const url = route.request().url();
    providerRequests.push(url);
    if (url.includes('/version_files')) return route.fulfill({ json: { [sha512]: version }, headers: { 'access-control-allow-origin': '*' } });
    if (url.includes('/project/testmod/version')) return route.fulfill({ json: [version], headers: { 'access-control-allow-origin': '*' } });
    return route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' } });
  });
  await context.route('https://api.curseforge.com/**', route => {
    providerRequests.push(route.request().url());
    return route.fulfill({ json: { data: { exactMatches: [] } }, headers: { 'access-control-allow-origin': '*' } });
  });
  await context.route('https://cdn.modrinth.com/**', route => {
    cdnRequests++;
    return cdnHealthy
      ? route.fulfill({ body: jar, headers: { 'access-control-allow-origin': '*' } })
      : route.fulfill({ status: 503, headers: { 'access-control-allow-origin': '*' } });
  });

  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({ name: 'pack.zip', mimeType: 'application/zip', buffer: archive });
  await page.getByLabel('Minecraft version').selectOption('1.21.1');
  await page.getByRole('button', { name: /Analyze pack/ }).click();
  await expect(page.getByRole('heading', { name: 'Check the matches' })).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('button', { name: /^Ready/ })).toHaveText('Ready1');
  expect(providerRequests.some(url => url.includes('/version_files'))).toBe(true);
  expect(providerRequests.some(url => url.includes('/project/testmod/version'))).toBe(true);
  const requestsAfterAnalysis = [...providerRequests];

  await page.getByRole('button', { name: /Build modpack/ }).click();
  const result = page.locator('.result');
  await expect(result.getByRole('heading', { name: 'Your modpack could not be built' })).toBeVisible({ timeout: 30000 });
  await expect(result.getByRole('button', { name: /Download ZIP/ })).toHaveCount(0);
  await expect(page.locator('.result-failures')).toContainText(/503|download failed/i);
  await expect(page.getByRole('button', { name: /^Ready/ })).toHaveText('Ready0');
  await expect(page.getByRole('button', { name: /^Needs attention/ })).toHaveText('Needs attention1');
  await expect(page.locator('.entry .reason')).toContainText(/503|download failed/i);
  expect(cdnRequests).toBeGreaterThan(0);
  expect(providerRequests).toEqual(requestsAfterAnalysis);

  cdnHealthy = true;
  const failedCdnRequests = cdnRequests;
  await result.getByRole('button', { name: 'Retry downloads' }).click();
  await expect(result.getByRole('heading', { name: 'Your pack is ready' })).toBeVisible({ timeout: 30000 });
  await expect(result.getByRole('button', { name: /Download ZIP/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Ready/ })).toHaveText('Ready1');
  expect(cdnRequests).toBeGreaterThan(failedCdnRequests);
  expect(providerRequests).toEqual(requestsAfterAnalysis);
});
