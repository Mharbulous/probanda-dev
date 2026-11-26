// The opposing arguments of a proceeding.

import { rows } from "../query-rows.js";
import { hasTable } from "../schema-capabilities.js";


export interface OpposingArgumentRow {
  id: number;
  component: string | null;
  pinpoint: string | null;
  contention: string;
  /** Its live rebuttals (argument_rebuts), in link order. Empty while it needs one (↩️). */
  rebuttals: { id: number; contention: string }[];
}

/** The live opposing arguments raised against us (`arguments`, side 'opposing', not anticipated;
 * schema v82): proceeding-scoped -- an argument carries no filing/round column, and a coverage
 * inventory is meant to read across the whole proceeding, not just this filing. Rendered as a
 * mockup-only "Opposing arguments" section (↩️ is a work marker like any other, so it renders for
 * the human and is stripped from the filed face, filed-face.ts) -- the filed answer to an argument
 * is the responsive submission's own verbatim-quoted anchor, not this inventory. */
export function fetchOpposingArguments(dbPath: string, proceedingId: number): OpposingArgumentRow[] {
  // A database held below v82 has no `arguments` table and no opposing side, so it holds no opposing argument.
  if (!hasTable(dbPath, "arguments")) return [];
  const points = rows<Omit<OpposingArgumentRow, "rebuttals">>(
    dbPath,
    `SELECT id, component, pinpoint, contention FROM arguments
     WHERE proceeding_id = ? AND side = 'opposing' AND anticipated = 0 AND killed_on IS NULL
     ORDER BY ordinal, id`,
    [proceedingId]
  );
  const links = rows<{ argument_id: number; id: number; contention: string }>(
    dbPath,
    `SELECT r.argument_id, a.id, a.contention FROM argument_rebuts r
     JOIN arguments a ON a.id = r.rebuttal_id AND a.killed_on IS NULL
     WHERE a.proceeding_id = ? ORDER BY r.rowid`,
    [proceedingId]
  );
  return points.map((p) => ({ ...p, rebuttals: links.filter((l) => l.argument_id === p.id).map((l) => ({ id: l.id, contention: l.contention })) }));
}
