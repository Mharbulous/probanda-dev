// The Sent write (ADR 0024 D6 "record as sent"; spec §5 "Lifecycle"; plan Phase 15) and the
// pre-send hold (#951 note): drafting_data__record_sent. The /drafting-data gatekeeper
// documents it in filing-checklists.md section 13 "Sent write" and the hold's job in jobs.md
// "Pre-send gate". The SQL here is the runtime's own, as forms/layout-snapshot.ts's is; backend.ts
// keeps its no-table-names contract and lends only the generic write primitive.
//
// Order: refuse what cannot be recorded (a bad argument, a Writing already sent or retired, one
// that is not a general Writing, a recorder who is not an active roster lawyer, a missing signer,
// no stored text, a party whose counsel cannot be read from case data); then the hold, which reads the latest
// render's inventory for the held criteria and never renders, then reads the statute-currency check
// live from the database, last; then the accuracy check of the sent copy against the stored
// text; then one transaction writing the party rows it was sent with (forms/parties-snapshot.ts,
// schema v42), the sent copy's `documents` row, `sent_copy_id`, the signer
// snapshot and `filed_on` (the Sent date), which freezes the exhibits and moves the revision, with
// the Pre-send gate job's step rewrites, waivers and completion and the `Deliver` job's closure. Only the `held` refusal writes
// before that transaction: the job and its steps.
// `layout_snapshot` and `needs_forum_parts` are never written: the v32 layout-freeze trigger
// refuses them in the statement that sets `filed_on`.

import { existsSync } from "node:fs";
import { extname, join } from "node:path";

import { DataServerError, NotFoundError, ValidationError } from "../../errors.js";
import { rosterLawyer, type LawyerAct } from "../../knowledge/tools.js";
import { runPythonDriver } from "../../python-spawn.js";
import { submissionDataMigrateScriptsDir } from "../../repo-root.js";
import { readFirmProfile, type FirmProfile } from "../../tools/practice/firm-profile.js";
import { pythonTimeoutMs, READ_TIMEOUT_MS, submissionDataWriteAll, type WriteStatement } from "../backend.js";
import { readManifest } from "../render-manifest.js";
import { storedLayout, type StoredLayout } from "./layout-snapshot.js";
import type { LayoutPart } from "./projections.js";
import { partiesSnapshotStatements } from "./parties-snapshot.js";
import type { MarkerInventory } from "./proposal-inventory.js";
import { fetchProse, fetchRevision, isJobOnlyBoard, liveTicketClause, type FilingRow } from "./query.js";
import { PRE_SEND_TITLE, unmetAuthorityConfirmedCriterion, unmetCurrencyCriterion, unmetHeldCriteria, unmetPositionConflictCriterion, type GoalCriterion } from "./render-work-board.js";
import { rows } from "../query-rows.js";

const TOOL = "drafting_data__record_sent";
const NOW = "strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')";
const DELIVER_TITLE = "Deliver";
const WAIVER = " — WAIVED: ";
const PRE_SEND_INTENT = "Meet or waive each criterion that holds this Writing back from being recorded as sent.";

export interface RecordSentArgs {
  db_path: string;
  filing_id: number;
  /** The Sent date, YYYY-MM-DD: stored as filed_on. */
  sent_on: string;
  /** The sent copy: a .eml, .pdf or .msg file. Exactly one of this and sent_copy_text. */
  sent_copy_path?: string;
  /** The sent copy as pasted text. */
  sent_copy_text?: string;
  /** The practitioner's words, verbatim, recorded as the WAIVED form on each open Pre-send gate step. */
  send_anyway?: string;
  /** The revision the practitioner approved the act at. */
  expect_revision: number;
}

export interface SentCopyComparison {
  method: "eml" | "pdf" | "text" | "msg";
  compared: boolean;
  missing: string[];
  note?: string;
}

