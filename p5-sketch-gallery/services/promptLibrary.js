import { CURATED_PROMPTS } from '../data/curatedPrompts.js';
import * as projectStore from './storage/projectStore.js';

export const PROMPT_CATEGORIES = [
  { id: 'emergence', label: 'Emergence', icon: 'fa-seedling' },
  { id: 'physics', label: 'Physics & Systems', icon: 'fa-atom' },
  { id: 'webgl', label: 'WebGL & Shaders', icon: 'fa-cube' },
  { id: 'interactive', label: 'Interactive Tools', icon: 'fa-hand-pointer' },
  { id: 'games', label: 'Games & Play', icon: 'fa-gamepad' },
  { id: 'data-sound', label: 'Data & Sound', icon: 'fa-chart-line' },
];

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'be', 'build', 'by', 'create', 'for', 'from',
  'in', 'include', 'into', 'is', 'it', 'make', 'of', 'on', 'or', 'p5', 'p5js',
  'sketch', 'that', 'the', 'this', 'to', 'use', 'using', 'with',
]);

export function normalizePromptText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/p5\s*\.\s*js/g, 'p5js')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function meaningfulTokens(text) {
  return new Set(normalizePromptText(text).split(' ').filter(word => word.length > 2 && !STOP_WORDS.has(word)));
}

export function promptSimilarity(a, b) {
  const aa = meaningfulTokens(a);
  const bb = meaningfulTokens(b);
  if (!aa.size || !bb.size) return 0;
  let intersection = 0;
  for (const token of aa) if (bb.has(token)) intersection++;
  return intersection / (aa.size + bb.size - intersection);
}

export function categoryInfo(id) {
  return PROMPT_CATEGORIES.find(category => category.id === id)
    || { id: id || 'other', label: 'Other', icon: 'fa-wand-magic-sparkles' };
}

export function guessPromptCategory(prompt = {}) {
  const text = normalizePromptText([
    prompt.title,
    prompt.prompt,
    ...(prompt.tags || []),
  ].join(' '));

  if (/webgl|shader|glsl|raymarch|volumetric|fragment shader|procedural planet/.test(text)) return 'webgl';
  if (/game|puzzle|player|level|maze|arcade|score|relic/.test(text)) return 'games';
  if (/audio|music|data|chart|graph|traffic|weather|visuali[sz]ation|typography/.test(text)) return 'data-sound';
  if (/tool|editor|drawing|paint|atelier|plotter|sculpt|interactive/.test(text)) return 'interactive';
  if (/physics|verlet|gravity|cloth|pendulum|spring|optics|collision|soft body|n body/.test(text)) return 'physics';
  return 'emergence';
}

function duplicateIndex(items, candidate) {
  const text = normalizePromptText(candidate.prompt);
  const title = normalizePromptText(candidate.title);
  return items.findIndex(item => {
    const itemText = normalizePromptText(item.prompt);
    if (text && text === itemText) return true;
    const sameTitle = title && title === normalizePromptText(item.title);
    const similarity = promptSimilarity(text, itemText);
    return similarity >= 0.82 || (sameTitle && similarity >= 0.48);
  });
}

function mergeDuplicate(target, duplicate) {
  const ids = new Set([...(target.projectIds || []), ...(duplicate.projectIds || [])]);
  target.projectIds = [...ids];
  target.savedCount = ids.size;
  target.tags = [...new Set([...(target.tags || []), ...(duplicate.tags || [])])].slice(0, 8);
  target.modelIds = [...new Set([...(target.modelIds || []), ...(duplicate.modelIds || [])].filter(Boolean))];
  target.modelLabels = [...new Set([...(target.modelLabels || []), ...(duplicate.modelLabels || [])].filter(Boolean))];
  target.providerModelKeys = [...new Set([...(target.providerModelKeys || []), ...(duplicate.providerModelKeys || [])].filter(Boolean))];
  if (!target.notes && duplicate.notes) target.notes = duplicate.notes;
  return target;
}

/**
 * Merge shipped seeds with prompts recovered from saved sketches. Near-identical
 * generations collapse into one card and carry all project ids, so a prompt
 * repeatedly used in the gallery never floods the catalogue.
 */
export function mergePromptLibrary(curated = CURATED_PROMPTS, galleryPrompts = []) {
  const out = [];
  for (const raw of curated) {
    if (!normalizePromptText(raw.prompt)) continue;
    const item = {
      ...raw,
      source: 'curated',
      category: raw.category || guessPromptCategory(raw),
      projectIds: [],
      savedCount: 0,
      modelIds: [],
      modelLabels: [],
      providerModelKeys: [],
    };
    const duplicate = duplicateIndex(out, item);
    if (duplicate >= 0) mergeDuplicate(out[duplicate], item);
    else out.push(item);
  }

  for (const raw of galleryPrompts) {
    if (!normalizePromptText(raw.prompt)) continue;
    const projectIds = raw.projectIds?.length
      ? raw.projectIds
      : (raw.projectId ? [raw.projectId] : []);
    const item = {
      ...raw,
      id: raw.id || `gallery-${projectIds[0] || out.length}`,
      source: 'gallery',
      category: raw.category || guessPromptCategory(raw),
      projectIds,
      savedCount: projectIds.length,
      modelIds: raw.modelIds || [],
      modelLabels: raw.modelLabels || [],
      providerModelKeys: raw.providerModelKeys || [],
    };
    const duplicate = duplicateIndex(out, item);
    if (duplicate >= 0) mergeDuplicate(out[duplicate], item);
    else out.push(item);
  }
  return out;
}

export async function scanGalleryPrompts(rootHandle) {
  if (!rootHandle) return [];
  const projects = await projectStore.listProjectPromptRecords(rootHandle);
  return projects.map(project => ({
    id: `gallery-${project.id}`,
    projectId: project.id,
    title: project.metadata?.title || project.id,
    prompt: project.prompt,
    tags: project.metadata?.tags || [],
    notes: project.metadata?.notes || '',
    createdAt: project.metadata?.createdAt || '',
    modelIds: project.metadata?.modelId ? [project.metadata.modelId] : [],
    modelLabels: (project.metadata?.modelDisplayLabel || project.metadata?.model)
      ? [project.metadata.modelDisplayLabel || project.metadata.model]
      : [],
    providerModelKeys: project.metadata?.providerId && project.metadata?.modelId
      ? [`${project.metadata.providerId}::${project.metadata.modelId}`]
      : [],
    category: guessPromptCategory({
      title: project.metadata?.title || project.id,
      prompt: project.prompt,
      tags: project.metadata?.tags || [],
    }),
  }));
}

export async function getPromptLibrary(rootHandle) {
  const galleryPrompts = await scanGalleryPrompts(rootHandle);
  return mergePromptLibrary(CURATED_PROMPTS, galleryPrompts);
}

export { CURATED_PROMPTS };
