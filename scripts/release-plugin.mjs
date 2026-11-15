import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { closeSync, constants, fstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const names = ['modpacks_migrator_wasm.js', 'modpacks_migrator_wasm_bg.wasm'];
const prefix = Buffer.from('_k0t1k-plugin\n');
const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
const launcherKey = createPublicKey({ key: Buffer.concat([spkiPrefix, Buffer.from('b37Axim0D7VgDNWVIgvlnpdn2nVOMSLM/jIFbRFc/4k=', 'base64')]), format: 'der', type: 'spki' });
const maxSize = 32 * 1024 * 1024;
const hash = data => createHash('sha256').update(data).digest('hex');

function snapshot(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size < 1 || stat.size > maxSize) throw new Error(`Invalid input file: ${path}`);
    const data = Buffer.allocUnsafe(stat.size + 1);
    let offset = 0;
    while (offset < data.length) {
      const n = readSync(fd, data, offset, data.length - offset, null);
      if (!n) break;
      offset += n;
    }
    if (offset !== stat.size) throw new Error(`Input file changed while reading: ${path}`);
    return data.subarray(0, offset);
  } finally {
    closeSync(fd);
  }
}

function workspaceVersion(toml) {
  const sections = toml.split(/^\s*\[[^\]\n]+\]\s*(?:#.*)?$/m);
  const headers = [...toml.matchAll(/^\s*\[([^\]\n]+)\]\s*(?:#.*)?$/gm)];
  const index = headers.findIndex(match => match[1] === 'workspace.package');
  if (index < 0 || headers.filter(match => match[1] === 'workspace.package').length !== 1) throw new Error('Invalid workspace.package section');
  const versions = [...sections[index + 1].matchAll(/^\s*version\s*=\s*"([^"]+)"\s*(?:#.*)?$/gm)];
  if (versions.length !== 1 || !/^\d+\.\d+\.\d+$/.test(versions[0][1])) throw new Error('Invalid workspace version');
  return versions[0][1];
}

export function verifyRelease(out, publicKey = launcherKey) {
  const manifest = readFileSync(join(out, 'plugin.json'));
  const encoded = readFileSync(join(out, 'plugin.json.sig'), 'utf8');
  const signature = Buffer.from(encoded, 'base64');
  if (signature.length !== 64 || signature.toString('base64') !== encoded || !verify(null, Buffer.concat([prefix, manifest]), publicKey, signature)) throw new Error('Invalid manifest signature');
  const parsed = JSON.parse(manifest);
  for (const name of names) {
    if (parsed.files?.[name] !== hash(readFileSync(join(out, name)))) throw new Error(`Invalid file hash: ${name}`);
  }
}

export function prepareRelease({ pkg, out, key, version, publicKey = launcherKey }) {
  const privateKey = createPrivateKey(key);
  const expected = publicKey.export({ format: 'der', type: 'spki' });
  if (privateKey.asymmetricKeyType !== 'ed25519' || publicKey.asymmetricKeyType !== 'ed25519' || !createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).equals(expected)) throw new Error('Signing key does not match launcher public key');
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid workspace version');
  const files = Object.fromEntries(names.map(name => [name, snapshot(join(pkg, name))]));
  const manifest = Buffer.from(`${JSON.stringify({ id: 'modpacks-migrator', version, api: 1, minLauncher: '0.1.0', files: Object.fromEntries(names.map(name => [name, hash(files[name])])) }, null, 2)}\n`);
  const signature = sign(null, Buffer.concat([prefix, manifest]), privateKey).toString('base64');
  if (out) {
    mkdirSync(out);
  } else {
    const parent = join(root, '.tmp');
    mkdirSync(parent, { recursive: true });
    out = mkdtempSync(join(parent, 'plugin-release-'));
  }
  for (const [name, data] of Object.entries({ 'plugin.json': manifest, 'plugin.json.sig': signature, ...files })) writeFileSync(join(out, name), data, { flag: 'wx' });
  verifyRelease(out, publicKey);
  return out;
}

function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: node scripts/release-plugin.mjs [--pkg DIR] [--out NEW_DIR]\nUses existing wasm-bindgen files; does not build or publish.');
    return;
  }
  let pkg = join(root, 'web/public/pkg');
  let out;
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const option = args[i];
    if (!['--pkg', '--out'].includes(option) || seen.has(option) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Invalid arguments; use --help');
    seen.add(option);
    if (option === '--pkg') pkg = resolve(args[++i]);
    else out = resolve(args[++i]);
  }
  const version = workspaceVersion(readFileSync(join(root, 'Cargo.toml'), 'utf8'));
  const key = readFileSync(process.env.K0T1K_PLUGIN_KEY || join(homedir(), '.config/k0t1k/plugin-signing-key.pem'));
  console.log(prepareRelease({ pkg, out, key, version }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(`release-plugin: ${error.message}`); process.exitCode = 1; }
}
