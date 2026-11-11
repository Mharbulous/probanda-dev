// The fingerprint of a judged day (build plan slice 10; spec Part 2, criterion 17). When a date is
// judged, its review_date record saves the day's TimeCamp entries as they were when the blocks were
// judged: id, start, end, task, note. On resume the session passes each judged day's current entries
// to time_review__compare_day, which sends the block of a changed or removed entry back to flagged,
// adds a flagged block for an added entry, and saves the current entries as the new fingerprint.
// Other blocks keep their approvals. The fingerprint is one field on the existing record, so an older
// copy that reads or rewrites the record neither refuses it nor loses it.

import { createHash } from "node:crypto";

import { DataServerError, ValidationError } from "../errors.js";
import type { KvCheck, KvWrite } from "../kv/backend.js";
import {
  REVIEW_DATE_NAMESPACE,
  REVIEW_DATE_PREFIX,
  timePipelineApplyIf,
  timePipelineGet,
  timePipelineList,
  timePipelineWriteIf,
} from "../time-pipeline/backend.js";
import type { ReviewDateSeams } from "../time-pipeline/review-date.js";
import { decideFlags } from "./flags.js";
import {
  BLOCK_PREFIX,
  type BlockRecord,
  type DayEvidenceRecord,
  NAMESPACE,
  blockId,
  blockKey,
  dayEvidenceKey,
  envOf,
  nowOf,
} from "./records.js";

export const ENTRY_SOURCE = "timecamp_time_entries";
const ATTEMPTS = 5;

export interface Entry {
  id: string;
  start: string;
  end: string;
  task: string;
  note: string;
}

export interface Fingerprint {
  taken_at: string;
  sha256: string;
  entries: Entry[];
}

/** The names a TimeCamp row may give each field: the gather step's names, then the store's. */
const ALIASES: Record<keyof Entry, string[]> = {
  id: ["id", "native_id", "entry_id"],
  start: ["start", "start_ts", "start_time"],
  end: ["end", "end_ts", "end_time"],
  task: ["task", "timecamp_task_id", "task_id"],
  note: ["note", "description"],
};

function pick(row: Record<string, unknown>, field: keyof Entry): string {
  for (const name of ALIASES[field]) {
    const value = row[name];
    if (value !== undefined && value !== null) return String(value);
  }
  return "";
}

/** One entry from a row (an evidence row or an entry the session passes). The id is required. */
export function normalizeEntry(label: string, row: unknown): Entry {
  if (typeof row !== "object" || row === null || Array.isArray(row)) throw new ValidationError(`${label} must be an object`);
  const raw = row as Record<string, unknown>;
  const entry: Entry = { id: pick(raw, "id"), start: pick(raw, "start"), end: pick(raw, "end"), task: pick(raw, "task"), note: pick(raw, "note") };
  if (entry.id === "") throw new ValidationError(`${label}: an entry needs an id (id, native_id or entry_id)`);
  return entry;
}

const canon = (e: Entry): string => JSON.stringify([e.id, e.start, e.end, e.task, e.note]);

export function fingerprintOf(entries: Entry[], takenAt: string): Fingerprint {
  const sorted = [...entries].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const sha256 = createHash("sha256").update(sorted.map(canon).join("\n")).digest("hex");
  return { taken_at: takenAt, sha256, entries: sorted };
}

/** The day's TimeCamp entries in its saved evidence, or null where no evidence is saved. */
export function fingerprintOfEvidence(evidenceValue: string | null, takenAt: string): Fingerprint | null {
  if (evidenceValue === null) return null;
  const day = JSON.parse(evidenceValue) as DayEvidenceRecord;
  const entries = day.rows.filter((r) => r.source === ENTRY_SOURCE).map((r, i) => normalizeEntry(`day_evidence row ${i}`, r));
  return fingerprintOf(entries, takenAt);
}

/** The fingerprint to save on judge: from the date's saved evidence, or null if it has none. */
export function fingerprintForJudge(date: string, seams: ReviewDateSeams): Fingerprint | null {
  const { value } = timePipelineGet(NAMESPACE, dayEvidenceKey(date), envOf(seams));
  return fingerprintOfEvidence(value, nowOf(seams).toISOString());
}

export type CompareResult =
  | { status: "not_judged"; date: string }
  | { status: "no_fingerprint"; date: string }
  | { status: "unchanged"; date: string }
  | { status: "changed"; date: string; changed: string[]; added: string[]; removed: string[]; flagged: string[]; new_blocks: string[]; clear: false };

const cites = (b: BlockRecord, id: string): boolean => b.evidence.some((e) => e.source === ENTRY_SOURCE && e.ref === id);

/** Compare a judged day's current TimeCamp entries with its fingerprint. Writes nothing when they
 * match. Otherwise, in one transaction: the block of each changed or removed entry goes back to
 * flagged (its approval kept on the block as `superseded_review`), an added entry, or a changed or
 * removed one that no block cites, gets a new flagged block, and the current entries become the
 * fingerprint, so a second compare reports nothing new. */