/** One stored paragraph or clause the sent copy lacks: its index in the stored text, and the span
 * of the copy that aligns best with it, or null when no word of it is in the copy. */
interface Mismatch {
  index: number;
  sent: string | null;
}

/** The most differing passages a sent_copy_mismatch refusal lists; it counts the rest. */
const MISMATCH_CAP = 20;

export interface RecordSentResult {
  filing_id: number;
  sent_on: string;
  sent_copy_id: number;
  revision: number;
  recorded_by: string;
  comparison: SentCopyComparison & { paragraphs: number };
  signer_snapshot: Record<string, unknown>;
  /** The Pre-send gate job this write closed, with the held criteria it waived; null when none exists. */
  pre_send_gate: { ticket_id: number; waived: string[] } | null;
  /** The `Deliver` job this write closed, both its steps done; null when none was live. */
  deliver: { ticket_id: number } | null;
  note: string;
  warning?: string;
}

function refused(message: string, code: string, details?: Record<string, unknown>): DataServerError {
  return new DataServerError(`${TOOL}: ${message}`, code, details);
}

/** The refusal of a record_sent, record_filed or record_served call whose expect_revision is not the database's. */
export function revisionMoved(title: string, expected: number, current: number): DataServerError {
  return new DataServerError(
    `"${title}": the drafting records moved from revision ${expected}, where this act was approved, to ${current}; nothing was written. ` +
      "Show the practitioner the Writing as it now stands before asking again",
    "revision_moved"
  );
}

/** Who records a Writing as sent: an active roster lawyer, checked as a confirmation's author is. */
const RECORD_ACT: LawyerAct = { unset: "the Sent write has no recorder", act: "records a Writing as sent", why: "" };

/** The signer's details as sent (#990 item 10): the roster entry of a lawyer signer, or the signing party. */
function signerSnapshot(dbPath: string, filing: FilingRow, profile: FirmProfile): Record<string, unknown> {
  if (filing.signer_party_id !== null) {
    const [party] = rows<{ id: number; name: string; role: string }>(dbPath, "SELECT id, name, role FROM parties WHERE id = ?", [filing.signer_party_id]);
    if (party === undefined) throw refused(`"${filing.title}": its signing party is not in the matter's records`, "invalid_signer");
    return { party_id: party.id, name: party.name, role: party.role };
  }
  if (filing.signer_key === null) throw refused(`"${filing.title}" has no signer; set its signer before recording it as sent`, "invalid_signer");
  const entry = profile.roster.find((candidate) => candidate.key === filing.signer_key);
  if (entry === undefined) throw refused(`"${filing.title}": its signer "${filing.signer_key}" is not on the firm roster`, "invalid_signer");
  return { ...entry };
}

/** The inventory the latest render of this Writing recorded (render-manifest.ts); every mockup
 * render records one. The Sent write never renders: an inventory older than the revision, or none,
 * is refused. */
function latestInventory(dbPath: string, filing: FilingRow, revision: number): MarkerInventory {
  const manifest = readManifest(dbPath, filing.id);
  if (manifest === null || manifest.stamp.filing_id !== filing.id) {
    throw refused(`render first: "${filing.title}" has no mockup to check the sent copy against; render its mockup, then record it as sent again`, "render_first");
  }
  if (manifest.stamp.revision < revision) {
    throw refused(
      `render first: "${filing.title}" changed after its mockup was last rendered; ` +
        "render its mockup, then record it as sent again",
      "render_first"
    );
  }
  return manifest.inventory;
}

interface StepRow {
  ordinal: number;
  text: string;
  done_at: string | null;
}

const RESULT = /^(.*): (?:unmet \(\d+ open\)|met) \[rev \d+\]$/;

/** One Pre-send gate step: the criterion id, its card text, and the result at revision `rev`. */
function unmetStep(c: GoalCriterion, rev: number): string {
  return `${c.id} — ${c.text}: unmet (${c.outstanding} open) [rev ${rev}]`;
}

