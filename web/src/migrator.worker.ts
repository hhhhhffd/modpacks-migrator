// The worker owns all filesystem handles; input is read in bounded slices.
const scope = self as unknown as DedicatedWorkerGlobalScope;
type SyncHandle = { read(buffer: ArrayBufferView, options?: { at?: number }): number; write(buffer: ArrayBufferView, options?: { at?: number }): number; getSize(): number; truncate(size: number): void; flush(): void; close(): void };
type SyncFileHandle = FileSystemFileHandle & { createSyncAccessHandle(): Promise<SyncHandle> };
type Wasm = { default(): Promise<void>; BrowserMigrator: new (adapter: unknown) => { analyzeZip(size: number): unknown; resolveMods(request: unknown): Promise<{ entries: unknown[] }>; searchProjects(provider: string, query: string): Promise<unknown>; listCandidates(provider: string, projectId: string, target: unknown): Promise<unknown>; convertZip(): Promise<unknown>; free(): void } };
let migrator: InstanceType<Wasm['BrowserMigrator']> | undefined;
let input: Blob | undefined;
let directory: FileSystemDirectoryHandle | undefined;
let directoryName = '';
let output: SyncHandle | undefined;
let outputFile: FileSystemFileHandle | undefined;
let handles: SyncHandle[] = [];
let artifacts = new Map<string, SyncHandle>();
let resolutionCount = 0;
let controller = new AbortController();
const reader = new FileReaderSync();
const cacheLimit = 32 * 1024 * 1024;
type CachedResponse = { status: number; headers: [string, string][]; body: Uint8Array; size: number };
const metadataCache = new Map<string, CachedResponse>();
let cacheSize = 0;
let cacheGeneration = 0;
let converting = false;
function clearMetadataCache() { metadataCache.clear(); cacheSize = 0; cacheGeneration++; }
async function cacheKey(method: string, url: string, headers: Headers, body: Uint8Array) {
  // Hash headers too, so credentials never appear in cache keys and variants cannot collide.
  const prefix = new TextEncoder().encode(JSON.stringify([method, url, Array.from(headers.entries())]));
  const bytes = new Uint8Array(prefix.length + body.length); bytes.set(prefix); bytes.set(body, prefix.length);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
}
function storageError(error: unknown): Error { return Object.assign(new Error(`Browser storage is unavailable or full. Allow site storage and try again. ${error instanceof Error ? error.message : String(error)}`), { code: 'resource' }); }
function closeFiles() { for (const handle of handles) handle.close(); handles = []; artifacts.clear(); output?.close(); output = undefined; outputFile = undefined; }
async function cleanup() { controller.abort(); closeFiles(); if (directoryName) { const root = await navigator.storage.getDirectory(); await root.removeEntry(directoryName, { recursive: true }); directoryName = ''; directory = undefined; } }
async function prepareStorage(count: number) {
  try {
    if (!navigator.storage?.getDirectory) throw new Error('Origin private file system is not supported by this browser.');
    const root = await navigator.storage.getDirectory();
    if (!directory) { directoryName = `modpacks-migrator-${crypto.randomUUID()}`; scope.postMessage({ directoryName }); directory = await root.getDirectoryHandle(directoryName, { create: true }); }
    closeFiles();
    outputFile = await directory.getFileHandle('output.zip', { create: true });
    output = await (outputFile as SyncFileHandle).createSyncAccessHandle(); output.truncate(0);
    for (let i = 0; i < count; i++) { const file = await directory.getFileHandle(`artifact-${i}`, { create: true }); const handle = await (file as SyncFileHandle).createSyncAccessHandle(); handle.truncate(0); handles.push(handle); }
  } catch (error) { throw storageError(error); }
}
const adapter = {
  readInput(offset: number, length: number) { if (!input) throw new Error('Choose an archive first.'); return new Uint8Array(reader.readAsArrayBuffer(input.slice(offset, offset + length))); },
  writeOutput(offset: number, data: Uint8Array) { if (!output || output.write(data, { at: offset }) !== data.length) throw storageError('Could not write the output ZIP.'); },
  writeArtifact(key: string, data: Uint8Array) { let handle = artifacts.get(key); if (!handle) { handle = handles[artifacts.size]; if (!handle) throw storageError('Too many staged files.'); artifacts.set(key, handle); } handle.truncate(0); if (handle.write(data, { at: 0 }) !== data.length) throw storageError('Could not stage a file.'); },
  readArtifact(key: string, offset: number, length: number) { const handle = artifacts.get(key); if (!handle) throw storageError('A staged file is missing.'); const bytes = new Uint8Array(Math.min(length, Math.max(0, handle.getSize() - offset))); const n = handle.read(bytes, { at: offset }); return bytes.subarray(0, n); },
  progress(progress: unknown) { scope.postMessage({ progress }); },
  async fetch(method: string, url: string, pairs: [string, string][], body: Uint8Array, maxBytes: number) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') throw new Error('Only HTTPS provider requests are allowed.');
    const headers = new Headers(pairs);
    const hasKey = headers.has('x-api-key');
    if (hasKey && !['https://api.curseforge.com', 'https://edge.forgecdn.net'].includes(parsed.origin)) throw new Error('Credentials cannot be sent to this origin.');
    const generation = cacheGeneration;
    const cacheable = !!input && !converting && (method === 'GET' || method === 'POST') && ['https://api.modrinth.com', 'https://api.curseforge.com'].includes(parsed.origin);
    const key = cacheable ? await cacheKey(method, url, headers, body) : undefined;
    const cached = key && generation === cacheGeneration ? metadataCache.get(key) : undefined;
    if (cached) {
      if (cached.body.length > maxBytes) throw new Error('Provider response exceeds the size limit.');
      return { status: cached.status, headers: cached.headers.map(([name, value]) => [name, value] as [string, string]), body: cached.body.slice() };
    }
    const timeout = AbortSignal.timeout(45_000);
    const response = await fetch(url, { method, headers, body: body.length ? new Uint8Array(body) : undefined, redirect: 'error', signal: AbortSignal.any([controller.signal, timeout]), credentials: 'omit', referrerPolicy: 'no-referrer' });
    const length = Number(response.headers.get('content-length'));
    if (Number.isFinite(length) && length > maxBytes) throw new Error('Provider response exceeds the size limit.');
    const stream = response.body?.getReader(); const chunks: Uint8Array[] = []; let total = 0;
    if (stream) { try { while (true) { const { done, value } = await stream.read(); if (done) break; total += value.length; if (total > maxBytes) { await stream.cancel(); throw new Error('Provider response exceeds the size limit.'); } chunks.push(value); } } finally { stream.releaseLock(); } }
    const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const responseHeaders = Array.from(response.headers.entries());
    const size = bytes.length + responseHeaders.reduce((sum, [name, value]) => sum + 2 * (name.length + value.length), 0) + 512;
    if (key && response.ok && generation === cacheGeneration && size <= cacheLimit) {
      const previous = metadataCache.get(key); if (previous) cacheSize -= previous.size;
      metadataCache.delete(key);
      while (cacheSize + size > cacheLimit) { const oldest = metadataCache.keys().next().value!; cacheSize -= metadataCache.get(oldest)!.size; metadataCache.delete(oldest); }
      metadataCache.set(key, { status: response.status, headers: responseHeaders, body: bytes.slice(), size }); cacheSize += size;
    }
    return { status: response.status, headers: responseHeaders, body: bytes };
  },
};
async function getMigrator() {
  if (!migrator) { const wasmUrl = new URL('/pkg/modpacks_migrator_wasm.js', self.location.origin).href; const wasm = await import(/* @vite-ignore */ wasmUrl) as Wasm; await wasm.default(); migrator = new wasm.BrowserMigrator(adapter); }
  return migrator;
}
scope.onmessage = async ({ data }: MessageEvent<{ id: number; method: string; args: unknown[] }>) => {
  const { id, method, args } = data;
  try {
    let result: unknown;
    if (method === 'dispose') { clearMetadataCache(); migrator?.free(); migrator = undefined; await cleanup(); }
    else if (method === 'cancel') { clearMetadataCache(); controller.abort(); controller = new AbortController(); }
    else {
      if (method === 'analyzeZip') clearMetadataCache();
      const instance = await getMigrator();
      if (method === 'analyzeZip') { input = args[0] as Blob; result = instance.analyzeZip(input.size); }
      else if (method === 'resolveMods') { result = await instance.resolveMods(args[0]); resolutionCount = (result as { entries: unknown[] }).entries.length; }
      else if (method === 'searchProjects') result = await instance.searchProjects(args[0] as string, args[1] as string);
      else if (method === 'listCandidates') result = await instance.listCandidates(args[0] as string, args[1] as string, args[2]);
      else if (method === 'convertZip') { await prepareStorage(resolutionCount); converting = true; try { const report = await instance.convertZip(); output!.flush(); output!.close(); output = undefined; const archive = await outputFile!.getFile(); result = { archive, report }; } finally { converting = false; } }
      else throw new Error('Unknown worker operation.');
    }
    scope.postMessage({ id, result });
  } catch (error) { const message = error instanceof Error ? error.message : String(error); const code = (error as { code?: string })?.code || (/browser storage/i.test(message) ? 'resource' : 'operation'); scope.postMessage({ id, error: { code, message } }); }
};
