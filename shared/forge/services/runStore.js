// Run persistence shared by the Forge family — non-destructive and append-only.
// Every build is a NEW run folder under
// <data-root>/<appId>/projects/<artifactSlug>/<runId>/, with the model's files
// in project/ and a forge.json sidecar of prompt + telemetry + rating.
//
// `createRunStore({ appId, defaultSlug })` binds one Forge's namespace and
// returns the whole API, so each app keeps its own data-root folder while the
// append-only rules live in exactly one place.

import { ensureAppNamespace } from '../../services/data-root-manager.js';
import { readableRunId, compareRunsNewestFirst } from './runNaming.js';

export function createRunStore({ appId, defaultSlug = 'project', readableRunNames = false } = {}) {
    if (!appId) throw new Error('createRunStore needs an appId.');

  async function getAppRoot() {
    return ensureAppNamespace(appId);
  }

  async function getDir(parent, name) { return parent.getDirectoryHandle(name, { create: true }); }

  function slugify(s) {
    return String(s || defaultSlug).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || defaultSlug;
  }

  /** Create a fresh run folder; returns handles + ids. */
  async function createRun(gameSlug, executor = {}) {
    const root = await getAppRoot();
    const projects = await getDir(root, 'projects');
    const gameDir = await getDir(projects, gameSlug);
    // Timestamp keeps runs sortable; the suffix prevents two rapid actions
    // (notably Fork + Improve) from ever reopening the same directory.
    const suffix = globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID().slice(0, 6)
      : Math.random().toString(36).slice(2, 8);
    const now = Date.now();
    const runId = readableRunNames
      ? readableRunId({ ...executor, now, suffix })
      : `run-${now}-${suffix}`;
    const runDir = await getDir(gameDir, runId);
    const projectHandle = await getDir(runDir, 'project');
    return { runId, runDir, projectHandle };
  }

  async function writeMeta(runDir, meta) {
    const fh = await runDir.getFileHandle('forge.json', { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify(meta, null, 2));
    await w.close();
  }

  /** Merge a lifecycle transition into forge.json without dropping provenance. */
  async function patchMeta(runDir, patch) {
    const current = (await readMeta(runDir)) || {};
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    await writeMeta(runDir, next);
    return next;
  }

  /** Persist the full in-app build trace (steps incl. wire request/response) next to
   * forge.json, so a failed or interesting run can be re-inspected later. Best-effort. */
  async function writeTrace(runDir, steps) {
    try {
      const fh = await runDir.getFileHandle('trace.json', { create: true });
      const w = await fh.createWritable();
      await w.write(JSON.stringify(steps, null, 2));
      await w.close();
    } catch (e) { console.warn('writeTrace failed', e); }
  }

  /** Read the compact final trace, falling back to the append-only event journal. */
  async function readTrace(runDir) {
    try {
      const fh = await runDir.getFileHandle('trace.json');
      return JSON.parse(await (await fh.getFile()).text());
    } catch {
      try {
        const fh = await runDir.getFileHandle('trace.jsonl');
        const text = await (await fh.getFile()).text();
        return text.split(/\r?\n/).filter(Boolean).flatMap(line => {
          try { return [JSON.parse(line)]; } catch { return []; }
        });
      } catch {
        return [];
      }
    }
  }

  /**
   * Serialized JSONL appender. File System Access has no atomic append primitive,
   * so one writer queues seek/write operations and flush() lets callers guarantee
   * durability before marking the run complete.
   */
  function createTraceAppender(runDir) {
    let queue = Promise.resolve();
    const append = (record) => {
      queue = queue.then(async () => {
        const fh = await runDir.getFileHandle('trace.jsonl', { create: true });
        const file = await fh.getFile();
        const writer = await fh.createWritable({ keepExistingData: true });
        await writer.seek(file.size);
        await writer.write(JSON.stringify(record) + '\n');
        await writer.close();
      }).catch(e => console.warn('trace append failed', e));
      return queue;
    };
    return { append, flush: () => queue };
  }

  async function writeValidation(runDir, report) {
    const serializable = { ...report };
    delete serializable.screenshot;
    const fh = await runDir.getFileHandle('validation.json', { create: true });
    const writer = await fh.createWritable();
    await writer.write(JSON.stringify(serializable, null, 2));
    await writer.close();
  }

  async function readValidation(runDir) {
    try {
      const handle = await runDir.getFileHandle('validation.json');
      return JSON.parse(await (await handle.getFile()).text());
    } catch {
      return null;
    }
  }

  async function writeRunArtifact(runDir, name, value) {
    const fh = await runDir.getFileHandle(name, { create: true });
    const writer = await fh.createWritable();
    await writer.write(value);
    await writer.close();
  }

  /** Read a run artifact as a File, or null when the run never produced one. */
  async function readRunArtifact(runDir, name) {
    try {
      return await (await runDir.getFileHandle(name)).getFile();
    } catch { return null; }
  }

  async function readMeta(runDir) {
    try {
      const fh = await runDir.getFileHandle('forge.json');
      return JSON.parse(await (await fh.getFile()).text());
    } catch { return null; }
  }

  /** List every game that has runs. */
  async function listGames() {
    const root = await getAppRoot();
    const games = [];
    try {
      const projects = await root.getDirectoryHandle('projects');
      for await (const [slug, handle] of projects.entries()) {
        if (handle.kind !== 'directory') continue;
        let runs = 0;
        for await (const [, r] of handle.entries()) if (r.kind === 'directory') runs++;
        games.push({ slug, runs });
      }
    } catch { /* no projects yet */ }
    games.sort((a, b) => a.slug.localeCompare(b.slug));
    return games;
  }

  /** List runs for a game slug, newest first, each with its forge.json meta. */
  async function listRuns(gameSlug) {
    const root = await getAppRoot();
    const out = [];
    try {
      const projects = await root.getDirectoryHandle('projects');
      const gameDir = await projects.getDirectoryHandle(gameSlug);
      for await (const [runId, runDir] of gameDir.entries()) {
        if (runDir.kind !== 'directory') continue;
        const meta = await readMeta(runDir);
        out.push({ runId, meta, runDir });
      }
    } catch { /* none */ }
    out.sort(compareRunsNewestFirst);
    return out;
  }

  async function getProjectHandle(gameSlug, runId) {
    const root = await getAppRoot();
    const projects = await root.getDirectoryHandle('projects');
    const gameDir = await projects.getDirectoryHandle(gameSlug);
    const runDir = await gameDir.getDirectoryHandle(runId);
    const projectHandle = await runDir.getDirectoryHandle('project');
    return { projectHandle, runDir };
  }

  async function getRunHandles(gameSlug, runId) {
    const root = await getAppRoot();
    const projects = await root.getDirectoryHandle('projects');
    const gameDir = await projects.getDirectoryHandle(gameSlug);
    const runDir = await gameDir.getDirectoryHandle(runId);
    const projectHandle = await runDir.getDirectoryHandle('project');
    return { projectHandle, runDir };
  }

  /** Patch a run's forge.json (e.g. set a rating) without touching its files. */
  async function updateMeta(gameSlug, runId, patch) {
    const { runDir } = await getProjectHandle(gameSlug, runId);
    const meta = (await readMeta(runDir)) || {};
    const next = { ...meta, ...patch };
    await writeMeta(runDir, next);
    return next;
  }

  return Object.freeze({
    appId,
    defaultSlug,
    getAppRoot,
    slugify,
    createRun,
    writeMeta,
    patchMeta,
    writeTrace,
    readTrace,
    createTraceAppender,
    writeValidation,
    readValidation,
    writeRunArtifact,
    readRunArtifact,
    readMeta,
    listGames,
    listRuns,
    getProjectHandle,
    getRunHandles,
    updateMeta,
  });
}
