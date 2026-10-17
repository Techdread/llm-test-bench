// Minimal CSV parser / serialiser — RFC 4180-ish. Handles quoted fields with
// commas / quotes / newlines; trims trailing empty line.

export function parseCsv(text, { delimiter = ',' } = {}) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === delimiter) { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  while (rows.length && rows[rows.length - 1].every(v => v === '')) rows.pop();
  return rows;
}

export function stringifyCsv(rows, { delimiter = ',' } = {}) {
  const escape = (v) => {
    if (v == null) return '';
    const s = String(v);
    if (s.includes(delimiter) || s.includes('"') || s.includes('\n') || s.includes('\r')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  return rows.map(r => r.map(escape).join(delimiter)).join('\n');
}

/** Infer a simple SQLite column type for a column of sample values. */
export function inferType(values) {
  let seenInt = true, seenReal = true, seenAny = false;
  for (const v of values) {
    if (v === '' || v == null) continue;
    seenAny = true;
    if (!/^-?\d+$/.test(v)) seenInt = false;
    if (!/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(v)) seenReal = false;
  }
  if (!seenAny) return 'TEXT';
  if (seenInt) return 'INTEGER';
  if (seenReal) return 'REAL';
  return 'TEXT';
}

export function triggerDownload(filename, text, mime = 'text/csv') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
