// Filesystem-backed session store for Code Morph Lab v3.
// All methods take an appHandle (FileSystemDirectoryHandle scoped to root/code-morph-lab-v3/).

export function createSessionStore(appHandle) {
  if (!appHandle) throw new Error('sessionStore requires a FileSystemDirectoryHandle');

  async function getSessionDir(id, { create = false } = {}) {
    return appHandle.getDirectoryHandle(id, { create });
  }

  async function writeJson(dir, name, obj) {
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify(obj, null, 2));
    await w.close();
  }

  async function readJson(dir, name) {
    const fh = await dir.getFileHandle(name);
    const file = await fh.getFile();
    return JSON.parse(await file.text());
  }

  async function writeText(dir, name, content) {
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(content);
    await w.close();
  }

  async function readText(dir, name) {
    const fh = await dir.getFileHandle(name);
    const file = await fh.getFile();
    return await file.text();
  }

  async function writeSnapshotFolder(iterDir, snapshotMap) {
    const snapDir = await iterDir.getDirectoryHandle('snapshot', { create: true });
    for (const [name, content] of snapshotMap) {
      // Flat filenames only in this workspace model (no nested dirs inside workspace).
      await writeText(snapDir, name, content);
    }
  }

  async function readSnapshotFolder(iterDir) {
    try {
      const snapDir = await iterDir.getDirectoryHandle('snapshot');
      const out = {};
      for await (const [name, handle] of snapDir.entries()) {
        if (handle.kind === 'file') {
          const f = await handle.getFile();
          out[name] = await f.text();
        }
      }
      return out;
    } catch {
      return {};
    }
  }

  async function readFlatFiles(dir) {
    const out = {};
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === 'file') {
        const f = await handle.getFile();
        out[name] = await f.text();
      }
    }
    return out;
  }

  const api = {
    async createSession(sessionMeta) {
      // id is "{yyyy-mm-dd}_{slug}_{shortId}" assembled by caller.
      const dir = await getSessionDir(sessionMeta.id, { create: true });
      await writeJson(dir, 'session.json', sessionMeta);
      await dir.getDirectoryHandle('iterations', { create: true });
      return sessionMeta;
    },

    async updateSession(id, patch) {
      const dir = await getSessionDir(id);
      const meta = await readJson(dir, 'session.json');
      const next = { ...meta, ...patch };
      await writeJson(dir, 'session.json', next);
      return next;
    },

    async appendIteration(id, iteration, snapshotMap) {
      const dir = await getSessionDir(id);
      const itersDir = await dir.getDirectoryHandle('iterations', { create: true });
      const folder = String(iteration.number).padStart(2, '0');
      const iterDir = await itersDir.getDirectoryHandle(folder, { create: true });
      await writeSnapshotFolder(iterDir, snapshotMap);
      await writeJson(iterDir, 'diff.json', iteration.diffs || {});
      await writeJson(iterDir, 'toolcalls.json', iteration.toolCalls || []);
      await writeJson(iterDir, 'run.json', {
        runResult: iteration.runResult || null,
        errorInfo: iteration.errorInfo || null,
        success: iteration.success,
        duration: iteration.duration,
        filesChanged: iteration.filesChanged,
      });
    },

    async finalizeSession(id, status, finalSnapshotMap) {
      const dir = await getSessionDir(id);
      const finalDir = await dir.getDirectoryHandle('final', { create: true });
      if (finalSnapshotMap) {
        for (const [name, content] of finalSnapshotMap) {
          await writeText(finalDir, name, content);
        }
      }
      const meta = await readJson(dir, 'session.json');
      await writeJson(dir, 'session.json', { ...meta, status, finalizedAt: new Date().toISOString() });
    },

    async listSessions() {
      const out = [];
      for await (const [name, handle] of appHandle.entries()) {
        if (handle.kind === 'directory') {
          try {
            const meta = await readJson(handle, 'session.json');
            out.push(meta);
          } catch {
            // skip dirs without session.json
          }
        }
      }
      out.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      return out;
    },

    async loadSession(id) {
      const dir = await getSessionDir(id);
      const meta = await readJson(dir, 'session.json');
      const iterations = [];
      try {
        const itersDir = await dir.getDirectoryHandle('iterations');
        const names = [];
        for await (const [name, h] of itersDir.entries()) {
          if (h.kind === 'directory') names.push(name);
        }
        names.sort();
        for (const n of names) {
          const iterDir = await itersDir.getDirectoryHandle(n);
          const runJson = await readJson(iterDir, 'run.json').catch(() => ({}));
          const snap = await readSnapshotFolder(iterDir);
          const diffs = await readJson(iterDir, 'diff.json').catch(() => ({}));
          const toolCalls = await readJson(iterDir, 'toolcalls.json').catch(() => []);
          iterations.push({
            number: parseInt(n, 10),
            snapshot: snap,
            diffs,
            toolCalls,
            ...runJson,
          });
        }
      } catch {}
      let finalSnapshot = {};
      try {
        const finalDir = await dir.getDirectoryHandle('final');
        finalSnapshot = await readFlatFiles(finalDir);
      } catch {}
      return { ...meta, iterations, finalSnapshot };
    },

    async deleteSession(id) {
      await appHandle.removeEntry(id, { recursive: true });
    },

    async forkSession(id, newId, newGoal) {
      const srcDir = await getSessionDir(id);
      const srcMeta = await readJson(srcDir, 'session.json');
      let finalSnap = {};
      try {
        const finalDir = await srcDir.getDirectoryHandle('final');
        for await (const [name, handle] of finalDir.entries()) {
          if (handle.kind === 'file') {
            const f = await handle.getFile();
            finalSnap[name] = await f.text();
          }
        }
      } catch {
        // Fallback: use the last iteration's snapshot
        const loaded = await api.loadSession(id);
        if (loaded.iterations.length > 0) {
          finalSnap = loaded.iterations[loaded.iterations.length - 1].snapshot || {};
        }
      }
      const newMeta = {
        id: newId,
        createdAt: new Date().toISOString(),
        goal: newGoal || srcMeta.goal,
        language: srcMeta.language,
        model: srcMeta.model,
        maxIterations: srcMeta.maxIterations,
        status: 'idle',
        importedFrom: srcMeta.importedFrom || { kind: 'fork', source: 'code-morph-lab-v3', parentId: id },
        startingFiles: finalSnap,
      };
      await api.createSession(newMeta);
      return newMeta;
    },
  };

  return api;
}

/**
 * Build a session id from a goal string.
 */
export function buildSessionId(goal) {
  const date = new Date().toISOString().slice(0, 10);
  const slug = (goal || 'session')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const shortId = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
  return `${date}_${slug || 'untitled'}_${shortId}`;
}
