// The Litigation Strategy's to-dos (ADR 0021 D1): the matter's open task-registry rows, read through the
// practice gatekeeper's own tool, practice_data__open_tasks, the way open_session looks the matter
// up. This is the one place a registry row becomes page data, and each to-do is built field by
// field: a row's deadline_date (ADR 0013, ADR 0021 D2) goes no further than this function. Nothing
// here writes, so the nudge fields stay task-prioritization's to advance.

import type { PracticeStore } from "../practice/store.js";
import { open_tasks } from "../tools/practice/reads.js";

/** One open registry row, as much of it as the Litigation Strategy draws. */
export interface MatterTodo {
  id: string;
  description: string;
  /** The row's next_nudge_date: when to start, never time remaining (ADR 0021 D2). */
  bf_date: string | null;
  /** `filing:<id>` or `proceeding:<id>` in this matter's submission database (ADR 0021 D5). */
  filing_ref: string | null;
}

/** The matter's to-dos, or why none were read. A page that could not read the registry says so. */
export type MatterTodos = { rows: MatterTodo[] } | { note: string };

const text = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));

export async function readMatterTodos(practiceDb: PracticeStore, matterNo: string | undefined): Promise<MatterTodos> {
  if (matterNo === undefined) return { note: "No matter number was given, so this matter's to-dos were not read." };
  let rows: Record<string, unknown>[];
  try {
    rows = (await open_tasks(practiceDb, { matt_num: matterNo })).rows;
  } catch (err) {
    return { note: `This matter's to-dos could not be read (${matterNo}): ${(err as Error).message}` };
  }
  return {
    rows: rows.map((row) => ({
      id: String(row.id),
      description: text(row.description) ?? "",
      bf_date: text(row.next_nudge_date),
      filing_ref: text(row.filing_ref),
    })),
  };
}