/** The Pre-send gate job as a SQL expression, with its parameters, for a statement to name it by. */
interface JobRef {
  sql: string;
  params: unknown[];
}

/** The writes that bring the Writing's Pre-send gate job into line with the held criteria. */
interface GatePlan {
  /** The live job's id; null when there is none, including when `statements` create it. */
  live: number | null;
  /** The job, live or created by `statements`; null when none is live and nothing is held. */
  job: JobRef | null;
  statements: WriteStatement[];
}

/** A live job by filing and title. A deleted job (jobs-closeout.md §10a) is never rewritten or completed here. */
const liveJobSql = (dbPath: string): string => `SELECT id FROM tickets WHERE filing_id = ? AND title = ? AND status IN ('queued', 'wip')${liveTicketClause(dbPath)} ORDER BY id`;

/**
 * Plans the writes that bring the Writing's Pre-send gate job into line with the held criteria unmet
 * now (jobs.md §14a): create it, one step per unmet criterion, when none is live and one is unmet;
 * otherwise rewrite each step that is not waived, `unmet` while its criterion is and `met` with
 * `done_at` once it is not, and add a step for a criterion newly unmet. Reads only: the caller
 * writes the statements, on the `held` refusal alone or in the Sent write's transaction. Ticket
 * writes move no revision.
 */
function planPreSendGate(dbPath: string, filing: FilingRow, held: GoalCriterion[], rev: number): GatePlan {
  const live = rows<{ id: number }>(dbPath, liveJobSql(dbPath), [filing.id, PRE_SEND_TITLE]);
  if (live.length === 0) {
    if (held.length === 0) return { live: null, job: null, statements: [] };
    const [anchor] = rows<{ billing_anchor: string }>(
      dbPath,
      "SELECT billing_anchor FROM tickets WHERE filing_id = ? AND billing_anchor IS NOT NULL ORDER BY (title = 'Deliver') DESC, id DESC LIMIT 1",
      [filing.id]
    );
    if (anchor === undefined) {
      throw refused(`no job on "${filing.title}"'s Work Board says what to bill the Pre-send gate job to; a letter's Deliver job, written when it is saved, says it`, "no_billing_anchor");
    }
    const notDeleted = liveTicketClause(dbPath);
    const job: JobRef = { sql: `(SELECT id FROM tickets WHERE filing_id = ? AND title = ? AND status IN ('queued', 'wip')${notDeleted})`, params: [filing.id, PRE_SEND_TITLE] };
    const statements: WriteStatement[] = [
      {
        sql:
          `INSERT INTO tickets (proceeding_id, filing_id, title, intent, kind, priority, billing_anchor, created) ` +
          `SELECT ?, ?, ?, ?, 'work', (SELECT COALESCE(MAX(priority), 0) + 1 FROM tickets WHERE filing_id = ?), ?, ${NOW} ` +
          `WHERE NOT EXISTS (SELECT 1 FROM tickets WHERE filing_id = ? AND title = ? AND status IN ('queued', 'wip')${notDeleted})`,
        params: [filing.proceeding_id, filing.id, PRE_SEND_TITLE, PRE_SEND_INTENT, filing.id, anchor.billing_anchor, filing.id, PRE_SEND_TITLE],
        expect_changes: 1,
      },
      ...held.map((c, i) => ({
        sql: `INSERT INTO ticket_steps (ticket_id, ordinal, text) VALUES (${job.sql}, ?, ?)`,
        params: [...job.params, i + 1, unmetStep(c, rev)],
      })),
    ];
    return { live: null, job, statements };
  }

  const ticketId = live[0].id;
  const steps = rows<StepRow>(dbPath, "SELECT ordinal, text, done_at FROM ticket_steps WHERE ticket_id = ? ORDER BY ordinal", [ticketId]);
  const byId = new Map(held.map((c) => [c.id as string, c]));
  const statements: WriteStatement[] = [];
  const stepped = new Set<string>();
  for (const step of steps) {
    const id = step.text.split(" — ")[0];
    stepped.add(id);
    const label = RESULT.exec(step.text)?.[1];
    // A waived step is never rewritten (jobs.md §14), nor one this write did not author.
    if (step.text.includes(WAIVER) || label === undefined) continue;
    const c = byId.get(id);
    statements.push(
      c === undefined
        ? { sql: `UPDATE ticket_steps SET text = ?, done_at = ${NOW} WHERE ticket_id = ? AND ordinal = ?`, params: [`${label}: met [rev ${rev}]`, ticketId, step.ordinal] }
        : { sql: "UPDATE ticket_steps SET text = ?, done_at = NULL WHERE ticket_id = ? AND ordinal = ?", params: [unmetStep(c, rev), ticketId, step.ordinal] }
    );
  }
  let next = Math.max(0, ...steps.map((s) => s.ordinal));
  for (const c of held.filter((h) => !stepped.has(h.id))) {
    statements.push({ sql: "INSERT INTO ticket_steps (ticket_id, ordinal, text) VALUES (?, ?, ?)", params: [ticketId, ++next, unmetStep(c, rev)] });
  }
  return { live: ticketId, job: { sql: "?", params: [ticketId] }, statements };
}

