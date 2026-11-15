import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Migrator, type Candidate, type Entry, type Loader, type MigrationReport, type Progress, type Project, type Provider, type Resolution, type Selection } from './migrator';

const repository = 'https://github.com/hhhhhffd/modpacks-migrator';
const author = 'https://github.com/hhhhhffd';

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" /></>,
    box: <><path d="m12 3 9 5-9 5-9-5 9-5Zm-9 5v9l9 5 9-5V8M12 13v9M7.5 5.5l9 5" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
    shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" /><path d="m8 12 3 3 5-6" /></>,
    link: <><path d="M14 3h7v7m0-7L10 14M10 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" /></>,
    download: <path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4" />,
    minus: <path d="M5 12h14" />,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>,
    moon: <path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z" />,
    undo: <><path d="M4 10h10a6 6 0 0 1 0 12M4 10l5-5m-5 5 5 5" /></>,
    github: <><path d="M9 19c-4 1-4-2-6-2m12 5v-4c0-1 .1-1.5-.5-2 4-.4 7.5-2 7.5-7a5.4 5.4 0 0 0-1.5-3.7A5 5 0 0 0 20 1s-1.3-.4-4 1.5a14 14 0 0 0-8 0C5.3.6 4 1 4 1a5 5 0 0 0-.5 4.3A5.4 5.4 0 0 0 2 9c0 5 3.5 6.6 7.5 7-.6.5-.6 1.2-.5 2v4" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.box}</svg>;
}

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
function projectUrl(candidate: Candidate) {
  try { const url = new URL(candidate.projectUrl); if (url.protocol === 'https:' && ['modrinth.com', 'www.modrinth.com', 'curseforge.com', 'www.curseforge.com'].includes(url.hostname)) return url.href; } catch { /* Use the official provider homepage if metadata is invalid. */ }
  return candidate.provider === 'modrinth' ? 'https://modrinth.com/' : 'https://www.curseforge.com/minecraft/mc-mods';
}
function concise(message: string) { return message.split('\n')[0].replaceAll('JsValue(', '').replaceAll('TypeError: ', '').slice(0, 350); }
function entryName(entry: Entry) { return (entry.sourcePath?.split('/').pop() || entry.selected?.filename)?.replace(/\.jar$/i, '') || entry.inputId; }
function isReady(entry: Entry) { return !!entry.selected && (entry.status === 'updated' || entry.status === 'unchanged'); }
function Channel({ candidate }: { candidate: Candidate }) { return <span className={`badge ${candidate.channel}`}>{candidate.channel}</span>; }

