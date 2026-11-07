// Bundled demos: a finished page from the Prompt Gallery that ships with the
// app, so a first-time visitor has code to morph before they have written a
// prompt or opened another tool. A demo arrives exactly like a Prompt Gallery
// handoff (kind 'code', original prompt kept apart from the requested change),
// under its own source so there is nowhere to "Send back" to.

export const DEMO_SOURCE = 'code-morph-demo';

const DEMOS_URL = new URL('../demos/', import.meta.url);

/** A suggested change: a short button label and the request it fills in. A
 *  bare string is its own label. */
export function normalizeSuggestion(suggestion) {
  if (typeof suggestion === 'string') {
    const text = suggestion.trim();
    return text ? { label: text, text } : null;
  }
  const text = String(suggestion?.text || '').trim();
  if (!text) return null;
  return { label: String(suggestion.label || '').trim() || text, text };
}

export function normalizeDemoIndex(index) {
  const demos = (Array.isArray(index?.demos) ? index.demos : [])
    .filter(demo => demo && typeof demo.slug === 'string' && Array.isArray(demo.files) && demo.files.length)
    .map(demo => ({
      ...demo,
      title: demo.title || demo.slug,
      language: demo.language === 'python' ? 'python' : 'html',
      suggestions: (Array.isArray(demo.suggestions) ? demo.suggestions : []).map(normalizeSuggestion).filter(Boolean),
    }));
  const chosen = demos.some(demo => demo.slug === index?.default) ? index.default : (demos[0]?.slug || '');
  return { default: chosen, demos };
}

/** The demo as a cml handoff payload. */
export function demoToPayload(demo, contents) {
  return {
    v: 1,
    kind: 'code',
    source: DEMO_SOURCE,
    title: demo.title,
    prompt: demo.prompt || '',
    language: demo.language,
    files: demo.files.map(name => ({ name, content: String(contents[name] ?? '') })),
    meta: { demo: demo.slug, model: demo.model || '', origin: demo.source || '', suggestions: demo.suggestions },
  };
}

export async function loadDemoIndex(fetchImpl = globalThis.fetch) {
  try {
    const response = await fetchImpl(new URL('index.json', DEMOS_URL));
    if (!response.ok) return { default: '', demos: [] };
    return normalizeDemoIndex(await response.json());
  } catch {
    return { default: '', demos: [] };
  }
}

export async function loadDemo(demo, fetchImpl = globalThis.fetch) {
  const contents = {};
  for (const name of demo.files) {
    const response = await fetchImpl(new URL(`${demo.slug}/${name}`, DEMOS_URL));
    if (!response.ok) throw new Error(`The ${demo.title} demo could not be loaded (${response.status}).`);
    contents[name] = await response.text();
  }
  return demoToPayload(demo, contents);
}