function gateChanged(filing: FilingRow): DataServerError {
  return refused(`"${filing.title}": its Pre-send gate job changed while it was being recorded; nothing was written. Record it as sent again`, "pre_send_gate_changed");
}

/** One paragraph or clause of the stored text, with the part it came from, e.g. `slot:body, paragraph 2`. */
interface StoredParagraph {
  part: string;
  text: string;
}

/** The stored text the sent copy is checked against, in part order: each paragraph of a
 * `slot:<name>` part's prose row, and each clause of a `terms` part in `filing_clauses` order, as
 * its `wording_override` when set, else its wording (the text the `terms` projection prints). */
function storedParagraphs(dbPath: string, filing: FilingRow, stored: StoredLayout): StoredParagraph[] {
  const prose = fetchProse(dbPath, filing.id);
  const clauses = () =>
    rows<{ wording: string }>(
      dbPath,
      "SELECT COALESCE(fc.wording_override, c.wording) AS wording FROM filing_clauses fc JOIN clauses c ON c.id = fc.clause_id WHERE fc.filing_id = ? ORDER BY fc.ordinal",
      [filing.id]
    ).map((c) => c.wording);
  return (stored.layout.parts as LayoutPart[]).flatMap((part) => {
    const texts = part.source === "terms" ? clauses() : part.source.startsWith("slot:") ? (prose.get(part.source.slice("slot:".length))?.text ?? "").split(/\r?\n\s*\r?\n/) : [];
    const unit = part.source === "terms" ? "clause" : "paragraph";
    return texts
      .map((p) => p.trim())
      .filter((p) => p !== "")
      .map((text, i) => ({ part: `${part.source}, ${unit} ${i + 1}`, text }));
  });
}

/** The accuracy check (D6), by sent_copy_compare.py through the runtime's Python driver. */
function compareSentCopy(paragraphs: string[], args: RecordSentArgs, env: NodeJS.ProcessEnv): SentCopyComparison & { mismatches: Mismatch[] } {
  return runPythonDriver({
    label: "sent-copy comparison",
    driver: join(submissionDataMigrateScriptsDir(env), "sent_copy_compare.py"),
    payload: JSON.stringify({ paragraphs, path: args.sent_copy_path ?? null, text: args.sent_copy_text ?? null }),
    env,
    timeoutMs: pythonTimeoutMs(env, READ_TIMEOUT_MS),
  }) as SentCopyComparison & { mismatches: Mismatch[] };
}

/** A calendar date written YYYY-MM-DD: its components must round-trip through a UTC date, so
 * 2026-02-31 is refused rather than rolled over. */
