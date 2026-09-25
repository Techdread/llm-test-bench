// Admin writes for the showcase (spec 342, phase 2). Pure over D1/R2-shaped
// stores, like showcase-store.js, so node:test runs it against real SQLite.
//
// Data preservation rules, enforced here rather than trusted to the console:
//   - nothing is deleted: "remove" is status = 'hidden';
//   - R2 objects are content-addressed and written only when absent;
//   - an id is never reused, whatever its status;
//   - every change appends an audit row with before/after snapshots.

import { cdnHosts, hubOnlyPath, shapeProblem } from './showcase-checks.js';

export const LIMITS = {
  codeBytes: 2_000_000,       // D1/R2 are fine with more; keep generations reasonable
  svgBytes: 1_000_000,
  posterBytes: 1_000_000,
  promptBytes: 20_000,
  title: 120,
  note: 200,
};

const BENCH_KIND = { 'prompt-gallery': 'html', 'p5-sketch-gallery': 'js', 'svg-benchmark': 'svg' };
const NEW_ID = /^[a-z0-9][a-z0-9-]{1,63}$/;
const RATING = /^(\d{1,2}\/\d{1,2})?$/;

export class AdminError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const fail = (status, message) => { throw new AdminError(status, message); };

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Poster type from magic bytes; never from the client's claimed type. */
export function posterType(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
  return '';
}

const CONTENT_TYPES = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8',
  svg: 'image/svg+xml', md: 'text/markdown; charset=utf-8', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

/** Write bytes under their content hash, only if that key is absent. */
async function putContent(bucket, prefix, bytes, ext) {
  const key = `${prefix}/${await sha256Hex(bytes)}.${ext}`;
  if (!(await bucket.head(key))) {
    await bucket.put(key, bytes, {
      httpMetadata: { contentType: CONTENT_TYPES[ext], cacheControl: 'public, max-age=31536000, immutable' },
    });
  }
  return key;
}

