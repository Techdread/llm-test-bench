// Showcase admin console (spec 342, phase 2). Behind Cloudflare Access; every
// write is also verified server-side (functions/lib/access.js).
import { render } from 'preact';
import { useState, useEffect, useMemo, useRef, useCallback } from 'preact/hooks';
import { html } from 'htm/preact';

import { getRootStatus, setRoot, connectRoot } from '../shared/services/data-root-manager.js';
import * as checks from './services/showcase-checks.js';
import * as api from './services/api.js';
import { handleReader } from './services/fs-reader.js';
import { scanCandidates, filterCandidates, suggestId, publishReport } from './services/candidates.js';
import { withCaptureShim, captureFromPreview, captureScreen, imageFromBytes, normalizePoster } from './services/poster.js';

const BENCH_LABEL = { 'prompt-gallery': 'Prompt Gallery', 'p5-sketch-gallery': 'p5 Sketch', 'svg-benchmark': 'SVG Bench' };
const BENCH_CLS = { 'prompt-gallery': 'pg', 'p5-sketch-gallery': 'p5', 'svg-benchmark': 'svg' };

function useToast() {
  const [toast, setToast] = useState(null);
  const timer = useRef(0);
  const show = useCallback((text, level = 'ok') => {
    clearTimeout(timer.current);
    setToast({ text, level });
    timer.current = setTimeout(() => setToast(null), level === 'error' ? 9000 : 4000);
  }, []);
  return [toast, show];
}

const itemArt = (item) => api.objectUrl(item.kind === 'svg' ? item.code_key : item.poster_key);

// ── Folder + candidates ────────────────────────────────────────────────────

function FolderBar({ folder, onConnect, onPick, onScan, scanning, progress, count }) {
  return html`
    <div class="adm-folder">
      <i class="fa-solid fa-folder-open"></i>
      ${folder.status === 'ready' && html`<span>Data folder <strong>${folder.name}</strong></span>
        <button class="button compact" onClick=${onScan} disabled=${scanning}>
          ${scanning ? `Scanning… ${progress}` : count ? `Rescan (${count} found)` : 'Scan for generations'}</button>`}
      ${folder.status === 'needs-permission' && html`<span>Folder <strong>${folder.name}</strong> needs permission again.</span>
        <button class="button compact primary" onClick=${onConnect}>Allow access</button>`}
      ${folder.status === 'none' && html`<span>Connect your data folder (the one the benches save into) to browse generations.</span>
        <button class="button compact primary" onClick=${onPick}>Choose folder</button>`}
      ${folder.status === 'unsupported' && html`<span>This browser cannot open local folders. Use Chrome or Edge.</span>`}
    </div>`;
}

function CandidateList({ list, selected, onSelect, filters, setFilters, total }) {
  const set = (k) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setFilters(current => ({ ...current, [k]: value }));
  };
  return html`
    <div class="adm-cands">
      <div class="adm-filters">
        <select value=${filters.bench} onChange=${set('bench')} aria-label="Bench">
          <option value="all">All benches</option>
          ${Object.entries(BENCH_LABEL).map(([k, v]) => html`<option value=${k}>${v}</option>`)}
        </select>
        <select value=${filters.minScore} onChange=${set('minScore')} aria-label="Minimum rating">
          <option value="0">Any rating</option><option value="0.01">Rated</option>
          <option value="0.7">70%+</option><option value="0.8">80%+</option><option value="0.9">90%+</option><option value="1">Top only</option>
        </select>
        <input type="search" placeholder="Search title, model" value=${filters.query} onInput=${set('query')} />
        <label><input type="checkbox" checked=${filters.unpublishedOnly} onChange=${set('unpublishedOnly')} /> Not yet published</label>
        <label><input type="checkbox" checked=${filters.onePerPrompt} onChange=${set('onePerPrompt')} /> Best per prompt</label>
      </div>
      <p class="adm-muted">${list.length} of ${total} generations</p>
      <ul class="adm-list" role="listbox" aria-label="Candidates">
        ${list.slice(0, 300).map(c => html`
          <li key=${c.source} role="option" aria-selected=${selected?.source === c.source}
              class=${`adm-row ${selected?.source === c.source ? 'is-selected' : ''}`} onClick=${() => onSelect(c)}>
            <span class=${`adm-chip ${BENCH_CLS[c.bench]}`}>${BENCH_LABEL[c.bench]}</span>
            <span class="adm-row-title">${c.title}</span>
            <span class="adm-row-score">${c.rated ? `${c.rating}/${c.scoreMax}` : '—'}</span>
            <span class="adm-row-sub">${c.model}${c.created ? ` · ${c.created.slice(0, 10)}` : ''}</span>
          </li>`)}
      </ul>
      ${list.length > 300 && html`<p class="adm-muted">Showing the first 300. Narrow the filters to see more.</p>`}
    </div>`;
}

