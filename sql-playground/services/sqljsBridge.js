// sql.js bridge. Lazy-loads the WASM runtime on first use and exposes a
// tiny typed surface: open (from bytes), exec (multi-statement), query (single
// SELECT-like), and export (bytes).

const SQLJS_VERSION = '1.10.3';
const SQLJS_BASE = new URL(`../../shared/lib/sql.js/${SQLJS_VERSION}/dist/`, import.meta.url).href;

let sqlJsPromise = null;

export function loadSqlJs() {
  if (sqlJsPromise) return sqlJsPromise;
  sqlJsPromise = (async () => {
    await new Promise((resolve, reject) => {
      if (window.initSqlJs) return resolve();
      const s = document.createElement('script');
      s.src = `${SQLJS_BASE}sql-wasm.js`;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Failed to load sql.js'));
      document.head.appendChild(s);
    });
    return window.initSqlJs({
      locateFile: (file) => `${SQLJS_BASE}${file}`,
    });
  })();
  return sqlJsPromise;
}

export async function createDb(bytes = null) {
  const SQL = await loadSqlJs();
  return new SQL.Database(bytes || undefined);
}

export function execScript(db, sql) {
  // Runs a multi-statement script; no result set returned.
  db.run(sql);
}

/**
 * Run any SQL and collect the last result set. Returns
 * { columns, rows, rowCount, changes } or throws.
 */
export function runQuery(db, sql, params = []) {
  const stmt = db.prepare(sql, params);
  try {
    const columns = stmt.getColumnNames();
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.get());
    }
    return { columns, rows, rowCount: rows.length };
  } finally {
    stmt.free();
  }
}

/**
 * Run multiple statements sequentially, returning an array of
 * { columns, rows } per statement that produced one (plus `changes` for DML).
 */
export function runScriptWithResults(db, sql) {
  const results = [];
  const stmts = db.exec(sql);
  for (const r of stmts) {
    results.push({ columns: r.columns, rows: r.values });
  }
  return results;
}

export function exportDb(db) {
  return db.export(); // Uint8Array
}

/** Read the schema: tables, columns, foreign keys. */
export function introspect(db) {
  const tables = [];
  const tblRes = runQuery(db, `
    SELECT name, sql FROM sqlite_master
    WHERE type='table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `);
  for (const [name, ddl] of tblRes.rows) {
    let columns = [];
    let foreignKeys = [];
    try {
      const colRes = runQuery(db, `PRAGMA table_info(${quoteIdent(name)})`);
      columns = colRes.rows.map(r => ({
        cid: r[0], name: r[1], type: r[2], notnull: !!r[3], dflt: r[4], pk: !!r[5],
      }));
    } catch {}
    try {
      const fkRes = runQuery(db, `PRAGMA foreign_key_list(${quoteIdent(name)})`);
      foreignKeys = fkRes.rows.map(r => ({
        id: r[0], seq: r[1], fromTable: name, fromColumn: r[3], toTable: r[2], toColumn: r[4],
      }));
    } catch {}
    tables.push({ name, ddl, columns, foreignKeys });
  }
  const indexes = [];
  try {
    const ixRes = runQuery(db, `
      SELECT name, tbl_name, sql FROM sqlite_master
      WHERE type='index' AND name NOT LIKE 'sqlite_%'
      ORDER BY tbl_name, name
    `);
    for (const [name, tbl, ddl] of ixRes.rows) {
      indexes.push({ name, table: tbl, ddl });
    }
  } catch {}
  return { tables, indexes };
}

export function quoteIdent(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

export function quoteValue(v) {
  if (v == null) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  return "'" + String(v).replace(/'/g, "''") + "'";
}

/** Plan: SQLite returns rows of (id, parent, notused, detail). Build tree. */
export function explainPlan(db, sql) {
  const res = runQuery(db, `EXPLAIN QUERY PLAN ${sql}`);
  const byId = new Map();
  const roots = [];
  for (const row of res.rows) {
    const node = { id: row[0], parent: row[1], detail: row[3], children: [] };
    byId.set(node.id, node);
  }
  for (const node of byId.values()) {
    const parent = byId.get(node.parent);
    if (parent) parent.children.push(node); else roots.push(node);
  }
  return roots;
}
