const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function dateValue(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function ratingValue(generation) {
  return Number(generation.metadata?.rating) || 0;
}

function text(value) {
  return String(value || '').toLowerCase();
}

export function isArchived(generation) {
  return Boolean(generation.metadata?.archivedAt);
}

export function isRefined(generation) {
  const meta = generation.metadata || {};
  return Boolean(meta.derivedFrom || meta.refine?.kind);
}

export function modelLabel(generation) {
  const meta = generation.metadata || {};
  return meta.modelDisplayLabel || meta.modelName || meta.model || 'Unknown model';
}

/**
 * The model on its own, without the provider prefix `modelDisplayLabel` carries.
 * For a column header or a pick card the provider is already shown beside it,
 * and "OpenRouter / Laguna S 2…" truncates away the part you are choosing by.
 */
export function shortModelLabel(generation) {
  const meta = generation.metadata || {};
  return meta.modelName || meta.model || meta.modelId || modelLabel(generation);
}

export function humanizeFolderName(folderId) {
  return String(folderId || 'Untitled project')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

export function matchesGeneration(generation, query) {
  const q = text(query).trim();
  if (!q) return true;
  const meta = generation.metadata || {};
  return [
    generation.id,
    generation.folderId,
    generation.variantKey,
    generation.prompt,
    modelLabel(generation),
    meta.providerName,
    meta.notes,
    ...(meta.tags || []),
  ].some(value => text(value).includes(q));
}

function matchesCollection(generation, collection, now) {
  const archived = isArchived(generation);
  switch (collection) {
    case 'unreviewed': return !archived && ratingValue(generation) === 0;
    case 'favorites': return !archived && ratingValue(generation) >= 4;
    case 'refined': return !archived && isRefined(generation);
    case 'recent': {
      const created = dateValue(generation.metadata?.createdAt);
      return !archived && created > 0 && now - created <= RECENT_WINDOW_MS;
    }
    case 'archived': return archived;
    default: return !archived;
  }
}

export function filterVariants(generations, filters = {}, now = Date.now()) {
  const {
    query = '',
    collection = 'all',
    model = '',
    tag = '',
    minRating = 0,
  } = filters;

  return generations.filter(generation => {
    const meta = generation.metadata || {};
    if (!matchesCollection(generation, collection, now)) return false;
    if (query && !matchesGeneration(generation, query)) return false;
    if (model && modelLabel(generation) !== model) return false;
    if (tag && !(meta.tags || []).includes(tag)) return false;
    if (Number(minRating) > 0 && ratingValue(generation) < Number(minRating)) return false;
    return true;
  });
}

export function sortVariants(generations, sortBy = 'date-desc') {
  return [...generations].sort((a, b) => {
    switch (sortBy) {
      case 'date-asc': return dateValue(a.metadata?.createdAt) - dateValue(b.metadata?.createdAt);
      case 'rating-desc': return ratingValue(b) - ratingValue(a) || dateValue(b.metadata?.createdAt) - dateValue(a.metadata?.createdAt);
      case 'rating-asc': return ratingValue(a) - ratingValue(b) || dateValue(b.metadata?.createdAt) - dateValue(a.metadata?.createdAt);
      case 'name-asc': return `${a.folderId}/${modelLabel(a)}`.localeCompare(`${b.folderId}/${modelLabel(b)}`);
      case 'name-desc': return `${b.folderId}/${modelLabel(b)}`.localeCompare(`${a.folderId}/${modelLabel(a)}`);
      default: return dateValue(b.metadata?.createdAt) - dateValue(a.metadata?.createdAt);
    }
  });
}

export function groupGenerationsByFolder(generations) {
  const groups = new Map();

  for (const generation of generations) {
    const folderId = generation.folderId || generation.id;
    if (!groups.has(folderId)) groups.set(folderId, []);
    groups.get(folderId).push(generation);
  }

  return [...groups.entries()].map(([folderId, items]) => {
    const variants = sortVariants(items, 'date-desc');
    const activeVariants = variants.filter(generation => !isArchived(generation));
    const representativePool = activeVariants.length ? activeVariants : variants;
    const representative = sortVariants(representativePool, 'rating-desc')[0] || null;
    const tags = [...new Set(variants.flatMap(generation => generation.metadata?.tags || []))].sort();
    const models = [...new Set(variants.map(modelLabel))].sort();
    const prompt = variants.find(generation => generation.prompt)?.prompt || '';
    const metadataTitle = variants.find(generation => generation.metadata?.title)?.metadata?.title;
    const latestAt = variants.reduce((latest, generation) => {
      const candidate = generation.metadata?.createdAt || '';
      return dateValue(candidate) > dateValue(latest) ? candidate : latest;
    }, '');

    return {
      id: folderId,
      folderId,
      title: metadataTitle || humanizeFolderName(folderId),
      prompt,
      variants,
      representative,
      tags,
      models,
      variantCount: variants.length,
      activeCount: activeVariants.length,
      unreviewedCount: activeVariants.filter(generation => ratingValue(generation) === 0).length,
      favoriteCount: activeVariants.filter(generation => ratingValue(generation) >= 4).length,
      refinedCount: activeVariants.filter(isRefined).length,
      bestRating: variants.reduce((best, generation) => Math.max(best, ratingValue(generation)), 0),
      latestAt,
      archived: variants.length > 0 && variants.every(isArchived),
      containsArchived: variants.some(isArchived),
    };
  });
}

export function filterProjects(projects, filters = {}, now = Date.now()) {
  const query = text(filters.query).trim();
  const variantFilters = { ...filters, query: '' };

  return projects.filter(project => {
    const matchedVariants = filterVariants(project.variants, variantFilters, now);
    if (matchedVariants.length === 0) return false;
    if (!query) return true;
    const projectMatch = [project.title, project.folderId, project.prompt, ...project.tags]
      .some(value => text(value).includes(query));
    return projectMatch || matchedVariants.some(generation => matchesGeneration(generation, query));
  });
}

export function sortProjects(projects, sortBy = 'date-desc') {
  return [...projects].sort((a, b) => {
    switch (sortBy) {
      case 'date-asc': return dateValue(a.latestAt) - dateValue(b.latestAt);
      case 'rating-desc': return b.bestRating - a.bestRating || dateValue(b.latestAt) - dateValue(a.latestAt);
      case 'rating-asc': return a.bestRating - b.bestRating || dateValue(b.latestAt) - dateValue(a.latestAt);
      case 'name-asc': return a.title.localeCompare(b.title);
      case 'name-desc': return b.title.localeCompare(a.title);
      case 'variants-desc': return b.variantCount - a.variantCount || a.title.localeCompare(b.title);
      default: return dateValue(b.latestAt) - dateValue(a.latestAt);
    }
  });
}

/**
 * Pick the variants that make the most informative side-by-side comparison.
 *
 * One model per column first — comparing the same prompt across LLMs is the
 * point — then, only if the project has fewer models than slots, fill up with
 * its remaining variants so a single-model project can still be lined up.
 */
export function pickDistinctModelVariants(generations, limit = 4) {
  const ranked = sortVariants(generations.filter(g => !isArchived(g)), 'rating-desc');
  const pool = ranked.length ? ranked : sortVariants(generations, 'rating-desc');
  const picked = [];
  const seenModels = new Set();

  for (const generation of pool) {
    if (picked.length >= limit) break;
    const model = modelLabel(generation);
    if (seenModels.has(model)) continue;
    seenModels.add(model);
    picked.push(generation);
  }
  for (const generation of pool) {
    if (picked.length >= limit) break;
    if (!picked.includes(generation)) picked.push(generation);
  }
  return picked;
}

export function collectGalleryFacets(generations) {
  return {
    models: [...new Set(generations.map(modelLabel).filter(Boolean))].sort(),
    tags: [...new Set(generations.flatMap(generation => generation.metadata?.tags || []))].sort(),
  };
}
