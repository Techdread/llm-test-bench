// The candidates.js reader interface over a File System Access directory handle.

export function handleReader(root) {
  async function dir(path) {
    let handle = root;
    for (const part of path.split('/').filter(Boolean)) handle = await handle.getDirectoryHandle(part);
    return handle;
  }
  async function list(path, kind) {
    try {
      const handle = await dir(path);
      const names = [];
      for await (const [name, entry] of handle.entries()) if (entry.kind === kind) names.push(name);
      return names.sort();
    } catch {
      return [];
    }
  }
  async function file(path) {
    const parts = path.split('/');
    const name = parts.pop();
    return (await (await dir(parts.join('/'))).getFileHandle(name)).getFile();
  }
  return {
    dirs: (path) => list(path, 'directory'),
    files: (path) => list(path, 'file'),
    text: async (path) => (await file(path)).text(),
    bytes: async (path) => new Uint8Array(await (await file(path)).arrayBuffer()),
    /** Write a file that does not exist yet. Refuses to replace one: run folders are the user's data. */
    async writeNew(path, blob) {
      const parts = path.split('/');
      const name = parts.pop();
      const folder = await dir(parts.join('/'));
      try {
        await folder.getFileHandle(name);
        throw Object.assign(new Error(`${path} already exists; it was left as it is.`), { exists: true });
      } catch (error) {
        if (error.exists) throw error;
      }
      const writable = await (await folder.getFileHandle(name, { create: true })).createWritable();
      await writable.write(blob);
      await writable.close();
    },
  };
}