export function isCalendarDate(text: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match === null) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function checkArgs(args: RecordSentArgs): void {
  if (!isCalendarDate(args.sent_on)) {
    throw new ValidationError(`${TOOL}.sent_on must be a calendar date, YYYY-MM-DD`, "invalid_sent_on");
  }
  if ((args.sent_copy_path === undefined) === (args.sent_copy_text === undefined)) {
    throw new ValidationError(`${TOOL} takes exactly one of sent_copy_path and sent_copy_text`, "invalid_sent_copy");
  }
  if (args.sent_copy_path !== undefined) {
    if (![".eml", ".pdf", ".msg"].includes(extname(args.sent_copy_path).toLowerCase())) {
      throw new ValidationError(`${TOOL}.sent_copy_path must be a .eml, .pdf or .msg file: ${args.sent_copy_path}`, "invalid_sent_copy");
    }
    if (!existsSync(args.sent_copy_path)) throw new ValidationError(`${TOOL}.sent_copy_path does not exist: ${args.sent_copy_path}`, "invalid_sent_copy");
  }
  if (args.send_anyway !== undefined && args.send_anyway.trim() === "") {
    throw new ValidationError(`${TOOL}.send_anyway must carry the practitioner's own words`, "invalid_send_anyway");
  }
}

/** drafting_data__record_sent: the Sent write and its pre-send hold. Refusals write nothing,
 * bar the `held` refusal, which leaves the Pre-send gate job naming what holds sending. */
