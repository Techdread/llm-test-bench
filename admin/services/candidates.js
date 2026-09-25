// Showcase candidates from the owner's data folder (spec 342, phase 2).
//
// DOM-free: it walks the three benches' save layouts through a small reader
// interface, so the admin console passes a File System Access adapter and the
// tests pass a fake tree. Ratings are the owner's own:
//   prompt-gallery   <slug>/<stem>.html + <stem>.json   rating, ratingScale (5 or 10)
//   svg-benchmark    svg-data/benchmarks/<slug>/submissions/<stem>.svg + .json   manualScore /10
//                    svg-data/benchmarks/<slug>/prompt.txt
//   p5-sketch-gallery projects/<slug>/sketch.js + metadata.json (rating /5) + prompt.md + thumb.png
//
// Reader: { dirs(path) -> names[], files(path) -> names[], text(path) -> string|null }

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
  for (const [bench, scan] of [['prompt-gallery', scanPromptGallery], ['svg-benchmark', scanSvg], ['p5-sketch-gallery', scanP5]]) {
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
    if (q && !`${c.title} ${c.model} ${c.run}`.toLowerCase().includes(q)) continue;
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
  const hub = checks.hubOnlyPath(code);
  if (hub) report.push({ level: 'fail', text: `Loads ${hub}, which the public site does not have.` });
  const shape = checks.shapeProblem(code, candidate.kind);
  if (shape) report.push({ level: 'fail', text: `Not a clean file: ${shape}.` });
  const hosts = checks.cdnHosts(code);
  if (hosts.length) report.push({ level: 'warn', text: `Loads from ${hosts.join(', ')}; visitors are told examples may use CDNs.` });
  const sameRun = published.filter(item => (item.source_meta?.source || '').startsWith(candidate.source.split('/').slice(0, -1).join('/') + '/'));
  if (sameRun.length) report.push({ level: 'warn', text: `Same prompt already published as ${sameRun.map(i => i.id).join(', ')}.` });
  if (!report.some(r => r.level === 'fail')) report.unshift({ level: 'pass', text: 'Portable: no hub-only paths.' });
  return report;
}