function PublishPanel({ candidate, reader, items, onPublished, toast }) {
  const [code, setCode] = useState('');
  const [prompt, setPrompt] = useState('');
  const [form, setForm] = useState({});
  const [poster, setPoster] = useState(null);   // { bytes, url, blank }
  const [busy, setBusy] = useState('');
  const frame = useRef(null);
  const previewBox = useRef(null);
  const fileInput = useRef(null);

  useEffect(() => {
    let live = true;
    setPoster(null);
    setCode('');
    (async () => {
      const text = await reader.text(candidate.source);
      const promptText = candidate.prompt ? await reader.text(candidate.prompt).catch(() => '') : '';
      if (!live) return;
      setCode(text);
      setPrompt(promptText.trim());
      setForm({
        id: suggestId(candidate, items.map(i => i.id)),
        title: candidate.title,
        note: candidate.model,
        rating: candidate.rated ? `${candidate.rating}/${candidate.scoreMax}` : '',
      });
      if (candidate.thumb) {
        const img = await imageFromBytes(await reader.bytes(candidate.thumb));
        if (live) setPoster(await normalizePoster(img));
      }
    })().catch(e => toast(`Could not read ${candidate.source}: ${e.message}`, 'error'));
    return () => { live = false; };
  }, [candidate.source]);

  const report = useMemo(() => (code ? publishReport(candidate, code, items, checks) : []), [code, items]);
  const failed = report.some(r => r.level === 'fail');
  const needsPoster = candidate.kind !== 'svg';
  const svgUrl = useMemo(() => (candidate.kind === 'svg' && code ? URL.createObjectURL(new Blob([code], { type: 'image/svg+xml' })) : ''), [code]);

  async function usePoster(source, label) {
    try {
      const result = await normalizePoster(source);
      setPoster(result);
      toast(result.blank ? `${label}: the image looks blank. Try another capture method.` : `${label}: poster ready.`, result.blank ? 'warn' : 'ok');
    } catch (e) {
      toast(`${label} failed: ${e.message}`, 'error');
    }
  }

  async function doPublish() {
    setBusy('Publishing…');
    try {
      const item = await api.publish({
        id: form.id.trim(), bench: candidate.bench, title: form.title, note: form.note, rating: form.rating,
        sourceMeta: { source: candidate.source, prompt: candidate.prompt, model: candidate.model, run: candidate.run,
          rating: candidate.rating, scoreMax: candidate.scoreMax, created: candidate.created, publishedFrom: 'admin' },
      }, { code: new TextEncoder().encode(code), prompt, poster: poster?.bytes });
      toast(`Published ${item.id}. It is live on the showcase now.`);
      onPublished(item);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  }

  const field = (k, label, extra = {}) => html`
    <label class="adm-field"><span>${label}</span>
      <input value=${form[k] || ''} onInput=${e => { const v = e.target.value; setForm(f => ({ ...f, [k]: v })); }} ...${extra} /></label>`;

  return html`
    <section class="adm-publish" aria-label="Publish">
      <header class="adm-publish-head">
        <span class=${`adm-chip ${BENCH_CLS[candidate.bench]}`}>${BENCH_LABEL[candidate.bench]}</span>
        <h2>${candidate.title}</h2>
        <code class="adm-path">${candidate.source}</code>
      </header>
      <div class="adm-preview" ref=${previewBox}>
        ${candidate.kind === 'html' && code && html`<iframe ref=${frame} title="Preview" sandbox="allow-scripts" srcdoc=${withCaptureShim(code)}></iframe>`}
        ${candidate.kind === 'svg' && svgUrl && html`<img src=${svgUrl} alt="SVG preview" />`}
        ${candidate.kind === 'js' && (poster ? html`<img src=${poster.url} alt="Project thumbnail" />`
          : html`<p class="adm-muted">p5 sketches are previewed by their project thumbnail. Upload a poster if there is none.</p>`)}
      </div>
      ${prompt && html`<details class="adm-prompt"><summary>Prompt</summary><p>${prompt}</p></details>`}
      <ul class="adm-report">${report.map(r => html`<li class=${`is-${r.level}`}>${r.text}</li>`)}</ul>
      <div class="adm-form">
        ${field('id', 'Id (permanent: permalink and vote key)', { pattern: '[a-z0-9][a-z0-9-]{1,63}', spellcheck: false })}
        ${field('title', 'Title', { maxLength: 120 })}
        ${field('note', 'Model label', { maxLength: 200 })}
        ${field('rating', 'Rating', { placeholder: '9/10', maxLength: 5 })}
      </div>
      ${needsPoster && html`
        <div class="adm-poster">
          <div class="adm-poster-img">${poster ? html`<img src=${poster.url} alt="Poster" />` : html`<span class="adm-muted">No poster yet</span>`}</div>
          <div class="adm-poster-actions">
            ${candidate.kind === 'html' && html`
              <button class="button compact" onClick=${() => captureFromPreview(frame.current).then(img => usePoster(img, 'Canvas capture'), e => toast(e.message, 'warn'))}>Capture canvas</button>
              <button class="button compact" onClick=${() => captureScreen(previewBox.current).then(c => usePoster(c, 'Screen capture'), e => toast(`Screen capture cancelled: ${e.message}`, 'warn'))}>Capture screen</button>`}
            <button class="button compact" onClick=${() => fileInput.current.click()}>Upload image</button>
            <input ref=${fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden
              onChange=${async e => { const f = e.target.files[0]; e.target.value = ''; if (f) usePoster(await imageFromBytes(new Uint8Array(await f.arrayBuffer()), f.type), 'Upload'); }} />
            ${poster?.blank && html`<p class="adm-warn">This poster looks blank.</p>`}
          </div>
        </div>`}
      <div class="adm-publish-go">
        <button class="button primary" disabled=${!code || failed || !!busy || !form.id || !form.title || (needsPoster && !poster)} onClick=${doPublish}>
          ${busy || 'Publish to showcase'}</button>
        ${failed && html`<span class="adm-warn">Fix the failing check first.</span>`}
        ${needsPoster && !poster && !failed && html`<span class="adm-muted">Add a poster to publish.</span>`}
      </div>
    </section>`;
}

// ── Published items ────────────────────────────────────────────────────────

function ShowcaseTab({ items, setItems, reload, toast }) {
  const [order, setOrder] = useState(items.map(i => i.id));
  const [drafts, setDrafts] = useState({});
  useEffect(() => setOrder(items.map(i => i.id)), [items]);
  const byId = useMemo(() => Object.fromEntries(items.map(i => [i.id, i])), [items]);
  const dirtyOrder = order.join() !== items.map(i => i.id).join();
  const heroCount = items.filter(i => i.hero && i.status === 'published').length;

  const move = (id, delta) => {
    const i = order.indexOf(id);
    const j = Math.max(0, Math.min(order.length - 1, delta === -Infinity ? 0 : i + delta));
    const next = order.slice();
    next.splice(i, 1);
    next.splice(j, 0, id);
    setOrder(next);
  };
  const patch = async (id, change, label) => {
    try {
      const item = await api.updateItem(id, change);
      setItems(items.map(i => (i.id === id ? { ...i, ...item, hero: Boolean(item.hero) } : i)));
      setDrafts(d => { const n = { ...d }; delete n[id]; return n; });
      toast(`${label} ${id}.`);
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const saveOrder = async () => {
    try {
      await api.saveOrder(order);
      toast('Order saved. The public page updates within a minute.');
      reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const replace = async (id, file) => {
    try {
      const norm = await normalizePoster(await imageFromBytes(new Uint8Array(await file.arrayBuffer()), file.type));
      await api.replacePoster(id, norm.bytes);
      toast(`New poster for ${id}. The old one is kept in History.`);
      reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  return html`
    <section aria-label="Published items">
      <div class="adm-toolbar">
        <span>${items.filter(i => i.status === 'published').length} published, ${items.filter(i => i.status === 'hidden').length} hidden</span>
        <span class=${heroCount === 6 ? 'adm-muted' : 'adm-warn'}>${heroCount} on the landing page${heroCount === 6 ? '' : ' (it shows six)'}</span>
        ${dirtyOrder && html`<button class="button compact primary" onClick=${saveOrder}>Save order</button>
          <button class="button compact" onClick=${() => setOrder(items.map(i => i.id))}>Undo</button>`}
      </div>
      <ol class="adm-items">
        ${order.map((id, index) => {
          const item = byId[id];
          if (!item) return null;
          const draft = drafts[id] || {};
          const value = (k) => (k in draft ? draft[k] : item[k]);
          const edit = (k) => (e) => setDrafts({ ...drafts, [id]: { ...draft, [k]: e.target.value } });
          return html`
            <li key=${id} class=${`adm-item ${item.status === 'hidden' ? 'is-hidden' : ''}`}>
              <img src=${itemArt(item)} alt="" loading="lazy" />
              <div class="adm-item-main">
                <div class="adm-item-top">
                  <span class=${`adm-chip ${BENCH_CLS[item.bench]}`}>${BENCH_LABEL[item.bench]}</span>
                  <code>${id}</code>
                  ${item.status === 'hidden' && html`<span class="adm-tag">hidden</span>`}
                  <a href=${`../showcase.html#${id}`} target="_blank" rel="noopener">view</a>
                </div>
                <div class="adm-item-edit">
                  <input aria-label="Title" value=${value('title')} onInput=${edit('title')} />
                  <input aria-label="Model label" value=${value('note')} onInput=${edit('note')} />
                  <input aria-label="Rating" class="adm-rating" value=${value('rating')} onInput=${edit('rating')} />
                  ${Object.keys(draft).length > 0 && html`<button class="button compact primary" onClick=${() => patch(id, draft, 'Saved')}>Save</button>`}
                </div>
              </div>
              <div class="adm-item-actions">
                <label title="Show on the landing page"><input type="checkbox" checked=${item.hero} onChange=${e => patch(id, { hero: e.target.checked }, e.target.checked ? 'Added to landing:' : 'Removed from landing:')} /> Landing</label>
                <div class="adm-move">
                  <button class="button compact" aria-label="Move to top" disabled=${index === 0} onClick=${() => move(id, -Infinity)}>⤒</button>
                  <button class="button compact" aria-label="Move up" disabled=${index === 0} onClick=${() => move(id, -1)}>↑</button>
                  <button class="button compact" aria-label="Move down" disabled=${index === order.length - 1} onClick=${() => move(id, 1)}>↓</button>
                </div>
                ${item.kind !== 'svg' && html`<label class="button compact">Poster…<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange=${e => { const f = e.target.files[0]; e.target.value = ''; if (f) replace(id, f); }} /></label>`}
                ${item.status === 'published'
                  ? html`<button class="button compact danger" onClick=${() => patch(id, { status: 'hidden' }, 'Hid')}>Hide</button>`
                  : html`<button class="button compact" onClick=${() => patch(id, { status: 'published' }, 'Restored')}>Unhide</button>`}
              </div>
            </li>`;
        })}
      </ol>
    </section>`;
}

// ── History ────────────────────────────────────────────────────────────────

function HistoryTab({ items, reload, toast }) {
  const [entries, setEntries] = useState(null);
  const load = useCallback(() => api.listAudit().then(setEntries, e => toast(e.message, 'error')), []);
  useEffect(() => { load(); }, [items]);
  const current = Object.fromEntries(items.map(i => [i.id, i]));
  const restore = async (id, keys, label) => {
    try {
      await api.restoreRevision(id, keys);
      toast(`Restored the earlier ${label} of ${id}.`);
      reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  if (!entries) return html`<p class="adm-muted">Loading history…</p>`;
  const summary = (e) => {
    if (e.action === 'reorder') return 'Changed the order';
    if (!e.before || !e.after || Array.isArray(e.after)) return '';
    return Object.keys(e.after).filter(k => !k.endsWith('_at')).slice(0, 4)
      .map(k => (e.before && k in e.before ? `${k}: ${JSON.stringify(e.before[k])} → ${JSON.stringify(e.after[k])}` : '')).filter(Boolean).join('; ');
  };
  return html`
    <section aria-label="History">
      <p class="adm-muted">Every change is recorded and nothing is deleted. Earlier posters and code stay stored and can be restored.</p>
      <ol class="adm-history">
        ${entries.map(e => {
          const item = current[e.item_id];
          const oldPoster = e.before?.poster_key || (e.action === 'publish' && e.after?.poster_key);
          const oldCode = e.action === 'publish' && e.after?.code_key;
          return html`
            <li key=${e.seq}>
              <span class="adm-history-at">${e.at.replace('T', ' ').slice(0, 16)}</span>
              <strong>${e.action}</strong> ${e.item_id && html`<code>${e.item_id}</code>`}
              <span class="adm-muted"> by ${e.actor}</span>
              <div class="adm-history-diff">${summary(e)}</div>
              ${item && oldPoster && oldPoster !== item.poster_key && html`
                <button class="button compact" onClick=${() => restore(item.id, { poster_key: oldPoster }, 'poster')}>Restore this poster</button>`}
              ${item && oldCode && oldCode !== item.code_key && html`
                <button class="button compact" onClick=${() => restore(item.id, { code_key: oldCode }, 'code')}>Restore this code</button>`}
            </li>`;
        })}
      </ol>
    </section>`;
}

// ── Backup ─────────────────────────────────────────────────────────────────

async function downloadBackup(toast) {
  toast('Preparing backup…');
  const manifest = await api.backupManifest();
  const objects = {};
  let done = 0;
  for (const key of manifest.objects) {
    const bytes = await api.fetchObject(key);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    objects[key] = btoa(binary);
    if (++done % 10 === 0) toast(`Backing up… ${done}/${manifest.objects.length} files`);
  }
  const backup = { ...manifest, exportedAt: new Date().toISOString(), objects };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: 'application/json' }));
  a.download = `showcase-backup-${backup.exportedAt.slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast(`Backup downloaded: ${manifest.items.length} items, ${manifest.objects.length} files.`);
}

// ── App ────────────────────────────────────────────────────────────────────

function App() {
  const [identity, setIdentity] = useState(null);
  const [fatal, setFatal] = useState('');
  const [items, setItems] = useState([]);
  const [tab, setTab] = useState('publish');
  const [folder, setFolder] = useState({ status: 'checking' });
  const [reader, setReader] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState('');
  const [selected, setSelected] = useState(null);
  const [filters, setFilters] = useState({ bench: 'all', minScore: '0.01', unpublishedOnly: true, onePerPrompt: true, query: '' });
  const [toast, showToast] = useToast();

  const reload = useCallback(() => api.listItems().then(setItems, e => showToast(e.message, 'error')), []);

  const refreshFolder = useCallback(async () => {
    if (!('showDirectoryPicker' in window)) return setFolder({ status: 'unsupported' });
    const status = await getRootStatus();
    setFolder(status);
    if (status.status === 'ready') {
      const ready = handleReader(status.handle);
      setReader(() => ready);
      return ready;
    }
    return null;
  }, []);

  useEffect(() => {
    api.me().then(setIdentity, e => setFatal(e.message));
    reload();
    // Scan as soon as the folder is usable: no extra click, and no race
    // between the folder check and a click on a half-ready page.
    refreshFolder().then(ready => ready && scan(ready));
  }, []);

  const scan = async (activeReader = reader) => {
    if (!activeReader) return;
    setScanning(true);
    try {
      const found = await scanCandidates(activeReader, { onProgress: ({ found: n }) => setProgress(`${n} found`) });
      setCandidates(found);
      showToast(`Found ${found.length} generations.`);
    } catch (e) {
      showToast(`Scan failed: ${e.message}`, 'error');
    } finally {
      setScanning(false);
    }
  };

  const filtered = useMemo(() => filterCandidates(candidates, { ...filters, minScore: Number(filters.minScore) }, items), [candidates, filters, items]);

  if (fatal) {
    return html`<main class="adm-main"><h1>Showcase admin</h1><p class="adm-warn">${fatal}</p></main>`;
  }

  return html`
    <header class="site-header">
      <a class="brand" href="../"><span class="brand-mark">LT</span><span>LLM Test Bench</span></a>
      <nav aria-label="Admin">
        <span class="adm-muted">${identity ? `Signed in as ${identity.email}` : 'Checking sign-in…'}</span>
        <a href="../showcase.html" target="_blank" rel="noopener">View showcase</a>
        <button class="button compact" onClick=${() => downloadBackup(showToast).catch(e => showToast(`Backup failed: ${e.message}`, 'error'))}>Download backup</button>
      </nav>
    </header>
    <main class="adm-main">
      <div class="adm-tabs" role="tablist">
        ${[['publish', 'Publish'], ['showcase', `Showcase (${items.length})`], ['history', 'History']].map(([k, label]) => html`
          <button role="tab" aria-selected=${tab === k} class=${`adm-tab ${tab === k ? 'is-active' : ''}`} onClick=${() => setTab(k)}>${label}</button>`)}
      </div>
      ${tab === 'publish' && html`
        <${FolderBar} folder=${folder} scanning=${scanning} progress=${progress} count=${candidates.length}
          onScan=${() => scan()}
          onConnect=${async () => { if (await connectRoot()) { const ready = await refreshFolder(); if (ready) scan(ready); } }}
          onPick=${async () => { try { await setRoot(); const ready = await refreshFolder(); if (ready) scan(ready); } catch { /* picker cancelled */ } }} />
        <div class="adm-split">
          <${CandidateList} list=${filtered} total=${candidates.length} selected=${selected} onSelect=${setSelected} filters=${filters} setFilters=${setFilters} />
          ${selected && reader
            ? html`<${PublishPanel} key=${selected.source} candidate=${selected} reader=${reader} items=${items} toast=${showToast}
                onPublished=${() => { reload(); setSelected(null); }} />`
            : html`<section class="adm-publish adm-empty"><p class="adm-muted">${candidates.length ? 'Pick a generation to preview and publish it.' : 'Scan your data folder to list generations, best-rated first.'}</p></section>`}
        </div>`}
      ${tab === 'showcase' && html`<${ShowcaseTab} items=${items} setItems=${setItems} reload=${reload} toast=${showToast} />`}
      ${tab === 'history' && html`<${HistoryTab} items=${items} reload=${reload} toast=${showToast} />`}
    </main>
    ${toast && html`<div class=${`adm-toast is-${toast.level}`} role="status">${toast.text}</div>`}`;
}

const mount = document.getElementById('admin');
mount.textContent = '';   // drop the static "Loading…" placeholder
render(html`<${App} />`, mount);