export async function submissionDataRecordSent(args: RecordSentArgs, env: NodeJS.ProcessEnv = process.env): Promise<RecordSentResult> {
  checkArgs(args);
  const [filing] = rows<FilingRow>(args.db_path, "SELECT * FROM filings WHERE id = ?", [args.filing_id]);
  if (filing === undefined) throw new NotFoundError("That Writing is not in this matter's drafting records", "not_found");
  if (isJobOnlyBoard(filing)) throw refused(`Work Board ${filing.id} has no Writing, so there is nothing to record as sent`, "milestone_only");
  if (filing.retired_on) throw refused(`"${filing.title}" was retired on ${filing.retired_on}`, "writing_retired");
  if (filing.filed_on) throw refused(`"${filing.title}" was already recorded as sent or filed on ${filing.filed_on}`, "already_sent");
  const stored = filing.layout_snapshot === null ? null : storedLayout(filing);
  if (stored === null || stored.layout.renderer !== "general") {
    throw refused(`"${filing.title}" is a court form, not a letter or general document; record its filing date as filed, not as sent`, "not_a_general_writing");
  }
  const profile = readFirmProfile(env);
  const recordedBy = rosterLawyer(profile, RECORD_ACT);
  const signer = signerSnapshot(args.db_path, filing, profile);
  const revision = fetchRevision(args.db_path);
  if (revision !== args.expect_revision) throw revisionMoved(filing.title, args.expect_revision, revision);
  const paragraphs = storedParagraphs(args.db_path, filing, stored);
  if (paragraphs.length === 0) {
    throw refused(
      `"${filing.title}" has no saved text: none of its parts holds a paragraph or a clause, so there is nothing to check the sent copy against. ` +
        "Save the text that was sent into it, then record it as sent again",
      "no_stored_text"
    );
  }
  // The party rows it is sent with, read from case data now: refused, writing nothing, while a party drifts.
  const snapshot = partiesSnapshotStatements(args.db_path, filing, TOOL, env);

  // The hold (#951 note; a venue's letter included, #1236): every Writing this tool records is a general one.
  const held = unmetHeldCriteria(args.db_path, filing, latestInventory(args.db_path, filing, revision));
  // The currency check comes last, read live after render_first (jobs.md §14a).
  const currency = unmetCurrencyCriterion(args.db_path, filing);
  if (currency !== null) held.push(currency);
  // Then the authority-confirmed check, read from the row just loaded (#1231).
  const confirmed = unmetAuthorityConfirmedCriterion(filing);
  if (confirmed !== null) held.push(confirmed);
  // Then the position-conflict check: an open Pass 2 finding job (jobs-stock.md §3g).
  const conflict = unmetPositionConflictCriterion(args.db_path, filing);
  if (conflict !== null) held.push(conflict);
  const gate = planPreSendGate(args.db_path, filing, held, revision);
  if (held.length > 0 && args.send_anyway === undefined) {
    // The one refusal that writes: the job names what holds sending (jobs.md §14a).
    if (gate.statements.length > 0 && !(await submissionDataWriteAll(args.db_path, gate.statements, env)).ok) throw gateChanged(filing);
    const jobId = gate.live ?? rows<{ id: number }>(args.db_path, liveJobSql(args.db_path), [filing.id, PRE_SEND_TITLE])[0].id;
    throw refused(
      `sending is held: ${held.map((c) => `${c.id} (${c.items.join("; ")})`).join(", ")} unmet now. ` +
        `Pre-send gate job ${jobId} names each; meet them and render again, or record it as sent with send_anyway carrying the practitioner's words`,
      "held"
    );
  }

  const { mismatches, ...comparison } = compareSentCopy(paragraphs.map((p) => p.text), args, env);
  if (comparison.missing.length > 0) {
    // Each passage in full, beside the span of the copy that aligns best with it.
    const passages = mismatches.slice(0, MISMATCH_CAP).map((m) => ({ part: paragraphs[m.index].part, stored: paragraphs[m.index].text, sent: m.sent }));
    const unlisted = comparison.missing.length - passages.length;
    throw refused(
      `the sent copy does not contain ${comparison.missing.length} paragraph(s) or clause(s) of the stored text:\n` +
        passages
          .map((p, i) => `${i + 1}. ${p.part}\n   stored: ${JSON.stringify(p.stored)}\n   closest in the sent copy: ${p.sent === null ? "none" : JSON.stringify(p.sent)}`)
          .join("\n") +
        (unlisted > 0 ? `\n${unlisted} more not listed.` : "") +
        "\nCorrect the stored text to what was sent, or pass the copy actually sent",
      "sent_copy_mismatch",
      { passages, unlisted }
    );
  }

  const describe =
    comparison.method === "msg"
      ? "sent copy (.msg), recorded by path and not compared"
      : `sent copy (${comparison.method === "text" ? "pasted text" : `.${comparison.method}`}), compared with the stored text`;
  const statements: WriteStatement[] = [
    // The revision guard: nothing has moved since the hold read the inventory and the check read the text.
    { sql: "UPDATE db_meta SET value = value WHERE key = 'revision' AND CAST(value AS INTEGER) = ?", params: [revision], expect_changes: 1 },
    // Before the statement that sets filed_on, which the v42 guard refuses while the Writing has none.
    ...snapshot,
    {
      sql: "INSERT INTO documents (proceeding_id, label, document_date, description, file_path) VALUES (?, ?, ?, ?, ?)",
      params: [filing.proceeding_id, `Sent copy — ${filing.title}`, args.sent_on, `${describe}; recorded by ${recordedBy}`, args.sent_copy_path ?? null],
      expect_changes: 1,
    },
    {
      // The documents row inserted just above.
      sql: "UPDATE filings SET sent_copy_id = last_insert_rowid(), signer_snapshot = ?, filed_on = ? WHERE id = ? AND filed_on IS NULL AND retired_on IS NULL",
      params: [JSON.stringify(signer), args.sent_on, filing.id],
      expect_changes: 1,
    },
  ];
  // The last statement that can fail because another session recorded this Writing: a party row it
  // wrote (UNIQUE per Writing and party), or the Writing's own filed_on or retired_on.
  const recordedAt = statements.length - 1;
  // The gate job's writes join the same transaction (jobs.md §14a): its steps rewritten, or the job
  // created with them, then each open step waived when something is held, then the job completed.
  const waived = held.map((c) => c.id as string);
  if (gate.job !== null) {
    const job = gate.job;
    statements.push(...gate.statements);
    if (waived.length > 0) {
      statements.push({
        sql: `UPDATE ticket_steps SET text = text || ? || ?, done_at = ${NOW} WHERE ticket_id = ${job.sql} AND done_at IS NULL AND text NOT LIKE '% — WAIVED: %'`,
        params: [WAIVER, args.send_anyway, ...job.params],
      });
    }
    statements.push({
      sql:
        `UPDATE tickets SET status = 'completed', completed_at = ${NOW} WHERE id = ${job.sql} AND status IN ('queued', 'wip') ` +
        `AND NOT EXISTS (SELECT 1 FROM ticket_steps WHERE ticket_id = ${job.sql} AND done_at IS NULL)`,
      params: [...job.params, ...job.params],
      expect_changes: 1,
    });
  }
  // The Writing's live `Deliver` job closes in the same transaction (jobs.md §3b): a recorded sent
  // copy is the evidence that the send happened, so both steps are done. A job already completed or
  // superseded matches nothing and is left as it stands, as is a shelved one (jobs.md §10a).
  const deliverId =
    rows<{ id: number }>(args.db_path, `${liveJobSql(args.db_path).replace("ORDER BY", "AND rejected_at IS NULL ORDER BY")}`, [filing.id, DELIVER_TITLE])[0]?.id ?? null;
  if (deliverId !== null) {
    const live = "status IN ('queued', 'wip') AND rejected_at IS NULL";
    statements.push(
      { sql: `UPDATE ticket_steps SET done_at = ${NOW} WHERE ticket_id = ? AND done_at IS NULL AND ticket_id IN (SELECT id FROM tickets WHERE id = ? AND ${live})`, params: [deliverId, deliverId] },
      { sql: `UPDATE tickets SET status = 'completed', completed_at = ${NOW}, locked_by = NULL, locked_at = NULL WHERE id = ? AND ${live}`, params: [deliverId] }
    );
  }
  const written = await submissionDataWriteAll(args.db_path, statements, env);
  if (!written.ok) {
    if (written.failed === 0) {
      throw refused(`"${filing.title}" changed while it was being recorded; render first, then record it as sent again`, "render_first");
    }
    if (written.failed <= recordedAt) throw refused(`"${filing.title}" was sent or retired while it was being recorded; nothing was written`, "already_sent");
    throw gateChanged(filing);
  }
  const gateJob =
    gate.job === null ? null : (gate.live ?? rows<{ id: number }>(args.db_path, "SELECT id FROM tickets WHERE filing_id = ? AND title = ? ORDER BY id DESC LIMIT 1", [filing.id, PRE_SEND_TITLE])[0].id);

  const unused = args.send_anyway !== undefined && waived.length === 0 ? " Nothing held sending, so the send_anyway words were not recorded." : "";
  const [after] = rows<{ sent_copy_id: number }>(args.db_path, "SELECT sent_copy_id FROM filings WHERE id = ?", [filing.id]);
  return {
    filing_id: filing.id,
    sent_on: args.sent_on,
    sent_copy_id: after.sent_copy_id,
    revision: fetchRevision(args.db_path),
    recorded_by: recordedBy,
    comparison: { ...comparison, paragraphs: paragraphs.length },
    signer_snapshot: signer,
    pre_send_gate: gateJob === null ? null : { ticket_id: gateJob, waived },
    // Null when another session finished the job between the read and the write.
    deliver: deliverId === null || written.results[written.results.length - 1].changes === 0 ? null : { ticket_id: deliverId },
    note:
      `"${filing.title}" recorded as sent on ${args.sent_on}; its exhibits are frozen.` +
      (comparison.note ? ` ${comparison.note}.` : "") +
      unused,
    ...(written.warning ? { warning: written.warning } : {}),
  };
}
