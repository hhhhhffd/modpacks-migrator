import { test, expect, gameVersions } from './fixtures';

const catalogUrl = 'https://api.modrinth.com/v2/tag/game_version';
const cors = { 'access-control-allow-origin': '*' };

test('loads grouped Minecraft versions and only permits catalog choices', async ({ page }) => {
  let releaseCatalog!: () => void;
  const released = new Promise<void>(resolve => { releaseCatalog = resolve; });
  await page.route(catalogUrl, async route => {
    await released;
    await route.fulfill({ json: gameVersions, headers: cors });
  });
  await page.goto('/');
  const version = page.getByLabel('Minecraft version');
  try {
    await expect(version).toBeDisabled();
  } finally {
    releaseCatalog();
  }
  await expect(version).toBeEnabled();
  await expect(version).toHaveJSProperty('tagName', 'SELECT');
  await expect(version).toHaveValue('');
  await expect(version.locator('option:checked')).toHaveText('Choose a version');
  await expect(version.locator('optgroup[label="Releases"] option')).toContainText(['1.21.5', '1.21.1', '1.20.1']);
  await expect(version.locator('optgroup').filter({ has: page.locator('option[value="25w10a"]') })).toHaveCount(1);
  await expect(version.locator('option[value="not-a-version"]')).toHaveCount(0);
  await version.selectOption('1.21.1');
  await expect(version).toHaveValue('1.21.1');
});

test('retries a failed Minecraft version catalog request', async ({ page }) => {
  let requests = 0;
  let healthy = false;
  await page.route(catalogUrl, route => {
    requests++;
    return healthy
      ? route.fulfill({ json: gameVersions, headers: cors })
      : route.fulfill({ status: 503, headers: cors });
  });
  await page.goto('/');
  const version = page.getByLabel('Minecraft version');
  await expect(version).toBeDisabled();
  const retry = page.getByRole('button', { name: 'Retry versions' });
  await expect(retry).toBeVisible();
  const initialRequests = requests;
  healthy = true;
  await retry.click();
  await expect(version).toBeEnabled();
  await version.selectOption('1.21.1');
  await expect(version).toHaveValue('1.21.1');
  expect(requests).toBe(initialRequests + 1);
});