type Filter = 'all' | 'ready' | 'attention' | 'removed';
type Theme = 'light' | 'dark';
type GameVersion = { version: string; version_type: 'release' | 'snapshot' | 'alpha' | 'beta' };
export default function App() {
  const [theme, setTheme] = useState<Theme>(() => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  useEffect(() => {
    document.documentElement.dataset.themePreference = theme;
    document.documentElement.dataset.theme = theme;
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!.content = theme === 'dark' ? '#10121c' : '#eceef5';
  }, [theme]);
  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try { localStorage.setItem('modpacks-migrator-theme', next); }
    catch (error) { console.warn('Theme preference could not be saved; it will apply to this tab only.', error); }
  }
  const engine = useRef<Migrator | null>(null);
  const [file, setFile] = useState<File>();
  const [version, setVersion] = useState('');
  const [gameVersions, setGameVersions] = useState<GameVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(true);
  const [versionsError, setVersionsError] = useState('');
  const [versionsAttempt, setVersionsAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setVersionsLoading(true);
    setVersionsError('');
    async function loadVersions() {
      try {
        const response = await fetch('https://api.modrinth.com/v2/tag/game_version', {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
          credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
        });
        if (!response.ok) throw new Error(`Minecraft version catalog returned HTTP ${response.status}.`);
        const text = await response.text();
        if (text.length > 1024 * 1024) throw new Error('Minecraft version catalog exceeds the size limit.');
        const rows: unknown = JSON.parse(text);
        if (!Array.isArray(rows) || !rows.length || rows.length > 5000 || !rows.every((row): row is GameVersion =>
          !!row && typeof row === 'object' && typeof row.version === 'string' && row.version.length > 0 && row.version.length < 80 &&
          ['release', 'snapshot', 'alpha', 'beta'].includes(row.version_type))) {
          throw new Error('Minecraft version catalog has an invalid format.');
        }
        if (!controller.signal.aborted) setGameVersions(rows);
      } catch (error) {
        if (!controller.signal.aborted) setVersionsError(`Could not load Minecraft versions. ${concise(String(error))}`);
      } finally {
        if (!controller.signal.aborted) setVersionsLoading(false);
      }
    }
    void loadVersions();
    return () => controller.abort();
  }, [versionsAttempt]);
  const [loader, setLoader] = useState<Loader>('fabric');
  const [dependencies, setDependencies] = useState(true);
  const [selections, setSelections] = useState<Selection[]>([]);
  const selectionsRef = useRef<Selection[]>([]);
  const appliedSelections = useRef<Selection[]>([]);
  const removedSelections = useRef(new Map<string, Selection | undefined>());
  const selectionRevision = useRef(0);
  const selectionLoop = useRef(false);
  const operationEpoch = useRef(0);
  const [updating, setUpdating] = useState(false);
  const [resolution, setResolution] = useState<Resolution>();
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState<Progress>();
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ archive: Blob; report: MigrationReport }>();
  const [editingSetup, setEditingSetup] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [modQuery, setModQuery] = useState('');
  const [replace, setReplace] = useState<string>();
  const [provider, setProvider] = useState<Provider>('modrinth');
  const [query, setQuery] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [alternatives, setAlternatives] = useState<Candidate[]>([]);
  const [searched, setSearched] = useState(false);
  const [versionsLoaded, setVersionsLoaded] = useState(false);
  const previewRef = useRef<HTMLElement>(null);
  const resultRef = useRef<HTMLElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => { const instance = new Migrator(); engine.current = instance; instance.onprogress = setProgress; return () => { void instance.dispose().catch(e => console.error('Could not release browser storage:', concise(String(e)))); engine.current = null; }; }, []);
  useEffect(() => {
    if (!replace) return;
    const previous = document.activeElement as HTMLElement | null;
    searchInput.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); setReplace(undefined); }
      if (event.key !== 'Tab') return;
      const controls = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]');
      if (!controls?.length) return;
      const first = controls[0], last = controls[controls.length - 1];
      if (!dialogRef.current?.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', onKey); previous?.focus(); };
  }, [replace]);
  useEffect(() => {
    if (!replace || !dialogRef.current) return;
    if (!dialogRef.current.contains(document.activeElement) || document.activeElement?.matches(':disabled')) {
      dialogRef.current.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)')?.focus();
    }
  }, [busy, replace]);
  const target = { minecraftVersion: version.trim(), loader };
  const locked = !!busy || updating;
  const removed = (id: string) => selections.some(item => item.inputId === id && item.exclude);
  const entries = result?.report.entries || resolution?.entries || [];
  const downloadFailures = new Map<string, number>();
  for (const entry of result?.report.entries || []) {
    if (entry.selected && !entry.outputPath && entry.action !== 'excluded') {
      const reason = concise(entry.reason || 'The file could not be verified.');
      downloadFailures.set(reason, (downloadFailures.get(reason) || 0) + 1);
    }
  }
  const builtFileCount = new Set((result?.report.entries || []).map(entry => entry.outputPath).filter(Boolean)).size;
  const archiveReady = !!result && builtFileCount > 0 && (result.report.status === 'completed' || result.report.status === 'partial');
  const canRetryDownloads = !!result && (resolution?.entries.some(isReady) ?? false);
  const selectedCount = entries.filter(entry => isReady(entry) && !removed(entry.inputId)).length;
  const removedCount = entries.filter(entry => removed(entry.inputId)).length;
  const attentionCount = entries.filter(entry => !isReady(entry) && !removed(entry.inputId)).length;
  const filteredEntries = entries.filter(entry => {
    const isRemoved = removed(entry.inputId);
    const matches = filter === 'all' || (filter === 'removed' && isRemoved) || (filter === 'ready' && isReady(entry) && !isRemoved) || (filter === 'attention' && !isReady(entry) && !isRemoved);
    return matches && `${entryName(entry)} ${entry.sourcePath} ${entry.selected?.name || ''}`.toLowerCase().includes(modQuery.toLowerCase());
  });
  async function run(label: string, action: () => Promise<void>) {
    const epoch = operationEpoch.current;
    setError(''); setProgress(undefined); setBusy(label);
    try { await action(); } catch (e) { if (epoch === operationEpoch.current) setError(concise(e instanceof Error ? e.message : 'The operation failed.')); } finally { if (epoch === operationEpoch.current) setBusy(''); }
  }
  function request(changes: Selection[]) { return { target, providers: ['modrinth', 'curseforge'] as Provider[], includeDependencies: dependencies, allowedChannels: ['release', 'beta', 'alpha'] as Candidate['channel'][], selections: changes }; }
  // Serialize edits in the worker and coalesce quick clicks. The list stays in place;
  // only the latest desired selection is published as the dependency-checked snapshot.
  async function applySelections() {
    if (selectionLoop.current) return;
    selectionLoop.current = true; setUpdating(true); setError('');
    const epoch = operationEpoch.current;
    try {
      while (true) {
        const revision = selectionRevision.current;
        const next = [...selectionsRef.current];
        const preview = await engine.current!.resolveMods(request(next));
        if (epoch !== operationEpoch.current) return;
        if (revision !== selectionRevision.current) continue;
        setResolution(preview); appliedSelections.current = next; break;
      }
    } catch (e) {
      if (epoch !== operationEpoch.current) return;
      selectionsRef.current = appliedSelections.current;
      setSelections(appliedSelections.current);
      setError(concise(e instanceof Error ? e.message : 'Could not update this selection.'));
    } finally { if (epoch === operationEpoch.current) { selectionLoop.current = false; setUpdating(false); } }
  }
  function changeSelection(inputId: string, selection?: Partial<Selection>) {
    const next = selectionsRef.current.filter(item => item.inputId !== inputId);
    if (selection) next.push({ inputId, ...selection });
    selectionsRef.current = next; selectionRevision.current += 1;
    setSelections(next); setResult(undefined); void applySelections();
  }
  function removeEntry(inputId: string) {
    removedSelections.current.set(inputId, selectionsRef.current.find(item => item.inputId === inputId));
    changeSelection(inputId, { exclude: true });
  }
  function undoRemoval(inputId: string) { changeSelection(inputId, removedSelections.current.get(inputId)); removedSelections.current.delete(inputId); }
  function resetPreview() { setResolution(undefined); setResult(undefined); setSelections([]); selectionsRef.current = []; appliedSelections.current = []; removedSelections.current.clear(); setError(''); }
  async function cancelOperation() {
    const epoch = ++operationEpoch.current;
    selectionRevision.current += 1; selectionLoop.current = false;
    setUpdating(false); resetPreview(); setEditingSetup(true); setBusy('Cancelling');
    try { await engine.current!.cancel(); if (epoch === operationEpoch.current) setError('Operation cancelled. Analyze the archive again to continue.'); }
    catch (e) { if (epoch === operationEpoch.current) setError(concise(String(e))); }
    finally { if (epoch === operationEpoch.current) setBusy(''); }
  }
  function chooseFile(next?: File) {
    if (!next || locked) return;
    if (!next.name.toLowerCase().endsWith('.zip')) { setError('Choose a .zip archive containing your mods.'); return; }
    setFile(next); resetPreview(); setEditingSetup(true);
  }
  async function analyze() {
    await engine.current!.analyzeZip(file!);
    const preview = await engine.current!.resolveMods(request([]));
    setResolution(preview); setResult(undefined); setSelections([]); selectionsRef.current = []; appliedSelections.current = []; removedSelections.current.clear();
    setEditingSetup(false); setFilter('all'); setModQuery('');
    requestAnimationFrame(() => previewRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' }));
  }
  async function buildPack() {
    setResult(undefined);
    const converted = await engine.current!.convertZip();
    setResult(converted);
    if (converted.report.status === 'empty') { setFilter('attention'); setModQuery(''); }
    requestAnimationFrame(() => resultRef.current?.scrollIntoView({ block: 'center', behavior: 'instant' }));
  }
  function openReplacement(inputId: string) { setReplace(inputId); setProjects([]); setAlternatives([]); setQuery(''); setSearched(false); setVersionsLoaded(false); setError(''); }
  const warning = resolution?.warnings?.length ? resolution.warnings.map(message => message.includes('CurseForge') ? 'CurseForge is unavailable for this analysis. Modrinth matches are still available. Analyze again to retry.' : concise(message)) : [];
  const steps = [['Your modpack', !resolution ? 'current' : 'done'], ['Review matches', resolution && !result ? 'current' : result ? 'done' : ''], ['Download', result ? 'current' : '']] as const;
  const ticker = ['sodium', 'iris', 'lithium', 'fabric-api', 'modmenu', 'appleskin', 'jei', 'create', 'xaeros-minimap', 'cloth-config'];
  return <div className="app-shell">
    <header className="topbar page-width">
      <a className="brand" href="/" aria-label="Modpack Migrator home"><span className="brand-mark"><Icon name="box" size={18} /></span><span>modpack<span className="brand-second">migrator</span></span></a>
      <div className="header-actions">
        <button className="theme-toggle icon-button" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} onClick={toggleTheme}><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={19} /></button>
        <nav aria-label="Project links"><a className="repo-link" href={repository} target="_blank" rel="noreferrer">Source on GitHub</a></nav>
      </div>
    </header>
    <section className={`hero page-width ${resolution && !editingSetup ? 'is-compact' : ''}`} aria-labelledby="hero-title">
      <div className="hero-copy">
        <p className="hero-chip"><span className="live-dot" /> Runs in your browser · No upload · No account</p>
        <h1 id="hero-title">Your next world.<br /><span>Your favorite mods.</span></h1>
        <p className="hero-description">Drop in a modpack, pick a Minecraft version, and get back a ZIP with verified builds from Modrinth and CurseForge.</p>
        <ul className="hero-facts"><li><Icon name="shield" size={16} /> Your files never leave this device</li><li><Icon name="check" size={16} /> Only hash-verified downloads</li></ul>
      </div>
      <section className={`setup ${resolution && !editingSetup ? 'setup-collapsed' : ''}`} aria-labelledby="setup-title">
        <ol className="journey" aria-label="Migration steps">{steps.map(([label, state], index) => <li key={label} className={state} aria-current={state === 'current' ? 'step' : undefined}><span className="step-number">{state === 'done' ? <Icon name="check" size={12} /> : index + 1}</span><span className="step-label">{label}</span></li>)}</ol>
        {resolution && !editingSetup && <div className="pack-summary"><span className="file-symbol"><Icon name="box" size={22} /></span><div><strong>{file?.name}</strong><span>{version.trim()} · {loader} · {entries.length} mods found</span></div><button className="secondary" disabled={locked} onClick={() => setEditingSetup(true)}>Edit setup</button></div>}
        <div className="setup-content" hidden={!!resolution && !editingSetup}>
          <h2 id="setup-title" className="visually-hidden">Start with your modpack</h2>
          <label className={`upload ${file ? 'has-file' : ''} ${dragging ? 'dragging' : ''}`} onDragOver={event => { event.preventDefault(); if (!locked) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); chooseFile(event.dataTransfer.files[0]); }}>
            <span className="upload-art"><Icon name={file ? 'box' : 'upload'} size={22} /></span><span className="upload-text"><strong>{file ? file.name : 'Drop your current modpack ZIP'}</strong><span className="upload-description">{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB · click to choose another` : <>or <span className="upload-browse">browse files</span> · JARs inside, up to 256 MB</>}</span></span><input aria-label="Modpack ZIP" disabled={locked} type="file" accept=".zip,application/zip" onChange={event => chooseFile(event.target.files?.[0])} />
          </label>
          <fieldset className="destination"><legend>Your new modpack</legend><p>Choose the version and loader to migrate to, not the original pack’s.</p>
          <div className="fields">
            <label>Minecraft version<select aria-label="Minecraft version" disabled={locked || versionsLoading || !gameVersions.length} value={version} onChange={event => { setVersion(event.target.value); resetPreview(); }}><option value="" disabled>{versionsLoading ? 'Loading versions…' : 'Choose a version'}</option><optgroup label="Releases">{gameVersions.filter(item => item.version_type === 'release').map(item => <option key={item.version} value={item.version}>{item.version}</option>)}</optgroup><optgroup label="Snapshots & prereleases">{gameVersions.filter(item => item.version_type === 'snapshot').map(item => <option key={item.version} value={item.version}>{item.version}</option>)}</optgroup><optgroup label="Legacy alpha & beta">{gameVersions.filter(item => item.version_type === 'alpha' || item.version_type === 'beta').map(item => <option key={item.version} value={item.version}>{item.version}</option>)}</optgroup></select></label>
            <label>Loader<select aria-label="Loader" disabled={locked} value={loader} onChange={event => { setLoader(event.target.value as Loader); resetPreview(); }}><option value="fabric">Fabric</option><option value="forge">Forge</option><option value="neoforge">NeoForge</option><option value="quilt">Quilt</option></select></label>
          </div>
          {versionsError && <div className="version-catalog-error" role="alert"><p>{versionsError}</p><button className="quiet-button" disabled={versionsLoading || locked} onClick={() => setVersionsAttempt(attempt => attempt + 1)}>Retry versions</button></div>}
          </fieldset>
          <label className="check"><input disabled={locked} type="checkbox" checked={dependencies} onChange={event => { setDependencies(event.target.checked); resetPreview(); }} /><span>Include required dependencies<small>Libraries your mods need to start.</small></span></label>
          <button className="primary analyze-button" disabled={!file || !version.trim() || locked} onClick={() => void run('Finding compatible mods', analyze)}>{busy === 'Finding compatible mods' ? <><span className="spinner" /> Analyzing your pack</> : <>Analyze pack <Icon name="arrow" size={18} /></>}</button>
          {resolution && <button className="quiet-button return-review" onClick={() => setEditingSetup(false)}>Back to your matches <Icon name="arrow" size={15} /></button>}
        </div>
      </section>
      <div className="ticker" aria-hidden="true"><div>{[0, 1].map(copy => <span key={copy}>{ticker.map(name => <span key={name} className="ticker-item">{name}<em>1.20.1</em><Icon name="arrow" size={12} /><b>1.21.1</b></span>)}</span>)}</div></div>
    </section>
    <main className="page-width workspace">
      {busy && !replace && <div className="operation-status" role="status"><span className="spinner" /><div><strong>{busy}</strong><span>{progress?.message || 'Working on your device. Your archive stays here.'}</span>{progress?.total ? <progress value={progress.completed || 0} max={progress.total} aria-label={busy} /> : null}</div><button className="secondary" onClick={() => void cancelOperation()}>Cancel</button></div>}
      {error && !replace && <div className={`feedback ${error.toLowerCase().includes('cancelled') ? 'neutral' : ''}`} role="alert"><span className="feedback-mark">!</span><div><strong>{error.toLowerCase().includes('cancelled') ? 'Analysis cancelled' : 'Something needs your attention'}</strong><p>{error}</p></div><button className="icon-button" aria-label="Dismiss message" onClick={() => setError('')}><Icon name="close" size={18} /></button></div>}
      {resolution && <section className="preview panel" ref={previewRef} aria-labelledby="review-title">
        <div className="review-heading"><div><h2 id="review-title">Check the matches</h2><p>Keep a match, switch its version, replace it, or leave it out.</p></div><div className="selection-feedback"><span className="selection-status" role="status">{updating ? <><span className="spinner" /> Checking dependencies</> : <><Icon name="check" size={15} /> Changes saved locally</>}</span>{updating && <button className="quiet-button" onClick={() => void cancelOperation()}>Cancel update</button>}</div></div>
        <div className="pack-meter" aria-hidden="true"><div className="meter-bar">{selectedCount > 0 && <span className="is-ready" style={{ flexGrow: selectedCount }} />}{attentionCount > 0 && <span className="is-attention" style={{ flexGrow: attentionCount }} />}{removedCount > 0 && <span className="is-removed" style={{ flexGrow: removedCount }} />}</div><div className="meter-legend"><span className="is-ready">{selectedCount} ready</span><span className="is-attention">{attentionCount} need attention</span><span className="is-removed">{removedCount} removed</span></div></div>
        {warning.length > 0 && <details className="provider-notice"><summary><span className="notice-dot" /> Some provider data is unavailable <span className="details-label">Details</span></summary><div>{warning.map((message, index) => <p key={index}>{message}</p>)}</div></details>}
        <div className="review-toolbar"><div className="filters" role="group" aria-label="Filter mods">{([['all', 'All mods', entries.length], ['ready', 'Ready', selectedCount], ['attention', 'Needs attention', attentionCount], ['removed', 'Removed', removedCount]] as const).map(([value, label, count]) => <button key={value} className={`${filter === value ? 'active' : ''} filter-${value}`} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}<span>{count}</span></button>)}</div><label className="mod-search"><Icon name="search" size={16} /><input type="search" aria-label="Search mods" placeholder="Find a mod…" value={modQuery} onChange={event => setModQuery(event.target.value)} /></label></div>
        <div className="table-heading"><span>Your mod</span><span>Compatible version</span><span>Actions</span></div>
        <div className="entries">{filteredEntries.map(entry => {
          const isRemoved = removed(entry.inputId);
          const selectedVersion = selections.find(item => item.inputId === entry.inputId)?.versionId || entry.selected?.versionId || '';
          const name = entryName(entry);
          return <article data-input-id={entry.inputId} className={`entry ${isRemoved ? 'is-removed' : ''} ${!isReady(entry) && !isRemoved ? 'needs-attention' : ''}`} key={entry.inputId}>
            <div className="entry-source"><span className="mod-icon" aria-hidden="true" style={{ '--mod-hue': (entry.inputId.split('').reduce((n, char) => n + char.charCodeAt(0), 0) * 47) % 360 } as CSSProperties}>{name.charAt(0).toUpperCase()}</span><div className="mod-identity"><strong title={name}>{name}</strong><small title={entry.sourcePath}>{entry.sourcePath || 'Required dependency'}</small>{entry.requiredBy?.length ? <span className="dependency-note">Required by {entry.requiredBy.length} {entry.requiredBy.length === 1 ? 'mod' : 'mods'}</span> : null}</div></div>
            <div className="entry-target">{isRemoved ? <span className="removed-label">Left out of your pack</span> : entry.candidates?.length > 0 ? <><div className="version-control"><select disabled={!!busy} aria-label={`Version for ${entry.sourcePath}`} value={selectedVersion} onChange={event => { const candidate = entry.candidates.find(c => c.versionId === event.target.value); if (candidate) changeSelection(entry.inputId, { provider: candidate.provider, projectId: candidate.projectId, versionId: candidate.versionId }); }}><option value="" disabled>Choose version</option>{entry.candidates.map(candidate => <option key={`${candidate.provider}-${candidate.versionId}`} value={candidate.versionId}>{candidate.version} · {candidate.channel}</option>)}</select>{entry.selected && <Channel candidate={entry.selected} />}</div>{entry.selected && <a className="provider-link" href={projectUrl(entry.selected)} target="_blank" rel="noreferrer">{entry.selected.provider === 'modrinth' ? 'Modrinth' : 'CurseForge'} <Icon name="link" size={11} />{entry.action === 'replacement' && <span>Manual replacement</span>}</a>}</> : <span className="unavailable-label">{entry.status === 'no_compatible_version' ? 'No compatible version' : entry.status === 'dependency_conflict' ? 'Dependency needs attention' : entry.status === 'not_found' ? 'Not identified' : entry.status === 'error' ? 'Provider unavailable' : 'Download unavailable'}</span>}{entry.reason && !isRemoved && <small className="reason">{concise(entry.reason)}</small>}</div>
            <div className="entry-actions">{isRemoved ? <button disabled={!!busy} className="undo-button" onClick={() => undoRemoval(entry.inputId)}><Icon name="undo" size={15} /> Undo</button> : <><button disabled={locked} className="replace-button" onClick={() => openReplacement(entry.inputId)}>Replace</button><button disabled={!!busy} className="remove-button" onClick={() => removeEntry(entry.inputId)} aria-label={`Remove ${name}`} title="Leave this mod out of the download"><Icon name="minus" size={15} /><span>Remove</span></button></>}</div>
          </article>;
        })}{filteredEntries.length === 0 && <div className="empty-list"><span className="empty-icon"><Icon name={filter === 'attention' ? 'check' : 'search'} size={22} /></span><h3>{filter === 'attention' ? 'Nothing needs your attention.' : filter === 'removed' && !modQuery ? 'Nothing left behind.' : 'No mods here.'}</h3><p>{modQuery ? 'Try another name or clear your search.' : filter === 'removed' ? 'Mods you remove stay here, with an option to undo.' : 'Choose another filter to see your mods.'}</p>{(modQuery || filter !== 'all') && <button className="secondary" onClick={() => { setModQuery(''); setFilter('all'); }}>Show all mods</button>}</div>}</div>
        <div className="preview-footer">
          <div><strong>{archiveReady ? `Pack built · ${builtFileCount} ${builtFileCount === 1 ? 'JAR' : 'JARs'} included` : `${selectedCount} ${selectedCount === 1 ? 'mod' : 'mods'} ready to pack`}</strong><p>{archiveReady ? 'Download the ZIP, or change your choices to build a new pack.' : 'Removing a required dependency also leaves out the mods that need it.'}</p></div>
          <div className="build-actions">
            <button className={archiveReady ? 'secondary' : 'primary'} disabled={locked || (!selectedCount && !canRetryDownloads)} onClick={() => void run('Building your modpack', buildPack)}>{canRetryDownloads && downloadFailures.size ? 'Retry downloads' : 'Build modpack'} <Icon name="arrow" size={18} /></button>
            {archiveReady && <button className="primary" onClick={() => save(result!.archive, 'migrated-modpack.zip')}><Icon name="download" size={17} /> Download ZIP</button>}
          </div>
        </div>
      </section>}
      {result && <section className={`result ${result.report.status === 'empty' ? 'empty-result' : ''}`} ref={resultRef} aria-labelledby="result-title"><div className="result-icon"><Icon name={result.report.status === 'empty' ? 'box' : 'check'} size={28} /></div><div className="result-copy"><h2 id="result-title">{result.report.status === 'completed' ? 'Your pack is ready' : result.report.status === 'partial' ? 'Your pack is partially ready' : result.report.status === 'empty' ? 'Your modpack could not be built' : `Migration ${result.report.status}`}</h2><p>{result.report.status === 'partial' ? 'Some mods couldn’t make the trip. The report lists which ones and why.' : result.report.status === 'empty' ? `No files passed download and verification for Minecraft ${result.report.target.minecraftVersion} / ${result.report.target.loader}. No modpack was created. See the failures below and retry the downloads.` : 'Verified files in a clean ZIP, plus a report of everything that changed.'}</p>{downloadFailures.size > 0 && <div className="result-failures"><h3>What went wrong</h3><ul>{[...downloadFailures].slice(0, 5).map(([reason, count]) => <li key={reason}><strong>{count} {count === 1 ? 'mod' : 'mods'}</strong><span>{reason}</span></li>)}</ul>{downloadFailures.size > 5 && <p>More failures are shown beside the affected mods in the list.</p>}</div>}<div className="buttons">{canRetryDownloads && downloadFailures.size > 0 && <button className="primary" disabled={locked} onClick={() => void run('Building your modpack', buildPack)}>Retry downloads <Icon name="arrow" size={17} /></button>}{archiveReady && <button className="primary" onClick={() => save(result.archive, 'migrated-modpack.zip')}><Icon name="download" size={17} /> Download ZIP</button>}<button className="secondary" onClick={() => save(new Blob([JSON.stringify(result.report, null, 2)], { type: 'application/json' }), 'migration-report.json')}>Download report <Icon name="download" size={15} /></button></div></div></section>}
      <div className="ground-rules"><div><span><Icon name="shield" size={20} /></span><strong>Your pack stays yours</strong><small>Everything is processed in this tab, not on a server.</small></div><div><span><Icon name="box" size={20} /></span><strong>Official files only</strong><small>Matched through Modrinth and CurseForge.</small></div><div><span><Icon name="check" size={20} /></span><strong>No surprises in your ZIP</strong><small>Only verified files. Configs stay untouched.</small></div></div>
    </main>
    <footer className="footer page-width">
      <p className="compatibility-note">We find published builds, not magic fixes. Minecraft runtime compatibility isn’t guaranteed.</p>
      <p className="copyright">© {new Date().getFullYear()} <a className="author-link" href={author} target="_blank" rel="noreferrer">hhhhhffd</a>. Licensed under <a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noreferrer">AGPL-3.0</a>.</p>
    </footer>
    {replace && <div className="modal-backdrop" onClick={() => setReplace(undefined)}><div className="modal" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="replace-title" onClick={event => event.stopPropagation()}><div className="section-heading"><div><p className="eyebrow">FIND A NEW FAVORITE</p><h2 id="replace-title">A different mod. Your choice.</h2></div><button className="icon-button" aria-label="Close replacement" onClick={() => setReplace(undefined)}><Icon name="close" size={20} /></button></div><p className="modal-description">Search an official project or paste its link. Only builds for {version.trim()} / {loader} will appear.</p><form className="search" onSubmit={event => { event.preventDefault(); if (query.trim() && !busy) void run('Searching projects', async () => { setAlternatives([]); setVersionsLoaded(false); setProjects(await engine.current!.searchProjects(provider, query.trim())); setSearched(true); }); }}><select disabled={!!busy} aria-label="Provider" value={provider} onChange={event => { setProvider(event.target.value as Provider); setProjects([]); setAlternatives([]); setSearched(false); setVersionsLoaded(false); }}><option value="modrinth">Modrinth</option><option value="curseforge">CurseForge</option></select><input ref={searchInput} disabled={!!busy} aria-label="Project name or ID" placeholder="Search a mod or paste a project link" value={query} onChange={event => setQuery(event.target.value)} /><button type="submit" aria-label="Search" className="primary" disabled={!query.trim() || !!busy}><Icon name="search" size={17} /><span>Search</span></button></form><button className="direct-id quiet-button" disabled={!query.trim() || !!busy} onClick={() => void run('Loading compatible versions', async () => { const id = projectIdFromInput(provider, query); setProjects([]); setSearched(false); setAlternatives(await engine.current!.listCandidates(provider, id, target)); setVersionsLoaded(true); })}>Use this project ID / official link <Icon name="arrow" size={14} /></button>{busy && <div className="modal-loading" role="status"><span className="spinner" />{busy}…</div>}{error && <p className="modal-error" role="alert">{error}</p>}<div className="search-results">{projects.map(project => <button disabled={!!busy} key={project.projectId} className="project" onClick={() => void run('Loading compatible versions', async () => { setAlternatives(await engine.current!.listCandidates(provider, project.projectId, target)); setVersionsLoaded(true); })}><span className="file-symbol"><Icon name="box" size={20} /></span><span><strong>{project.name}</strong><small>{project.description || project.projectId}</small></span><Icon name="arrow" size={17} /></button>)}{alternatives.map(candidate => <button disabled={!!busy} key={`${candidate.provider}-${candidate.versionId}`} className="project candidate-project" onClick={() => { changeSelection(replace, { provider: candidate.provider, projectId: candidate.projectId, versionId: candidate.versionId }); setReplace(undefined); }}><span><strong>{candidate.name}</strong><small>{candidate.version}</small></span><Channel candidate={candidate} /><span className="choose-version">Choose <Icon name="arrow" size={15} /></span></button>)}{!busy && ((searched && !projects.length) || (versionsLoaded && !alternatives.length)) && <p className="modal-empty">{versionsLoaded ? 'No compatible builds for this target. Try another project.' : 'No projects found. Try another name or use an official link.'}</p>}</div><p className="replacement-note"><Icon name="shield" size={15} /> This is a manual replacement, not an automatic match. It will appear in your report.</p></div></div>}
  </div>;
}
