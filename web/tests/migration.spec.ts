import { test, expect } from './fixtures';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

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
  await page.getByLabel('Minecraft version').selectOption('1.21.1');
  await page.getByRole('button', { name: /Analyze pack/ }).click();
  await expect(page.getByRole('heading', { name: 'Check the matches' })).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.badge.alpha')).toHaveText('alpha');
  await expect(page.locator('.mod-identity strong')).toHaveText('test');
  await page.getByLabel('Version for mods/test.jar').selectOption('stable');
  await expect(page.locator('.badge.release')).toHaveText('release');
  await page.getByRole('button', { name: /^Remove / }).click();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
  await expect(page.locator('.entry')).toHaveClass(/is-removed/);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.badge.release')).toHaveText('release');
  await expect(page.getByLabel('Version for mods/test.jar')).toHaveValue('stable');
  await page.getByRole('button', { name: /Build modpack/ }).click();
  await expect(page.getByRole('heading', { name: 'Your pack is ready' })).toBeVisible({ timeout: 30000 });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /Download report/ }).click();
  expect((await download).suggestedFilename()).toBe('migration-report.json');
  const footer = page.locator('.preview-footer');
  await expect(footer).toHaveCSS('position', 'static');
  await expect(footer).toContainText('Pack built · 1 JAR included');
  await expect(footer.getByRole('button', { name: 'Build modpack' })).toBeVisible();
  const zipDownload = page.waitForEvent('download');
  await footer.getByRole('button', { name: 'Download ZIP' }).click();
  expect((await zipDownload).suggestedFilename()).toBe('migrated-modpack.zip');
  await page.setViewportSize({ width: 768, height: 1024 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(footer.getByRole('button', { name: 'Download ZIP' })).toBeVisible();
  await expect(footer.getByRole('button', { name: 'Build modpack' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel('Version for mods/test.jar').selectOption('alpha1');
  await expect(footer.getByRole('button', { name: 'Download ZIP' })).toHaveCount(0);
  await expect(page.locator('.result')).toHaveCount(0);
  await expect(footer.getByRole('button', { name: 'Build modpack' })).toBeEnabled();
});

test('locks target controls while resolving and preserves the confirmed target', async ({ page, context }) => {
  let signalRequest!: () => void;
  let releaseRequest!: () => void;
  const requested = new Promise<void>(resolve => { signalRequest = resolve; });
  const released = new Promise<void>(resolve => { releaseRequest = resolve; });
  await context.route('https://api.modrinth.com/**', async route => {
    if (route.request().url().includes('/version_files')) {
      signalRequest();
      await released;
      await route.fulfill({ json: { [sha512]: version('old', 'release', '2024-01-01T00:00:00Z') }, headers: { 'access-control-allow-origin': '*' } });
    } else {
      await route.fulfill({ json: [version('stable', 'release', '2025-01-01T00:00:00Z')], headers: { 'access-control-allow-origin': '*' } });
    }
  });
  await context.route('https://api.curseforge.com/**', route => route.fulfill({ json: { data: { exactMatches: [] } }, headers: { 'access-control-allow-origin': '*' } }));
  await context.route('https://cdn.modrinth.com/**', route => route.fulfill({ body: jar, headers: { 'access-control-allow-origin': '*' } }));
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({ name: 'pack.zip', mimeType: 'application/zip', buffer: archive });
  const versionInput = page.getByLabel('Minecraft version');
  await versionInput.selectOption('1.21.1');
  await page.getByRole('button', { name: /Analyze pack/ }).click();
  await requested;
  await expect(versionInput).toBeDisabled();
  await expect(page.locator('input[type=file]')).toBeDisabled();
  await expect(page.getByLabel('Loader')).toBeDisabled();
  await expect(page.getByLabel(/Include required dependencies/)).toBeDisabled();
  releaseRequest();
  await expect(page.getByRole('heading', { name: 'Check the matches' })).toBeVisible();
  await expect(versionInput).toHaveValue('1.21.1');
  await page.getByRole('button', { name: /Build modpack/ }).click();
  await expect(page.getByRole('heading', { name: 'Your pack is ready' })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Download report/ }).click();
  const path = await (await downloadPromise).path();
  expect(JSON.parse(await readFile(path, 'utf8')).target.minecraftVersion).toBe('1.21.1');
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
  await page.getByLabel('Minecraft version').selectOption('1.21.1');
  await page.getByRole('button', { name: /Analyze pack/ }).click();
  await requested;
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('alert')).toContainText('cancelled');
  await expect(page.getByRole('button', { name: /Analyze pack/ })).toBeEnabled();
});

test('shows repository and author links even before the repository exists', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.repo-link')).toHaveAttribute('href', 'https://github.com/hhhhhffd/modpacks-migrator');
  await expect(page.locator('.author-link')).toHaveAttribute('href', 'https://github.com/hhhhhffd');
  await expect(page.locator('.author-link')).toContainText('hhhhhffd');
  await expect(page).toHaveTitle(/hhhhhffd/);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('link', { name: 'Source on GitHub', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your next world. Your favorite mods.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('keeps removal local, supports undo and search without restarting review', async ({ page, context }) => {
  let calls = 0;
  await context.route('https://api.modrinth.com/**', async route => {
    calls++;
    const json = route.request().url().includes('/version_files')
      ? { [sha512]: version('old', 'release', '2024-01-01T00:00:00Z') }
      : [version('stable', 'release', '2025-01-01T00:00:00Z')];
    await route.fulfill({ json });
  });
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({ name: 'pack.zip', mimeType: 'application/zip', buffer: archive });
  await page.getByLabel('Minecraft version').selectOption('1.21.1');
  await page.getByRole('button', { name: /Analyze pack/ }).click();
  await expect(page.getByRole('heading', { name: 'Check the matches' })).toBeVisible();
  const initialCalls = calls;
  await page.getByRole('button', { name: /^Remove / }).click();
  await expect(page.locator('.entry')).toHaveClass(/is-removed/);
  await expect(page.locator('.selection-status')).toContainText('Changes saved locally');
  await expect(page.locator('.operation-status')).toHaveCount(0);
  await page.getByRole('button', { name: /^Removed/ }).click();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.selection-status')).toContainText('Changes saved locally');
  await expect(page.locator('.empty-list')).toContainText('Nothing left behind');
  await page.getByRole('button', { name: /^All mods/ }).click();
  await page.getByRole('searchbox', { name: 'Search mods' }).fill('does-not-exist');
  await expect(page.locator('.empty-list')).toContainText('No mods here');
  await page.getByRole('button', { name: 'Show all mods' }).click();
  await expect(page.locator('.entry')).toHaveCount(1);
  expect(calls).toBe(initialCalls);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByLabel('Version for mods/test.jar')).toBeVisible();
  await page.getByRole('button', { name: /^Remove / }).click();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
});

test('replaces a project explicitly and traps focus during pending search', async ({ page, context }) => {
  let releaseSearch!: () => void;
  const searchReleased = new Promise<void>(resolve => { releaseSearch = resolve; });
  const replacement = { ...version('replacement-v1', 'beta', '2025-01-01T00:00:00Z'), project_id: 'replacement', name: 'A different mod' };
  await context.route('https://api.modrinth.com/**', async route => {
    const url = route.request().url();
    if (url.includes('/search')) await searchReleased;
    const json = url.includes('/version_files') ? { [sha512]: version('old', 'release', '2024-01-01T00:00:00Z') }
      : url.includes('/search') ? { hits: [{ project_id: 'replacement', title: 'A different mod', description: 'An explicit replacement project' }] }
      : url.includes('/project/replacement/version') ? [replacement]
      : [version('stable', 'release', '2025-01-01T00:00:00Z')];
    await route.fulfill({ json });
  });
  await context.route('https://cdn.modrinth.com/**', route => route.fulfill({ body: jar }));
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({ name: 'pack.zip', mimeType: 'application/zip', buffer: archive });
  await page.getByLabel('Minecraft version').selectOption('1.21.1');
  await page.getByRole('button', { name: /Analyze pack/ }).click();
  const replaceButton = page.getByRole('button', { name: 'Replace', exact: true });
  await replaceButton.click();
  await expect(page.getByLabel('Project name or ID')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(replaceButton).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await replaceButton.click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel('Project name or ID').fill('different');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  try {
    await expect(page.getByLabel('Project name or ID')).toBeDisabled();
    for (const key of ['Tab', 'Shift+Tab', 'Tab', 'Tab', 'Shift+Tab']) {
      await page.keyboard.press(key);
      expect(await page.getByRole('dialog').evaluate(dialog => dialog.contains(document.activeElement))).toBe(true);
    }
  } finally { releaseSearch(); }
  await page.getByRole('button', { name: /A different mod An explicit/ }).click();
  await page.getByRole('button', { name: /replacement-v1.*Choose/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.provider-link')).toContainText('Manual replacement');
  await expect(page.locator('.badge.beta')).toBeVisible();
  await page.getByRole('button', { name: /Build modpack/ }).click();
  await expect(page.getByRole('heading', { name: 'Your pack is ready' })).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: /Download report/ }).click();
  const report = JSON.parse(await readFile(await (await downloaded).path(), 'utf8'));
  expect(report.entries[0].action).toBe('replacement');
  expect(report.entries[0].selected.projectId).toBe('replacement');
});

test('moves blocked dependents out of Ready and restores them with Undo', async ({ page, context }) => {
  const dependent = { ...version('stable', 'release', '2025-01-01T00:00:00Z'), dependencies: [{ project_id: 'library', version_id: null, dependency_type: 'required' }] };
  const library = { ...version('library-v1', 'release', '2024-01-01T00:00:00Z'), project_id: 'library' };
  await context.route('https://api.modrinth.com/**', route => {
    const url = route.request().url();
    return route.fulfill({ json: url.includes('/version_files') ? { [sha512]: version('old', 'release', '2024-01-01T00:00:00Z') }
      : url.includes('/project/library/version') ? [library] : [dependent] });
  });
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({ name: 'pack.zip', mimeType: 'application/zip', buffer: archive });
  await page.getByLabel('Minecraft version').selectOption('1.21.1');
  await page.getByRole('button', { name: /Analyze pack/ }).click();
  await expect(page.getByRole('button', { name: /^Ready/ })).toHaveText('Ready2');
  const dependency = page.locator('.entry[data-input-id="dependency-Modrinth-library"]');
  await dependency.getByRole('button', { name: /^Remove / }).click();
  await expect(page.locator('.selection-status')).toContainText('Changes saved locally');
  await expect(page.getByRole('button', { name: /^Ready/ })).toHaveText('Ready0');
  await expect(page.getByRole('button', { name: /^Needs attention/ })).toHaveText('Needs attention1');
  await expect(page.getByRole('button', { name: /Build modpack/ })).toBeDisabled();
  await page.getByRole('button', { name: /^Needs attention/ }).click();
  await expect(page.locator('.entry')).toHaveCount(1);
  await expect(page.locator('.entry .reason')).toContainText('excluded');
  await page.getByRole('button', { name: /^Removed/ }).click();
  await dependency.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('button', { name: /^Ready/ })).toHaveText('Ready2');
  await expect(page.getByRole('button', { name: /Build modpack/ })).toBeEnabled();
});

test('cancels a background dependency update and safely analyzes again', async ({ page, context }) => {
  let signalRequest!: () => void;
  let releaseRequest!: () => void;
  const requested = new Promise<void>(resolve => { signalRequest = resolve; });
  const released = new Promise<void>(resolve => { releaseRequest = resolve; });
  const alternative = { ...version('requires-library', 'release', '2024-01-01T00:00:00Z'), dependencies: [{ project_id: 'library', version_id: null, dependency_type: 'required' }] };
  await context.route('https://api.modrinth.com/**', async route => {
    const url = route.request().url();
    if (url.includes('/project/library/version')) { signalRequest(); await released; }
    await route.fulfill({ json: url.includes('/version_files') ? { [sha512]: version('old', 'release', '2024-01-01T00:00:00Z') }
      : url.includes('/project/library/version') ? [{ ...version('library-v1', 'release', '2024-01-01T00:00:00Z'), project_id: 'library' }]
      : [version('alpha1', 'alpha', '2025-01-01T00:00:00Z'), alternative] });
  });
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({ name: 'pack.zip', mimeType: 'application/zip', buffer: archive });
  await page.getByLabel('Minecraft version').selectOption('1.21.1');
  await page.getByRole('button', { name: /Analyze pack/ }).click();
  await page.getByLabel('Version for mods/test.jar').selectOption('requires-library');
  await requested;
  try {
    await expect(page.locator('.operation-status')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Build modpack/ })).toBeDisabled();
    await page.getByRole('button', { name: 'Cancel update' }).click();
    await expect(page.getByRole('alert')).toContainText('cancelled');
    await expect(page.getByRole('heading', { name: 'Check the matches' })).toHaveCount(0);
  } finally { releaseRequest(); }
  await page.getByRole('button', { name: /Analyze pack/ }).click();
  await expect(page.getByRole('heading', { name: 'Check the matches' })).toBeVisible();
  await expect(page.locator('.entry')).toHaveCount(1);
  await expect(page.getByLabel('Version for mods/test.jar')).toHaveValue('alpha1');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Build modpack/ })).toBeEnabled();
});

test('rejects invalid ZIP without a server fallback', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({ name: 'invalid.zip', mimeType: 'application/zip', buffer: Buffer.from('not a zip') });
  await page.getByLabel('Minecraft version').selectOption('1.21.1');
  await page.getByRole('button', { name: /Analyze pack/ }).click();
  await expect(page.getByRole('alert')).toContainText('ZIP');
});
