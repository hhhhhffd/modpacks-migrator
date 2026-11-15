import { test, expect } from './fixtures';

const storageKey = 'modpacks-migrator-theme';

test('initially uses the device theme, then persists explicit toggles', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme-preference', 'light');
  await expect(html).toHaveAttribute('data-theme', 'light');

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(html).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(html).toHaveAttribute('data-theme-preference', 'dark');
  await expect(html).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBe('dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.reload();
  await expect(html).toHaveAttribute('data-theme-preference', 'dark');
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await expect(html).toHaveAttribute('data-theme-preference', 'light');
  await expect(html).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBe('light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.reload();
  await expect(html).toHaveAttribute('data-theme-preference', 'light');
  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('button', { name: 'Switch to dark theme' })).toBeVisible();
});

test('uses a dark device theme on first load when no preference is saved', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'dark');
  await expect(page.getByRole('button', { name: 'Switch to light theme' })).toBeVisible();
});

test('applies a saved theme before the app module runs', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript(key => localStorage.setItem(key, 'dark'), storageKey);
  await page.route('**/src/main.tsx', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('remains usable when localStorage is blocked', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } });
  });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const theme = page.getByRole('button', { name: 'Switch to dark theme' });
  await expect(theme).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your next world. Your favorite mods.' })).toBeVisible();
  await theme.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByLabel('Minecraft version')).toBeEnabled();
});

test('places the source link in the header and the author in the footer', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.goto('/');
  const header = page.locator('header.topbar');
  const footer = page.locator('footer.footer');
  const brand = header.locator('.brand');
  const theme = header.getByRole('button', { name: /Switch to (dark|light) theme/ });
  const source = header.getByRole('link', { name: /Source on GitHub/ });
  await expect(source).toBeVisible();
  await expect(source).toContainText('Source on GitHub');
  await expect(source).toHaveAttribute('href', 'https://github.com/hhhhhffd/modpacks-migrator');
  await expect(footer.getByRole('link', { name: /hhhhhffd/ })).toHaveAttribute('href', 'https://github.com/hhhhhffd');
  await expect(header.locator('.author-link')).toHaveCount(0);
  await expect(footer).toContainText(`© ${new Date().getFullYear()}`);
  await expect(footer).toContainText('AGPL-3.0');
  const [brandBox, themeBox, sourceBox] = await Promise.all([brand.boundingBox(), theme.boundingBox(), source.boundingBox()]);
  expect(brandBox).not.toBeNull();
  expect(themeBox).not.toBeNull();
  expect(sourceBox).not.toBeNull();
  expect(brandBox!.x + brandBox!.width).toBeLessThanOrEqual(themeBox!.x + 1);
  expect(themeBox!.x + themeBox!.width).toBeLessThanOrEqual(sourceBox!.x + 1);
});

for (const width of [320, 390, 768, 1100, 1440, 1920]) {
  test(`step tiles stay readable without overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    const steps = page.locator('.journey > li');
    await expect(steps).toHaveCount(3);
    await expect(steps.locator('.step-label')).toHaveText(['Your modpack', 'Review matches', 'Download']);
    for (let i = 0; i < 3; i++) {
      const step = steps.nth(i);
      await expect(step.locator('.step-number')).toBeVisible();
      await expect(step.locator('.step-label')).toBeVisible();
    }
    const geometry = await steps.evaluateAll(elements => elements.map(element => {
      const tile = element.getBoundingClientRect();
      const number = element.querySelector('.step-number')!.getBoundingClientRect();
      const label = element.querySelector('.step-label')!;
      const text = document.createRange();
      text.selectNodeContents(label);
      const labelBox = text.getBoundingClientRect();
      return { tile: { left: tile.left, right: tile.right, top: tile.top, bottom: tile.bottom }, number: { left: number.left, right: number.right, top: number.top, bottom: number.bottom }, label: { left: labelBox.left, right: labelBox.right, top: labelBox.top, bottom: labelBox.bottom }, scrollWidth: label.scrollWidth, clientWidth: label.clientWidth };
    }));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
    for (const { tile, number, label, scrollWidth, clientWidth } of geometry) {
      expect(tile.left).toBeGreaterThanOrEqual(-1);
      expect(tile.right).toBeLessThanOrEqual(width + 1);
      expect(label.left).toBeGreaterThanOrEqual(tile.left - 1);
      expect(label.right).toBeLessThanOrEqual(tile.right + 1);
      expect(label.top).toBeGreaterThanOrEqual(tile.top - 1);
      expect(label.bottom).toBeLessThanOrEqual(tile.bottom + 1);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
      const overlap = number.left < label.right - 1 && number.right > label.left + 1 && number.top < label.bottom - 1 && number.bottom > label.top + 1;
      expect(overlap).toBe(false);
    }
    for (let i = 0; i < geometry.length; i++) for (let j = i + 1; j < geometry.length; j++) {
      const a = geometry[i].tile, b = geometry[j].tile;
      expect(a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1).toBe(false);
    }
  });
}