export function timeReviewCompareDay(dateIn: unknown, entriesIn: unknown, seams: ReviewDateSeams = {}): CompareResult {
  const tool = "time_review__compare_day";
  const date = typeof dateIn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateIn) ? dateIn : null;
  if (date === null) throw new ValidationError(`${tool}: ${JSON.stringify(dateIn)} is not a date as YYYY-MM-DD`);
  if (!Array.isArray(entriesIn)) throw new ValidationError(`${tool}: entries must be the day's current TimeCamp entries, a list`);
  const current = new Map<string, Entry>();
  entriesIn.forEach((raw, i) => {
    const entry = normalizeEntry(`${tool} entries[${i}]`, raw);
    if (current.has(entry.id)) throw new ValidationError(`${tool}: entry ${entry.id} is listed twice`);
    current.set(entry.id, entry);
  });

  const env = envOf(seams);
  const key = REVIEW_DATE_PREFIX + date;
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const read = timePipelineGet(REVIEW_DATE_NAMESPACE, key, env);
    if (read.value === null) return { status: "not_judged", date };
    const record = JSON.parse(read.value) as Record<string, unknown> & { judged_at?: string | null; fingerprint?: Fingerprint };
    if (!record.judged_at) return { status: "not_judged", date };
    const before = record.fingerprint;
    if (!before) return { status: "no_fingerprint", date };

    const was = new Map(before.entries.map((e) => [e.id, e]));
    const changed = [...current.values()].filter((e) => was.has(e.id) && canon(was.get(e.id) as Entry) !== canon(e)).map((e) => e.id);
    const added = [...current.keys()].filter((id) => !was.has(id));
    const removed = [...was.keys()].filter((id) => !current.has(id));
    if (changed.length + added.length + removed.length === 0) return { status: "unchanged", date };

    const listed = timePipelineList(NAMESPACE, `${BLOCK_PREFIX}${date}:`, env).items;
    const blocks = listed.map((item) => ({ block: JSON.parse(item.value) as BlockRecord, sha256: item.sha256 }));
    const now = nowOf(seams).toISOString();
    const writes: KvWrite[] = [];
    const flagged = new Set<string>();
    const reasons = new Map<string, string>();
    for (const id of changed) reasons.set(id, "recheck:entry_changed");
    for (const id of removed) reasons.set(id, "recheck:entry_removed");

    const touched = new Map<string, BlockRecord>();
    const uncited: string[] = [];
    for (const [id, reason] of reasons) {
      const live = blocks.filter(({ block }) => block.state !== "merged" && block.state !== "split" && cites(block, id));
      if (live.length === 0) uncited.push(id);
      for (const { block } of live) {
        const next: BlockRecord = touched.get(block.id) ?? { ...block };
        if (next.review) {
          next.superseded_review = next.review;
          delete next.review;
          delete next.timecamp;
        }
        next.state = "flagged";
        if (!next.flags.includes(reason)) next.flags = [...next.flags, reason];
        touched.set(block.id, next);
        flagged.add(block.id);
      }
    }
    for (const block of touched.values()) writes.push({ op: "set", namespace: NAMESPACE, key: blockKey(block.id), value: JSON.stringify(block) });

    let index = Math.max(0, ...blocks.map(({ block }) => Number(block.id.slice(date.length + 1)) || 0));
    const newBlocks: string[] = [];
    const addNew = (entry: Entry, reason: string): void => {
      const matter = decideFlags("no_evidence", []);
      const made: BlockRecord = {
        kind: "block",
        id: blockId(date, index),
        date,
        start: entry.start || "unknown",
        end: entry.end || "unknown",
        matter: "Unassigned",
        description: entry.note || `TimeCamp entry ${entry.id}`,
        matter_basis: "no_evidence",
        bill_basis: [],
        flags: [...matter.flags, reason],
        state: "flagged",
        evidence: [{ source: ENTRY_SOURCE, ref: entry.id }],
        links: [],
        staged_at: now,
      };
      index += 1;
      newBlocks.push(made.id);
      writes.push({ op: "set", namespace: NAMESPACE, key: blockKey(made.id), value: JSON.stringify(made) });
    };
    for (const id of added) addNew(current.get(id) as Entry, "recheck:entry_added");
    for (const id of uncited) addNew((current.get(id) ?? was.get(id)) as Entry, reasons.get(id) as string);

    const next = fingerprintOf([...current.values()], now);
    writes.push({ op: "set", namespace: NAMESPACE, key, value: JSON.stringify({ ...record, fingerprint: next }) });
    const checks: KvCheck[] = [
      { namespace: NAMESPACE, key, expect_sha256: read.sha256 as string },
      ...listed.map((item): KvCheck => ({ namespace: NAMESPACE, key: item.key, expect_sha256: item.sha256 })),
    ];
    if ("stale" in timePipelineApplyIf(checks, writes, env)) continue;
    return { status: "changed", date, changed, added, removed, flagged: [...flagged], new_blocks: newBlocks, clear: false };
  }
  throw new DataServerError(`${tool}: ${date} changed ${ATTEMPTS} times while this call was comparing; nothing was written. Try again`, "contended");
}

/** After a write to TimeCamp that was read back, make that entry's current values the fingerprint's,
 * so the practitioner's own correction is not reported as a change on the next resume. */
export function acceptEntry(dateIn: string, entryIn: unknown, seams: ReviewDateSeams = {}): void {
  const entry = normalizeEntry("time_review__record_timecamp entry", entryIn);
  const env = envOf(seams);
  const key = REVIEW_DATE_PREFIX + dateIn;
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const read = timePipelineGet(REVIEW_DATE_NAMESPACE, key, env);
    if (read.value === null) return;
    const record = JSON.parse(read.value) as Record<string, unknown> & { fingerprint?: Fingerprint };
    if (!record.fingerprint) return;
    const entries = [...record.fingerprint.entries.filter((e) => e.id !== entry.id), entry];
    const fingerprint = fingerprintOf(entries, record.fingerprint.taken_at);
    const reply = timePipelineWriteIf(REVIEW_DATE_NAMESPACE, key, JSON.stringify({ ...record, fingerprint }), { expect_sha256: read.sha256 as string }, env);
    if (!("stale" in reply)) return;
  }
  throw new DataServerError(`time_review__record_timecamp: ${dateIn} changed ${ATTEMPTS} times while the entry was being accepted; try again`, "contended");
}
