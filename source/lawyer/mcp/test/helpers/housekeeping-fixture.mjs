// Synthetic matter trees for the /housekeeping tool tests. Never a live matter.

import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

export const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

const MATTER_DIRS = ["0. DRAFT", "3. CORRESPONDENCE", "4. LAWYER BRIEF", "6. LAW", "TRASH"];
const TEMPLATE_DIRS = [
  "0. DRAFT",
  "2. SOLICITOR CLIENT",
  "3. CORRESPONDENCE",
  "4. LAWYER BRIEF",
  "5. COURT FILE#",
  "6. LAW",
  "7. DISCOVERY/LOD Plaintiff/Party #1",
  "9. DISBURSEMENTS",
];

/**
 * A throwaway matter (a coclerk.json naming its matter-data folder, standard folders, `files`) beside
 * that matter-data folder and a throwaway template tree.
 */
export function matterFixture(files = {}, { dirs = MATTER_DIRS } = {}) {
  const base = mkdtempSync(join(tmpdir(), "coclerk-hk-"));
  const root = join(base, "Matter");
  const caseData = join(base, "Matter case data");
  const template = join(base, "template");
  mkdirSync(root);
  mkdirSync(caseData);
  writeFileSync(join(caseData, "main.sqlite"), "");
  writeFileSync(join(root, "coclerk.json"), JSON.stringify({ schema_version: 5, matter_root: root, case_data_dir: caseData }));
  for (const d of dirs) mkdirSync(join(root, ...d.split("/")), { recursive: true });
  for (const d of TEMPLATE_DIRS) mkdirSync(join(template, ...d.split("/")), { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return {
    base,
    root,
    caseData,
    template,
    at: (rel) => join(root, ...rel.split(/[\\/]/)),
    env: { ...process.env, COCLERK_HOUSEKEEPING_TEMPLATE_ROOT: template },
    cleanup: () => rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }),
  };
}

/** An offered row for the file at `rel` (backslash or slash separators), overridable field by field. */
export function row(m, rel, overrides = {}) {
  const current = rel.replace(/\//g, "\\");
  return {
    row_id: overrides.row_id ?? basename(current).replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 60),
    current_path: current,
    hash: sha(m.at(rel)),
    ingest_outcome: "ingested",
    source_ids: [1],
    section: "offered",
    action: { kind: "stuck", reason: "no proposal" },
    name_checks: [],
    notes: [],
    ...overrides,
  };
}

/**
 * The rows in the order write_run_file requires when none of them rotates: root files by name,
 * then subfolder files by folder, then name, lowercased (spec §B3.4).
 */
export function inRunOrder(rows) {
  const key = (r) => {
    const path = r.current_path.replace(/\//g, "\\").toLowerCase();
    const cut = path.lastIndexOf("\\");
    return [cut < 0 ? 0 : 1, cut < 0 ? "" : path.slice(0, cut).replace(/\\/g, "\0"), path.slice(cut + 1)];
  };
  const compare = (a, b) => {
    const [ka, kb] = [key(a), key(b)];
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
    return 0;
  };
  return [...rows].sort(compare);
}

/** A proposal whose rows are put in run order (inRunOrder); `extra.rows` is taken as given. */
export function proposalFor(m, runId, rows, extra = {}) {
  rows = inRunOrder(rows);
  return {
    run_id: runId,
    matter_root: m.root,
    created_at: "2026-09-24T20:40:13.000Z",
    header: { open_in_word: [], folders_not_looked_inside: [] },
    folders: [
      { path: "3. CORRESPONDENCE", exists: true },
      { path: "4. LAWYER BRIEF", exists: true },
      { path: "6. LAW", exists: true, second_pass: true, flag_tokens: ["Ltd", "Inc"] },
    ],
    draft_folder: "0. DRAFT",
    rows,
    rule_gaps: [],
    ...extra,
  };
}

export function runDir(m, runId) {
  return join(m.caseData, "housekeeping", runId);
}

/** Writes approval.json straight into the run, as the page server would. */
export function writeApproval(m, runId, rows) {
  writeFileSync(join(runDir(m, runId), "approval.json"), JSON.stringify({ run_id: runId, approved_at: "2026-09-24T21:00:00.000Z", rows }));
}

export function codeOf(fn) {
  try {
    fn();
  } catch (err) {
    return err.code;
  }
  throw new Error("expected a throw, got none");
}
