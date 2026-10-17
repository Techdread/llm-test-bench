// Per-agent model lists the user can edit and keep.
//
// The bridge reports what each CLI knows about itself (Codex reads its on-disk
// catalogue, Antigravity shells `agy models`, Claude Code has no listing at all
// so the bridge ships a written-down default). Those are only seeds: a saved
// list overrides them for that agent, so a model that ships before the defaults
// catch up is one edit away rather than a code change.
//
// Saved in the data root (not localStorage) so the list survives a browser
// profile and travels with the rest of the user's data.

/** Split a textarea into a clean id list (one per line, deduped). */
export function parseModelList(text) {
  const seen = new Set();
  return String(text || '')
    .split('\n')
    .map(s => s.trim())
    .filter(s => s && !s.startsWith('#') && !seen.has(s) && seen.add(s));
}

const FILE = 'agent-models.json';

/**
 * @param {Function} getAppRoot the calling Forge's data-root namespace, so the
 *   list is saved beside that app's runs rather than in a shared file.
 */
export function createAgentModelStore(getAppRoot) {

  async function readFile() {
    const root = await getAppRoot();
    try {
      const handle = await root.getFileHandle(FILE);
      return JSON.parse(await (await handle.getFile()).text());
    } catch {
      return {}; // never saved, or unreadable — defaults apply
    }
  }

  /** { [agentId]: string[] } — only agents the user has customised. */
  async function loadAgentModels() {
    const data = await readFile();
    return data && typeof data === 'object' ? data : {};
  }

  /**
   * Save one agent's list. Pass null/[] to drop the override so the bridge's
   * defaults apply again — the file keeps every other agent's list untouched.
   */
  async function saveAgentModels(agentId, models) {
    const data = await readFile();
    if (models && models.length) data[agentId] = models;
    else delete data[agentId];

    const root = await getAppRoot();
    const handle = await root.getFileHandle(FILE, { create: true });
    const w = await handle.createWritable();
    await w.write(JSON.stringify(data, null, 2));
    await w.close();
    return data;
  }


  return Object.freeze({ loadAgentModels, saveAgentModels, parseModelList });
}
