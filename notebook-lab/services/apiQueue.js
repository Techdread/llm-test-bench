import * as store from './notebookStore.js';
import { buildApiError, normalizeCommand } from './apiProtocol.js';

const API_DIR = 'api';
const INBOX = 'inbox';
const PROCESSING = 'processing';
const OUTBOX = 'outbox';
const FAILED = 'failed';

export function startApiQueue({ onCommand, onStatus, intervalMs = 2500 }) {
  let stopped = false;
  let polling = false;

  const poll = async () => {
    if (stopped || polling) return;
    polling = true;
    try {
      const appHandle = store.getAppHandle();
      if (!appHandle) {
        onStatus && onStatus({ state: 'disabled', message: 'No data root selected' });
        return;
      }
      await ensureApiFolders(appHandle);
      const files = await listJsonFiles(appHandle, [API_DIR, INBOX]);
      if (files.length === 0) {
        onStatus && onStatus({ state: 'idle', message: 'API queue idle' });
        return;
      }

      for (const fileName of files) {
        if (stopped) break;
        await processFile(appHandle, fileName, onCommand, onStatus);
      }
    } catch (err) {
      onStatus && onStatus({ state: 'failed', message: err.message || String(err) });
    } finally {
      polling = false;
    }
  };

  poll();
  const timer = setInterval(poll, intervalMs);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

async function processFile(appHandle, fileName, onCommand, onStatus) {
  const requestId = fileName.replace(/\.json$/, '');
  onStatus && onStatus({ state: 'processing', message: `Processing ${fileName}` });

  let command = null;
  let rawText = '';
  try {
    rawText = await readNestedFile(appHandle, [API_DIR, INBOX], fileName);
    await writeNestedFile(appHandle, [API_DIR, PROCESSING], fileName, rawText);
    await deleteNestedFile(appHandle, [API_DIR, INBOX], fileName);
    command = normalizeCommand(JSON.parse(rawText), requestId);
    const result = await onCommand(command);
    await writeNestedFile(appHandle, [API_DIR, OUTBOX], `${command.requestId}.result.json`, JSON.stringify(result, null, 2));
    await safeDeleteNestedFile(appHandle, [API_DIR, PROCESSING], fileName);
    onStatus && onStatus({ state: 'idle', message: `Completed ${command.requestId}` });
  } catch (err) {
    const safeCommand = command || { requestId };
    const errorPayload = buildApiError(safeCommand, err);
    await writeNestedFile(appHandle, [API_DIR, FAILED], `${safeCommand.requestId || requestId}.error.json`, JSON.stringify(errorPayload, null, 2));
    await safeDeleteNestedFile(appHandle, [API_DIR, PROCESSING], fileName);
    await safeDeleteNestedFile(appHandle, [API_DIR, INBOX], fileName);
    onStatus && onStatus({ state: 'failed', message: err.message || String(err) });
  }
}

async function ensureApiFolders(appHandle) {
  const api = await appHandle.getDirectoryHandle(API_DIR, { create: true });
  await api.getDirectoryHandle(INBOX, { create: true });
  await api.getDirectoryHandle(PROCESSING, { create: true });
  await api.getDirectoryHandle(OUTBOX, { create: true });
  await api.getDirectoryHandle(FAILED, { create: true });
}

async function getDir(root, pathParts, create = false) {
  let dir = root;
  for (const part of pathParts) {
    dir = await dir.getDirectoryHandle(part, { create });
  }
  return dir;
}

async function listJsonFiles(root, pathParts) {
  const dir = await getDir(root, pathParts, true);
  const files = [];
  for await (const [name, handle] of dir) {
    if (handle.kind === 'file' && name.endsWith('.json')) files.push(name);
  }
  return files.sort((a, b) => a.localeCompare(b));
}

async function readNestedFile(root, pathParts, fileName) {
  const dir = await getDir(root, pathParts);
  const handle = await dir.getFileHandle(fileName);
  const file = await handle.getFile();
  return file.text();
}

async function writeNestedFile(root, pathParts, fileName, content) {
  const dir = await getDir(root, pathParts, true);
  const handle = await dir.getFileHandle(fileName, { create: true });
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
}

async function deleteNestedFile(root, pathParts, fileName) {
  const dir = await getDir(root, pathParts);
  await dir.removeEntry(fileName);
}

async function safeDeleteNestedFile(root, pathParts, fileName) {
  try {
    await deleteNestedFile(root, pathParts, fileName);
  } catch { /* best effort */ }
}
