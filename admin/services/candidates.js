// Showcase candidates from the owner's data folder (spec 342, phase 2).
//
// DOM-free: it walks the three benches' save layouts through a small reader
// interface, so the admin console passes a File System Access adapter and the
// tests pass a fake tree. Ratings are the owner's own:
//   prompt-gallery   <slug>/<stem>.html + <stem>.json   rating, ratingScale (5 or 10)
//   svg-benchmark    svg-data/benchmarks/<slug>/submissions/<stem>.svg + .json   manualScore /10
//                    svg-data/benchmarks/<slug>/prompt.txt
//   p5-sketch-gallery projects/<slug>/sketch.js + metadata.json (rating /5) + prompt.md + thumb.png
//   game-forge-v2 /  projects/<slug>/<run>/project/ + forge.json (rating /5, prompt) + preview.png
//   vr-forge         (a forge run is a folder: it publishes as a project bundle, see project-bundle.js)
//
// Reader: { dirs(path) -> names[], files(path) -> names[], text(path) -> string|null, bytes(path) -> Uint8Array }

const join = (...parts) => parts.filter(Boolean).join('/');

export function titleCase(slug) {
  return String(slug || '')
    .replace(/^\d+[-_]/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

async function readJson(reader, path) {
  try {
    const text = await reader.text(path);
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

function rated(rating, scoreMax) {
  const value = Number(rating) || 0;
  return { rating: value, scoreMax, score: value / scoreMax, rated: value > 0 };
}

async function scanPromptGallery(reader, onProgress) {
  const out = [];
  const base = 'prompt-gallery';
  for (const slug of await reader.dirs(base)) {
    if (slug.startsWith('_')) continue;                     // _library etc.
    const dir = join(base, slug);
    const names = await reader.files(dir);
    for (const name of names) {
      if (!name.endsWith('.html')) continue;
      const stem = name.slice(0, -5);
      const meta = await readJson(reader, join(dir, `${stem}.json`));
      out.push({
        bench: 'prompt-gallery', kind: 'html', run: slug,
        source: join(dir, name), prompt: names.includes('prompt.md') ? join(dir, 'prompt.md') : '',
        thumb: '', title: titleCase(slug),
        model: meta.model || meta.modelDisplayLabel || stem.split('_')[0],
        created: meta.createdAt || '',
        ...rated(meta.rating, Number(meta.ratingScale) || 5),
      });
    }
    onProgress?.(out.length);
  }
  return out;
}

async function scanSvg(reader, onProgress) {
  const out = [];
  const base = 'svg-benchmark/svg-data/benchmarks';
  for (const slug of await reader.dirs(base)) {
    const dir = join(base, slug, 'submissions');
    const promptPath = join(base, slug, 'prompt.txt');
    let promptTitle = '';
    for (const name of await reader.files(dir)) {
      if (!name.endsWith('.svg')) continue;
      if (promptTitle === '') {
        let text = null;
        try { text = await reader.text(promptPath); } catch { /* no prompt.txt */ }
        promptTitle = svgTitle(text, slug);
      }
      const meta = await readJson(reader, join(dir, `${name.slice(0, -4)}.json`));
      out.push({
        bench: 'svg-benchmark', kind: 'svg', run: slug,
        source: join(dir, name), prompt: promptPath, thumb: '', title: promptTitle,
        model: meta.model || meta.modelId || 'unknown',
        created: meta.submittedAt || '',
        ...rated(meta.manualScore, 10),
      });
    }
    onProgress?.(out.length);
  }
  return out;
}

async function scanP5(reader, onProgress) {
  const out = [];
  const base = 'p5-sketch-gallery/projects';
  for (const slug of await reader.dirs(base)) {
    const dir = join(base, slug);
    const names = await reader.files(dir);
    if (!names.includes('sketch.js')) continue;
    const meta = await readJson(reader, join(dir, 'metadata.json'));
    out.push({
      bench: 'p5-sketch-gallery', kind: 'js', run: slug,
      source: join(dir, 'sketch.js'), prompt: names.includes('prompt.md') ? join(dir, 'prompt.md') : '',
      thumb: names.includes('thumb.png') ? join(dir, 'thumb.png') : '',
      title: meta.title || titleCase(slug.replace(/-[a-z0-9]{6,}$/i, '')),
      model: meta.model || meta.modelDisplayLabel || meta.modelId || 'unknown',
      created: meta.createdAt || meta.savedAt || '',
      ...rated(meta.rating, 5),
    });
    onProgress?.(out.length);
  }
  return out;
}

const AGENT_LABEL = { 'claude-code': 'Claude Code', codex: 'Codex', antigravity: 'Antigravity', grok: 'Grok',
  devin: 'Devin', cursor: 'Cursor', opencode: 'OpenCode' };

/** "claude-opus-5-5 · Claude Code" for an agent run, the model id for a direct one. */
export function forgeModelLabel(meta = {}) {
  if (meta.backend === 'agent' || (meta.agent && !meta.modelId)) {
    const agent = AGENT_LABEL[meta.agent] || meta.agent || 'agent';
    const model = meta.agentModel || meta.telemetry?.model || '';
    return model ? `${model} · ${agent}` : agent;
  }
  return meta.modelDisplayLabel || meta.modelName || meta.modelId || 'unknown';
}

/** Game Forge / VR Forge runs that have a project folder. */
async function scanForge(reader, onProgress, bench) {
  const out = [];
  const base = join(bench, 'projects');
  for (const slug of await reader.dirs(base)) {
    for (const runId of await reader.dirs(join(base, slug))) {
      const dir = join(base, slug, runId);
      if (!(await reader.dirs(dir)).includes('project')) continue;
      const names = await reader.files(dir);
      if (!names.includes('forge.json')) continue;
      const meta = await readJson(reader, join(dir, 'forge.json'));
      out.push({
        bench, kind: 'project', run: slug, runId,
        source: join(dir, 'project'), prompt: '',
        promptText: typeof meta.prompt === 'string' ? meta.prompt : '',
        thumb: names.includes('preview.png') ? join(dir, 'preview.png') : '',
        title: meta.taskTitle || meta.gameTitle || meta.title || titleCase(slug),
        model: forgeModelLabel(meta),
        status: meta.validation?.status || meta.status || '',
        created: meta.createdAt || '',
        ...rated(meta.rating, 5),
      });
    }
    onProgress?.(out.length);
  }
  return out;
}

/**
 * Every publishable file under `dir`, plus what was left out and why. Skipped
 * folders are not descended into: agents leave whole browser profiles behind.
 * `projectFileRule` comes from showcase-checks.js (passed in, so this module
 * stays import-free for node:test).
 */
export async function collectProjectFiles(reader, dir, projectFileRule) {
  const files = [];
  const skipped = [];
  async function walk(rel) {
    const here = rel ? `${dir}/${rel}` : dir;
    for (const name of await reader.files(here)) {
      const path = rel ? `${rel}/${name}` : name;
      const why = projectFileRule(path);
      if (why) skipped.push({ path, reason: why });
      else files.push({ path, bytes: await reader.bytes(`${dir}/${path}`) });
    }
    for (const name of await reader.dirs(here)) {
      const path = rel ? `${rel}/${name}` : name;
      // Judge the folder by a file inside it, so the same rule decides both.
      const why = projectFileRule(`${path}/x.js`);
      if (why) skipped.push({ path: `${path}/`, reason: why });
      else await walk(path);
    }
  }
  await walk('');
  return { files, skipped };
}

/** "Owl Eyes: Extreme close-up…" -> "Owl Eyes"; falls back to the slug. */
export function svgTitle(promptText, slug) {
  const first = String(promptText || '').trim().split(/[:.\n]/)[0].replace(/^draw (a picture of )?(an? )?/i, '').trim();
  const words = first.split(/\s+/).filter(Boolean);
  if (words.length && words.length <= 6) return words.map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
  return titleCase(slug.replace(/^draw-(a-picture-of-)?(an?-)?/, '')).split(' ').slice(0, 4).join(' ');
}

/** Scan every bench, best-rated first. */
export async function scanCandidates(reader, { onProgress } = {}) {
  let total = 0;
  const progress = (bench) => (n) => onProgress?.({ bench, found: total + n });
  const results = [];
  const forge = (bench) => (r, p) => scanForge(r, p, bench);
  for (const [bench, scan] of [['prompt-gallery', scanPromptGallery], ['svg-benchmark', scanSvg], ['p5-sketch-gallery', scanP5],
    ['game-forge-v2', forge('game-forge-v2')], ['vr-forge', forge('vr-forge')]]) {
    const found = await scan(reader, progress(bench)).catch(() => []);
    total += found.length;
    results.push(...found);
  }
  return results.sort((a, b) => b.score - a.score || String(b.created).localeCompare(String(a.created)));
}

/**
 * Narrow the list. `published` is the admin item list (source_meta.source marks
 * what is already on the site, hidden items included).
 */
export function filterCandidates(list, { bench = 'all', minScore = 0, unpublishedOnly = true, onePerPrompt = true, query = '' } = {}, published = []) {
  const taken = new Set(published.map(item => item.source_meta?.source).filter(Boolean));
  const q = query.trim().toLowerCase();
  const seen = new Set();
  const out = [];
  for (const c of list) {
    if (bench !== 'all' && c.bench !== bench) continue;
    if (c.score < minScore) continue;
    if (unpublishedOnly && taken.has(c.source)) continue;
    if (q && !`${c.title} ${c.model} ${c.run} ${c.runId || ''}`.toLowerCase().includes(q)) continue;
    const runKey = `${c.bench}/${c.run}`;
    if (onePerPrompt && seen.has(runKey)) continue;
    seen.add(runKey);
    out.push(c);
  }
  return out;
}

/** A short permanent id from the prompt slug, unique against existing ids. */
export function suggestId(candidate, existingIds) {
  const cleaned = String(candidate.run || candidate.title || 'item').toLowerCase()
    .replace(/^draw-(a-picture-of-)?(an?-)?/, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  let base = '';
  for (const part of cleaned.split('-')) {
    if (base && base.length + part.length + 1 > 32) break;
    base = base ? `${base}-${part}` : part;
  }
  base = base.replace(/(-(a|an|the|of|to|and|with|in|on))+$/, '') || 'item';
  const taken = new Set(existingIds);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

/**
 * Pre-publish report, using the same checks the server enforces.
 * @param {{ hubOnlyPath, cdnHosts, shapeProblem }} checks  functions/lib/showcase-checks.js
 */
export function publishReport(candidate, code, published, checks) {
  const report = [];
  const project = candidate.kind === 'project';
  const shape = checks.shapeProblem(code, candidate.kind);
  if (shape) report.push({ level: 'fail', text: `Not a clean ${project ? 'project' : 'file'}: ${shape}.` });
  const bundle = project && !shape ? checks.parseProjectBundle(code).bundle : null;
  if (project && bundle) {
    const hub = checks.projectHubPath(bundle);
    if (hub) report.push({ level: 'fail', text: `Loads ${hub}, which is outside the project.` });
    const trace = checks.projectPrivateTrace(bundle);
    if (trace) report.push({ level: 'fail', text: `Carries a private path or address: ${trace}.` });
  } else if (!project) {
    const hub = checks.hubOnlyPath(code);
    if (hub) report.push({ level: 'fail', text: `Loads ${hub}, which the public site does not have.` });
  }
  const hosts = bundle ? checks.projectCdnHosts(bundle) : project ? [] : checks.cdnHosts(code);
  if (hosts.length) report.push({ level: 'warn', text: `Loads from ${hosts.join(', ')}; visitors are told examples may use CDNs.` });
  // Same prompt: the run's game folder for a forge, the generation's folder otherwise.
  const promptDir = project ? `${candidate.bench}/projects/${candidate.run}/` : candidate.source.split('/').slice(0, -1).join('/') + '/';
  const sameRun = published.filter(item => (item.source_meta?.source || '').startsWith(promptDir));
  if (sameRun.length) report.push({ level: 'warn', text: `Same prompt already published as ${sameRun.map(i => i.id).join(', ')}.` });
  if (!report.some(r => r.level === 'fail')) report.unshift({ level: 'pass', text: 'Portable: no hub-only paths.' });
  return report;
}
