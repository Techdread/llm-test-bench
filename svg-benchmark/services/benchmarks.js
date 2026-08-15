// Benchmark data management service
// Handles creating/loading benchmarks and submissions using the File System Access API
//
// Data structure on disk:
//   svg-data/
//     benchmarks/
//       {slug}/
//         prompt.txt
//         meta.json        — { category, difficulty, createdAt }
//         reference.png    — optional reference image
//         submissions/
//           {model-slug}.svg
//           {model-slug}.json — { model, manualScore, autoScore, dimensions, elementCount, fileSize, notes, submittedAt }

import { getNestedDirectoryHandle } from '../../shared/services/fs.js';

const ROOT_FOLDER = 'svg-data';
const BENCHMARKS_FOLDER = 'benchmarks';

export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

async function getBenchmarksDir(rootHandle) {
  return getNestedDirectoryHandle(rootHandle, [ROOT_FOLDER, BENCHMARKS_FOLDER]);
}

async function getBenchmarkDir(rootHandle, slug) {
  return getNestedDirectoryHandle(rootHandle, [ROOT_FOLDER, BENCHMARKS_FOLDER, slug]);
}

async function getSubmissionsDir(rootHandle, slug) {
  return getNestedDirectoryHandle(rootHandle, [ROOT_FOLDER, BENCHMARKS_FOLDER, slug, 'submissions']);
}

// ── List all benchmarks ──

export async function listBenchmarks(rootHandle) {
  const benchDir = await getBenchmarksDir(rootHandle);
  const benchmarks = [];

  for await (const [name, handle] of benchDir) {
    if (handle.kind !== 'directory') continue;
    try {
      const bDir = await benchDir.getDirectoryHandle(name);

      // Read prompt
      let prompt = '';
      try {
        const pFile = await bDir.getFileHandle('prompt.txt');
        const pBlob = await pFile.getFile();
        prompt = await pBlob.text();
      } catch (e) { /* no prompt file */ }

      // Read meta
      let meta = {};
      try {
        const mFile = await bDir.getFileHandle('meta.json');
        const mBlob = await mFile.getFile();
        meta = JSON.parse(await mBlob.text());
      } catch (e) { /* no meta */ }

      // Check for reference
      let hasReference = false;
      try {
        await bDir.getFileHandle('reference.png');
        hasReference = true;
      } catch (e) { /* no reference */ }

      // Count submissions
      let submissionCount = 0;
      let bestScore = null;
      const submissionModels = []; // { model, modelId } — used for batch has-run detection
      try {
        const subDir = await bDir.getDirectoryHandle('submissions');
        for await (const [sName, sHandle] of subDir) {
          if (sHandle.kind === 'file' && sName.endsWith('.json')) {
            submissionCount++;
            try {
              const sf = await sHandle.getFile();
              const sData = JSON.parse(await sf.text());
              if (sData.autoScore != null && (bestScore === null || sData.autoScore > bestScore)) {
                bestScore = sData.autoScore;
              }
              submissionModels.push({ model: sData.model || '', modelId: sData.modelId || null });
            } catch (e) { /* skip */ }
          }
        }
      } catch (e) { /* no submissions dir */ }

      benchmarks.push({
        slug: name,
        prompt,
        meta,
        hasReference,
        submissionCount,
        bestScore,
        submissionModels,
      });
    } catch (e) {
      console.warn(`Failed to load benchmark "${name}":`, e);
    }
  }

  return benchmarks.sort((a, b) => {
    const da = a.meta.createdAt || '';
    const db = b.meta.createdAt || '';
    return db.localeCompare(da);
  });
}

// ── Create a new benchmark ──

