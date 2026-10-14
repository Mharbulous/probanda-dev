// The counsel offer-back (party/counsel SSOT): before the submission copy of counsel of record and
// the address for service is dropped, every value it holds that case data does not hold is offered
// back to the practitioner, to apply to case data, discard here, or hold, and the migrate refuses
// the hop that drops it (v43) while any offer or parties_drift row stands. Each matter's case-data
// folder holds a real submission database migrated to v42, the last schema holding the copy, and a
// case-data main.sqlite built from /case-data's canonical schema.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

// open_session starts the background render job (#589): keep its locks out of %LOCALAPPDATA%.
process.env.COCLERK_SUBMISSION_LOCK_ROOT = mkdtempSync(join(tmpdir(), "coclerk-counsel-offers-locks-"));
after(() => rmSync(process.env.COCLERK_SUBMISSION_LOCK_ROOT, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

const { callTool, createDispatchContext } = await import("../build/index.js");
const { awaitBackgroundJobs } = await import("../build/submission/render-job.js");
const { submissionDataExecute, submissionDataQuery } = await import("../build/submission/backend.js");
const { submissionDataMigrate } = await import("../build/submission/migrate.js");
const { hopsFrom } = await import("./helpers/schema-hops.mjs");
const { counselOffers } = await import("../build/submission/parties-drift.js");
const { updateCaseData, writePartiesOfRecord } = await import("./helpers/case-data-fixture.mjs");
const { submissionDbAt } = await import("./helpers/template-db.mjs");

const FILE_NUMBER = "S-290002";

// Case data names each party's lawyer and no email.
const CASE_DATA = {
  proceedings: [{ id: 1, file_number: FILE_NUMBER }],
  parties: [
    { id: 1, name: "Larchmont (B.C.) Inc.", counsel_name: "C. Lawyer", of_record: [[1, "plaintiff"]] },
    { id: 2, name: "Example Defendant Ltd.", counsel_name: "Y. Counsel", of_record: [[1, "defendant"]] },
  ],
};

// The copy holds the plaintiff's lawyer padded, which agrees with case data, and an email case data
// lacks; the defendant's lawyer as case data holds it, and a blank email, which holds nothing.
const SUBMISSION_SEED = `
INSERT INTO proceedings (id, matter_reference, forum, file_number) VALUES (1, 'L8470', 'CAN/BC/BCSC', '${FILE_NUMBER}');
INSERT INTO parties (id, proceeding_id, name, role, ordinal, counsel_name, counsel_email, case_party_id) VALUES
  (1, 1, 'Larchmont (B.C.) Inc.', 'Plaintiff', 1, ' C. Lawyer ', 'c@lawyer.example', 1),
  (2, 1, 'Example Defendant Ltd.', 'Defendant', 2, 'Y. Counsel', '', 2);
`;

const PLAINTIFF = { proceeding_id: 1, file_number: FILE_NUMBER, party_id: 1, name: "Larchmont (B.C.) Inc.", role: "Plaintiff", case_party_id: 1 };
const DEFENDANT = { proceeding_id: 1, file_number: FILE_NUMBER, party_id: 2, name: "Example Defendant Ltd.", role: "Defendant", case_party_id: 2 };
const EMAIL_OFFER = { ...PLAINTIFF, kind: "offer", field: "counsel_email", case_data_value: null, held_value: "c@lawyer.example" };

const schemaVersion = (dbPath) => Number(submissionDataQuery(dbPath, "SELECT value FROM db_meta WHERE key = 'schema_version'").rows[0].value);
const backupsOf = (m) => readdirSync(m.caseDataDir).filter((name) => name.startsWith("submission.sqlite.bak-"));

/** <tmp>/L8470 Larchmont/coclerk.json -> <tmp>/0. CASE DATA/L8470 Larchmont/{submission,main}.sqlite */
async function matterFixture(t) {
  const base = mkdtempSync(join(tmpdir(), "coclerk-counsel-offers-"));
  t.after(async () => {
    await awaitBackgroundJobs();
    rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  const matterRoot = join(base, "L8470 Larchmont");
  const caseDataDir = join(base, "0. CASE DATA", "L8470 Larchmont");
  mkdirSync(matterRoot, { recursive: true });
  mkdirSync(caseDataDir, { recursive: true });
  writeFileSync(
    join(matterRoot, "coclerk.json"),
    JSON.stringify({ schema_version: 5, matter_root: matterRoot, case_data_dir: caseDataDir, evidence_sql_path: "4. LAWYER BRIEF\\CoWork\\evidence.sql" }),
    "utf-8"
  );
  const dbPath = join(caseDataDir, "submission.sqlite");
  submissionDbAt(dbPath, 42);
  await submissionDataExecute(dbPath, SUBMISSION_SEED);
  writePartiesOfRecord(caseDataDir, CASE_DATA);
  return { matterRoot, caseDataDir, dbPath };
}

test("a value the copy holds and case data lacks is one offer, compared trimmed, and a blank one is none", async (t) => {
  const m = await matterFixture(t);
  assert.deepEqual(counselOffers(m.dbPath), [EMAIL_OFFER]);
});

test("a value case data holds differently is offered with case data's value beside it", async (t) => {
  const m = await matterFixture(t);
  updateCaseData(m.caseDataDir, "UPDATE parties SET lawyer_email = 'other@lawyer.example' WHERE party_id = 1;");
  assert.deepEqual(counselOffers(m.dbPath), [{ ...EMAIL_OFFER, case_data_value: "other@lawyer.example" }]);
});

test("applied: once case data holds the value, the offer is gone", async (t) => {
  const m = await matterFixture(t);
  updateCaseData(m.caseDataDir, "UPDATE parties SET lawyer_email = 'c@lawyer.example' WHERE party_id = 1;");
  assert.deepEqual(counselOffers(m.dbPath), []);
});

test("discarded: once the copy's field is NULL, the offer is gone", async (t) => {
  const m = await matterFixture(t);
  await submissionDataExecute(m.dbPath, "UPDATE parties SET counsel_email = NULL WHERE id = 1;");
  assert.deepEqual(counselOffers(m.dbPath), []);
});

test("an unlinked party holding values is one unlinked row naming them", async (t) => {
  const m = await matterFixture(t);
  await submissionDataExecute(m.dbPath, "UPDATE parties SET case_party_id = NULL WHERE id = 2;");
  assert.deepEqual(counselOffers(m.dbPath), [EMAIL_OFFER, { ...DEFENDANT, case_party_id: null, kind: "unlinked", held: { counsel_name: "Y. Counsel" } }]);
});

test("with no case-data database every party holding values is unchecked, saying why", async (t) => {
  const m = await matterFixture(t);
  rmSync(join(m.caseDataDir, "main.sqlite"));
  const offers = counselOffers(m.dbPath);
  assert.deepEqual(
    offers.map((o) => [o.party_id, o.kind, o.held]),
    [
      [1, "unchecked", { counsel_name: "C. Lawyer", counsel_email: "c@lawyer.example" }],
      [2, "unchecked", { counsel_name: "Y. Counsel" }],
    ]
  );
  for (const o of offers) assert.match(o.reason, /no case-data database in /);
});

test("open_session returns counsel_offers only when there is one", async (t) => {
  const m = await matterFixture(t);
  const practicePath = join(tmpdir(), `coclerk-counsel-offers-practice-${randomUUID()}.db`);
  t.after(() => rmSync(practicePath, { force: true }));
  const context = await createDispatchContext({ ...process.env, COCLERK_DB_PATH: practicePath });

  // The offer holds the database at v42: the session goes on, read as current, with the rows to decide.
  const session = await callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot });
  assert.deepEqual(session.counsel_offers, [EMAIL_OFFER]);
  assert.deepEqual(session.parties_drift, []);
  assert.match(session.migration_refused, /counsel_email held here as "c@lawyer\.example"/);
  assert.equal(session.migration_required, false);
  assert.deepEqual(session.filings, []);
  assert.equal("migrated" in session, false);
  assert.equal(schemaVersion(m.dbPath), 42);

  await submissionDataExecute(m.dbPath, "UPDATE parties SET counsel_email = NULL WHERE id = 1;");
  const again = await callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot });
  assert.equal("counsel_offers" in again, false);
  assert.equal("migration_refused" in again, false);
  assert.deepEqual([again.migrated.from, again.migrated.to], [42, hopsFrom(42).at(-1).to]);
});

