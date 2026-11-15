export type Provider = 'modrinth' | 'curseforge';
export type Loader = 'fabric' | 'forge' | 'neoforge' | 'quilt';
export interface Target { minecraftVersion: string; loader: Loader }
export interface Input { id: string; path: string; size: number; sha1: string; sha512: string; fingerprint: number }
export interface Analysis { inputs: Input[]; ignoredFiles: number }
export interface Dependency { kind: 'required' | 'optional' | 'incompatible' | 'embedded'; projectId: string | null; versionId: string | null }
export interface Candidate { provider: Provider; projectId: string; versionId: string; fileId: string; name: string; version: string; filename: string; url: string | null; projectUrl: string; sha1: string | null; sha512: string | null; size: number; published: string; channel: 'release' | 'beta' | 'alpha'; gameVersions: string[]; loaders: Loader[]; dependencies: Dependency[] }
export interface Entry { inputId: string; sourcePath: string; source: Candidate | null; selected: Candidate | null; candidates: Candidate[]; status: 'updated' | 'unchanged' | 'not_found' | 'no_compatible_version' | 'download_unavailable' | 'dependency_conflict' | 'error'; reason: string | null; action: 'replacement' | 'deduplicated' | 'added_dependency' | 'excluded' | null; requiredBy: string[]; outputPath: string | null }
export interface Resolution { entries: Entry[]; warnings: string[]; schemaVersion: number; target: Target; includeDependencies: boolean }
export interface Selection { inputId: string; exclude?: boolean; provider?: Provider; projectId?: string; versionId?: string }
export interface ResolveRequest { target: Target; providers: Provider[]; includeDependencies: boolean; allowedChannels: ('release' | 'beta' | 'alpha')[]; selections: Selection[] }
export interface Project { provider: Provider; projectId: string; name: string; projectUrl: string; description: string }
export interface Progress { stage: string; completed?: number; total?: number; message?: string }
export interface MigrationReport { schemaVersion: number; target: Target; status: 'completed' | 'partial' | 'empty' | 'failed' | 'cancelled'; entries: Entry[]; warnings: string[] }
export interface Conversion { archive: Blob; report: MigrationReport }

/** Each instance owns a dedicated worker and its temporary browser storage. */
export class Migrator {
  private worker!: Worker;
  private directoryName = '';
  private nextId = 0;
  private pending = new Map<number, { resolve(value: unknown): void; reject(reason: Error): void }>();
  onprogress?: (progress: Progress) => void;
  constructor() { this.startWorker(); }
  private startWorker() {
    this.worker = new Worker(new URL('./migrator.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }) => {
      if (data.directoryName) { this.directoryName = data.directoryName; return; }
      if (data.progress) { this.onprogress?.(data.progress); return; }
      const pending = this.pending.get(data.id);
      if (!pending) return;
      this.pending.delete(data.id);
      if (data.error) pending.reject(Object.assign(new Error(data.error.message), { code: data.error.code }));
      else pending.resolve(data.result);
    };
    this.worker.onerror = () => this.rejectAll(new Error('The migration worker stopped unexpectedly.'));
  }
  private call<T>(method: string, args: unknown[] = []): Promise<T> {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve: value => resolve(value as T), reject }); this.worker.postMessage({ id, method, args }); });
  }
  private rejectAll(error: Error) { for (const pending of this.pending.values()) pending.reject(error); this.pending.clear(); }
  analyzeZip(file: Blob | Uint8Array) { return this.call<Analysis>('analyzeZip', [file instanceof Uint8Array ? new Blob([new Uint8Array(file)]) : file]); }
  resolveMods(request: ResolveRequest) { return this.call<Resolution>('resolveMods', [request]); }
  searchProjects(provider: Provider, query: string) { return this.call<Project[]>('searchProjects', [provider, query]); }
  listCandidates(provider: Provider, projectId: string, target: Target) { return this.call<Candidate[]>('listCandidates', [provider, projectId, target]); }
  convertZip() { return this.call<Conversion>('convertZip'); }
  private async cleanup() {
    const name = this.directoryName; this.directoryName = '';
    if (name) { const root = await navigator.storage.getDirectory(); await root.removeEntry(name, { recursive: true }); }
  }
  async cancel() {
    this.worker.terminate(); this.rejectAll(new Error('Operation cancelled. Analyze the archive again to continue.'));
    try { await this.cleanup(); } finally { this.startWorker(); }
  }
  async dispose() { this.worker.terminate(); this.rejectAll(new Error('Migrator disposed.')); await this.cleanup(); }
}
