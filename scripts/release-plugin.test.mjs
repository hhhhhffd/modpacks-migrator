import { generateKeyPairSync, sign, verify } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { prepareRelease, verifyRelease } from './release-plugin.mjs';

const js = 'modpacks_migrator_wasm.js';
const wasm = 'modpacks_migrator_wasm_bg.wasm';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'plugin-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const pkg = join(dir, 'pkg');
  mkdirSync(pkg);
  writeFileSync(join(pkg, js), 'bindings');
  writeFileSync(join(pkg, wasm), Buffer.from([0, 97, 115, 109]));
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return { dir, pkg, out: join(dir, 'out'), key: privateKey.export({ format: 'pem', type: 'pkcs8' }), publicKey, version: '1.2.3' };
}

test('signs the exact prefixed manifest and verifies both files', t => {
  const f = fixture(t);
  prepareRelease(f);
  assert.deepEqual(readdirSync(f.out).sort(), [js, wasm, 'plugin.json', 'plugin.json.sig'].sort());
  const manifest = readFileSync(join(f.out, 'plugin.json'));
  const signature = Buffer.from(readFileSync(join(f.out, 'plugin.json.sig'), 'utf8'), 'base64');
  assert.equal(signature.length, 64);
  assert.ok(verify(null, Buffer.concat([Buffer.from('_k0t1k-plugin\n'), manifest]), f.publicKey, signature));
  assert.deepEqual(signature, sign(null, Buffer.concat([Buffer.from('_k0t1k-plugin\n'), manifest]), f.key));
  const parsed = JSON.parse(manifest);
  assert.deepEqual(Object.keys(parsed), ['id', 'version', 'api', 'minLauncher', 'files']);
  assert.equal(parsed.id, 'modpacks-migrator');
  assert.equal(parsed.version, '1.2.3');
  assert.equal(parsed.api, 1);
  assert.equal(parsed.minLauncher, '0.1.0');
  verifyRelease(f.out, f.publicKey);
  writeFileSync(join(f.out, js), 'tampered');
  assert.throws(() => verifyRelease(f.out, f.publicKey), /hash/);
});

test('detects manifest tampering', t => {
  const f = fixture(t);
  prepareRelease(f);
  writeFileSync(join(f.out, 'plugin.json'), '{}');
  assert.throws(() => verifyRelease(f.out, f.publicKey), /signature/);
});

test('rejects a wrong key before creating output', t => {
  const f = fixture(t);
  f.publicKey = generateKeyPairSync('ed25519').publicKey;
  assert.throws(() => prepareRelease(f), /does not match/);
  assert.throws(() => readdirSync(f.out), { code: 'ENOENT' });
});

test('rejects existing output without touching it', t => {
  const f = fixture(t);
  mkdirSync(f.out);
  writeFileSync(join(f.out, 'keep'), 'untouched');
  assert.throws(() => prepareRelease(f), { code: 'EEXIST' });
  assert.equal(readFileSync(join(f.out, 'keep'), 'utf8'), 'untouched');
});

test('rejects missing, symlinked and empty inputs before output creation', t => {
  const f = fixture(t);
  rmSync(join(f.pkg, js));
  assert.throws(() => prepareRelease(f), { code: 'ENOENT' });
  symlinkSync(join(f.pkg, wasm), join(f.pkg, js));
  assert.throws(() => prepareRelease(f));
  rmSync(join(f.pkg, js));
  writeFileSync(join(f.pkg, js), '');
  assert.throws(() => prepareRelease(f), /Invalid input/);
  assert.throws(() => readdirSync(f.out), { code: 'ENOENT' });
});

test('CLI always rejects a synthetic key against the pinned launcher key', t => {
  const f = fixture(t);
  const keyPath = join(f.dir, 'key.pem');
  writeFileSync(keyPath, f.key);
  const result = spawnSync(process.execPath, [new URL('./release-plugin.mjs', import.meta.url).pathname, '--pkg', f.pkg, '--out', f.out], { env: { ...process.env, K0T1K_PLUGIN_KEY: keyPath }, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not match/);
  assert.throws(() => readdirSync(f.out), { code: 'ENOENT' });
});

test('--help does not read the key or create output', () => {
  const result = spawnSync(process.execPath, [new URL('./release-plugin.mjs', import.meta.url).pathname, '--help'], { env: { ...process.env, K0T1K_PLUGIN_KEY: '/does/not/exist' }, encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
});
