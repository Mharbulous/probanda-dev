// A client letter's Word review draft, end to end on a real .docx filled from an invented letterhead:
// the firm folder is reached through the firm profile with no grant, drafting_data__attach_to_board
// takes the file, the board reads the hold from inside it (pending, then approved), write_email refuses
// it as an attachment while held, and none of its text reaches the database. /draft letters.md section 10.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import { startFakeCloud } from "./helpers/fake-cloud.mjs";

const { callTool, createDispatchContext } = await import("../build/index.js");
const { awaitBackgroundJobs } = await import("../build/submission/render-job.js");
const { closePageServer } = await import("../build/housekeeping/server.js");
const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataQuery } = await import("../build/submission/backend.js");
const { fetchProceeding } = await import("../build/submission/forms/query.js");
const { buildPreFilingBoardData } = await import("../build/submission/forms/render-work-board.js");
const { attachedDrafts, reviewStatus } = await import("../build/submission/board-attachments.js");
const { draftHarness } = await import("../build/submission/draft-harness.js");
const { submissionFormsBoardCard } = await import("../build/submission/matter-pages.js");

after(() => closePageServer());

const PYTHON = process.env.COCLERK_PYTHON || "python";
const PUBLISH_TESTS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", ".claude", "skills", "publish", "tests");
const STEM = "2026-11-03 LET Client re invented award";
const ADVICE = "Invented advice that must never reach a database";
const TOKEN = "sess-client-letter-word";
const META = { revision: 1, matter: "L9999", client: "Larchmont", rendered: "2026-11-03 12:00" };
const LAWYER = { key: "pe", name: "Pat Example", designation: "Lawyer", role: "lawyer", email: "pat@example.com", direct_line: "555-0100", closing: "Yours truly,", initials: "PE", active: true };
const STAFF = { key: "ss", name: "Sam Staff", designation: "Assistant", role: "staff", email: "sam@example.com", direct_line: "555-0101", closing: "Yours truly,", initials: "ss", active: true };
const LETTER = { signer: "pe", file_number: "9999.T001", date: "November 3, 2026", recipient: ["Invented Client", "1 Any Street"], salutation: "Dear Invented Client,", re: ["Invented award"], body: [ADVICE] };

async function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), "coclerk-client-letter-word-"));
  t.after(async () => {
    await awaitBackgroundJobs();
    rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  const root = join(base, "L9999 Test Matter");
  mkdirSync(join(root, "0. DRAFT"), { recursive: true });
  mkdirSync(join(root, "0. CASE DATA"));
  writeFileSync(join(root, "coclerk.json"), JSON.stringify({ schema_version: 5, matter_root: root, case_data_dir: join(base, "case data") }));
  const firm = join(base, "0. CASE DATA", "_practice", "firm");
  mkdirSync(firm, { recursive: true });
  writeFileSync(join(firm, "firm.json"), JSON.stringify({ firm_name: "Fixture Law LLP", roster: [LAWYER, STAFF] }));
  const made = spawnSync(PYTHON, ["-B", "-c", "import sys, support; support.write_zip(sys.argv[1], support.first_page_template_parts())", join(firm, "letterhead.docx")], {
    cwd: PUBLISH_TESTS,
    encoding: "utf-8",
  });
  assert.equal(made.status, 0, made.stderr);
  const config = (person) => {
    const path = join(base, `config-${person}.json`);
    writeFileSync(path, JSON.stringify({ case_data_root: join(base, "0. CASE DATA"), person }));
    return { ...process.env, COCLERK_CONFIG_PATH: path };
  };
  const canon = realpathSync.native(root);
  const draft = join(canon, "0. DRAFT");
  const dbPath = join(canon, "0. CASE DATA", "submission.sqlite");
  await freshSubmissionDb(dbPath);
  const context = await createDispatchContext({ ...process.env, ...(await startFakeCloud(t)).env, COCLERK_DB_PATH: join(base, "practice.db") });
  const env = config("pe");
  return {
    root: canon,
    draft,
    dbPath,
    context,
    env,
    staffEnv: config("ss"),
    file: join(draft, `${STEM}.docx`),
    fill: (extra = {}) => draftHarness({ step: "client_letter_fill", matter_root: canon, output_name: STEM, letter: LETTER, ...extra }, env),
    approve: (e = env) => draftHarness({ step: "client_letter_approve", matter_root: canon, output_name: STEM }, e),
    attach: () => callTool(context, "drafting_data__attach_to_board", { db_path: dbPath, kind: "client_letter", path: `0. DRAFT\\${STEM}.docx`, draft_dir: draft, session_token: TOKEN }),
  };
}

const review = (f) => attachedDrafts(f.dbPath, f.draft, buildPreFilingBoardData(f.dbPath, fetchProceeding(f.dbPath, 1), META))[0].review;

test("the letterhead is reached through the firm profile, and an attached .docx reads pending, then approved", async (t) => {
  const f = await fixture(t);
  const filled = f.fill();
  assert.equal(filled.success, true, JSON.stringify(filled));
  assert.equal(filled.path, f.file);

  const attached = await f.attach();
  assert.equal(attached.proceeding_created, true, "drafting_data__attach_to_board takes a .docx in the draft folder");
  assert.deepEqual(submissionDataQuery(f.dbPath, "SELECT path, kind FROM board_attachments").rows, [{ path: `0. DRAFT\\${STEM}.docx`, kind: "client_letter" }]);
  assert.equal(review(f), "pending");
  const lane = () => submissionFormsBoardCard({ db_path: f.dbPath, proceeding_id: 1, lanes: ["attached"], draft_dir: f.draft }, { clientName: "Larchmont", clientNo: "9999", matterNo: "L9999" }, META.rendered).card;
  assert.match(lane(), /· review: pending ·/);

  assert.equal(f.approve().success, true);
  assert.equal(review(f), "approved", "an attached .docx with no hold line is approved, not `no review line`");
  assert.match(lane(), /· review: approved ·/);
});

test("the hold blocks a sendable copy until a roster lawyer approves", async (t) => {
  const f = await fixture(t);
  f.fill();
  const email = () => draftHarness({ step: "write_email", matter_root: f.root, output_name: "2026-11-03 ET Client re invented award", to: ["client@example.org"], subject: "Invented", attachments: [f.file] }, f.env);
  const refused = email();
  assert.equal(refused.error, "attachment_on_hold");
  assert.deepEqual(readdirSync(f.draft).filter((n) => n.endsWith(".eml")), [], "nothing was written");

  const staff = f.approve(f.staffEnv);
  assert.equal(staff.error, "not_a_roster_lawyer");
  assert.equal(reviewStatus(f.file), "pending");

  assert.equal(f.approve().success, true);
  const sent = email();
  assert.equal(sent.success, true, JSON.stringify(sent));
});

test("no client-letter text reaches the database", async (t) => {
  const f = await fixture(t);
  f.fill();
  await f.attach();
  f.approve();
  review(f);
  await awaitBackgroundJobs();
  assert.equal(readFileSync(f.dbPath).includes(ADVICE), false);
  assert.equal(readFileSync(f.dbPath).includes("Invented Client"), false);
});

test("a corrupt .docx reads unreadable on the board, never approved", async (t) => {
  const f = await fixture(t);
  writeFileSync(f.file, "not a zip");
  await f.attach();
  const [card] = attachedDrafts(f.dbPath, f.draft, buildPreFilingBoardData(f.dbPath, fetchProceeding(f.dbPath, 1), META));
  assert.equal(card.state, "unreadable");
  assert.equal(card.review, null);
});
