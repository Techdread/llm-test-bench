// Landing-page showcase strip.
//
// tools/build-public-mvp.mjs writes _showcase/index.json listing the curated
// tiles. If that file is absent (or empty) the panel simply stays hidden, so a
// build without a showcase degrades to the old single-column hero.

const BENCH = {
  'prompt-gallery': { cls: 'pg', label: 'Prompt Gallery' },
  'p5-sketch-gallery': { cls: 'p5', label: 'p5 Sketch' },
  'svg-benchmark': { cls: 'svg', label: 'SVG Bench' },
};

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function render() {
  const panel = document.getElementById('showcase');
  const grid = document.getElementById('showcase-grid');
  if (!panel || !grid) return;

  let items = [];
  try {
    const res = await fetch('_showcase/index.json');
    if (!res.ok) return;
    items = (await res.json()).showcase || [];
  } catch {
    return;                       // no showcase in this build
  }
  if (!items.length) return;

  grid.innerHTML = items.map((it, i) => {
    const bench = BENCH[it.bench] || { cls: 'pg', label: it.bench };
    const href = `${it.bench}/#/showcase/${encodeURIComponent(it.id)}`;
    // SVG submissions have no poster: the file itself is the artwork, small
    // enough to inline as an <img> straight from _showcase/.
    const art = it.poster
      ? `<img alt="" loading="lazy" src="_showcase/${esc(it.poster)}">`
      : `<img alt="" loading="lazy" src="_showcase/${esc(it.id)}${esc(it.ext || '.svg')}">`;
    return `
      <a class="showcase-tile ${bench.cls}" href="${esc(href)}" style="--d:${i * 60}ms">
        <span class="showcase-art">${art}
          <span class="showcase-chip">${esc(bench.label)}</span>
          ${it.rating ? `<span class="showcase-score">${esc(it.rating)}</span>` : ''}
        </span>
        <span class="showcase-meta">
          <span class="showcase-title">${esc(it.title)}</span>
          <span class="showcase-go" aria-hidden="true">&rarr;</span>
        </span>
        <span class="showcase-sub">${esc(it.note || '')}</span>
      </a>`;
  }).join('');

  const count = document.getElementById('showcase-count');
  if (count) count.textContent = `${items.length} hand-picked`;
  panel.hidden = false;
}

render();