test("the migrate refuses the drop of the copy while an offer stands, naming it and writing nothing", async (t) => {
  const m = await matterFixture(t);
  const before = readFileSync(m.dbPath);
  await assert.rejects(submissionDataMigrate(m.dbPath), (err) => {
    assert.equal(err.code, "counsel_not_reconciled");
    assert.match(err.message, /Larchmont \(B\.C\.\) Inc\. \(Plaintiff, proceeding 1\): counsel_email held here as "c@lawyer\.example", case data holds none/);
    assert.match(err.message, /Nothing was written\..*filing-checklists\.md section 0/);
    return true;
  });
  assert.deepEqual(readFileSync(m.dbPath), before);
  assert.deepEqual(backupsOf(m), []);
});

test("the migrate refuses the drop while a party drifts, and drops the copy once every party is linked and every value decided", async (t) => {
  const m = await matterFixture(t);
  await submissionDataExecute(m.dbPath, "UPDATE parties SET counsel_email = NULL, case_party_id = NULL WHERE id = 1;");
  await assert.rejects(submissionDataMigrate(m.dbPath), (err) => {
    assert.equal(err.code, "counsel_not_reconciled");
    assert.match(err.message, /Larchmont \(B\.C\.\) Inc\. \(Plaintiff, proceeding 1\): unlinked, holding counsel_name; link it first/);
    assert.match(err.message, /Drift: Larchmont \(B\.C\.\) Inc\. \(Plaintiff, proceeding 1\): unlinked/);
    return true;
  });
  assert.equal(schemaVersion(m.dbPath), 42);

  await submissionDataExecute(m.dbPath, "UPDATE parties SET case_party_id = 1 WHERE id = 1;");
  const migrated = await submissionDataMigrate(m.dbPath);
  assert.deepEqual(migrated.applied, hopsFrom(42));
  assert.equal(backupsOf(m).length, 1);
  assert.deepEqual(counselOffers(m.dbPath), [], "the copy is gone");
});