async function audit(db, { actor, action, itemId = null, before = null, after = null, now }) {
  await db.prepare('INSERT INTO audit (at, actor, action, item_id, before, after) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(now, actor, action, itemId, before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after))
    .run();
}

const getRow = (db, id) => db.prepare('SELECT * FROM items WHERE id = ?').bind(id).first();

function cleanText(value, max, field) {
  const text = String(value ?? '').trim();
  if (text.length > max) fail(422, `${field} is longer than ${max} characters`);
  return text;
}

export async function listAll(db) {
  const { results } = await db.prepare('SELECT * FROM items ORDER BY position, id').all();
  return (results || []).map(row => ({
    ...row,
    hero: Boolean(row.hero),
    cdn_hosts: JSON.parse(row.cdn_hosts || '[]'),
    source_meta: JSON.parse(row.source_meta || '{}'),
  }));
}

/**
 * Validate everything before writing anything, so a rejected publish leaves
 * no stray objects or rows behind.
 * @param {{ id, bench, title, note?, rating?, sourceMeta? }} meta
 * @param {{ code: Uint8Array, prompt?: string, poster?: Uint8Array }} files
 */
export async function publishItem(db, bucket, meta, files, { actor, now }) {
  const id = String(meta.id || '');
  if (!NEW_ID.test(id)) fail(422, 'id must be 2–64 characters of a–z, 0–9 and hyphens, starting with a letter or digit');
  const kind = BENCH_KIND[meta.bench];
  if (!kind) fail(422, `unknown bench ${meta.bench}`);
  const title = cleanText(meta.title, LIMITS.title, 'title');
  if (!title) fail(422, 'title is required');
  const note = cleanText(meta.note, LIMITS.note, 'note');
  const rating = cleanText(meta.rating, 5, 'rating');
  if (!RATING.test(rating)) fail(422, 'rating must look like 9/10 or be empty');

  const code = files.code;
  if (!code?.length) fail(422, 'code is required');
  if (code.length > (kind === 'svg' ? LIMITS.svgBytes : LIMITS.codeBytes)) fail(413, 'code file is too large');
  const text = new TextDecoder().decode(code);
  const hubPath = hubOnlyPath(text);
  if (hubPath) fail(422, `loads ${hubPath}, which the public site does not have`);
  const shape = shapeProblem(text, kind);
  if (shape) fail(422, `not a clean ${kind} file: ${shape}`);

  const prompt = String(files.prompt || '').trim();
  if (prompt.length > LIMITS.promptBytes) fail(413, 'prompt is too long');

  let posterExt = '';
  if (kind !== 'svg') {
    if (!files.poster?.length) fail(422, 'a poster image is required');
    if (files.poster.length > LIMITS.posterBytes) fail(413, 'poster is larger than 1 MB');
    posterExt = posterType(files.poster);
    if (!posterExt) fail(415, 'poster must be a JPEG, PNG or WebP image');
  }

  if (await getRow(db, id)) fail(409, `id ${id} is already used; ids are permanent, choose another`);

  const codeKey = await putContent(bucket, 'code', code, kind);
  const promptKey = prompt ? await putContent(bucket, 'prompt', new TextEncoder().encode(prompt), 'md') : null;
  const posterKey = posterExt ? await putContent(bucket, 'posters', files.poster, posterExt) : null;
  const { top } = await db.prepare('SELECT COALESCE(MAX(position), 0) AS top FROM items').first();

  const row = {
    id, bench: meta.bench, title, note, rating, kind,
    code_key: codeKey, prompt_key: promptKey, poster_key: posterKey,
    status: 'published', position: top + 1, hero: 0,
    cdn_hosts: JSON.stringify(cdnHosts(text)),
    source_meta: JSON.stringify(meta.sourceMeta && typeof meta.sourceMeta === 'object' ? meta.sourceMeta : {}),
    created_at: now, updated_at: now,
  };
  const columns = Object.keys(row);
  // INSERT (not OR IGNORE): a race on the same id fails loudly instead of silently.
  await db.prepare(`INSERT INTO items (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
    .bind(...columns.map(c => row[c])).run();
  await audit(db, { actor, action: 'publish', itemId: id, after: row, now });
  return row;
}

/** Edit title/note/rating, hide/unhide, or set the hero flag. */
export async function updateItem(db, id, patch, { actor, now }) {
  const before = await getRow(db, id);
  if (!before) fail(404, `no item ${id}`);
  const next = {};
  if ('title' in patch) {
    next.title = cleanText(patch.title, LIMITS.title, 'title');
    if (!next.title) fail(422, 'title cannot be empty');
  }
  if ('note' in patch) next.note = cleanText(patch.note, LIMITS.note, 'note');
  if ('rating' in patch) {
    next.rating = cleanText(patch.rating, 5, 'rating');
    if (!RATING.test(next.rating)) fail(422, 'rating must look like 9/10 or be empty');
  }
  if ('status' in patch) {
    if (!['published', 'hidden'].includes(patch.status)) fail(422, 'status must be published or hidden');
    next.status = patch.status;
  }
  if ('hero' in patch) next.hero = patch.hero ? 1 : 0;
  const fields = Object.keys(next).filter(k => next[k] !== before[k]);
  if (!fields.length) return before;

  await db.prepare(`UPDATE items SET ${fields.map(f => `${f} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .bind(...fields.map(f => next[f]), now, id).run();
  const after = await getRow(db, id);
  const action = 'status' in next && next.status !== before.status
    ? (next.status === 'hidden' ? 'hide' : 'unhide')
    : fields.length === 1 && fields[0] === 'hero' ? 'hero' : 'edit';
  await audit(db, { actor, action, itemId: id,
    before: Object.fromEntries(fields.map(f => [f, before[f]])),
    after: Object.fromEntries(fields.map(f => [f, after[f]])), now });
  return after;
}

/** Set the display order. `ids` must name every item exactly once. */
export async function reorderItems(db, ids, { actor, now }) {
  if (!Array.isArray(ids) || !ids.length) fail(422, 'order must be a non-empty list of ids');
  const { results } = await db.prepare('SELECT id FROM items ORDER BY position, id').all();
  const current = results.map(r => r.id);
  const wanted = new Set(ids);
  if (wanted.size !== ids.length || ids.length !== current.length || current.some(id => !wanted.has(id))) {
    fail(422, 'order must list every item exactly once (reload and try again)');
  }
  // One statement whatever the item count: the free plan allows 50 queries per request.
  await db.prepare(`UPDATE items SET position = (SELECT key + 1 FROM json_each(?1) WHERE value = items.id)
                    WHERE id IN (SELECT value FROM json_each(?1))`).bind(JSON.stringify(ids)).run();
  await audit(db, { actor, action: 'reorder', before: current, after: ids, now });
  return ids;
}

export async function replacePoster(db, bucket, id, bytes, { actor, now }) {
  const before = await getRow(db, id);
  if (!before) fail(404, `no item ${id}`);
  if (before.kind === 'svg') fail(422, 'SVG items have no poster: the file is the artwork');
  if (!bytes?.length) fail(422, 'no image uploaded');
  if (bytes.length > LIMITS.posterBytes) fail(413, 'poster is larger than 1 MB');
  const ext = posterType(bytes);
  if (!ext) fail(415, 'poster must be a JPEG, PNG or WebP image');
  const key = await putContent(bucket, 'posters', bytes, ext);
  if (key === before.poster_key) return before;
  await db.prepare('UPDATE items SET poster_key = ?, updated_at = ? WHERE id = ?').bind(key, now, id).run();
  await audit(db, { actor, action: 'poster', itemId: id, before: { poster_key: before.poster_key }, after: { poster_key: key }, now });
  return getRow(db, id);
}

/** Point an item back at an earlier revision's objects (from the audit log). */
export async function restoreRevision(db, bucket, id, keys, { actor, now }) {
  const before = await getRow(db, id);
  if (!before) fail(404, `no item ${id}`);
  const next = {};
  for (const field of ['code_key', 'poster_key']) {
    if (!(field in keys) || keys[field] === before[field]) continue;
    const key = String(keys[field] || '');
    const prefix = field === 'code_key' ? 'code/' : 'posters/';
    if (!key.startsWith(prefix) || !(await bucket.head(key))) fail(422, `${field} ${key} is not a stored object`);
    if (field === 'code_key' && !key.endsWith(`.${before.kind}`)) fail(422, 'code revision is a different kind of file');
    next[field] = key;
  }
  const fields = Object.keys(next);
  if (!fields.length) return before;
  await db.prepare(`UPDATE items SET ${fields.map(f => `${f} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .bind(...fields.map(f => next[f]), now, id).run();
  await audit(db, { actor, action: 'restore', itemId: id,
    before: Object.fromEntries(fields.map(f => [f, before[f]])), after: next, now });
  return getRow(db, id);
}

export async function listAudit(db, { before = null, limit = 50 } = {}) {
  const size = Math.max(1, Math.min(200, Number(limit) || 50));
  const stmt = before
    ? db.prepare('SELECT * FROM audit WHERE seq < ? ORDER BY seq DESC LIMIT ?').bind(Number(before), size)
    : db.prepare('SELECT * FROM audit ORDER BY seq DESC LIMIT ?').bind(size);
  const { results } = await stmt.all();
  return (results || []).map(r => ({ ...r, before: r.before && JSON.parse(r.before), after: r.after && JSON.parse(r.after) }));
}

/** Every row plus every object key they have ever referenced (for the backup). */
export async function backupManifest(db) {
  const items = (await db.prepare('SELECT * FROM items ORDER BY position, id').all()).results || [];
  const auditRows = (await db.prepare('SELECT * FROM audit ORDER BY seq').all()).results || [];
  const keys = new Set();
  for (const row of items) for (const k of [row.code_key, row.prompt_key, row.poster_key]) if (k) keys.add(k);
  for (const row of auditRows) {
    for (const snap of [row.before, row.after]) {
      const text = String(snap || '');
      for (const m of text.matchAll(/"((?:code|prompt|posters)\/[0-9a-f]{64}\.[a-z]+)"/g)) keys.add(m[1]);
    }
  }
  return { schema: 1, items, audit: auditRows, objects: [...keys].sort() };
}
