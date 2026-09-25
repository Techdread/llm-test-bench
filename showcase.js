// Showcase tiles for the landing-page hero and the full showcase page.
//
// Items come from the showcase backend (GET api/showcase, spec 342: D1 + R2)
// and fall back to _showcase/index.json, which tools/build-public-mvp.mjs bakes
// into every build. With neither, every showcase panel simply stays hidden, so
// a build without a showcase degrades to the old single-column hero.
//
// Markup contract:
//   <div data-showcase-panel hidden>          shown once tiles exist
//     <span data-showcase-count></span>       "N hand-picked"
//     <div data-showcase-grid data-hero data-limit="6">
//                                             tiles; data-hero shows only items
//                                             flagged `hero` (the first N when
//                                             none are), data-limit caps them
//     <div data-showcase-filters>             optional bench filter chips
//
// Every item keeps a stable `id` (also the tile's DOM id), so showcase.html#<id>
// is a shareable permalink — and future per-item voting can key on the same id.

const BENCH = {
  'prompt-gallery': { cls: 'pg', label: 'Prompt Gallery' },
  'p5-sketch-gallery': { cls: 'p5', label: 'p5 Sketch' },
  'svg-benchmark': { cls: 'svg', label: 'SVG Bench' },
};

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// "9/10" -> 0.9; unrated sorts last.
const ratingScore = (rating) => {
  const [got, max] = String(rating || '').split('/').map(Number);
  return got > 0 && max > 0 ? got / max : -1;
};

function tile(it, i) {
  const bench = BENCH[it.bench] || { cls: 'pg', label: it.bench };
  const href = `${it.bench}/#/showcase/${encodeURIComponent(it.id)}`;
  const src = it.posterUrl || it.artUrl;
  return `
    <a class="showcase-tile ${bench.cls}" id="${esc(it.id)}" href="${esc(href)}" style="--d:${Math.min(i, 12) * 50}ms"
       aria-label="${esc(`${it.title} — ${bench.label}, ${it.note || 'unknown model'}`)}">
      <span class="showcase-art"><img alt="" loading="lazy" decoding="async" src="${esc(src)}">
        <span class="showcase-chip">${esc(bench.label)}</span>
        ${it.rating ? `<span class="showcase-score" title="Maintainer rating">${esc(it.rating)}</span>` : ''}
      </span>
      <span class="showcase-meta">
        <span class="showcase-title">${esc(it.title)}</span>
        <span class="showcase-go" aria-hidden="true">&rarr;</span>
      </span>
      <span class="showcase-sub">${esc(it.note || '')}</span>
    </a>`;
}

async function fetchList(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const list = (await res.json()).showcase;
    return Array.isArray(list) && list.length ? list : null;
  } catch {
    return null;
  }
}

// The static index predates the backend: resolve its file names to URLs and
// treat its first six as the hero, which is what the build has always shown.
function fromStaticIndex(list) {
  return list.map((it, i) => ({
    ...it,
    // SVG submissions have no poster: the file itself is the artwork.
    posterUrl: it.poster ? `_showcase/${it.poster}` : '',
    artUrl: it.poster ? '' : `_showcase/${it.id}${it.ext || '.svg'}`,
    hero: i < 6,
  }));
}

async function loadItems() {
  const live = await fetchList('api/showcase');
  if (live) return live;
  const baked = await fetchList('_showcase/index.json');
  return baked ? fromStaticIndex(baked) : [];
}

function renderFilters(host, items, apply) {
  const counts = items.reduce((m, it) => (m[it.bench] = (m[it.bench] || 0) + 1, m), {});
  const chips = [['all', 'All', items.length],
    ...Object.keys(BENCH).filter((b) => counts[b]).map((b) => [b, BENCH[b].label, counts[b]])];
  host.innerHTML = chips.map(([key, label, n]) =>
    `<button type="button" class="filter-chip" data-bench="${esc(key)}" aria-pressed="${key === 'all'}">
       ${esc(label)} <span>${n}</span></button>`).join('');
  host.addEventListener('click', (e) => {
    const chip = e.target.closest('.filter-chip');
    if (!chip) return;
    for (const c of host.querySelectorAll('.filter-chip')) c.setAttribute('aria-pressed', String(c === chip));
    apply(chip.dataset.bench);
  });
}

async function render() {
  const panels = document.querySelectorAll('[data-showcase-panel]');
  if (!panels.length) return;
  const items = await loadItems();
  if (!items.length) {
    for (const empty of document.querySelectorAll('.showcase-empty')) {
      empty.textContent = 'This build carries no showcase examples.';
    }
    return;
  }

  for (const panel of panels) {
    const grid = panel.querySelector('[data-showcase-grid]');
    if (!grid) continue;
    const limit = Number(grid.dataset.limit) || Infinity;
    const heroOnly = 'hero' in grid.dataset;
    const sortSelect = panel.querySelector('[data-showcase-sort]');
    let bench = 'all';

    const draw = () => {
      const pool = bench === 'all' ? items.slice() : items.filter((it) => it.bench === bench);
      let list = heroOnly && pool.some((it) => it.hero) ? pool.filter((it) => it.hero) : pool;
      if (sortSelect?.value === 'rating') list.sort((a, b) => ratingScore(b.rating) - ratingScore(a.rating));
      list = list.slice(0, limit);
      grid.innerHTML = list.map(tile).join('');
      for (const count of panel.querySelectorAll('[data-showcase-count]')) {
        count.textContent = list.length < pool.length
          ? `${list.length} of ${pool.length} hand-picked`
          : `${pool.length} hand-picked`;
      }
    };

    const filters = panel.querySelector('[data-showcase-filters]');
    if (filters) renderFilters(filters, items, (b) => { bench = b; draw(); });
    sortSelect?.addEventListener('change', draw);
    draw();
    panel.hidden = false;
  }

  // Permalink: showcase.html#<id> scrolls to and highlights that tile.
  let target = null;
  try {
    if (location.hash.length > 1) target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
  } catch { /* malformed escape in the hash: no permalink */ }
  if (target?.classList.contains('showcase-tile')) {
    target.classList.add('is-target');
    // Instant, after layout: the page's smooth scroll-behavior gets cancelled
    // while the freshly inserted grid is still settling.
    requestAnimationFrame(() => target.scrollIntoView({ block: 'center', behavior: 'instant' }));
  }
}

render();
