import { chromium } from '../web/node_modules/playwright/index.mjs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const archive = process.argv[2];
if (!archive) throw new Error('Usage: node scripts/browser-smoke.mjs <local ZIP> [Minecraft version]');
const target = process.argv[3] || '1.21.5';
const root = resolve('.tmp');
await mkdir(root, { recursive: true });
const output = await mkdtemp(join(root, 'browser-smoke-'));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/sbin/chromium', headless: true, chromiumSandbox: true, args: ['--disable-dev-shm-usage'] });
const failures = [];
const pageErrors = [];
const responses = new Map();
let page;
try {
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1050 } });
  page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('requestfailed', request => {
    const url = new URL(request.url());
    if (url.protocol === 'https:') failures.push({ host: url.hostname, error: request.failure()?.errorText });
  });
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.protocol === 'https:') {
      const key = `${url.hostname} ${response.status()}`;
      responses.set(key, (responses.get(key) || 0) + 1);
    }
  });
  await page.goto(process.env.APP_URL || 'http://127.0.0.1:3000', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.getByRole('heading', { name: 'New version. Same modpack.' }).waitFor({ timeout: 60_000 });
  await page.screenshot({ path: join(output, 'landing.png'), fullPage: true });
  await page.locator('input[type=file]').setInputFiles(resolve(archive));
  await page.getByLabel('Minecraft version').fill(target);
  await page.getByRole('button', { name: 'Analyze pack' }).click();
  await Promise.race([
    page.getByRole('heading', { name: 'Check the matches' }).waitFor({ timeout: 360_000 }),
    page.getByRole('alert').waitFor({ timeout: 360_000 }).then(async () => { throw new Error(await page.getByRole('alert').innerText()); }),
  ]);
  const preview = {
    entries: await page.locator('.entry').count(),
    selected: await page.locator('.entry-target .badge').count(),
    warnings: await page.locator('.notice').allTextContents(),
  };
  console.log('Preview', JSON.stringify(preview));
  await page.locator('.preview').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, 'preview.png') });
  await page.getByRole('button', { name: 'Confirm and prepare ZIP' }).click();
  await Promise.race([
    page.locator('.result').waitFor({ timeout: 360_000 }),
    page.getByRole('alert').waitFor({ timeout: 360_000 }).then(async () => { throw new Error(await page.getByRole('alert').innerText()); }),
  ]);
  const result = await page.locator('.result').innerText();
  console.log('Result', result.replaceAll('\n', ' | '));
  const reportPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download report' }).click();
  const reportDownload = await reportPromise;
  const reportDir = join(output, 'report');
  await mkdir(reportDir);
  await reportDownload.saveAs(join(reportDir, 'migration-report.json'));
  const zipButton = page.getByRole('button', { name: 'Download ZIP' });
  if (await zipButton.count()) {
    const zipPromise = page.waitForEvent('download');
    await zipButton.click();
    const download = await zipPromise;
    const zipDir = join(output, 'archive');
    await mkdir(zipDir);
    await download.saveAs(join(zipDir, 'migrated-modpack.zip'));
  }
  await page.locator('.result').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, 'result.png') });
  const summary = { target, preview, result, pageErrors, networkFailures: failures, responses: Object.fromEntries(responses) };
  await writeFile(join(output, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log('Browser errors', JSON.stringify(pageErrors));
  console.log('Provider responses', JSON.stringify(Object.fromEntries(responses)));
  console.log('Network failures', JSON.stringify(failures));
  console.log('Artifacts', output);
  if (pageErrors.length) process.exitCode = 1;
} catch (error) {
  console.error('Browser smoke failed:', error.message);
  console.error('Page errors:', JSON.stringify(pageErrors));
  console.error('Provider responses:', JSON.stringify(Object.fromEntries(responses)));
  console.error('Network failures:', JSON.stringify(failures));
  if (page && !page.isClosed()) {
    await page.screenshot({ path: join(output, 'failure.png'), fullPage: true });
    console.error('Visible state:', await page.locator('body').innerText());
  }
  console.error('Artifacts:', output);
  process.exitCode = 1;
} finally {
  await browser.close();
}
