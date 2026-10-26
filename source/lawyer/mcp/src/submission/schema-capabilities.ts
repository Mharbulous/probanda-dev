// Which tables and columns a drafting database holds (issue #184), so a reader can keep a database
// held below the current schema readable (forms.ts MIN_READABLE_SCHEMA_VERSION) without naming a
// table or column it lacks. It reads metadata only, and adds no schema.
//
// One snapshot per database path, read from sqlite_master and pragma_table_info. Only a present table
// or column is trusted from the snapshot: no hop drops one, while a database held below a hop can be
// migrated in the same server process. So a miss re-reads the snapshot before answering, and absence
// never outlives a migrate.

import { rows } from "./query-rows.js";

const snapshots = new Map<string, Set<string>>();

function readSnapshot(dbPath: string): Set<string> {
  const held = new Set<string>();
  for (const r of rows<{ tbl: string; col: string | null }>(
    dbPath,
    "SELECT m.name AS tbl, p.name AS col FROM sqlite_master m LEFT JOIN pragma_table_info(m.name) p WHERE m.type = 'table'"
  )) {
    held.add(r.tbl);
    if (r.col !== null) held.add(`${r.tbl}.${r.col}`);
  }
  snapshots.set(dbPath, held);
  return held;
}

function holds(dbPath: string, key: string): boolean {
  if (snapshots.get(dbPath)?.has(key)) return true;
  return readSnapshot(dbPath).has(key);
}

/** Whether the database holds table `table`. */
export function hasTable(dbPath: string, table: string): boolean {
  return holds(dbPath, table);
}

/** Whether the database's table `table` holds column `column`. */
export function hasColumn(dbPath: string, table: string, column: string): boolean {
  return holds(dbPath, `${table}.${column}`);
}

/** Forget every snapshot, or one database's, so the next question reads it afresh. For tests. */
export function resetSchemaCapabilities(dbPath?: string): void {
  if (dbPath === undefined) snapshots.clear();
  else snapshots.delete(dbPath);
}
