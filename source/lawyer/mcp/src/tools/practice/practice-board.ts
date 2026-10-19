// practice_data__render_practice_board: writes the Work Board (practice-board-shell.ts) beside
// practice.db from the all-matters sweeps of active_deadlines and open_tasks, and returns its path and
// panel counts, never a date. Each item is placed by its stored date against today's local date; no
// deadline is derived. The sweeps' defaults already leave out met and dismissed deadlines, occurred
// anchors and a not_applicable deadline whose one-shot post-expiry notice has fired. A matter whose
// status is exactly `test` is left out; every other matter, billable or not, is drawn.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DataServerError, ValidationError } from "../../errors.js";
import { resolvePracticeDbPath } from "../../practice/backend.js";
import type { PracticeStore } from "../../practice/store.js";
import {
  PRACTICE_BOARD_FILE,
  PRACTICE_BOARD_MARKER,
  renderPracticeBoardHtml,
  type PracticeBoardData,
  type PracticeBoardItem,
} from "../../submission/forms/practice-board-shell.js";
import { humanise } from "../../submission/matter-dates.js";
import { writeStatusFile } from "../../submission/render-job.js";
import { active_deadlines, open_tasks } from "./reads.js";
import { isBillable } from "./shared.js";

/** How far ahead Coming up reaches, in days (Brahm, 2026-10-14). */
const HORIZON_DAYS = 14;

const text = (value: unknown): string | null => (value === null || value === undefined || value === "" ? null : String(value));

function localDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The Work Board's data as of `now`, which sets today, the horizon and the rendered time. */
export async function buildPracticeBoardData(store: PracticeStore, now: Date): Promise<PracticeBoardData> {
  const today = localDate(now);
  const horizon = localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + HORIZON_DAYS));

  const matterRows = store.rows("matter");
  const matterById = new Map(matterRows.map((row) => [String(row.id), row]));
  const testMatters = new Set(matterRows.filter((row) => row.status === "test").map((row) => String(row.id)));

  const items: PracticeBoardItem[] = [];
  const notes: string[] = [];
  let conflicted = 0;

  const kept = (row: Record<string, unknown>): boolean => !testMatters.has(String(row.matter_id));
  const matterOf = (row: Record<string, unknown>) => {
    const matter = row.matter_id ? matterById.get(String(row.matter_id)) : undefined;
    const ref = [text(row.matt_num), text(row.matter_description)].filter((part) => part !== null).join(" — ");
    return {
      matter: ref === "" ? "No matter" : ref,
      client: text(row.client_name) ?? "No client",
      matter_status: matter ? text(matter.status) : null,
      billable: matter ? isBillable(matter) : true,
    };
  };
  const labelled = (type: unknown, row: Record<string, unknown>): string =>
    [humanise(String(type)), text(row.party_label), text(row.proceeding_label)].filter((part) => part !== null).join(" — ");

  try {
    const dates = await active_deadlines(store, {});
    for (const anchor of dates.anchors.filter(kept)) {
      const isConflicted = anchor.status === "conflicted";
      if (isConflicted) conflicted++;
      items.push({
        kind: "event",
        label: labelled(anchor.anchor_type, anchor),
        date: text(anchor.anchor_date),
        flag: isConflicted ? "Conflicted" : null,
        bf_date: null,
        ...matterOf(anchor),
      });
    }
    for (const deadline of dates.deadlines.filter(kept)) {
      const scenario = text(deadline.scenario_label);
      const review = text(deadline.review_flag);
      items.push({
        kind: "deadline",
        label: labelled(deadline.deadline_type, deadline) + (deadline.status === "not_applicable" ? " (other side)" : ""),
        date: text(deadline.deadline_date),
        flag: scenario !== null ? `Provisional — ${scenario}` : review !== null ? humanise(review) : null,
        bf_date: null,
        ...matterOf(deadline),
      });
    }
  } catch (err) {
    notes.push(`The deadlines and events could not be read: ${(err as Error).message}. None of them is shown.`);
  }

  try {
    const tasks = await open_tasks(store, {});
    for (const task of tasks.rows.filter(kept)) {
      items.push({
        kind: "todo",
        label: text(task.description) ?? "",
        date: text(task.deadline_date),
        flag: null,
        bf_date: text(task.next_nudge_date),
        ...matterOf(task),
      });
    }
  } catch (err) {
    notes.push(`The to-dos could not be read: ${(err as Error).message}. None of them is shown.`);
  }

  // By date, then matter. An undated to-do sorts after every date, by its BF date.
  const sortKey = (i: PracticeBoardItem) => `${i.date ?? "9999"}|${i.date === null ? i.bf_date ?? "9999" : ""}|${i.matter}`;
  items.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

  const panels: PracticeBoardData["panels"] = { overdue: [], due_today: [], coming_up: [], other: [] };
  for (const i of items) {
    if (i.date === null) panels.other.push(i);
    else if (i.date < today) panels.overdue.push(i);
    else if (i.date === today) panels.due_today.push(i);
    else if (i.date <= horizon) panels.coming_up.push(i);
    else panels.other.push(i);
  }

  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    meta: { rendered: `${today} ${pad(now.getHours())}:${pad(now.getMinutes())}`, today, horizon_days: HORIZON_DAYS },
    panels,
    notes,
    conflicted,
    excluded_test_matters: testMatters.size,
  };
}

export async function render_practice_board(store: PracticeStore): Promise<Record<string, unknown>> {
  const data = await buildPracticeBoardData(store, new Date());
  const { panels } = data;

  const file = join(dirname(resolvePracticeDbPath()), PRACTICE_BOARD_FILE);
  if (existsSync(file) && !readFileSync(file, "utf-8").includes(PRACTICE_BOARD_MARKER)) {
    throw new ValidationError(`refusing to overwrite ${file} -- it does not carry the Work Board's marker, so this renderer did not write it`);
  }
  const code = writeStatusFile(file, renderPracticeBoardHtml(data));
  if (code !== null) throw new DataServerError(`could not write ${file}: ${code}`);

  return {
    work_board_path: file,
    counts: {
      overdue: panels.overdue.length,
      due_today: panels.due_today.length,
      coming_up: panels.coming_up.length,
      other: panels.other.length,
      flagged: Object.values(panels).flat().filter((i) => i.flag !== null).length,
      conflicted: data.conflicted,
    },
    excluded_test_matters: data.excluded_test_matters,
    read_failures: data.notes.length,
  };
}
