// runnerSql — runs SQL cells with sql.js (SQLite compiled to WebAssembly).
// The rules are in services/sqlCell.js; this file owns the database.

import { resultToRows, saveKey, tableOutput, tablesFromValues, tableSql } from './sqlCell.js';

const SQLJS_BASE = new URL('../../shared/lib/sql.js/1.10.3/dist/', import.meta.url).href;

let sqlJsPromise = null;
let dbPromise = null;
// Tables built from nb, so ones whose nb value has gone can be dropped.
let tablesFromNb = new Set();

function loadSqlJs() {
  if (sqlJsPromise) return sqlJsPromise;
  sqlJsPromise = (async () => {
    if (!window.initSqlJs) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `${SQLJS_BASE}sql-wasm.js`;
        script.onload = resolve;
        script.onerror = () => reject(new Error('Could not load the SQL engine (sql.js)'));
        document.head.appendChild(script);
      });
    }
    return window.initSqlJs({ locateFile: (file) => `${SQLJS_BASE}${file}` });
  })().catch((error) => { sqlJsPromise = null; throw error; });
  return sqlJsPromise;
}

/** The notebook's database: one per page, so tables last from cell to cell. */
async function database() {
  if (!dbPromise) dbPromise = loadSqlJs().then((SQL) => new SQL.Database());
  return dbPromise;
}

/** Start again with an empty database (a new notebook opened, say). */
export function resetSqlDatabase() {
  dbPromise?.then((db) => db.close()).catch(() => {});
  dbPromise = null;
  tablesFromNb = new Set();
}

function loadTables(db, values) {
  const tables = tablesFromValues(values);
  const now = new Set(tables.map((t) => t.name));
  db.run('BEGIN');
  try {
    for (const name of tablesFromNb) {
      if (!now.has(name)) db.run(tableSql({ name, columns: [] }).drop);
    }
    for (const table of tables) {
      const sql = tableSql(table);
      db.run(sql.drop);
      db.run(sql.create);
      const insert = db.prepare(sql.insert);
      try {
        for (const row of table.rows) insert.run(row);
      } finally {
        insert.free();
      }
    }
    db.run('COMMIT');
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  }
  tablesFromNb = now;
  return tables;
}

export async function runSql(source, bridge) {
  try {
    const db = await database();
    const tables = loadTables(db, bridge.snapshot());
    const results = db.exec(source);
    const outputs = [];
    if (results.length === 0) {
      const changed = db.getRowsModified();
      outputs.push({ type: 'text', value: changed ? `Done: ${changed} row${changed === 1 ? '' : 's'} changed.` : 'Done.' });
    }
    for (const result of results) outputs.push(tableOutput(result));

    const key = saveKey(source);
    if (key) {
      if (results.length) {
        const rows = resultToRows(results[results.length - 1]);
        bridge.setValue(key, rows);
        outputs.push({ type: 'text', value: `Saved ${rows.length} row${rows.length === 1 ? '' : 's'} as nb.${key}` });
      } else {
        outputs.push({ type: 'text', role: 'stderr', value: `Nothing to save as nb.${key}: the SQL returned no rows.` });
      }
    }
    return { ok: true, outputs, metadata: { runtimeKind: 'wasm', tables: tables.map((t) => t.name) } };
  } catch (error) {
    return { ok: false, outputs: [], error: error.message || String(error) };
  }
}