export async function createBenchmark(rootHandle, prompt, category, difficulty) {
  const slug = slugify(prompt) || `benchmark-${Date.now()}`;
  const bDir = await getBenchmarkDir(rootHandle, slug);

  // Save prompt
  const pFile = await bDir.getFileHandle('prompt.txt', { create: true });
  const pWritable = await pFile.createWritable();
  await pWritable.write(prompt);
  await pWritable.close();

  // Save meta
  const meta = {
    category: category || 'general',
    difficulty: difficulty || 'moderate',
    createdAt: new Date().toISOString(),
  };
  const mFile = await bDir.getFileHandle('meta.json', { create: true });
  const mWritable = await mFile.createWritable();
  await mWritable.write(JSON.stringify(meta, null, 2));
  await mWritable.close();

  // Create submissions directory
  await bDir.getDirectoryHandle('submissions', { create: true });

  return slug;
}

// ── Save reference image ──

export async function saveReference(rootHandle, slug, dataUrl) {
  const bDir = await getBenchmarkDir(rootHandle, slug);

  // Convert data URL to blob
  const res = await fetch(dataUrl);
  const blob = await res.blob();

  const fh = await bDir.getFileHandle('reference.png', { create: true });
  const writable = await fh.createWritable();
  await writable.write(blob);
  await writable.close();
}

// ── Load reference image as data URL ──

export async function loadReference(rootHandle, slug) {
  const bDir = await getBenchmarkDir(rootHandle, slug);
  try {
    const fh = await bDir.getFileHandle('reference.png');
    const file = await fh.getFile();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  } catch (e) {
    return null;
  }
}

// ── Load a full benchmark ──

export async function loadBenchmark(rootHandle, slug) {
  const bDir = await getBenchmarkDir(rootHandle, slug);

  let prompt = '';
  try {
    const pFile = await bDir.getFileHandle('prompt.txt');
    const pBlob = await pFile.getFile();
    prompt = await pBlob.text();
  } catch (e) { /* no prompt */ }

  let meta = {};
  try {
    const mFile = await bDir.getFileHandle('meta.json');
    const mBlob = await mFile.getFile();
    meta = JSON.parse(await mBlob.text());
  } catch (e) { /* no meta */ }

  let referenceUrl = null;
  try {
    referenceUrl = await loadReference(rootHandle, slug);
  } catch (e) { /* no reference */ }

  const submissions = await listSubmissions(rootHandle, slug);

  return { slug, prompt, meta, referenceUrl, submissions };
}

// ── List submissions for a benchmark ──

export async function listSubmissions(rootHandle, slug) {
  const submissions = [];
  let subDir;
  try {
    subDir = await getSubmissionsDir(rootHandle, slug);
  } catch (e) {
    return submissions;
  }

  const jsonFiles = [];
  for await (const [name, handle] of subDir) {
    if (handle.kind === 'file' && name.endsWith('.json')) {
      jsonFiles.push(name);
    }
  }

  for (const jsonName of jsonFiles) {
    const baseName = jsonName.replace('.json', '');
    try {
      const jFile = await subDir.getFileHandle(jsonName);
      const jBlob = await jFile.getFile();
      const data = JSON.parse(await jBlob.text());

      let svgContent = '';
      try {
        const sFile = await subDir.getFileHandle(baseName + '.svg');
        const sBlob = await sFile.getFile();
        svgContent = await sBlob.text();
      } catch (e) { /* no SVG */ }

      submissions.push({
        id: baseName,
        svg: svgContent,
        ...data,
      });
    } catch (e) {
      console.warn(`Failed to load submission "${baseName}":`, e);
    }
  }

  return submissions.sort((a, b) => {
    const da = a.submittedAt || '';
    const db = b.submittedAt || '';
    return db.localeCompare(da);
  });
}

// ── Past batch runs ──
//
// Batch submissions carry `batch: { id, kind, healed, healAttempts }` in their
// metadata, so a run can be rebuilt by grouping every submission by that id.
// Only metadata is read here; the SVGs are fetched on demand by loadRunSvgs().

