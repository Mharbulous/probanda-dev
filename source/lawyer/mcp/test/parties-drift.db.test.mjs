// Party and counsel from case data (party/counsel SSOT): counsel of record and the address for
// service are court-record state owned by /matter-data. A matter's case-data folder holds both
// databases here: a real submission database seeded with the BCSC consent-order requisition, and a
// matter-data main.sqlite built from /matter-data's canonical schema.sql. A drafting Writing prints each
// party's counsel from case data, read live through case_party_id; open_session reports every party
// it cannot be read for, the filed render and the filed-face emitters refuse while one stands, the
// mockup marks it for the human only, and a filed filing renders the party rows record_filed wrote
// from case data when it was filed.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";

// open_session starts the background render job (#589): keep its locks out of %LOCALAPPDATA%.
process.env.COCLERK_SUBMISSION_LOCK_ROOT = mkdtempSync(join(tmpdir(), "coclerk-parties-drift-locks-"));
after(() => rmSync(process.env.COCLERK_SUBMISSION_LOCK_ROOT, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

const { callTool, createDispatchContext } = await import("../build/index.js");
const { awaitBackgroundJobs } = await import("../build/submission/render-job.js");
const { submissionDataExecute, submissionDataQuery } = await import("../build/submission/backend.js");
const {
  submissionFormsEmitAffidavit,
  submissionFormsEmitBccaBook,
  submissionFormsEmitBccaFactum,
  submissionFormsEmitForm32,
  submissionFormsBootstrap,
  submissionFormsEmitForm33,
  submissionFormsRender,
} = await import("../build/submission/forms.js");
const { toFiledFace } = await import("../build/submission/forms/filed-face.js");
const { updateCaseData, writeCaseData } = await import("./helpers/case-data-fixture.mjs");
const { freshSubmissionDb, submissionDbAt } = await import("./helpers/template-db.mjs");
const { seedBcscConsentOrder } = await import("./fixtures/forms-render-seeds.mjs");

const FILE_NUMBER = "S-290002";
const CLIENT = { clientName: "Larchmont", clientNo: "4001", matterNo: "L8470" };

// Case data names the plaintiff's lawyer as the consent-order seed does, and a different lawyer for
// the defendant: the seed's case data reads D. Lawyer, this case data Y. Counsel.
const CASE_SEED = `
INSERT INTO proceedings (proceeding_id, court, file_number) VALUES (1, 'BCSC', '${FILE_NUMBER}');
INSERT INTO parties (party_id, name, party_type, lawyer_name) VALUES
  (1, 'Larchmont (B.C.) Inc.', 'corporation', 'C. Lawyer'),
  (2, 'Example Defendant Ltd.', 'corporation', 'Y. Counsel');
INSERT INTO proceeding_parties (proceeding_id, party_id, role) VALUES (1, 1, 'plaintiff'), (1, 2, 'defendant');
`;

// A filed Notice of Withdrawal: the defendant's lawyer is gone and it is served at its own address.
const NOWOL_CASE_SEED = CASE_SEED.replace("'Y. Counsel'", "NULL") + "UPDATE parties SET address = '9 Home Rd' WHERE party_id = 2;";

/** <tmp>/L8470 Larchmont/coclerk.json -> <tmp>/0. CASE DATA/L8470 Larchmont/{submission,main}.sqlite */
async function matterFixture(t, { caseSeed = CASE_SEED, link = true, version } = {}) {
  const base = mkdtempSync(join(tmpdir(), "coclerk-parties-drift-"));
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
  // `version`: a database held behind at that schema version, as a refused migrate leaves it.
  if (version === undefined) await freshSubmissionDb(dbPath);
  else submissionDbAt(dbPath, version);
  await seedBcscConsentOrder(dbPath);
  await submissionDataExecute(
    dbPath,
    // Schema v42 holds a party-linked recipient's name NOT NULL: the runtime reads none of it.
    `INSERT INTO recipients (id, proceeding_id, name, capacity, email, address, party_id, ordinal)
       VALUES (1, 1, ${version === 42 ? "'Stale Copy Counsel'" : "NULL"}, 'counsel for the Defendant', NULL, NULL, 2, 1);` +
      (link ? "" : " UPDATE parties SET case_party_id = NULL;")
  );
  writeCaseData(caseDataDir, caseSeed);
  return { matterRoot, caseDataDir, dbPath };
}

async function openSession(t, matterRoot) {
  const practicePath = join(tmpdir(), `coclerk-parties-drift-practice-${randomUUID()}.db`);
  t.after(() => rmSync(practicePath, { force: true }));
  const context = await createDispatchContext({ ...process.env, COCLERK_DB_PATH: practicePath });
  return callTool(context, "drafting_forms__open_session", { matter_root: matterRoot });
}

/** The Consent Order document of a render, mockup or filed. */
const consentOrder = (result) => result.documents.find((d) => d.file_name === "Consent Order.md").markdown;

/** Every rendered document's text, the board aside. */
const printed = (result) => result.documents.map((d) => d.markdown ?? "").join("\n");

const UNLINKED_DEFENDANT = {
  proceeding_id: 1,
  file_number: FILE_NUMBER,
  party_id: 2,
  name: "Example Defendant Ltd.",
  role: "Defendant",
  case_party_id: null,
  kind: "unlinked",
};

test("a drafting Writing prints case data's counsel, not the submission copy, with no write, and nothing drifts", async (t) => {
  const m = await matterFixture(t);
  const session = await openSession(t, m.matterRoot);
  assert.deepEqual(session.parties_drift, []);
  assert.equal(session.parties_drift_note, undefined);

  const mockup = submissionFormsRender(m.dbPath, 1, CLIENT);
  assert.equal(mockup.parties_drift, undefined);
  assert.match(consentOrder(mockup), /Signature of Y\. Counsel, lawyer for the Defendant, Example Defendant Ltd\./);
  assert.doesNotMatch(printed(mockup), /D\. Lawyer/);
  assert.doesNotMatch(printed(mockup), /^🏷️ /m);

  const filed = submissionFormsRender(m.dbPath, 1, CLIENT, "filed");
  assert.equal(filed.parties_drift_gate_failed, undefined);
  assert.match(consentOrder(filed), /Signature of Y\. Counsel, lawyer for the Defendant/);
});

test("an unlinked party is drift, whatever case data says", async (t) => {
  const m = await matterFixture(t, { link: false });
  const result = await openSession(t, m.matterRoot);
  assert.deepEqual(
    result.parties_drift.map((r) => [r.party_id, r.kind, r.case_party_id]),
    [[1, "unlinked", null], [2, "unlinked", null]]
  );
});

test("no matter-data proceeding with the file number gives a clear parties_drift_note, never a silent empty list", async (t) => {
  const m = await matterFixture(t, { caseSeed: CASE_SEED.replace(`'${FILE_NUMBER}'`, "'S-000001'") });
  const result = await openSession(t, m.matterRoot);
  assert.match(result.parties_drift_note, new RegExp(`no matter-data proceeding has file number ${FILE_NUMBER}`));
  assert.deepEqual(result.parties_drift.map((r) => [r.party_id, r.kind]), [[1, "unchecked"], [2, "unchecked"]]);
  const filed = submissionFormsRender(m.dbPath, 1, CLIENT, "filed");
  assert.equal(filed.parties_drift_gate_failed, true);
  assert.deepEqual(filed.documents, []);
});

test("a proceeding with a file number and no matter-data database is unchecked, and prints no counsel from the copy", async (t) => {
  const m = await matterFixture(t);
  rmSync(join(m.caseDataDir, "main.sqlite"));
  const session = await openSession(t, m.matterRoot);
  assert.deepEqual(session.parties_drift.map((r) => [r.party_id, r.kind]), [[1, "unchecked"], [2, "unchecked"]]);
  assert.match(session.parties_drift_note, /no matter-data database in /);

  const mockup = submissionFormsRender(m.dbPath, 1, CLIENT);
  assert.equal(mockup.parties_drift.length, 2);
  assert.doesNotMatch(printed(mockup), /C\. Lawyer|D\. Lawyer/);
  assert.equal(submissionFormsRender(m.dbPath, 1, CLIENT, "filed").parties_drift_gate_failed, true);
});

test("the filed render of a drafting filing refuses parties_drift, and the mockup marks the party for the human only", async (t) => {
  const m = await matterFixture(t);
  await submissionDataExecute(m.dbPath, "UPDATE parties SET case_party_id = NULL WHERE id = 2;");
  const filed = submissionFormsRender(m.dbPath, 1, CLIENT, "filed");
  assert.equal(filed.parties_drift_gate_failed, true);
  assert.deepEqual(filed.documents, []);
  assert.deepEqual(filed.parties_drift, [UNLINKED_DEFENDANT]);
  assert.match(filed.note, /Example Defendant Ltd\. \(unlinked\)/);

  const mockup = submissionFormsRender(m.dbPath, 1, CLIENT);
  assert.deepEqual(mockup.parties_drift, [UNLINKED_DEFENDANT]);
  const venue = mockup.documents[0].markdown;
  const line = venue.split("\n").find((l) => l.startsWith("🏷️ Example Defendant Ltd. (Defendant)"));
  assert.ok(line, `expected a 🏷️ line for the defendant in:\n${venue.slice(0, 600)}`);
  assert.match(line, /not linked to a party in case data/);
  assert.equal(venue.split("\n").filter((l) => l.startsWith("🏷️ ")).length, 1, "the plaintiff is read from case data and is unmarked");
  assert.doesNotMatch(toFiledFace(venue), /case data/, "the marker line is withheld from the forum");
  // The unlinked defendant's counsel is NULL, never the submission copy.
  assert.doesNotMatch(printed(mockup), /D\. Lawyer|Y\. Counsel/);
  assert.match(consentOrder(mockup), /Signature of C\. Lawyer, lawyer for the Plaintiff/);
});

test("a v42 database whose v43 hop is refused stays usable: open_session lists its filings and reports the refusal, and the drafting filing renders from case data", async (t) => {
  const m = await matterFixture(t, { version: 42 });
  // An unlinked defendant still holding a counsel value in the v42 copy: the hop waits on the practitioner.
  await submissionDataExecute(m.dbPath, "UPDATE parties SET case_party_id = NULL, counsel_name = 'Stale Copy Counsel' WHERE id = 2;");
  const session = await openSession(t, m.matterRoot);
  assert.match(session.migration_refused, /refused/);
  assert.match(session.migration_refused, /Example Defendant Ltd\./);
  assert.equal(session.migration_required, false);
  assert.equal(session.schema_version, 42);
  assert.equal("migrated" in session, false);
  assert.deepEqual(session.filings.map((f) => f.filing_id), [1]);
  assert.deepEqual(session.parties_drift, [UNLINKED_DEFENDANT]);

  const mockup = submissionFormsRender(m.dbPath, 1, CLIENT);
  assert.deepEqual(mockup.parties_drift, [UNLINKED_DEFENDANT]);
  const venue = mockup.documents[0].markdown;
  const line = venue.split("\n").find((l) => l.startsWith("🏷️ Example Defendant Ltd. (Defendant)"));
  assert.ok(line, `expected a 🏷️ line for the defendant in:\n${venue.slice(0, 600)}`);
  // The v42 copy is never read: the unlinked defendant prints no counsel, the plaintiff case data's.
  assert.doesNotMatch(printed(mockup), /Stale Copy Counsel|Y\. Counsel|D\. Lawyer/);
  assert.match(consentOrder(mockup), /Signature of C\. Lawyer, lawyer for the Plaintiff/);
  assert.equal(submissionDataQuery(m.dbPath, "SELECT value FROM db_meta WHERE key = 'schema_version'").rows[0].value, "42");
});

test("each filed-face emitter refuses a drafting Writing while drift stands", async (t) => {
  const m = await matterFixture(t);
  await submissionDataExecute(m.dbPath, "UPDATE parties SET case_party_id = NULL WHERE id = 2;");
  const emitters = [
    ["drafting_forms__emit_form32", () => submissionFormsEmitForm32(m.dbPath, 1)],
    ["drafting_forms__emit_form33", () => submissionFormsEmitForm33(m.dbPath, 1)],
    ["drafting_forms__emit_bcca_book", () => submissionFormsEmitBccaBook(m.dbPath, 1)],
    ["drafting_forms__emit_bcca_factum", () => submissionFormsEmitBccaFactum(m.dbPath, 1, "2026-10-01")],
    ["drafting_forms__emit_affidavit", () => submissionFormsEmitAffidavit(m.dbPath, 1, 1)],
  ];
  for (const [tool, emit] of emitters) {
    const refused = emit();
    assert.equal(refused.parties_drift_gate_failed, true, tool);
    assert.deepEqual(refused.parties_drift, [UNLINKED_DEFENDANT], tool);
    assert.equal(refused.markdown, undefined, tool);
    assert.match(refused.note, new RegExp(`Example Defendant Ltd\\. \\(unlinked\\).*call ${tool} again`), tool);
  }
});

test("linking the party clears its drift, and the filed face prints case data's counsel", async (t) => {
  const m = await matterFixture(t, { link: false });
  await submissionDataExecute(m.dbPath, "UPDATE parties SET case_party_id = id;");
  const result = await openSession(t, m.matterRoot);
  assert.deepEqual(result.parties_drift, []);
  const filed = submissionFormsRender(m.dbPath, 1, CLIENT, "filed");
  assert.equal(filed.parties_drift_gate_failed, undefined);
  assert.match(consentOrder(filed), /Signature of Y\. Counsel, lawyer for the Defendant/);
});

test("a mockup is not served from the manifest once case data alone changes counsel", async (t) => {
  const m = await matterFixture(t);
  assert.match(consentOrder(submissionFormsRender(m.dbPath, 1, CLIENT)), /Signature of Y\. Counsel/);
  updateCaseData(m.caseDataDir, "UPDATE parties SET lawyer_name = 'Z. Counsel' WHERE party_id = 2;");
  const again = consentOrder(submissionFormsRender(m.dbPath, 1, CLIENT));
  assert.match(again, /Signature of Z\. Counsel, lawyer for the Defendant/);
  assert.doesNotMatch(again, /Y\. Counsel/);
});

// Bootstrap's render_state and the background job's freshness check use the parties digest render's
// memo key holds (#1308), so the three agree on "fresh" when case data alone changes counsel.
const PINNED = "2026-09-15 10:00";

const renderAt = (dbPath) => submissionFormsRender(dbPath, 1, CLIENT, "mockup", undefined, undefined, undefined, PINNED);
const stateAt = (dbPath) => submissionFormsBootstrap(dbPath, CLIENT, PINNED).filings[0].render_state;

test("bootstrap reports a drafting filing stale once case data alone changes counsel, and fresh while nothing changes", async (t) => {
  const m = await matterFixture(t);
  renderAt(m.dbPath);
  assert.equal(stateAt(m.dbPath), "fresh");
  updateCaseData(m.caseDataDir, "UPDATE parties SET lawyer_name = 'Z. Counsel' WHERE party_id = 2;");
  assert.equal(stateAt(m.dbPath), "stale");
  renderAt(m.dbPath);
  assert.equal(stateAt(m.dbPath), "fresh");
});

test("bootstrap reads case data in its own timings phase", async (t) => {
  const m = await matterFixture(t);
  const { timings } = submissionFormsBootstrap(m.dbPath, CLIENT, PINNED);
  assert.equal(timings.filter((p) => p.phase === "parties_drift").length, 1);
});

test("a sent filing stays fresh in bootstrap when case data changes after it was rendered", async (t) => {
  const m = await matterFixture(t);
  await callTool({}, "drafting_data__record_filed", { db_path: m.dbPath, filing_id: 1, filed_on: "2026-09-29" });
  renderAt(m.dbPath);
  updateCaseData(m.caseDataDir, "UPDATE parties SET lawyer_name = 'Z. Counsel' WHERE party_id = 2;");
  assert.equal(stateAt(m.dbPath), "fresh");
});

test("a manifest without parties_drift reads stale in bootstrap, as it misses in render", async (t) => {
  const m = await matterFixture(t);
  renderAt(m.dbPath);
  const manifestFile = join(dirname(submissionFormsBootstrap(m.dbPath, CLIENT, PINNED).filings[0].paths[0]), "render-manifest.json");
  const { parties_drift, ...older } = JSON.parse(readFileSync(manifestFile, "utf-8"));
  assert.equal(typeof parties_drift, "string");
  writeFileSync(manifestFile, JSON.stringify(older), "utf-8");
  assert.equal(stateAt(m.dbPath), "stale");
});

test("with case data unreadable, bootstrap decides as render's memo check does for the same inputs", async (t) => {
  const m = await matterFixture(t);
  rmSync(join(m.caseDataDir, "main.sqlite"));
  assert.deepEqual(renderAt(m.dbPath).parties_drift.map((r) => r.kind), ["unchecked", "unchecked"]);
  assert.equal(stateAt(m.dbPath), "fresh", "the same unchecked drift is the same digest");
  writeCaseData(m.caseDataDir, CASE_SEED);
  assert.equal(stateAt(m.dbPath), "stale", "case data readable again changes the digest");
});

test("after a matter-data counsel change the background job queues the filing and re-renders it", async (t) => {
  const m = await matterFixture(t);
  const args = { db_path: m.dbPath, client_name: CLIENT.clientName, client_no: CLIENT.clientNo, matter_no: CLIENT.matterNo };
  submissionFormsRender(m.dbPath, 1, CLIENT);
  const settled = await callTool({}, "drafting_forms__bootstrap", args);
  assert.deepEqual([settled.background_job.current, ...settled.background_job.queued].filter((id) => id !== null), []);
  await awaitBackgroundJobs();

  updateCaseData(m.caseDataDir, "UPDATE parties SET lawyer_name = 'Z. Counsel' WHERE party_id = 2;");
  const moved = await callTool({}, "drafting_forms__bootstrap", args);
  assert.equal(moved.filings[0].render_state, "stale");
  assert.deepEqual([moved.background_job.current, ...moved.background_job.queued], [1]);
  // The job renders a queued filing only while isFresh says it is not fresh.
  const [summary] = await awaitBackgroundJobs();
  assert.deepEqual(summary.rendered, [1]);
  assert.equal((await callTool({}, "drafting_forms__bootstrap", args)).filings[0].render_state, "fresh");
});

test("a Notice of Withdrawal in case data prints no counsel for the party, with no drift", async (t) => {
  const m = await matterFixture(t, { caseSeed: NOWOL_CASE_SEED });
  const session = await openSession(t, m.matterRoot);
  assert.deepEqual(session.parties_drift, []);
  const filed = submissionFormsRender(m.dbPath, 1, CLIENT, "filed");
  assert.equal(filed.parties_drift_gate_failed, undefined);
  assert.doesNotMatch(consentOrder(filed), /lawyer for the Defendant/);
  assert.doesNotMatch(printed(filed), /D\. Lawyer/);
});

test("a filed filing prints the counsel case data held when it was filed, never the submission copy, whatever case data says later", async (t) => {
  const m = await matterFixture(t);
  await callTool({}, "drafting_data__record_filed", { db_path: m.dbPath, filing_id: 1, filed_on: "2026-09-29" });
  updateCaseData(m.caseDataDir, "UPDATE parties SET lawyer_name = 'Z. Counsel' WHERE party_id = 2;");
  const filed = submissionFormsRender(m.dbPath, 1, CLIENT, "filed");
  assert.equal(filed.parties_drift_gate_failed, undefined, "a sent filing is never held for drift");
  const order = consentOrder(filed);
  assert.match(order, /Signature of Y\. Counsel, lawyer for the Defendant/);
  assert.doesNotMatch(order, /D\. Lawyer|Z\. Counsel/);
});

test("setting a filing's filed_on by a raw update is refused while it has no snapshot, naming both tools", async (t) => {
  const m = await matterFixture(t);
  await assert.rejects(
    submissionDataExecute(m.dbPath, "UPDATE filings SET filed_on = '2026-09-29' WHERE id = 1;"),
    /\/drafting-data's record-sent tool.*record-filed tool/
  );
});

test("a proceeding with no file number reads each linked party's own counsel by case_party_id, and an unlinked one is drift", async (t) => {
  const m = await matterFixture(t);
  // The per-proceeding override is the court record's; a proceeding with no file number has none.
  updateCaseData(m.caseDataDir, "UPDATE proceeding_parties SET lawyer_name = 'Z. Override' WHERE party_id = 2;");
  await submissionDataExecute(m.dbPath, "UPDATE proceedings SET file_number = NULL WHERE id = 1; UPDATE parties SET case_party_id = NULL WHERE id = 1;");
  const unlinkedPlaintiff = { ...UNLINKED_DEFENDANT, file_number: "", party_id: 1, name: "Larchmont (B.C.) Inc.", role: "Plaintiff" };

  const session = await openSession(t, m.matterRoot);
  assert.deepEqual(session.parties_drift, [unlinkedPlaintiff]);
  assert.equal(session.parties_drift_note, undefined);

  const mockup = submissionFormsRender(m.dbPath, 1, CLIENT);
  assert.deepEqual(mockup.parties_drift, [unlinkedPlaintiff]);
  assert.match(consentOrder(mockup), /Signature of Y\. Counsel, lawyer for the Defendant/);
  assert.doesNotMatch(printed(mockup), /C\. Lawyer|D\. Lawyer|Z\. Override/);

  // A link to a party case data does not hold is drift too.
  await submissionDataExecute(m.dbPath, "UPDATE parties SET case_party_id = 99 WHERE id = 1;");
  const relinked = submissionFormsRender(m.dbPath, 1, CLIENT);
  assert.deepEqual(relinked.parties_drift, [{ ...unlinkedPlaintiff, case_party_id: 99, kind: "not_of_record" }]);
  assert.match(relinked.documents[0].markdown, /^🏷️ Larchmont \(B\.C\.\) Inc\. \(Plaintiff\): linked to matter-data party 99, which case data does not hold/m);
});
