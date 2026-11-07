// Bundled forge demos: a finished run shipped with the app in `<forge>/demos/`
// (built by tools/app-demos.mjs with the showcase admin's bundler and checks),
// so a visitor can play something the forge made before choosing a model.
//
// A demo plays through the same player as a published showcase run, at
// `<forge>/#/demo/<slug>`, and is described by demos/index.json:
//   { default, demos: [{ slug, title, model, prompt, file, poster }] }

export function demosBase(documentRef = globalThis.document) {
  return new URL('demos/', documentRef?.baseURI || globalThis.location?.href || 'http://localhost/');
}

/** `#/demo/<slug>` -> slug, else ''. */
export function demoSlugFromHash(hash = globalThis.location?.hash || '') {
  const match = /^#\/demo\/([^/?#]+)/.exec(String(hash));
  if (!match) return '';
  try { return decodeURIComponent(match[1]); } catch { return ''; }
}

export function normalizeForgeDemoIndex(index, base = demosBase()) {
  const demos = (Array.isArray(index?.demos) ? index.demos : [])
    .filter(demo => demo && typeof demo.slug === 'string' && typeof demo.file === 'string')
    .map(demo => ({
      ...demo,
      title: demo.title || demo.slug,
      url: String(new URL(demo.file, base)),
      poster: demo.poster ? String(new URL(demo.poster, base)) : '',
    }));
  const chosen = demos.some(demo => demo.slug === index?.default) ? index.default : (demos[0]?.slug || '');
  return { default: chosen, demos };
}

/** Never throws: no index means no demos. */
export async function loadForgeDemoIndex({ fetchImpl = globalThis.fetch, base = demosBase() } = {}) {
  try {
    const res = await fetchImpl(new URL('index.json', base));
    if (!res.ok) return { default: '', demos: [] };
    return normalizeForgeDemoIndex(await res.json(), base);
  } catch {
    return { default: '', demos: [] };
  }
}

/**
 * A demo in the shape the showcase player reads (`loadShowcaseItem`), or null
 * when there is no such demo.
 */
export async function loadForgeDemoItem(slug, opts = {}) {
  const { demos } = await loadForgeDemoIndex(opts);
  const demo = demos.find(entry => entry.slug === slug);
  if (!demo) return null;
  const res = await (opts.fetchImpl || globalThis.fetch)(demo.url);
  if (!res.ok) return null;
  return {
    id: demo.slug, title: demo.title, note: demo.model || '', prompt: demo.prompt || '',
    kind: 'project', code: await res.text(), demo: true,
  };
}
