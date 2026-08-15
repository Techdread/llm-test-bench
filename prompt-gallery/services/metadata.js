// Metadata service for reading/writing JSON metadata files alongside HTML generations
// New format: each folder has one prompt.md (shared) and multiple variant files:
//   {sanitizedModel}_{shortId}.html  +  {sanitizedModel}_{shortId}.json
// Legacy format (auto-detected): response.html + metadata.json
import * as fs from '../../shared/services/fs.js';
import { STANDARD_SUBFOLDERS } from '../../shared/services/data-root-manager.js';

// Bootstrapped by the data-root contract inside every app namespace, so they
// sit next to the generation folders without ever being one.
const RESERVED_FOLDERS = new Set(STANDARD_SUBFOLDERS);

function shortId() {
  return Math.random().toString(36).substring(2, 8);
}

function sanitizeModelName(model) {
  return (model || 'unknown')
    .replace(/[<>:"/\\|?*]+/g, '')
    .replace(/\s+/g, '-')
    .toLowerCase()
    .substring(0, 40);
}

function makeVariantKey(model) {
  return `${sanitizeModelName(model)}_${shortId()}`;
}

/** Split a composite ID like "folder/variantKey" into parts */
function parseId(id) {
  const idx = id.indexOf('/');
  if (idx === -1) return { folderId: id, variantKey: null };
  return { folderId: id.substring(0, idx), variantKey: id.substring(idx + 1) };
}

export function createMetadata(model, tags = [], notes = '') {
  return {
    model: model || 'unknown',
    rating: 0,
    tags,
    createdAt: new Date().toISOString(),
    notes,
    promptTokens: 0,
    responseTokens: 0,
  };
}

/**
 * Save a generation as a new variant in a folder.
 * - If the folder exists and prompt matches, adds a new variant.
 * - If the folder exists and prompt differs, creates a new folder with a numeric suffix.
 * - If tags are empty and existing variants have tags, inherits them.
 * Returns { id, folderId, variantKey, redirectedFolder } 
 */
export async function saveGeneration(rootHandle, folderName, prompt, response, metadata) {
  let dirHandle;
  let actualFolder = folderName;

  // Check if folder already exists
  try {
    dirHandle = await rootHandle.getDirectoryHandle(folderName);
    // Read existing prompt
    let existingPrompt = null;
    try {
      const pf = await dirHandle.getFileHandle('prompt.md');
      existingPrompt = await (await pf.getFile()).text();
    } catch (e) { /* no prompt yet */ }

    if (existingPrompt !== null && existingPrompt.trim() !== prompt.trim()) {
      // Prompt differs — find an available folder name
      let suffix = 2;
      while (true) {
        actualFolder = `${folderName}-${suffix}`;
        try {
          await rootHandle.getDirectoryHandle(actualFolder);
          suffix++;
        } catch (e) {
          break; // folder doesn't exist, we can use it
        }
      }
      dirHandle = await rootHandle.getDirectoryHandle(actualFolder, { create: true });
    }
  } catch (e) {
    // Folder doesn't exist — create it
    dirHandle = await rootHandle.getDirectoryHandle(folderName, { create: true });
    actualFolder = folderName;
  }

  // Write prompt.md (shared per folder)
  const promptFile = await dirHandle.getFileHandle('prompt.md', { create: true });
  const pw = await promptFile.createWritable();
  await pw.write(prompt);
  await pw.close();

  // Inherit tags from existing variants if none provided
  const meta = { ...metadata };
  if (!meta.tags || meta.tags.length === 0) {
    for await (const [fileName, fileHandle] of dirHandle) {
      if (fileHandle.kind === 'file' && fileName.endsWith('.json') && fileName !== 'metadata.json') {
        try {
          const existing = JSON.parse(await (await fileHandle.getFile()).text());
          if (existing.tags?.length > 0) {
            meta.tags = [...existing.tags];
            break;
          }
        } catch (e) { /* skip */ }
      }
    }
  }

  // Generate variant key from model name + short ID
  const variantKey = makeVariantKey(meta.model);

  // Write response as {variantKey}.html
  const responseFile = await dirHandle.getFileHandle(`${variantKey}.html`, { create: true });
  const rw = await responseFile.createWritable();
  await rw.write(response);
  await rw.close();

  // Write metadata as {variantKey}.json
  const metaFile = await dirHandle.getFileHandle(`${variantKey}.json`, { create: true });
  const mw = await metaFile.createWritable();
  await mw.write(JSON.stringify(meta, null, 2));
  await mw.close();

  return {
    id: `${actualFolder}/${variantKey}`,
    folderId: actualFolder,
    variantKey,
    redirectedFolder: actualFolder !== folderName ? actualFolder : null,
  };
}

/**
 * Load a generation by composite ID ("folder/variantKey") or legacy ID ("folder").
 */
export async function loadGeneration(rootHandle, id) {
  const { folderId, variantKey } = parseId(id);
  try {
    const dirHandle = await rootHandle.getDirectoryHandle(folderId);
    let prompt = '';
    try {
      const pf = await dirHandle.getFileHandle('prompt.md');
      prompt = await (await pf.getFile()).text();
    } catch (e) { /* no prompt */ }

    let response = '', metadata = null;

    if (variantKey) {
      // New format
      try {
        const rf = await dirHandle.getFileHandle(`${variantKey}.html`);
        response = await (await rf.getFile()).text();
      } catch (e) { /* no response */ }
      try {
        const mf = await dirHandle.getFileHandle(`${variantKey}.json`);
        metadata = JSON.parse(await (await mf.getFile()).text());
      } catch (e) { /* no metadata */ }
    } else {
      // Legacy format
      try {
        const rf = await dirHandle.getFileHandle('response.html');
        response = await (await rf.getFile()).text();
      } catch (e) { /* no response */ }
      try {
        const mf = await dirHandle.getFileHandle('metadata.json');
        metadata = JSON.parse(await (await mf.getFile()).text());
      } catch (e) { /* no metadata */ }
    }

    return { id, folderId, variantKey, prompt, response, metadata };
  } catch (e) {
    return null;
  }
}

/**
 * Update metadata for a specific variant (or legacy generation).
 */
export async function updateMetadata(rootHandle, id, metadata) {
  const { folderId, variantKey } = parseId(id);
  const dirHandle = await rootHandle.getDirectoryHandle(folderId);
  const fileName = variantKey ? `${variantKey}.json` : 'metadata.json';
  const metaFile = await dirHandle.getFileHandle(fileName, { create: true });
  const mw = await metaFile.createWritable();
  await mw.write(JSON.stringify(metadata, null, 2));
  await mw.close();
}

/**
 * List all generations across all folders.
 * Each variant appears as a separate entry.
 * Handles both new (variant) and legacy formats.
 */
export async function listGenerations(rootHandle) {
  const generations = [];

  for await (const [name, handle] of rootHandle) {
    if (handle.kind !== 'directory') continue;
    // Folders starting with "_" are reserved app data (e.g. _library), not generations
    if (name.startsWith('_')) continue;
    // …as are the data-root contract's own subfolders. Without this, the JSON
    // the hub writes into config/ reads as a variant and a phantom "Config"
    // project shows up in the gallery and the compare picker.
    if (RESERVED_FOLDERS.has(name)) continue;

    // prompt.md belongs to the folder, so read it once and attach it to every
    // variant. This keeps gallery search and grouping prompt-aware without
    // changing the on-disk format.
    let prompt = '';
    try {
      const promptHandle = await handle.getFileHandle('prompt.md');
      prompt = await (await promptHandle.getFile()).text();
    } catch (e) { /* legacy folders may not have a prompt */ }

    // Scan folder for variant .json files and legacy metadata.json
    const variantJsons = [];
    let hasLegacyMeta = false;

    for await (const [fileName, fileHandle] of handle) {
      if (fileHandle.kind !== 'file') continue;
      if (fileName === 'metadata.json') {
        hasLegacyMeta = true;
      } else if (fileName.endsWith('.json')) {
        variantJsons.push({ key: fileName.replace(/\.json$/, ''), handle: fileHandle });
      }
    }

    if (variantJsons.length > 0) {
      // New format — each .json is a variant
      for (const vj of variantJsons) {
        try {
          const mFile = await vj.handle.getFile();
          const metadata = JSON.parse(await mFile.text());
          let response = '';
          try {
            const rf = await handle.getFileHandle(`${vj.key}.html`);
            response = await (await rf.getFile()).text();
          } catch (e) { /* no response file */ }
          generations.push({
            id: `${name}/${vj.key}`,
            folderId: name,
            variantKey: vj.key,
            prompt,
            response,
            metadata,
          });
        } catch (e) { /* skip invalid */ }
      }
    } else if (hasLegacyMeta) {
      // Legacy format — single response.html + metadata.json
      try {
        const mf = await handle.getFileHandle('metadata.json');
        const metadata = JSON.parse(await (await mf.getFile()).text());
        let response = '';
        try {
          const rf = await handle.getFileHandle('response.html');
          response = await (await rf.getFile()).text();
        } catch (e) { /* no response */ }
        generations.push({
          id: name,
          folderId: name,
          variantKey: null,
          prompt,
          response,
          metadata,
        });
      } catch (e) { /* not a valid generation folder */ }
    }
  }

  return generations;
}

/**
 * Delete a variant (or a legacy generation).
 * If the last variant is removed, the whole folder is deleted.
 */
export async function deleteGeneration(rootHandle, id) {
  const { folderId, variantKey } = parseId(id);

  if (!variantKey) {
    // Legacy — delete entire folder
    await rootHandle.removeEntry(folderId, { recursive: true });
    return;
  }

  const dirHandle = await rootHandle.getDirectoryHandle(folderId);
  // Remove variant files
  try { await dirHandle.removeEntry(`${variantKey}.html`); } catch (e) { /* ok */ }
  try { await dirHandle.removeEntry(`${variantKey}.json`); } catch (e) { /* ok */ }

  // Check if any variants remain (anything besides prompt.md)
  let remaining = 0;
  for await (const [fileName] of dirHandle) {
    if (fileName !== 'prompt.md') remaining++;
  }

  if (remaining === 0) {
    // No variants left — remove the whole folder
    await rootHandle.removeEntry(folderId, { recursive: true });
  }
}
