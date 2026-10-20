// The housekeeping approval page's placeholder fixture (map #125, #141): hand-written synthetic data for
// a fixture-mode preview, the proposal and approval renderApprovalPage takes. It ships in file-manager's
// files bundle, so it holds no machine path and no real person, entity or matter (#140): matter_root is
// a bare folder name, which is all the page shows of it. It holds every action kind and every section.

import type { Approval, Proposal, Row } from "./proposal.js";

const HASH = "0".repeat(64);

const row = (row_id: string, current_path: string, extra: Partial<Row>): Row => ({
  row_id,
  current_path,
  hash: HASH,
  ingest_outcome: "ingested",
  source_ids: [],
  section: "offered",
  name_checks: [],
  notes: [],
  ...extra,
});

const proposal: Proposal = {
  run_id: "20260115-090000-fixture",
  matter_root: "Ashbourne L4801",
  created_at: "2026-01-15T17:00:00.000Z",
  header: { open_in_word: ["Draft reply.docx"], folders_not_looked_inside: ["9. ARCHIVE"], finished_line: "Finished 11 files." },
  folders: [
    { path: "3. CORRESPONDENCE", exists: true },
    { path: "4. PLEADINGS", exists: true },
    { path: "6. LAW", exists: false, flag_tokens: ["SCC", "BCCA"], second_pass: true },
  ],
  draft_folder: "0. DRAFT",
  rows: [
    row("r1", "scan0001.pdf", { action: { kind: "file", name: "2026-01-05 LF Sample re Settlement offer.pdf", folder: "3. CORRESPONDENCE" }, name_checks: [{ name: "2026-01-05 LF Sample re Settlement offer.pdf", folder: "3. CORRESPONDENCE", ok: true }] }),
    row("r2", "3. CORRESPONDENCE\\letter.pdf", { action: { kind: "rename", name: "2026-01-06 LT Example re Document production.pdf" } }),
    row("r3", "Response to civil claim.pdf", { action: { kind: "move", folder: "4. PLEADINGS", file_no_ingest: true } }),
    row("r4", "6. LAW\\case.pdf", { action: { kind: "file", name: "Sample v Example 2019 BCSC 0000.pdf", folder: "6. LAW", create_folder: true }, store: "law" }),
    row("r5", "Draft reply v2.docx", { action: { kind: "draft" } }),
    row("r6", "scan0002.pdf", { action: { kind: "duplicate" }, twin: { path: "3. CORRESPONDENCE\\2026-01-05 LF Sample re Settlement offer.pdf", row_id: "r1", ingested: true } }),
    row("r7", "Invoice 0001.pdf", { action: { kind: "misfiled", matter: "L4802" } }),
    row("r8", "photo.heic", { action: { kind: "unreadable" }, ingest_outcome: "failed" }),
    row("r9", "notes.txt", { action: { kind: "stuck", reason: "No naming rule covers a plain-text note." } }),
    row("r10", "Statement of account.pdf", { action: { kind: "file", name: "2026-01-08 Statement of account.pdf", folder: "3. CORRESPONDENCE", answer: "Counterclaim", final: true }, ingest_outcome: "stopped" }),
    row("r11", "3. CORRESPONDENCE\\privileged memo.pdf", { section: "ingested_only", store: "privileged", notes: ["Stored as privileged."] }),
    row("r12", "large bundle.pdf", { section: "deferred", ingest_outcome: "none", notes: ["Deferred to the next run."] }),
  ],
  rule_gaps: [],
};

const approval: Approval = { run_id: proposal.run_id, approved_at: "2026-01-15T17:05:00.000Z", rows: [{ row_id: "r1", approve: true }, { row_id: "r3", approve: true }] };

/** The page before approval (approval null) and after, as renderApprovalPage draws each. */
export const HOUSEKEEPING_FIXTURE: { proposal: Proposal; approval: Approval } = { proposal, approval };
