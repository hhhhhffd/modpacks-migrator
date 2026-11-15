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
    undo: <><path d="M4 10h10a6 6 0 0 1 0 12M4 10l5-5m-5 5 5 5" /></>,
    github: <><path d="M9 19c-4 1-4-2-6-2m12 5v-4c0-1 .1-1.5-.5-2 4-.4 7.5-2 7.5-7a5.4 5.4 0 0 0-1.5-3.7A5 5 0 0 0 20 1s-1.3-.4-4 1.5a14 14 0 0 0-8 0C5.3.6 4 1 4 1a5 5 0 0 0-.5 4.3A5.4 5.4 0 0 0 2 9c0 5 3.5 6.6 7.5 7-.6.5-.6 1.2-.5 2v4" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.box}</svg>;
}

function PortalScene() {
  return <svg className="portal-scene" viewBox="0 0 540 370" fill="none" aria-hidden="true">
    <defs>
      <linearGradient id="portal-glow" x1="315" y1="70" x2="395" y2="245" gradientUnits="userSpaceOnUse"><stop stopColor="#d4efb0" /><stop offset="1" stopColor="#72bfa4" stopOpacity=".1" /></linearGradient>
      <radialGradient id="scene-halo"><stop stopColor="#90bfa0" stopOpacity=".2" /><stop offset="1" stopColor="#90bfa0" stopOpacity="0" /></radialGradient>
      <pattern id="portal-grid" width="15" height="15" patternUnits="userSpaceOnUse"><path d="M15 0H0v15" stroke="#e1f4c2" strokeOpacity=".16" /></pattern>
    </defs>
    <ellipse cx="312" cy="185" rx="225" ry="180" fill="url(#scene-halo)" />
    <path d="m25 284 245-139 242 139-245 139L25 284Z" stroke="#d5e7cc" strokeOpacity=".08" />
    <path d="m75 254 192-110 191 110-191 110L75 254Z" stroke="#d5e7cc" strokeOpacity=".08" />
    <g className="island-source">
      <path d="m50 234 104-60 103 60-103 60-104-60Z" fill="#94aa89" /><path d="m50 234 104 60v37L50 271v-37Z" fill="#536553" /><path d="m154 294 103-60v37l-103 60v-37Z" fill="#344d41" />
      <path d="m50 234 104 60v9L50 243v-9Z" fill="#7b9670" /><path d="m154 294 103-60v9l-103 60v-9Z" fill="#668363" />
      <path d="m73 232 29 17m19 11 32 18m26-1 29-17" stroke="#b2c4a2" strokeOpacity=".5" />
      <path d="m99 203 47-27 47 27-47 27-47-27Z" fill="#d4d0b4" /><path d="m99 203 47 27v42l-47-27v-42Z" fill="#a49f88" /><path d="m146 230 47-27v42l-47 27v-42Z" fill="#7b816e" />
      <path d="m121 193 47 27" stroke="#f3efcf" strokeOpacity=".5" /><path d="m114 224 15 9v13l-15-9v-13Zm44 11 19-11v13l-19 11v-13Z" fill="#666f60" />
      <path d="m72 241 9 5v9l-9-5v-9Zm111 49 13-8v9l-13 8v-9Z" fill="#b6c39e" fillOpacity=".5" />
    </g>
    <path d="m224 214 12-7m7-4 12-7m7-4 12-7" stroke="#d4e4a5" strokeWidth="2" strokeLinecap="round" />
    <g className="island-target">
      <path d="m267 211 102-59 120 69-102 59-120-69Z" fill="#bdd29b" /><path d="m267 211 120 69v44l-120-69v-44Z" fill="#647e58" /><path d="m387 280 102-59v44l-102 59v-44Z" fill="#3b5c47" />
      <path d="m267 211 120 69v9l-120-69v-9Z" fill="#99b37b" /><path d="m387 280 102-59v9l-102 59v-9Z" fill="#7d9d69" />
      <path d="m288 209 99 57 78-45" stroke="#d9e8b6" strokeOpacity=".5" />
      <path d="M311 213V85l78 45v128l-78-45Z" fill="#304f43" /><path d="m311 85 15-9 78 45-15 9-78-45Z" fill="#75977a" /><path d="m389 130 15-9v128l-15 9V130Z" fill="#182f27" />
      <path d="M326 206V111l48 28v95l-48-28Z" fill="url(#portal-glow)" /><path d="M326 206V111l48 28v95l-48-28Z" fill="url(#portal-grid)" /><path d="M326 206V111l48 28v95l-48-28Z" stroke="#c8e5a4" strokeOpacity=".7" />
      <path d="m311 116 15 9m-15 22 15 9m-15 22 15 9m48-28 15 9m-15 22 15 9m-15 22 15 9" stroke="#89a789" strokeOpacity=".45" />
      <path d="m424 201 15-9 15 9-15 9-15-9Z" fill="#dfd3a0" /><path d="m424 201 15 9v18l-15-9v-18Z" fill="#b4aa7a" /><path d="m439 210 15-9v18l-15 9v-18Z" fill="#879166" />
      <path d="m460 242 6-12 4 7m-169 2 5-13 5 6" stroke="#c8dea4" strokeWidth="2" />
    </g>
    <g className="portal-sparks" fill="#dfecbb"><rect x="289" y="91" width="4" height="4" /><rect x="422" y="97" width="3" height="3" /><rect x="281" y="156" width="3" height="3" /><rect x="412" y="183" width="4" height="4" /></g>
    <g className="scene-label"><rect x="63" y="124" width="102" height="30" rx="7" fill="#1b382c" stroke="#49644c" /><text x="77" y="143" fill="#c2cfb5">your-pack.zip</text><rect x="386" y="48" width="96" height="30" rx="7" fill="#d0e1b5" /><text x="400" y="67" fill="#243e30">next chapter</text></g>
  </svg>;
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
export default function App() {
  const engine = useRef<Migrator | null>(null);
  const [file, setFile] = useState<File>();
  const [version, setVersion] = useState('');
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
  const entries = resolution?.entries || [];
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
  function openReplacement(inputId: string) { setReplace(inputId); setProjects([]); setAlternatives([]); setQuery(''); setSearched(false); setVersionsLoaded(false); setError(''); }
  const warning = resolution?.warnings?.length ? resolution.warnings.map(message => message.includes('CurseForge') ? 'CurseForge is unavailable for this analysis. Modrinth matches are still available. Analyze again to retry.' : concise(message)) : [];
  return <div className="app-shell">
    <div className="forest">
      <header className="topbar page-width">
        <a className="brand" href="/" aria-label="Modpack Migrator home"><span className="brand-mark"><Icon name="box" size={25} /></span><span>modpack<span className="brand-second">migrator</span><span className="brand-dot">.</span></span></a>
        <nav aria-label="Project links"><a className="repo-link" aria-label="GitHub repository" href={repository} target="_blank" rel="noreferrer"><Icon name="github" size={18} /><span>GitHub</span><Icon name="link" size={13} /></a><span className="nav-divider" /><a className="author-link" href={author} target="_blank" rel="noreferrer" aria-label="Made by hhhhhffd on GitHub"><span className="author-avatar" aria-hidden="true">h<span>↗</span></span><span>hhhhhffd</span></a></nav>
      </header>
      <section className="hero page-width">
        <div className="hero-copy"><p className="eyebrow"><span className="live-dot" /> A fresh start, not a restart</p><h1>Your next world.<br /><span>Your favorite mods.</span></h1><p className="hero-description">Take your modpack somewhere new. Find compatible versions, keep what you love, and leave the busywork behind.</p><div className="hero-footnote"><Icon name="shield" size={16} /><span>Runs on your device. No upload. No account.</span></div></div>
        <div className="hero-art"><PortalScene /><span className="art-caption"><span /> Same pack. New possibilities.</span></div>
      </section>
    </div>
    <main className="page-width workspace">
      <div className="workspace-heading"><div><p className="eyebrow">PACK YOUR NEXT CHAPTER</p><h2>A little change. A whole new world.</h2></div><span className="local-badge"><span className="live-dot" /> Local-first, always</span></div>
      <ol className="journey" aria-label="Migration steps"><li className={!resolution ? 'current' : 'done'} aria-current={!resolution ? 'step' : undefined}><span>{resolution ? <Icon name="check" size={14} /> : '1'}</span>Your modpack</li><li className={resolution && !result ? 'current' : result ? 'done' : ''} aria-current={resolution && !result ? 'step' : undefined}><span>{result ? <Icon name="check" size={14} /> : '2'}</span>Make it yours</li><li className={result ? 'current' : ''} aria-current={result ? 'step' : undefined}><span>3</span>Take it with you</li></ol>
      <section className={`setup panel ${resolution && !editingSetup ? 'setup-collapsed' : ''}`} aria-labelledby="setup-title">
        {resolution && !editingSetup && <div className="pack-summary"><span className="file-symbol"><Icon name="box" size={24} /></span><div><strong>{file?.name}</strong><span>{version.trim()} <span className="summary-separator">/</span> {loader} <span className="summary-separator">·</span> {entries.length} mods found</span></div><button className="quiet-button" disabled={locked} onClick={() => setEditingSetup(true)}>Edit setup</button></div>}
        <div className="setup-content" hidden={!!resolution && !editingSetup}>
          <div className="section-heading"><div><h3 id="setup-title">Start with your modpack</h3><p>One ZIP. A new Minecraft version. We’ll find the right files.</p></div><span className="file-type">.ZIP IN → .ZIP OUT</span></div>
          <div className="setup-grid">
            <label className={`upload ${file ? 'has-file' : ''} ${dragging ? 'dragging' : ''}`} onDragOver={event => { event.preventDefault(); if (!locked) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); chooseFile(event.dataTransfer.files[0]); }}>
              <span className="upload-art"><span /><Icon name={file ? 'box' : 'upload'} size={29} /></span><strong>{file ? file.name : 'Drop your modpack here'}</strong><span className="upload-description">{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB · Ready for a new adventure` : <>or <span className="upload-browse">browse files</span> to get started</>}</span><small>ZIP with JAR files · up to 256 MB</small><input aria-label="Modpack ZIP" disabled={locked} type="file" accept=".zip,application/zip" onChange={event => chooseFile(event.target.files?.[0])} />
            </label>
            <div className="target-setup"><div className="fields"><label>Minecraft version<input disabled={locked} placeholder="e.g. 1.21.1" list="minecraft-versions" value={version} onChange={event => { setVersion(event.target.value); resetPreview(); }} /><datalist id="minecraft-versions"><option value="1.21.5" /><option value="1.21.1" /><option value="1.20.1" /></datalist></label><label>Loader<select disabled={locked} value={loader} onChange={event => { setLoader(event.target.value as Loader); resetPreview(); }}><option value="fabric">Fabric</option><option value="forge">Forge</option><option value="neoforge">NeoForge</option><option value="quilt">Quilt</option></select></label></div>
              <label className="check"><input disabled={locked} type="checkbox" checked={dependencies} onChange={event => { setDependencies(event.target.checked); resetPreview(); }} /><span>Include required dependencies<small>The little things your mods need to work.</small></span></label>
              <button className="primary analyze-button" disabled={!file || !version.trim() || locked} onClick={() => void run('Finding compatible mods', analyze)}>{busy === 'Finding compatible mods' ? <><span className="spinner" /> Analyzing your pack</> : <>Analyze pack <Icon name="arrow" size={19} /></>}</button><p className="setup-note">Your original files are never changed.</p>
            </div>
          </div>
          {resolution && <button className="quiet-button return-review" onClick={() => setEditingSetup(false)}>Back to your matches <Icon name="arrow" size={15} /></button>}
        </div>
      </section>
      {busy && !replace && <div className="operation-status" role="status"><span className="spinner" /><div><strong>{busy}</strong><span>{progress?.message || 'Working on your device. Your archive stays here.'}</span>{progress?.total ? <progress value={progress.completed || 0} max={progress.total} aria-label={busy} /> : null}</div><button className="quiet-button" onClick={() => void cancelOperation()}>Cancel</button></div>}
      {error && !replace && <div className={`feedback ${error.toLowerCase().includes('cancelled') ? 'neutral' : ''}`} role="alert"><span>!</span><div><strong>{error.toLowerCase().includes('cancelled') ? 'Analysis cancelled' : 'Something needs your attention'}</strong><p>{error}</p></div><button className="icon-button" aria-label="Dismiss message" onClick={() => setError('')}><Icon name="close" size={18} /></button></div>}
      {resolution && <section className="preview panel" ref={previewRef} aria-labelledby="review-title">
        <div className="section-heading review-heading"><div><p className="eyebrow">YOUR PACK, YOUR CALL</p><h2 id="review-title">Check the matches<span className="heading-dot">.</span></h2><p>Keep the good stuff. Swap a version. Leave a mod behind.</p></div><div className="selection-feedback"><span className="selection-status" role="status">{updating ? <><span className="spinner" /> Checking dependencies</> : <><Icon name="check" size={15} /> Changes saved locally</>}</span>{updating && <button className="quiet-button" onClick={() => void cancelOperation()}>Cancel update</button>}</div></div>
        {warning.length > 0 && <details className="provider-notice"><summary><span className="notice-dot" /> Some provider data is unavailable <span className="details-label">Details</span></summary><div>{warning.map((message, index) => <p key={index}>{message}</p>)}</div></details>}
        <div className="review-toolbar"><div className="filters" role="group" aria-label="Filter mods">{([['all', 'All mods', entries.length], ['ready', 'Ready', selectedCount], ['attention', 'Needs attention', attentionCount], ['removed', 'Removed', removedCount]] as const).map(([value, label, count]) => <button key={value} className={filter === value ? 'active' : ''} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}<span>{count}</span></button>)}</div><label className="mod-search"><Icon name="search" size={16} /><input type="search" aria-label="Search mods" placeholder="Find a mod…" value={modQuery} onChange={event => setModQuery(event.target.value)} /></label></div>
        <div className="table-heading"><span>YOUR MOD</span><span>COMPATIBLE VERSION</span><span>MAKE IT YOURS</span></div>
        <div className="entries">{filteredEntries.map(entry => {
          const isRemoved = removed(entry.inputId);
          const selectedVersion = selections.find(item => item.inputId === entry.inputId)?.versionId || entry.selected?.versionId || '';
          return <article data-input-id={entry.inputId} className={`entry ${isRemoved ? 'is-removed' : ''} ${!isReady(entry) && !isRemoved ? 'needs-attention' : ''}`} key={entry.inputId}>
            <div className="entry-source"><span className="mod-icon" style={{ '--mod-hue': (entry.inputId.split('').reduce((n, char) => n + char.charCodeAt(0), 0) * 43) % 90 } as CSSProperties}><Icon name="box" size={21} /></span><div className="mod-identity"><strong title={entryName(entry)}>{entryName(entry)}</strong><small title={entry.sourcePath}>{entry.sourcePath || 'Required dependency'}</small>{entry.requiredBy?.length ? <span className="dependency-note">Required by {entry.requiredBy.length} {entry.requiredBy.length === 1 ? 'mod' : 'mods'}</span> : null}</div></div>
            <div className="entry-target">{isRemoved ? <span className="removed-label">Removed from your choices</span> : entry.candidates?.length > 0 ? <><div className="version-control"><select disabled={!!busy} aria-label={`Version for ${entry.sourcePath}`} value={selectedVersion} onChange={event => { const candidate = entry.candidates.find(c => c.versionId === event.target.value); if (candidate) changeSelection(entry.inputId, { provider: candidate.provider, projectId: candidate.projectId, versionId: candidate.versionId }); }}><option value="" disabled>Choose version</option>{entry.candidates.map(candidate => <option key={`${candidate.provider}-${candidate.versionId}`} value={candidate.versionId}>{candidate.version} · {candidate.channel}</option>)}</select>{entry.selected && <Channel candidate={entry.selected} />}</div>{entry.selected && <a className="provider-link" href={projectUrl(entry.selected)} target="_blank" rel="noreferrer">{entry.selected.provider === 'modrinth' ? 'Modrinth' : 'CurseForge'} <Icon name="link" size={11} />{entry.action === 'replacement' && <span>Manual replacement</span>}</a>}</> : <span className="unavailable-label">{entry.status === 'no_compatible_version' ? 'No compatible version' : entry.status === 'dependency_conflict' ? 'Dependency needs attention' : entry.status === 'not_found' ? 'Not identified' : entry.status === 'error' ? 'Provider unavailable' : 'Download unavailable'}</span>}{entry.reason && !isRemoved && <small className="reason">{concise(entry.reason)}</small>}</div>
            <div className="entry-actions">{isRemoved ? <button disabled={!!busy} className="undo-button" onClick={() => undoRemoval(entry.inputId)}><Icon name="undo" size={15} /> Undo</button> : <><button disabled={locked} className="replace-button" onClick={() => openReplacement(entry.inputId)}>Replace</button><button disabled={!!busy} className="remove-button" onClick={() => removeEntry(entry.inputId)} aria-label={`Remove ${entryName(entry)}`} title="Leave this mod out of the download"><Icon name="minus" size={15} /><span>Remove</span></button></>}</div>
          </article>;
        })}{filteredEntries.length === 0 && <div className="empty-list"><Icon name={filter === 'attention' ? 'check' : 'search'} size={27} /><h3>{filter === 'attention' ? 'Nothing needs your attention.' : filter === 'removed' && !modQuery ? 'Nothing left behind.' : 'No mods here.'}</h3><p>{modQuery ? 'Try another name or clear your search.' : filter === 'removed' ? 'Mods you remove stay here, with an option to undo.' : 'Choose another filter to see your mods.'}</p>{(modQuery || filter !== 'all') && <button className="quiet-button" onClick={() => { setModQuery(''); setFilter('all'); }}>Show all mods</button>}</div>}</div>
        <div className="preview-footer"><div><strong>{selectedCount} {selectedCount === 1 ? 'mod' : 'mods'} selected for your next world</strong><p>No repeat scan. Required mods may reappear as dependency rows; removing those also excludes dependent mods.</p></div><button className="primary" disabled={locked || !selectedCount} onClick={() => void run('Building your modpack', async () => { setResult(await engine.current!.convertZip()); requestAnimationFrame(() => resultRef.current?.scrollIntoView({ block: 'center', behavior: 'instant' })); })}>Build modpack <Icon name="arrow" size={18} /></button></div>
      </section>}
      {result && <section className={`result panel ${result.report.status === 'empty' ? 'empty-result' : ''}`} ref={resultRef} aria-labelledby="result-title"><div className="result-icon"><Icon name={result.report.status === 'empty' ? 'box' : 'check'} size={30} /></div><div className="result-copy"><p className="eyebrow">PACKED FOR THE NEXT CHAPTER</p><h2 id="result-title">{result.report.status === 'completed' ? 'Your pack is ready' : result.report.status === 'partial' ? 'Your pack is partially ready' : result.report.status === 'empty' ? 'No files could be included' : `Migration ${result.report.status}`}</h2><p>{result.report.status === 'partial' ? 'Some mods couldn’t make the trip. Your report explains which ones and why.' : result.report.status === 'empty' ? 'No verified files were available. Try a replacement or another target version.' : 'Verified files, a clean ZIP, and a report of everything that changed.'}</p><div className="buttons">{result.report.status !== 'empty' && <button className="primary" onClick={() => save(result.archive, 'migrated-modpack.zip')}><Icon name="download" size={17} /> Download ZIP</button>}<button className="secondary" onClick={() => save(new Blob([JSON.stringify(result.report, null, 2)], { type: 'application/json' }), 'migration-report.json')}>Download report <Icon name="download" size={15} /></button></div></div></section>}
      <div className="ground-rules"><div><Icon name="shield" size={21} /><span><strong>Your pack stays yours</strong><small>Processed here, not on someone else’s server.</small></span></div><div><Icon name="box" size={21} /><span><strong>Official files. No guesswork.</strong><small>Matched through Modrinth and CurseForge.</small></span></div><div><Icon name="check" size={21} /><span><strong>No surprises in your ZIP</strong><small>Only verified files. Configs stay untouched.</small></span></div></div>
      <p className="compatibility-note">We find published builds, not magic fixes. Minecraft runtime compatibility isn’t guaranteed.</p>
    </main>
    <footer className="footer page-width"><a className="footer-brand" href={repository} target="_blank" rel="noreferrer"><Icon name="box" size={17} /> modpack migrator</a><span>Built by <a href={author} target="_blank" rel="noreferrer">hhhhhffd <Icon name="link" size={11} /></a></span><span>Open source. AGPL-3.0. <a href={repository} target="_blank" rel="noreferrer">Take a look <Icon name="arrow" size={13} /></a></span></footer>
    {replace && <div className="modal-backdrop" onClick={() => setReplace(undefined)}><div className="modal" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="replace-title" onClick={event => event.stopPropagation()}><div className="section-heading"><div><p className="eyebrow">FIND A NEW FAVORITE</p><h2 id="replace-title">A different mod. Your choice.</h2></div><button className="icon-button" aria-label="Close replacement" onClick={() => setReplace(undefined)}><Icon name="close" size={20} /></button></div><p className="modal-description">Search an official project or paste its link. Only builds for {version.trim()} / {loader} will appear.</p><form className="search" onSubmit={event => { event.preventDefault(); if (query.trim() && !busy) void run('Searching projects', async () => { setAlternatives([]); setVersionsLoaded(false); setProjects(await engine.current!.searchProjects(provider, query.trim())); setSearched(true); }); }}><select disabled={!!busy} aria-label="Provider" value={provider} onChange={event => { setProvider(event.target.value as Provider); setProjects([]); setAlternatives([]); setSearched(false); setVersionsLoaded(false); }}><option value="modrinth">Modrinth</option><option value="curseforge">CurseForge</option></select><input ref={searchInput} disabled={!!busy} aria-label="Project name or ID" placeholder="Search a mod or paste a project link" value={query} onChange={event => setQuery(event.target.value)} /><button type="submit" aria-label="Search" className="primary" disabled={!query.trim() || !!busy}><Icon name="search" size={17} /><span>Search</span></button></form><button className="direct-id quiet-button" disabled={!query.trim() || !!busy} onClick={() => void run('Loading compatible versions', async () => { const id = projectIdFromInput(provider, query); setProjects([]); setSearched(false); setAlternatives(await engine.current!.listCandidates(provider, id, target)); setVersionsLoaded(true); })}>Use this project ID / official link <Icon name="arrow" size={14} /></button>{busy && <div className="modal-loading" role="status"><span className="spinner" />{busy}…</div>}{error && <p className="modal-error" role="alert">{error}</p>}<div className="search-results">{projects.map(project => <button disabled={!!busy} key={project.projectId} className="project" onClick={() => void run('Loading compatible versions', async () => { setAlternatives(await engine.current!.listCandidates(provider, project.projectId, target)); setVersionsLoaded(true); })}><span className="file-symbol"><Icon name="box" size={20} /></span><span><strong>{project.name}</strong><small>{project.description || project.projectId}</small></span><Icon name="arrow" size={17} /></button>)}{alternatives.map(candidate => <button disabled={!!busy} key={`${candidate.provider}-${candidate.versionId}`} className="project candidate-project" onClick={() => { changeSelection(replace, { provider: candidate.provider, projectId: candidate.projectId, versionId: candidate.versionId }); setReplace(undefined); }}><span><strong>{candidate.name}</strong><small>{candidate.version}</small></span><Channel candidate={candidate} /><span className="choose-version">Choose <Icon name="arrow" size={15} /></span></button>)}{!busy && ((searched && !projects.length) || (versionsLoaded && !alternatives.length)) && <p className="modal-empty">{versionsLoaded ? 'No compatible builds for this target. Try another project.' : 'No projects found. Try another name or use an official link.'}</p>}</div><p className="replacement-note"><Icon name="shield" size={15} /> This is a manual replacement, not an automatic match. It will appear in your report.</p></div></div>}
  </div>;
}
