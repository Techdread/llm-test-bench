// Array-bars renderer. Given a snapshot (variable map) and a mapping, draws
// the primary array as vertical bars with cursor highlights for any cursor vars.

export function renderArrayBars(ctx, { snapshot, mapping, width, height, theme }) {
  const bg = theme === 'dark' ? '#0b1020' : '#f8fafc';
  const bar = theme === 'dark' ? '#6366f1' : '#4f46e5';
  const barActive = '#f97316';
  const cursorColor = '#10b981';
  const text = theme === 'dark' ? '#e2e8f0' : '#1f2937';
  const grid = theme === 'dark' ? '#1e293b' : '#e5e7eb';

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  const arrName = mapping.array || pickFirstArrayVar(snapshot.vars);
  const arr = arrName ? snapshot.vars.get(arrName) : null;
  if (!Array.isArray(arr)) {
    drawCentreMessage(ctx, width, height, text, `No array found${arrName ? ` (looked for \`${arrName}\`)` : ''}`);
    return;
  }

  // Find numeric range.
  let min = Infinity, max = -Infinity;
  for (const v of arr) {
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n)) continue;
    if (n < min) min = n;
    if (n > max) max = n;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) { min = 0; max = 1; }
  if (min === max) max = min + 1;

  const pad = 24;
  const labelH = 18;
  const chartH = height - pad * 2 - labelH;
  const chartW = width - pad * 2;
  const barW = Math.max(1, chartW / arr.length - 2);

  // Grid.
  ctx.strokeStyle = grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, pad + chartH);
  ctx.lineTo(pad + chartW, pad + chartH);
  ctx.stroke();

  // Cursors.
  const cursors = (mapping.cursors || []).map(name => ({ name, index: snapshot.vars.get(name) }))
    .filter(c => typeof c.index === 'number' && c.index >= 0 && c.index < arr.length);

  // Bars.
  for (let i = 0; i < arr.length; i++) {
    const v = typeof arr[i] === 'number' ? arr[i] : Number(arr[i]);
    const h = Number.isFinite(v) ? ((v - min) / (max - min)) * chartH : 0;
    const x = pad + (i / arr.length) * chartW;
    const y = pad + chartH - h;
    const isCursor = cursors.some(c => c.index === i);
    ctx.fillStyle = isCursor ? barActive : bar;
    ctx.fillRect(x + 1, y, barW, h);

    // Value label above small arrays only.
    if (arr.length <= 24) {
      ctx.fillStyle = text;
      ctx.font = '11px "Cascadia Code", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(String(v), x + 1 + barW / 2, y - 4);
    }
  }

  // Cursor flags.
  let labelY = pad - 10;
  for (const c of cursors) {
    const x = pad + (c.index / arr.length) * chartW + barW / 2;
    ctx.strokeStyle = cursorColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 1, pad);
    ctx.lineTo(x + 1, pad + chartH);
    ctx.stroke();

    ctx.fillStyle = cursorColor;
    ctx.font = 'bold 11px "Cascadia Code", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`${c.name}=${c.index}`, x + 4, labelY + 10);
    labelY += 12;
  }

  // Axis — array index marks every N.
  ctx.fillStyle = text;
  ctx.font = '10px "Cascadia Code", monospace';
  ctx.textAlign = 'center';
  const step = Math.max(1, Math.ceil(arr.length / 12));
  for (let i = 0; i < arr.length; i += step) {
    const x = pad + (i / arr.length) * chartW + barW / 2;
    ctx.fillText(String(i), x + 1, pad + chartH + 14);
  }
}

function pickFirstArrayVar(varMap) {
  for (const [k, v] of varMap.entries()) {
    if (Array.isArray(v) && !v.length || (Array.isArray(v) && typeof v[0] !== 'object')) return k;
  }
  return null;
}

function drawCentreMessage(ctx, width, height, color, msg) {
  ctx.fillStyle = color;
  ctx.font = '13px "Cascadia Code", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(msg, width / 2, height / 2);
}
