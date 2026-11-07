// Turn a set of workspace files into one page that plays in a single
// sandboxed frame: pick the entry page and inline the workspace's own CSS and
// JS into it. Shared by Code Morph Lab's and Prompt Gallery's Play overlays.

/** The page a set of files opens on: index.html, else the shallowest .html. */
export function htmlEntry(files) {
  const names = Object.keys(files || {}).filter(name => typeof files[name] === 'string');
  if (names.includes('index.html')) return 'index.html';
  return names.filter(name => /\.html?$/i.test(name))
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))[0] || '';
}

const escapeRe = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The entry page with the workspace's own CSS and JS inlined, so a project
 * split across files plays in a single sandboxed frame. Only files that exist
 * in the workspace are inlined; anything else is left as written.
 */
export function playableHtml(files) {
  const entry = htmlEntry(files);
  if (!entry) return '';
  let page = files[entry];
  for (const [name, content] of Object.entries(files)) {
    if (name === entry || typeof content !== 'string') continue;
    const ref = `["'](?:\\./)?${escapeRe(name)}["']`;
    if (/\.css$/i.test(name)) {
      page = page.replace(new RegExp(`<link\\b[^>]*href=${ref}[^>]*>`, 'gi'), () => `<style data-file="${name}">\n${content}\n</style>`);
    } else if (/\.m?js$/i.test(name)) {
      page = page.replace(new RegExp(`<script\\b([^>]*?)\\ssrc=${ref}([^>]*)>\\s*</script>`, 'gi'),
        (_, before, after) => `<script${before}${after} data-file="${name}">\n${content.replace(/<\/script/gi, '<\\/script')}\n</script>`);
    }
  }
  return page;
}
