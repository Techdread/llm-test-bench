// Bundled gallery demos (Prompt Gallery, SVG Benchmark, p5 Sketch Gallery):
// a published showcase piece shipped in `<app>/demos/` by tools/app-demos.mjs,
// opened in the Create view for a first-time visitor so the page starts with a
// working result and the prompt that made it, not empty editors.
//
// demos/index.json: { default, demos: [{ slug, title, model, file }] }
// demos/<file>:     { title, model, prompt, code, kind, rating, showcaseId }

export function appDemosBase(documentRef = globalThis.document) {
  return new URL('demos/', documentRef?.baseURI || globalThis.location?.href || 'http://localhost/');
}

export function normalizeAppDemoIndex(index, base = appDemosBase()) {
  const demos = (Array.isArray(index?.demos) ? index.demos : [])
    .filter(demo => demo && typeof demo.slug === 'string' && typeof demo.file === 'string')
    .map(demo => ({ ...demo, title: demo.title || demo.slug, url: String(new URL(demo.file, base)) }));
  const chosen = demos.some(demo => demo.slug === index?.default) ? index.default : (demos[0]?.slug || '');
  return { default: chosen, demos };
}

/** The default demo, or null. Never throws: no demo just means empty editors. */
export async function loadDefaultAppDemo({ fetchImpl = globalThis.fetch, base = appDemosBase() } = {}) {
  try {
    const res = await fetchImpl(new URL('index.json', base));
    if (!res.ok) return null;
    const index = normalizeAppDemoIndex(await res.json(), base);
    const entry = index.demos.find(demo => demo.slug === index.default);
    if (!entry) return null;
    const demoRes = await fetchImpl(entry.url);
    if (!demoRes.ok) return null;
    const demo = await demoRes.json();
    if (typeof demo?.code !== 'string' || !demo.code) return null;
    return {
      slug: entry.slug,
      title: demo.title || entry.title,
      model: demo.model || entry.model || '',
      prompt: String(demo.prompt || ''),
      code: demo.code,
      kind: demo.kind || '',
    };
  } catch {
    return null;
  }
}

/**
 * Whether a gallery should open its demo: nothing of the visitor's own is
 * saved, the editors are empty (no handoff or draft got there first), and the
 * page was not opened on some other route.
 */
export function shouldOpenAppDemo({ savedCount = 0, prompt = '', code = '', hash = '', createRoutes = ['', '#', '#/', '#/create'] } = {}) {
  if (savedCount > 0) return false;
  if (String(prompt).trim() || String(code).trim()) return false;
  return createRoutes.includes(String(hash));
}
