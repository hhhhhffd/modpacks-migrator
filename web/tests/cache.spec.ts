import { test, expect } from './fixtures';
import { createHash } from 'node:crypto';

const archive = Buffer.from('UEsDBBQAAAAAACmSb13pMpUbEwAAABMAAAANAAAAbW9kcy90ZXN0LmphcnN5bnRoZXRpYyBqYXIgYnl0ZXNQSwECFAMUAAAAAAApkm9d6TKVGxMAAAATAAAADQAAAAAAAAAAAAAAgAEAAAAAbW9kcy90ZXN0LmphclBLBQYAAAAAAQABADsAAAA+AAAAAAA=', 'base64');
const jar = Buffer.from('synthetic jar bytes');
const sha512 = createHash('sha512').update(jar).digest('hex');
const sha1 = createHash('sha1').update(jar).digest('hex');
function version(id: string) {
  return { project_id: 'testmod', id, name: `Test ${id}`, version_number: id, version_type: 'release', date_published: id === 'new' ? '2025-01-01T00:00:00Z' : '2024-01-01T00:00:00Z', game_versions: ['1.21.1'], loaders: ['fabric'], dependencies: [], files: [{ primary: true, filename: `${id}.jar`, url: 'https://cdn.modrinth.com/test.jar', size: jar.length, hashes: { sha1, sha512 } }] };
}

test('reuses successful metadata across selections and invalidates it for a new archive', async ({ page, context }) => {
  const requests: string[] = [];
  await context.route('https://api.modrinth.com/**', async route => {
    const url = route.request().url(); requests.push(url);
    if (url.includes('/version_files')) await route.fulfill({ json: { [sha512]: version('old') }, headers: { 'access-control-allow-origin': '*' } });
    else if (url.includes('/project/testmod/version')) await route.fulfill({ json: [version('new'), version('alternate')], headers: { 'access-control-allow-origin': '*' } });
    else await route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' } });
  });
  await context.route('https://api.curseforge.com/**', async route => {
    requests.push(route.request().url());
    await route.fulfill({ json: { data: { exactMatches: [] } }, headers: { 'access-control-allow-origin': '*' } });
  });
  await page.exposeFunction('providerRequestCount', () => requests.length);
  await page.goto('/');
  const result = await page.evaluate(async bytes => {
    const count = () => (window as unknown as { providerRequestCount(): Promise<number> }).providerRequestCount();
    const { Migrator } = await import('/src/migrator.ts');
    const migrator = new Migrator();
    const request = { target: { minecraftVersion: '1.21.1', loader: 'fabric' as const }, providers: ['modrinth' as const], includeDependencies: true, allowedChannels: ['release' as const], selections: [] as { inputId: string; exclude?: boolean; versionId?: string }[] };
    try {
      const analysis = await migrator.analyzeZip(new Uint8Array(bytes));
      const inputId = analysis.inputs[0].id;
      const first = await migrator.resolveMods(request);
      const initialCount = await count();
      request.selections = [{ inputId, exclude: true }];
      const excluded = await migrator.resolveMods(request);
      request.selections = [];
      const included = await migrator.resolveMods(request);
      request.selections = [{ inputId, versionId: 'alternate' }];
      const alternate = await migrator.resolveMods(request);
      const selectionCount = await count();
      // Change the filename in both ZIP directory records, leaving the JAR itself intact.
      const changed = new Uint8Array(bytes);
      for (let i = 0; i < changed.length - 4; i++) {
        if (changed[i] === 116 && changed[i + 1] === 101 && changed[i + 2] === 115 && changed[i + 3] === 116) changed[i] = 98;
      }
      await migrator.analyzeZip(changed);
      request.selections = [];
      await migrator.resolveMods(request);
      return { first: first.entries[0], excluded: excluded.entries[0], included: included.entries[0], alternate: alternate.entries[0], initialCount, selectionCount, newArchiveCount: await count() };
    } finally { await migrator.dispose(); }
  }, Array.from(archive));
  expect(result.first.selected?.versionId).toBe('new');
  expect(result.excluded.action).toBe('excluded');
  expect(result.included.selected?.versionId).toBe('new');
  expect(result.alternate.selected?.versionId).toBe('alternate');
  expect(result.initialCount).toBe(2);
  expect(result.selectionCount).toBe(result.initialCount);
  expect(result.newArchiveCount).toBe(4);
});

for (const failure of ['HTTP 503', 'oversized response'] as const) test(`snapshots ${failure} until the next analysis`, async ({ page, context }) => {
  let identificationRequests = 0;
  await context.route('https://api.modrinth.com/**', async route => {
    if (route.request().url().includes('/version_files')) {
      identificationRequests++;
      if (identificationRequests === 1) {
        if (failure === 'HTTP 503') return route.fulfill({ status: 503, headers: { 'access-control-allow-origin': '*' } });
        return route.fulfill({ body: Buffer.alloc(8 * 1024 * 1024 + 1), headers: { 'access-control-allow-origin': '*' } });
      }
      return route.fulfill({ json: { [sha512]: version('old') }, headers: { 'access-control-allow-origin': '*' } });
    }
    await route.fulfill({ json: [version('new')], headers: { 'access-control-allow-origin': '*' } });
  });
  await page.exposeFunction('identificationCount', () => identificationRequests);
  await page.goto('/');
  const result = await page.evaluate(async bytes => {
    const { Migrator } = await import('/src/migrator.ts');
    const migrator = new Migrator();
    const count = () => (window as unknown as { identificationCount(): Promise<number> }).identificationCount();
    const request = { target: { minecraftVersion: '1.21.1', loader: 'fabric' as const }, providers: ['modrinth' as const], includeDependencies: true, allowedChannels: ['release' as const], selections: [] };
    try {
      await migrator.analyzeZip(new Uint8Array(bytes));
      const first = await migrator.resolveMods(request);
      const second = await migrator.resolveMods(request);
      const beforeReanalysis = await count();
      await migrator.analyzeZip(new Uint8Array(bytes));
      const recovered = await migrator.resolveMods(request);
      return { first: first.entries[0], second: second.entries[0], beforeReanalysis, recovered: recovered.entries[0] };
    } finally { await migrator.dispose(); }
  }, Array.from(archive));
  expect(result.first.status).toBe('error');
  expect(result.second.status).toBe('error');
  expect(result.second.reason).toBe(result.first.reason);
  expect(result.beforeReanalysis).toBe(1);
  expect(result.recovered.selected?.versionId).toBe('new');
  expect(identificationRequests).toBe(2);
});
