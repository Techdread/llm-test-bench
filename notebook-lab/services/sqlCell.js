// sqlCell — the DOM-free half of SQL cells.
//
// A SQL cell runs against one in-memory SQLite database (sql.js) kept for the
// page session, so a table made in one SQL cell is there in the next. Before
// each run, every list of rows in `nb` (a list of objects, like nb.basket)
// becomes a table of the same name, refreshed from nb; a list of plain values
// becomes a one-column table called `value`. A `-- save as: key` comment saves
// the last result set back to nb as a list of objects.
//
// This module decides the tables, the SQL to build them, and how results turn
// back into rows. services/runnerSql.js does the running.

/** Rows shown per result set; the full result is still saved with `save as`. */
export const MAX_SHOWN_ROWS = 500;

/** Rows looked at when working out a table's columns and their types. */
const SAMPLE_ROWS = 500;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isScalar = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v);

/** A double-quoted SQL identifier, so any nb key or column name is safe. */
export function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function columnType(values) {
  const seen = values.filter((v) => v !== null && v !== undefined);
  if (seen.length && seen.every((v) => typeof v === 'boolean' || (typeof v === 'number' && Number.isInteger(v)))) return 'INTEGER';
  if (seen.length && seen.every((v) => typeof v === 'number' || typeof v === 'boolean')) return 'REAL';
  return 'TEXT';
}

/** A JavaScript value as something SQLite can store. Nested values become JSON text. */
export function toSqlValue(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

/**
 * The tables to build from nb's values: [{ name, columns: [{ name, type }], rows: [[...]] }].
 * Lists of objects and lists of plain values qualify; everything else is left alone.
 */
export function tablesFromValues(values = {}) {
  const tables = [];
  for (const [name, value] of Object.entries(values || {})) {
    if (!Array.isArray(value) || value.length === 0) continue;
    if (value.every(isPlainObject)) {
      const names = [];
      for (const row of value.slice(0, SAMPLE_ROWS)) {
        for (const key of Object.keys(row)) if (!names.includes(key)) names.push(key);
      }
      if (!names.length) continue;
      const columns = names.map((col) => ({ name: col, type: columnType(value.slice(0, SAMPLE_ROWS).map((row) => row[col])) }));
      tables.push({ name, columns, rows: value.map((row) => names.map((col) => toSqlValue(row[col]))) });
    } else if (value.every(isScalar)) {
      tables.push({ name, columns: [{ name: 'value', type: columnType(value) }], rows: value.map((v) => [toSqlValue(v)]) });
    }
  }
  return tables;
}

/** The statements that (re)build one table: drop, create, and a parameterised insert. */
export function tableSql(table) {
  const name = quoteIdent(table.name);
  return {
    drop: `DROP TABLE IF EXISTS ${name}`,
    create: `CREATE TABLE ${name} (${table.columns.map((c) => `${quoteIdent(c.name)} ${c.type}`).join(', ')})`,
    insert: `INSERT INTO ${name} VALUES (${table.columns.map(() => '?').join(', ')})`,
  };
}

/** The key named by a `-- save as: key` (or `-- save: key`) comment, or ''. */
export function saveKey(source = '') {
  const match = String(source).match(/^[ \t]*--[ \t]*save(?:[ \t]+as)?[ \t]*:[ \t]*([A-Za-z_][\w.-]*)[ \t]*$/m);
  return match ? match[1] : '';
}

function fromSqlValue(value) {
  if (value instanceof Uint8Array) return `[${value.length} bytes]`;
  return value;
}

/** A sql.js result set ({ columns, values }) as a list of objects, the shape nb keeps rows in. */
export function resultToRows(result) {
  const columns = result?.columns || [];
  return (result?.values || []).map((row) => Object.fromEntries(columns.map((col, i) => [col, fromSqlValue(row[i])])));
}

/** A result set as a `table` output, showing at most MAX_SHOWN_ROWS rows. */
export function tableOutput(result) {
  const columns = result?.columns || [];
  const values = (result?.values || []).map((row) => row.map(fromSqlValue));
  return { type: 'table', columns, rows: values.slice(0, MAX_SHOWN_ROWS), total: values.length };
}

/** Plain text for a table output, for the model's context and text exports. */
export function tableOutputToText(output, maxRows = 20) {
  const lines = [output.columns.join('\t'), ...output.rows.slice(0, maxRows).map((row) => row.map((v) => (v === null ? 'NULL' : String(v))).join('\t'))];
  if (output.total > maxRows) lines.push(`… ${output.total} rows in all`);
  return lines.join('\n');
}
