import { createHash } from 'node:crypto';
import { test, expect } from './fixtures';

const single = Buffer.from('UEsDBBQAAAAAACmSb13pMpUbEwAAABMAAAANAAAAbW9kcy90ZXN0LmphcnN5bnRoZXRpYyBqYXIgYnl0ZXNQSwECFAMUAAAAAAApkm9d6TKVGxMAAAATAAAADQAAAAAAAAAAAAAAgAEAAAAAbW9kcy90ZXN0LmphclBLBQYAAAAAAQABADsAAAA+AAAAAAA=', 'base64');
const jar = Buffer.from('synthetic jar bytes');
const sha512 = createHash('sha512').update(jar).digest('hex');
const sha1 = createHash('sha1').update(jar).digest('hex');

// Reuse the valid stored entry and CRC, changing only equal-length names and offsets.
// The worker reserves one OPFS handle per input even though identical JARs deduplicate.
const locals: Buffer[] = [], directory: Buffer[] = [];
for (let i = 0; i < 75; i++) {
  const name = `mods/${String(i).padStart(4, '0')}.jar`;
  const local = Buffer.from(single.subarray(0, 62));
  const central = Buffer.from(single.subarray(62, 121));
  local.write(name, 30); central.write(name, 46); central.writeUInt32LE(i * 62, 42);
  locals.push(local); directory.push(central);
}
const end = Buffer.from(single.subarray(121));
end.writeUInt16LE(75, 8); end.writeUInt16LE(75, 10);
end.writeUInt32LE(75 * 59, 12); end.writeUInt32LE(75 * 62, 16);
const archive = Buffer.concat([...locals, ...directory, end]);

test('closes all completed OPFS handles before disposal and rejects later work', async ({ page, context }) => {
  const version = { project_id: 'testmod', id: 'stable', name: 'Test', version_number: '1', version_type: 'release', date_published: '2025-01-01T00:00:00Z', game_versions: ['1.21.1'], loaders: ['fabric'], dependencies: [], files: [{ primary: true, filename: 'test.jar', url: 'https://cdn.modrinth.com/test.jar', size: jar.length, hashes: { sha1, sha512 } }] };
  await context.route('https://api.modrinth.com/**', route => route.fulfill({ json: route.request().url().includes('/version_files') ? { [sha512]: version } : [version] }));
  await context.route('https://cdn.modrinth.com/**', route => route.fulfill({ body: jar }));
  await page.goto('/');
  const result = await page.evaluate(async bytes => {
    const { Migrator } = await import('/src/migrator.ts');
    const migrator = new Migrator();
    const root = await navigator.storage.getDirectory();
    const before = new Set<string>();
    for await (const name of root.keys()) before.add(name);
    await migrator.analyzeZip(new Uint8Array(bytes));
    await migrator.resolveMods({ target: { minecraftVersion: '1.21.1', loader: 'fabric' }, providers: ['modrinth'], includeDependencies: true, allowedChannels: ['release'], selections: [] });
    const converted = await migrator.convertZip();
    const created: string[] = [];
    for await (const name of root.keys()) if (!before.has(name)) created.push(name);
    await migrator.dispose();
    await migrator.dispose();
    const remaining: string[] = [];
    for await (const name of root.keys()) if (created.includes(name)) remaining.push(name);
    let afterDispose = '';
    try { await migrator.analyzeZip(new Uint8Array(bytes)); }
    catch (error) { afterDispose = String(error); }
    return { status: converted.report.status, entries: converted.report.entries.length, created: created.length, remaining, afterDispose };
  }, Array.from(archive));
  expect(result.status).toBe('completed');
  expect(result.entries).toBe(75);
  expect(result.created).toBe(1);
  expect(result.remaining).toEqual([]);
  expect(result.afterDispose).toContain('Migrator disposed.');
});