export async function listBatchRuns(rootHandle) {
  const benchDir = await getBenchmarksDir(rootHandle);
  const runs = new Map();

  for await (const [name, handle] of benchDir) {
    if (handle.kind !== 'directory') continue;

    let bDir, subDir;
    try {
      bDir = await benchDir.getDirectoryHandle(name);
      subDir = await bDir.getDirectoryHandle('submissions');
    } catch (e) { continue; }

    let prompt = '';
    try {
      const pFile = await bDir.getFileHandle('prompt.txt');
      prompt = (await (await pFile.getFile()).text()).trim();
    } catch (e) { /* no prompt file */ }

    for await (const [sName, sHandle] of subDir) {
      if (sHandle.kind !== 'file' || !sName.endsWith('.json')) continue;
      try {
        const data = JSON.parse(await (await sHandle.getFile()).text());
        const runId = data.batch?.id;
        if (!runId) continue; // not a batch submission

        if (!runs.has(runId)) {
          runs.set(runId, {
            id: runId,
            model: data.model || 'unknown',
            modelId: data.modelId || null,
            items: [],
          });
        }
        runs.get(runId).items.push({
          submissionId: sName.replace(/\.json$/, ''),
          slug: name,
          prompt,
          autoScore: data.autoScore ?? null,
          manualScore: data.manualScore ?? 0,
          healed: !!data.batch.healed,
          kind: data.batch.kind || 'original',
          valid: data.valid !== false,
          submittedAt: data.submittedAt || '',
          params: data.params || null,
          paramsLabel: data.paramsLabel || null,
          stats: data.stats || null,
        });
      } catch (e) { /* skip unreadable submission */ }
    }
  }

  const list = [];
  for (const run of runs.values()) {
    run.items.sort((a, b) => (a.submittedAt || '').localeCompare(b.submittedAt || ''));
    const scores = run.items.map(i => i.autoScore).filter(s => s != null);
    list.push({
      ...run,
      count: run.items.length,
      startedAt: run.items[0]?.submittedAt || '',
      avgScore: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
    });
  }
  return list.sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
}

// Load the SVG markup for a run's items (as returned by listBatchRuns).
export async function loadRunSvgs(rootHandle, items) {
  const out = [];
  for (const it of items) {
    let svg = '';
    try {
      const subDir = await getSubmissionsDir(rootHandle, it.slug);
      const fh = await subDir.getFileHandle(it.submissionId + '.svg');
      svg = await (await fh.getFile()).text();
    } catch (e) { /* SVG missing — the row still lists, just without a preview */ }
    out.push({ ...it, svg });
  }
  return out;
}

// ── Save a submission ──

export async function saveSubmission(rootHandle, slug, modelSlug, svgContent, metadata) {
  const subDir = await getSubmissionsDir(rootHandle, slug);

  // Save SVG
  const svgFile = await subDir.getFileHandle(modelSlug + '.svg', { create: true });
  const svgWritable = await svgFile.createWritable();
  await svgWritable.write(svgContent);
  await svgWritable.close();

  // Save metadata JSON
  const jsonFile = await subDir.getFileHandle(modelSlug + '.json', { create: true });
  const jsonWritable = await jsonFile.createWritable();
  await jsonWritable.write(JSON.stringify(metadata, null, 2));
  await jsonWritable.close();
}

// ── Delete a submission ──

export async function deleteSubmission(rootHandle, slug, modelSlug) {
  const subDir = await getSubmissionsDir(rootHandle, slug);
  try { await subDir.removeEntry(modelSlug + '.svg'); } catch (e) { /* ok */ }
  try { await subDir.removeEntry(modelSlug + '.json'); } catch (e) { /* ok */ }
}

// ── Delete a benchmark ──

export async function deleteBenchmark(rootHandle, slug) {
  const benchDir = await getBenchmarksDir(rootHandle);
  await benchDir.removeEntry(slug, { recursive: true });
}

// ── Update submission metadata ──

export async function updateSubmissionMeta(rootHandle, slug, modelSlug, metadata) {
  const subDir = await getSubmissionsDir(rootHandle, slug);
  const jsonFile = await subDir.getFileHandle(modelSlug + '.json', { create: true });
  const jsonWritable = await jsonFile.createWritable();
  await jsonWritable.write(JSON.stringify(metadata, null, 2));
  await jsonWritable.close();
}
