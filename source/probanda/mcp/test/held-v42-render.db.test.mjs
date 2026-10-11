// A matter held at schema v42 stays readable (#1460; forms.ts MIN_READABLE_SCHEMA_VERSION). The
// 42 -> 43 hop is refused while a counsel offer stands, so the database stays at v42, and bootstrap
// lists its Writings as current. v47's statements_of_law.settled_on is absent there: the renderer
// reads it as NULL, so a Writing citing law renders without the settled tag instead of failing on
// `no such column`. The matter folder follows counsel-offers.db.test.mjs, the session and render
// calls open-session.db.test.mjs.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

// open_session starts the background render job (#589): keep its locks out of %LOCALAPPDATA%.
process.env.COCLERK_SUBMISSION_LOCK_ROOT = mkdtempSync(join(tmpdir(), "coclerk-held-v42-locks-"));
after(() => rmSync(process.env.COCLERK_SUBMISSION_LOCK_ROOT, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

const { callTool, createDispatchContext } = await import("../build/index.js");
const { awaitBackgroundJobs, backgroundJobStatus } = await import("../build/submission/render-job.js");
const { submissionDataExecute, submissionDataQuery } = await import("../build/submission/backend.js");
const { submissionFormsRender } = await import("../build/submission/forms.js");
const writes = await import("../build/tools/practice/writes.js");
const { writePartiesOfRecord } = await import("./helpers/case-data-fixture.mjs");
const { submissionDbAt } = await import("./helpers/template-db.mjs");
const { closePageServer } = await import("../build/housekeeping/server.js");
after(() => closePageServer());

const GENERAL = JSON.stringify({ layout: { renderer: "general", title: "Letter", parts: [] }, venue: null, passage_hashes: {} });

// The claimant's counsel email is held here and not in case data: a standing counsel offer, so the
// migrate refuses the 42 -> 43 hop. Filing 1 is a submission-backed Writing whose submission rests on
// statement 2; filing 2 a general Writing citing statement 1 through filing_law.
const SEED = `
INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L9999 - Held', 'CAN/BC/Vancouver-International-Arbitration-Centre');
INSERT INTO parties (id, proceeding_id, name, role, ordinal, is_client, is_applicant, to_be_served, counsel_name, counsel_email, case_party_id) VALUES
  (1, 1, 'Claimant Co.', 'Claimant', 1, 1, 1, 0, 'A. Lawyer', 'a@lawyer.example', 1),
  (2, 1, 'Respondent Co.', 'Respondent', 2, 0, 0, 1, NULL, NULL, 2);
INSERT INTO filings (id, proceeding_id, kind, round, title) VALUES (1, 1, 'submissions_package', 'opening', 'Opening Submissions Package');
INSERT INTO filings (id, proceeding_id, kind, title, needs_forum_parts, layout_snapshot, authority_confirmed_on)
  VALUES (2, 1, 'letter_to_opposing_counsel', 'Letter', 0, '${GENERAL}', '2026-10-02');
INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind) VALUES
  (1, 1, 'Cited v. Letter', '2020 BCSC 1', 'case'),
  (2, 1, 'Argued v. Submission', '2021 BCSC 2', 'case');
INSERT INTO submissions (id, proceeding_id, contention, ordinal) VALUES (1, 1, 'A deployed contention.', 1);
INSERT INTO filing_submissions (filing_id, submission_id, document, ordinal) VALUES (1, 1, 'form', 1);
INSERT INTO law_assertions (id, proceeding_id, proposition, dead_end) VALUES (1, 1, 'a proposition resting on a verified statement', 0);
INSERT INTO submission_law (submission_id, law_assertion_id) VALUES (1, 1);
INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, source, verification) VALUES
  (1, 1, NULL, 1, 'para 1', 'A passage the letter cites.', 'primary', 'verified'),
  (2, 1, 1, 2, 'para 2', 'A passage the submission rests on.', 'primary', 'verified');
INSERT INTO filing_law (filing_id, statement_id) VALUES (2, 1);
`;

const CASE_DATA = {
  parties: [
    { id: 1, name: "Claimant Co.", counsel_name: "A. Lawyer" },
    { id: 2, name: "Respondent Co." },
  ],
};

const CLIENT = { clientName: "Held Client Ltd.", clientNo: "C-9999", matterNo: "L9999" };

const schemaVersion = (dbPath) => Number(submissionDataQuery(dbPath, "SELECT value FROM db_meta WHERE key = 'schema_version'").rows[0].value);

/** <tmp>/L9999 Held Matter/coclerk.json -> <tmp>/0. CASE DATA/L9999 Held Matter/{submission,main}.sqlite, held at v42. */
async function heldMatter(t) {
  const base = mkdtempSync(join(tmpdir(), "coclerk-held-v42-"));
  t.after(async () => {
    await awaitBackgroundJobs();
    rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  const matterRoot = join(base, "L9999 Held Matter");
  const caseDataDir = join(base, "0. CASE DATA", "L9999 Held Matter");
  mkdirSync(join(matterRoot, "0. DRAFT"), { recursive: true });
  mkdirSync(caseDataDir, { recursive: true });
  writeFileSync(
    join(matterRoot, "coclerk.json"),
    JSON.stringify({ schema_version: 5, matter_root: matterRoot, case_data_dir: caseDataDir, evidence_sql_path: "4. LAWYER BRIEF\\CoWork\\evidence.sql" }),
    "utf-8"
  );
  const dbPath = join(caseDataDir, "submission.sqlite");
  submissionDbAt(dbPath, 42);
  await submissionDataExecute(dbPath, SEED);
  writePartiesOfRecord(caseDataDir, CASE_DATA);

  const practicePath = join(tmpdir(), `coclerk-held-v42-practice-${randomUUID()}.db`);
  t.after(() => rmSync(practicePath, { force: true }));
  const context = await createDispatchContext({ ...process.env, COCLERK_DB_PATH: practicePath });
  await writes.upsert_client_matter(context.practiceDb, "local", { client_num: CLIENT.clientNo, name: CLIENT.clientName, matt_num: CLIENT.matterNo });
  return { matterRoot, dbPath, context };
}

const doc = (result, type) => {
  const d = result.documents.find((x) => x.document_type === type);
  assert.ok(d, `expected a ${type} document`);
  return d;
};

test("a matter held at v42 by a counsel offer opens, lists and renders a general Writing citing law, and stays at v42", async (t) => {
  const m = await heldMatter(t);

  const opened = await callTool(m.context, "drafting_forms__open_session", { matter_root: m.matterRoot });
  assert.match(opened.migration_refused, /counsel_email held here as "a@lawyer\.example"/);
  assert.equal(opened.migration_required, false);
  assert.deepEqual(opened.filings.map((f) => f.filing_id).sort(), [1, 2]);

  // Inline, naming both, so the response carries the letter's markdown and the board's summary.
  const rendered = await callTool(m.context, "drafting_forms__render", { db_path: m.dbPath, filing_id: 2, session_token: opened.session_token, documents: ["General_writing", "Work_board"] });
  assert.ok(doc(rendered, "Work_board").board_summary, "expected a board_summary");
  const letter = doc(rendered, "General_writing").markdown;
  assert.match(letter, /^ {2}- > \*Cited v\. Letter\*, 2020 BCSC 1, para 1.* <!-- statement_of_law_id 1 -->$/m, letter);
  assert.doesNotMatch(letter, /settled by counsel/);

  // The background render job open_session started completes both Writings without a SQL error.
  await awaitBackgroundJobs();
  const job = backgroundJobStatus(m.dbPath);
  assert.equal(job.state, "done", JSON.stringify(job));
  assert.deepEqual(job.failed, []);
  assert.deepEqual([...job.done].sort(), [1, 2]);

  assert.equal(schemaVersion(m.dbPath), 42);
});

test("a submission-backed Writing on a matter held at v42 renders its statement line with no settled tag", async (t) => {
  const m = await heldMatter(t);
  const mockup = submissionFormsRender(m.dbPath, 1, CLIENT);
  for (const type of ["Written_arguments", "Counsel_brief"]) {
    const md = doc(mockup, type).markdown;
    assert.ok(md.includes("<!-- statement_of_law_id 2 -->"), `expected statement 2 on the ${type}`);
    assert.doesNotMatch(md, /settled by counsel/, type);
    // v48's submissions.no_facts_needed_on is absent at v42 and reads as NULL, so submission 1, which
    // rests on no fact, still raises 🧾.
    assert.match(md, /^\S+ \*\*A deployed contention\.\*\* 🧾/m, type);
    assert.doesNotMatch(md, /no stated fact needed/, type);
  }
  assert.equal(schemaVersion(m.dbPath), 42);
});
