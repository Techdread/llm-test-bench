import { asBytes } from './integrity.js';

export async function ensureDirectory(root, path) {
  const parts = Array.isArray(path) ? path : String(path || '').split('/').filter(Boolean);
  let current = root;
  for (const part of parts) current = await current.getDirectoryHandle(part, { create: true });
  return current;
}

export async function writeFileAt(root, path, value) {
  const parts = String(path).split('/').filter(Boolean);
  const name = parts.pop();
  const directory = await ensureDirectory(root, parts);
  const file = await directory.getFileHandle(name, { create: true });
  const writer = await file.createWritable();
  await writer.write(value);
  await writer.close();
}

export async function readFileAt(root, path) {
  const parts = String(path).split('/').filter(Boolean);
  const name = parts.pop();
  let directory = root;
  for (const part of parts) directory = await directory.getDirectoryHandle(part);
  const file = await (await directory.getFileHandle(name)).getFile();
  return new Uint8Array(await file.arrayBuffer());
}

export async function readJsonAt(root, path) {
  return JSON.parse(new TextDecoder().decode(await readFileAt(root, path)));
}

export async function writeJsonAt(root, path, value) {
  return writeFileAt(root, path, JSON.stringify(value, null, 2));
}

export async function directoryEntries(root, prefix = '') {
  const entries = {};
  for await (const [name, handle] of root.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === 'directory') Object.assign(entries, await directoryEntries(handle, path));
    else {
      const file = await handle.getFile();
      entries[path] = new Uint8Array(await file.arrayBuffer());
    }
  }
  return entries;
}

export async function writeEntries(root, entries, { prefix = '' } = {}) {
  let files = 0;
  let bytes = 0;
  for (const [path, value] of Object.entries(entries || {})) {
    const data = asBytes(value);
    await writeFileAt(root, prefix ? `${prefix}/${path}` : path, data);
    files += 1;
    bytes += data.byteLength;
  }
  return { files, bytes };
}

export async function copyDirectory(source, destination) {
  return writeEntries(destination, await directoryEntries(source));
}
