// Grid renderer. Handles 2D DP tables and maze/obstacle grids. Picks a
// colour-scale for numeric tables, binary colours for 0/1 grids, and marks a
// cursor cell if `mapping.cursor` resolves to a `{x, y}` object (or indices).

export function renderGridView(ctx, { snapshot, mapping, width, height, theme }) {
  const bg       = theme === 'dark' ? '#0b1020' : '#f8fafc';
  const txtCol   = theme === 'dark' ? '#e2e8f0' : '#1f2937';
  const cellBase = theme === 'dark' ? '#1e293b' : '#f1f5f9';
  const wallCol  = theme === 'dark' ? '#64748b' : '#94a3b8';

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  const tableName = mapping.table || pickFirst2D(snapshot.vars);
  const table = tableName ? snapshot.vars.get(tableName) : null;
  if (!Array.isArray(table) || !table.length || !Array.isArray(table[0])) {
    drawCentreMessage(ctx, width, height, txtCol, `No 2D table found${tableName ? ` (looked for \`${tableName}\`)` : ''}`);
    return;
  }

  const rows = table.length;
  const cols = Math.max(...table.map(r => r.length));
  const pad = 24;
  const availW = width - pad * 2;
  const availH = height - pad * 2;
  const cell = Math.max(6, Math.min(Math.floor(availW / cols), Math.floor(availH / rows)));

  const x0 = (width - cell * cols) / 2;
  const y0 = (height - cell * rows) / 2;

  // Determine numeric range.
  let min = Infinity, max = -Infinity;
  let isBinary = true;
  for (const row of table) {
    for (const v of row) {
      const n = typeof v === 'number' ? v : Number(v);
      if (Number.isFinite(n)) {
        if (n < min) min = n;
        if (n > max) max = n;
        if (n !== 0 && n !== 1) isBinary = false;
      }
    }
  }
  if (!Number.isFinite(min)) { min = 0; max = 1; }
  if (min === max) max = min + 1;

  // Cursor.
  const cursorVal = snapshot.vars.get(mapping.cursor || 'current');
  let cursorCell = null;
  if (cursorVal && typeof cursorVal === 'object' && 'x' in cursorVal && 'y' in cursorVal) {
    cursorCell = { x: cursorVal.x, y: cursorVal.y };
  } else if (typeof snapshot.vars.get('i') === 'number' && typeof snapshot.vars.get('j') === 'number') {
    cursorCell = { x: snapshot.vars.get('j'), y: snapshot.vars.get('i') };
  } else if (typeof snapshot.vars.get('i') === 'number' && typeof snapshot.vars.get('w') === 'number') {
    cursorCell = { x: snapshot.vars.get('w'), y: snapshot.vars.get('i') };
  }

  for (let r = 0; r < rows; r++) {
    const row = table[r] || [];
    for (let c = 0; c < cols; c++) {
      const v = row[c];
      const n = typeof v === 'number' ? v : Number(v);
      let fill = cellBase;
      if (Number.isFinite(n)) {
        if (isBinary) {
          fill = n === 1 ? wallCol : cellBase;
        } else {
          const t = (n - min) / (max - min);
          fill = heatColor(t, theme);
        }
      }
      const x = x0 + c * cell;
      const y = y0 + r * cell;
      ctx.fillStyle = fill;
      ctx.fillRect(x, y, cell - 1, cell - 1);

      if (Number.isFinite(n) && cell >= 22 && !isBinary) {
        ctx.fillStyle = t => theme === 'dark' ? '#f8fafc' : '#1f2937';
        ctx.fillStyle = contrastText((n - min) / (max - min), theme);
        ctx.font = `${Math.max(9, Math.floor(cell * 0.4))}px "Cascadia Code", monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(n), x + cell / 2, y + cell / 2);
      }
    }
  }

  // Cursor outline.
  if (cursorCell && cursorCell.y >= 0 && cursorCell.y < rows && cursorCell.x >= 0 && cursorCell.x < cols) {
    const x = x0 + cursorCell.x * cell;
    const y = y0 + cursorCell.y * cell;
    ctx.strokeStyle = '#f97316';
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 1, y + 1, cell - 3, cell - 3);
  }
}

function pickFirst2D(varMap) {
  for (const [k, v] of varMap.entries()) {
    if (Array.isArray(v) && v.length && Array.isArray(v[0])) return k;
  }
  return null;
}

function heatColor(t, theme) {
  // 0..1 → cool-warm scale.
  t = Math.max(0, Math.min(1, t));
  if (theme === 'dark') {
    const r = Math.round(60 + t * 180);
    const g = Math.round(60 + t * 80);
    const b = Math.round(120 - t * 40);
    return `rgb(${r},${g},${b})`;
  } else {
    const r = Math.round(200 + t * 55);
    const g = Math.round(220 - t * 120);
    const b = Math.round(240 - t * 190);
    return `rgb(${r},${g},${b})`;
  }
}

function contrastText(t, theme) {
  if (theme === 'dark') return '#f8fafc';
  return t > 0.5 ? '#f8fafc' : '#1f2937';
}

function drawCentreMessage(ctx, width, height, color, msg) {
  ctx.fillStyle = color;
  ctx.font = '13px "Cascadia Code", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(msg, width / 2, height / 2);
}
