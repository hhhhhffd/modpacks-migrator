import { useEffect, useRef, useState } from 'react';
import { Migrator, type Candidate, type Loader, type MigrationReport, type Progress, type Project, type Provider, type Resolution, type Selection } from './migrator';

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
function projectIdFromInput(provider: Provider, input: string): string {
  const value = input.trim();
  if (!value.includes('://')) return value;
  const url = new URL(value);
  const allowed = provider === 'modrinth' ? ['modrinth.com', 'www.modrinth.com'] : ['curseforge.com', 'www.curseforge.com'];
  if (url.protocol !== 'https:' || !allowed.includes(url.hostname)) throw new Error('Use an official provider project link or ID.');
  const parts = url.pathname.split('/').filter(Boolean);
  if (provider === 'modrinth' && parts[0] === 'mod' && parts[1]) return parts[1];
  if (provider === 'curseforge' && parts[0] === 'minecraft' && parts[1] === 'mc-mods' && parts[2]) return parts[2];
  throw new Error('Use a link to a mod project.');
}
function CandidateLabel({ candidate }: { candidate: Candidate }) {
  return <><strong>{candidate.name || candidate.filename}</strong> <span>{candidate.version}</span> <span className={`badge ${candidate.channel}`}>{candidate.channel}</span></>;
}
function projectUrl(candidate: Candidate) {
  try { const url = new URL(candidate.projectUrl); if (url.protocol === 'https:' && ['modrinth.com', 'www.curseforge.com'].includes(url.hostname)) return url.href; } catch { /* Fall back to the provider's official site. */ }
  return candidate.provider === 'modrinth' ? 'https://modrinth.com/' : 'https://www.curseforge.com/minecraft/mc-mods';
}
export default function App() {
  const engine = useRef<Migrator | null>(null);
  const [file, setFile] = useState<File>();
  const [version, setVersion] = useState('');
  const [loader, setLoader] = useState<Loader>('fabric');
  const [dependencies, setDependencies] = useState(true);
  const [selections, setSelections] = useState<Selection[]>([]);
  const [resolution, setResolution] = useState<Resolution>();
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState<Progress>();
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ archive: Blob; report: MigrationReport }>();
  const [replace, setReplace] = useState<string>();
  const [provider, setProvider] = useState<Provider>('modrinth');
  const [query, setQuery] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [alternatives, setAlternatives] = useState<Candidate[]>([]);
  useEffect(() => { const instance = new Migrator(); engine.current = instance; instance.onprogress = setProgress; return () => { void instance.dispose(); engine.current = null; }; }, []);
  const target = { minecraftVersion: version.trim(), loader };
  async function run(label: string, action: () => Promise<void>) {
    setError(''); setProgress(undefined); setBusy(label);
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'The operation failed.'); } finally { setBusy(''); }
  }
  async function resolve(changes = selections) {
    const preview = await engine.current!.resolveMods({ target, providers: ['modrinth', 'curseforge'], includeDependencies: dependencies, allowedChannels: ['release', 'beta', 'alpha'], selections: changes });
    setResolution(preview); setResult(undefined);
  }
  function updateSelection(inputId: string, selection: Partial<Selection>) {
    const next = selections.filter(item => item.inputId !== inputId);
    next.push({ inputId, ...selection }); setSelections(next); return next;
  }
  return <div className="page">
    <header className="topbar"><a className="brand" href="/" aria-label="Modpack Migrator home"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><span>MODPACK<br /><b>MIGRATOR</b></span></a><span className="privacy"><span className="privacy-dot" /> Runs in your browser</span></header>
    <main>
      <section className="intro"><p className="eyebrow">LOCAL-FIRST MODPACK MIGRATION</p><h1>New version.<br /><em>Same modpack.</em></h1><p>Move your mods to a new Minecraft version and loader. Review compatible files from official providers before you download.</p></section>
      <div className="layout"><div className="workbench">
        <section className="panel setup"><div className="section-heading"><div><p className="step">STEP 01 / SETUP</p><h2>Start with your pack</h2></div><span className="corner-icon" aria-hidden="true">↗</span></div>
          <label className="upload"><span className="upload-icon" aria-hidden="true">↑</span><span><strong>{file ? file.name : 'Choose a ZIP file'}</strong><small>{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB · Choose another file` : 'Your original archive stays on this device'}</small></span><input disabled={!!busy} type="file" accept=".zip,application/zip" onChange={event => { setFile(event.target.files?.[0]); setResolution(undefined); setResult(undefined); setSelections([]); }} /></label>
          <div className="fields"><label>Minecraft version<input disabled={!!busy} placeholder="e.g. 1.21.1" value={version} onChange={event => { setVersion(event.target.value); setResolution(undefined); setResult(undefined); }} /></label><label>Loader<select disabled={!!busy} value={loader} onChange={event => { setLoader(event.target.value as Loader); setResolution(undefined); setResult(undefined); }}><option value="fabric">Fabric</option><option value="forge">Forge</option><option value="neoforge">NeoForge</option><option value="quilt">Quilt</option></select></label></div>
          <label className="check"><input disabled={!!busy} type="checkbox" checked={dependencies} onChange={event => { setDependencies(event.target.checked); setResolution(undefined); setResult(undefined); }} /> Include required dependencies <span>Recommended</span></label>
          <button className="primary" disabled={!file || !version.trim() || !!busy} onClick={() => void run('Analyzing', async () => { await engine.current!.analyzeZip(file!); await resolve([]); setSelections([]); })}>Analyze pack <span>→</span></button>
        </section>
        {resolution && <section className="panel preview"><div className="section-heading"><div><p className="step">STEP 02 / REVIEW</p><h2>Check the matches</h2><p>Review versions, replace projects, or exclude files before downloading.</p></div><span className="count">{resolution.entries.length} items</span></div>
          {resolution.warnings?.map((warning, index) => <p className="notice" key={index}>{warning}</p>)}
          {resolution.entries.length === 0 ? <p className="notice">No matching mods were found in this archive.</p> : <div className="entries">{resolution.entries.map((entry, index) => <article className="entry" key={`${entry.inputId}-${index}`}><div className="entry-source"><span className="muted">SOURCE</span><strong>{entry.source?.name || entry.sourcePath || entry.inputId}</strong>{entry.source && <span>{entry.source.version}</span>}{entry.requiredBy?.length ? <small>Required by {entry.requiredBy.join(', ')}</small> : null}</div><div className="arrow" aria-hidden="true">→</div><div className="entry-target"><span className="muted">TARGET</span>{entry.selected ? <><CandidateLabel candidate={entry.selected} /><a href={projectUrl(entry.selected)} target="_blank" rel="noreferrer">View on {entry.selected.provider} ↗</a></> : <strong>{entry.status.replaceAll('_', ' ')}</strong>}{entry.reason && <small className="reason">{entry.reason}</small>}{entry.action && <small>{entry.action.replaceAll('_', ' ')}</small>}</div><div className="entry-actions">{entry.candidates?.length > 0 && <select disabled={!!busy} aria-label={`Version for ${entry.sourcePath}`} value={entry.selected?.versionId || ''} onChange={event => { const candidate = entry.candidates.find(c => c.versionId === event.target.value); if (candidate) void run('Updating preview', () => resolve(updateSelection(entry.inputId, { provider: candidate.provider, projectId: candidate.projectId, versionId: candidate.versionId }))); }}><option value="" disabled>Choose version</option>{entry.candidates.map(c => <option key={`${c.provider}-${c.projectId}-${c.versionId}`} value={c.versionId}>{c.version} · {c.channel}</option>)}</select>}<button disabled={!!busy} className="text-button" onClick={() => { setReplace(entry.inputId); setProjects([]); setAlternatives([]); setQuery(''); }}>Replace</button>{entry.action === 'excluded' ? <button disabled={!!busy} className="text-button" onClick={() => { const next = selections.filter(item => item.inputId !== entry.inputId); setSelections(next); void run('Updating preview', () => resolve(next)); }}>Include</button> : <button disabled={!!busy} className="text-button" onClick={() => void run('Updating preview', () => resolve(updateSelection(entry.inputId, { exclude: true })))}>Exclude</button>}</div></article>)}</div>}
          <div className="preview-footer"><p>Only verified, compatible files are included. Unresolved items appear in the report.</p><button className="primary" disabled={!!busy || !resolution.entries.length} onClick={() => void run('Preparing download', async () => setResult(await engine.current!.convertZip()))}>Confirm and prepare ZIP <span>→</span></button></div>
        </section>}
        {result && <section className="panel result"><p className="step">STEP 03 / DOWNLOAD</p><h2>{result.report.status === 'completed' ? 'Your pack is ready' : result.report.status === 'partial' ? 'Your pack is partially ready' : result.report.status === 'empty' ? 'No files could be included' : `Migration ${result.report.status}`}</h2><p>Check the report for details about every item.</p><div className="buttons">{result.report.status !== 'empty' && <button className="primary" onClick={() => save(result.archive, 'migrated-modpack.zip')}>Download ZIP ↓</button>}<button className="secondary" onClick={() => save(new Blob([JSON.stringify(result.report, null, 2)], { type: 'application/json' }), 'migration-report.json')}>Download report ↓</button></div></section>}
        {busy && <div className="status" role="status"><div><strong>{busy}…</strong><span>{progress?.message || progress?.stage || 'This may take a moment.'}</span></div><button className="secondary" onClick={() => { setResolution(undefined); setResult(undefined); void engine.current?.cancel().catch(e => setError(String(e))); }}>Cancel</button></div>}
        {error && <div className="error" role="alert"><strong>Could not continue</strong><p>{error}</p></div>}
      </div><aside><div className="terminal"><div className="terminal-title">MIGRATION / PREVIEW <span>●</span></div><div className="terminal-row"><small>ARCHIVE</small><strong>{file?.name || 'Choose a ZIP file'}</strong></div><div className="terminal-arrow">↓</div><div className="terminal-row"><small>TARGET</small><strong>{version.trim() || 'Minecraft version'} · {loader}</strong></div><div className="terminal-foot">Your selections, ready to review.</div></div></aside></div>
      <div className="features"><div><b>01 / Local processing</b><p>Your archive stays on this device. Fingerprints and file requests go directly to providers.</p></div><div><b>02 / Review every match</b><p>Choose alternatives, resolve dependencies and see what could not be migrated.</p></div><div><b>03 / Take it with you</b><p>Download your migrated mods and a detailed JSON report.</p></div></div>
    </main><footer><span>MODPACK MIGRATOR</span><span>AGPL-3.0 · Made for the next adventure</span></footer>
    {replace && <div className="modal-backdrop" onClick={() => setReplace(undefined)}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="replace-title" onClick={event => event.stopPropagation()}><div className="section-heading"><h2 id="replace-title">Replace project</h2><button className="text-button" onClick={() => setReplace(undefined)}>Close ✕</button></div><p>Search an official provider, then choose a compatible version.</p><div className="search"><select disabled={!!busy} aria-label="Provider" value={provider} onChange={event => setProvider(event.target.value as Provider)}><option value="modrinth">Modrinth</option><option value="curseforge">CurseForge</option></select><input disabled={!!busy} aria-label="Project name or ID" placeholder="Project name or ID" value={query} onChange={event => setQuery(event.target.value)} /><button className="secondary" disabled={!query.trim() || !!busy} onClick={() => void run('Searching', async () => { setProjects(await engine.current!.searchProjects(provider, query.trim())); setAlternatives([]); })}>Search</button></div><button className="text-button direct-id" disabled={!query.trim() || !!busy} onClick={() => void run('Loading versions', async () => { const id = projectIdFromInput(provider, query); setProjects([]); setAlternatives(await engine.current!.listCandidates(provider, id, target)); })}>Or use this project ID / official link →</button>{error && <p className="error" role="alert">{error}</p>}<div className="search-results">{projects.map(project => <button disabled={!!busy} key={project.projectId} className="project" onClick={() => void run('Loading versions', async () => setAlternatives(await engine.current!.listCandidates(provider, project.projectId, target)))}><strong>{project.name}</strong><small>{project.description || project.projectId}</small></button>)}{alternatives.map(candidate => <button disabled={!!busy} key={candidate.versionId} className="project" onClick={() => { const next = updateSelection(replace, { provider: candidate.provider, projectId: candidate.projectId, versionId: candidate.versionId }); setReplace(undefined); void run('Updating preview', () => resolve(next)); }}><CandidateLabel candidate={candidate} /></button>)}</div></div></div>}
  </div>;
}
