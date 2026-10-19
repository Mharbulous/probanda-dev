// The Sent write and the pre-send hold (plan Phase 15; ADR 0024 D6; #951 note):
// drafting_data__record_sent. On every general Writing, a venue's letter included (#1236), sending is held while a
// declared primary-authority, excerpts, noting-up or recipients criterion is unmet on the latest render's
// inventory, or the universal currency check is unmet, read live (#1229): the write refuses, leaving a Pre-send gate job with one step per unmet criterion,
// unless "send anyway" carries the practitioner's words into each step's WAIVED form. It refuses
// "render first" on an inventory older than the revision and never renders; only a roster lawyer
// records it, and never while a party's counsel cannot be read from case data. It then checks the sent
// copy against the stored text and writes the sent copy, the party rows it was sent with (from case
// data), sent_copy_id, the signer snapshot and filed_on in one transaction, with the Pre-send gate job's
// step closures, waivers and completion. The letters live in a firm overlay
// (helpers/general-writing-fixture.mjs); every mockup render, a cited layout's included, writes the
// manifest whose inventory the hold reads.

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";

import { updateCaseData } from "./helpers/matter-data-fixture.mjs";
import { knowledgeFile } from "./helpers/knowledge-fixture.mjs";
import { BCSC_TREE, generalWritingFixture, LETTER_BLOCK, MEMO_BLOCK, MEMO_FILE, NO_VENUE_TREE } from "./helpers/general-writing-fixture.mjs";
import { partiesSnapshotSql } from "./helpers/template-db.mjs";
import { boardDataOf } from "./fixtures/forms-render-seeds.mjs";

const { submissionFormsRender } = await import("../build/submission/forms.js");
const { submissionDataRecordSent } = await import("../build/submission/forms/sent-write.js");
const { submissionDataMigrate } = await import("../build/submission/migrate.js");
const { hopsFrom } = await import("./helpers/schema-hops.mjs");

const CLIENT = { clientName: "Ada Client", clientNo: "0001", matterNo: "L0000" };
const NOW = "2026-09-25 10:00";
const BODY = "First paragraph of the letter.\n\nSecond paragraph of the letter.";
const AS_SENT = "Dear Cara,\n\n1. First paragraph of the letter.\n\n2. Second paragraph\nof the letter.\n\nYours truly,\nPat Example";
const WORDS = "The client instructs us to send it today; the authority is being pulled separately.";

const VETTED_LETTER = { ...LETTER_BLOCK, title: "Letter to opposing counsel", parts: LETTER_BLOCK.parts.map(({ rule_ref, ...rest }) => rest) };

// Inventory entries as the collector records them on the letter's own face.
const unproven = { generating: false, marker: "🚧", instance: "proposition", table: "law_assertions", id: 1, item: "a proposition resting on nothing", doc: "General_writing" };
const unquoted = { generating: false, marker: "👃", instance: "law", table: "statements_of_law", id: 1, item: "Example v. Authority, 2020 BCSC 1", doc: "General_writing" };
const unreviewed = { generating: false, marker: "🧐", table: "filings", id: 1, item: "Letter to Cara", doc: "General_writing" };

// #1365: a render returns its board as board_summary; the board's data is this filing's section of
// the matter's Job Board page, read the way the page builds it, right after the render.
const render = (g, id, mode = "mockup") => {
  const result = submissionFormsRender(g.dbPath, id, CLIENT, mode, undefined, undefined, undefined, NOW);
  return mode === "mockup" ? { ...result, board: boardDataOf(g.dbPath, id, CLIENT, NOW) } : result;
};
const letterOf = (result) => result.documents.find((d) => d.document_type === "General_writing").markdown;

/** The counsel letter, drafted, with its Deliver job (whose billing anchor a Pre-send gate job copies), rendered once.
 * `fixture` replaces the vetted letter's front matter and block; `body` is its body prose row, none when null. */
async function drafted(t, { fixture = { front: null, block: VETTED_LETTER }, body = BODY } = {}) {
  const g = await generalWritingFixture(t, fixture);
  const { filing_id: id } = await g.createLetter();
  await g.prose(id, "addressee", "Cara Counsel");
  if (body !== null) await g.prose(id, "body", body);
  await g.recipient(id, 1, "to");
  await g.execute(
    `INSERT INTO tickets (proceeding_id, filing_id, title, intent, kind, priority, billing_anchor, created)
       VALUES (1, ${id}, 'Deliver', 'Send this letter to its recipients and record it as sent.', 'work', 0, 'L0000|late objection', '2026-09-25T09:00');`
  );
  render(g, id);
  return { g, id };
}

/** Every file in a letter's mockup folder, by name, as base64 bytes: none when the folder does not exist. */
function mockupFiles(g, id) {
  const dir = join(dirname(g.dbPath), "mockups", `Filing ${id}`);
  return existsSync(dir) ? Object.fromEntries(readdirSync(dir).map((name) => [name, readFileSync(join(dir, name)).toString("base64")])) : {};
}

/** Replaces the inventory the latest render's manifest recorded, as a render printing those markers would. */
function setInventory(g, id, inventory) {
  const manifest = join(dirname(g.dbPath), "mockups", `Filing ${id}`, "render-manifest.json");
  writeFileSync(manifest, JSON.stringify({ ...JSON.parse(readFileSync(manifest, "utf-8")), inventory }), "utf-8");
}

const send = (g, id, extra = {}) => submissionDataRecordSent({ db_path: g.dbPath, filing_id: id, sent_on: "2026-09-25", sent_copy_text: AS_SENT, ...extra }, g.seams.env);
const code = (expected, message) => (err) => {
  assert.equal(err.code, expected, err.message);
  if (message) assert.match(err.message, message);
  return true;
};
const filing = (g, id) => g.query("SELECT filed_on, sent_copy_id, signer_snapshot, layout_snapshot, needs_forum_parts FROM filings WHERE id = ?", [id])[0];
const gateJobs = (g, id) => g.query("SELECT id, status, intent, billing_anchor, priority FROM tickets WHERE filing_id = ? AND title = 'Pre-send gate'", [id]);
const stepsOf = (g, ticketId) => g.query("SELECT ordinal, text, done_at FROM ticket_steps WHERE ticket_id = ? ORDER BY ordinal", [ticketId]);
const documentCount = (g) => g.query("SELECT COUNT(*) AS n FROM documents")[0].n;
const printed = (g, id) =>
  g
    .query("SELECT party_id, name, role, counsel_name, counsel_email, address_for_service FROM parties_snapshot WHERE filing_id = ? ORDER BY party_id", [id])
    .map((r) => [r.party_id, r.name, r.role, r.counsel_name, r.counsel_email, r.address_for_service]);

test("an unmet held criterion refuses the Sent write and leaves a Pre-send gate job with one step per unmet held criterion; counsel's review holds nothing", async (t) => {
  const { g, id } = await drafted(t);
  setInventory(g, id, [unproven, unquoted, unreviewed]);
  const revision = g.revision();

  await assert.rejects(send(g, id), code("held", /primary-authority \(a proposition resting on nothing\), excerpts \(Example v\. Authority, 2020 BCSC 1\)/));
  const [job] = gateJobs(g, id);
  assert.deepEqual(
    { ...job, id: undefined },
    { id: undefined, status: "queued", intent: "Meet or waive each criterion that holds this Writing back from being recorded as sent.", billing_anchor: "L0000|late objection", priority: 1 }
  );
  assert.deepEqual(
    stepsOf(g, job.id).map((s) => [s.ordinal, s.text, s.done_at]),
    [
      [1, `primary-authority — Every proposition of law rests on primary authority: unmet (1 open) [rev ${revision}]`, null],
      [2, `excerpts — Every excerpt is quoted, pinpointed and checked: unmet (1 open) [rev ${revision}]`, null],
    ]
  );
  assert.equal(g.revision(), revision, "the job's writes move no revision");
  assert.deepEqual([filing(g, id).filed_on, filing(g, id).sent_copy_id], [null, null]);

  // Asked again with only excerpts still unmet: the same job, its primary-authority step closed as met.
  setInventory(g, id, [unquoted]);
  await assert.rejects(send(g, id), code("held"));
  assert.equal(gateJobs(g, id).length, 1, "no second job");
  const [closed, open] = stepsOf(g, job.id);
  assert.equal(closed.text, `primary-authority — Every proposition of law rests on primary authority: met [rev ${revision}]`);
  assert.notEqual(closed.done_at, null);
  assert.equal(open.done_at, null);
});

test("an inventory older than the revision is refused as render first, and the Sent write never renders", async (t) => {
  const { g, id } = await drafted(t);
  await g.execute(`UPDATE filing_prose SET text = 'A changed first paragraph.' WHERE filing_id = ${id} AND slot = 'body';`);
  const files = mockupFiles(g, id);
  assert.ok("render-manifest.json" in files && Object.keys(files).length > 1, Object.keys(files).join(", "));
  await assert.rejects(send(g, id), code("render_first", /older than the Writing's revision/));
  assert.deepEqual(mockupFiles(g, id), files, "the render manifest and the mockups are byte-identical");
  assert.equal(gateJobs(g, id).length, 0);
  assert.equal(filing(g, id).filed_on, null);

  const { filing_id: unrendered } = await g.createLetter({ title: "Never rendered" });
  await g.prose(unrendered, "body", BODY);
  await assert.rejects(send(g, unrendered), code("render_first", /no render of filing/));
  assert.deepEqual(mockupFiles(g, unrendered), {}, "no mockup and no render manifest were written");
});

test("a Writing whose stored layout cites a learned item records a render inventory, so the hold reads it and the Sent write succeeds", async (t) => {
  const { g, id } = await drafted(t, { fixture: {} });
  const stored = JSON.parse(g.query("SELECT layout_snapshot FROM filings WHERE id = ?", [id])[0].layout_snapshot);
  assert.deepEqual(Object.keys(stored.passage_hashes).sort(), ["R-body", "R-title"]);
  assert.ok("render-manifest.json" in mockupFiles(g, id), "the render wrote the manifest");

  setInventory(g, id, [unquoted]);
  await assert.rejects(send(g, id), code("held", /excerpts \(Example v\. Authority, 2020 BCSC 1\)/));
  const result = await send(g, id, { send_anyway: WORDS });
  assert.deepEqual(result.pre_send_gate.waived, ["excerpts"]);
  assert.equal(filing(g, id).filed_on, "2026-09-25");
});

test("a Writing with no stored text is refused, and nothing is written", async (t) => {
  const { g, id } = await drafted(t, { body: null });
  setInventory(g, id, [unquoted]);
  const documents = documentCount(g);
  await assert.rejects(send(g, id), code("no_stored_text", /no stored text/));
  assert.deepEqual([filing(g, id).filed_on, documentCount(g), gateJobs(g, id).length], [null, documents, 0]);
});

test("sent_on must be a calendar date: 2026-02-31 is refused", async (t) => {
  const { g, id } = await drafted(t);
  await assert.rejects(send(g, id, { sent_on: "2026-02-31" }), code("invalid_sent_on"));
  assert.equal(filing(g, id).filed_on, null);
});

test("only a roster lawyer records a Writing as sent: a staff key is refused", async (t) => {
  const { g, id } = await drafted(t);
  g.setPerson("st");
  await assert.rejects(send(g, id), code("not_a_lawyer", /"st" is staff/));
  g.setPerson(null);
  await assert.rejects(send(g, id), code("person_unset"));
  assert.equal(filing(g, id).filed_on, null);
});

test("send anyway records the practitioner's words in each WAIVED step, stores sent_copy_id with the signer snapshot and the Sent date, and moves the revision", async (t) => {
  const { g, id } = await drafted(t);
  setInventory(g, id, [unproven, unquoted]);
  await assert.rejects(send(g, id), code("held"));
  const before = filing(g, id);
  const revision = g.revision();
  const documents = documentCount(g);

  const result = await send(g, id, { send_anyway: WORDS });
  const [job] = gateJobs(g, id);
  assert.deepEqual(result.pre_send_gate, { ticket_id: job.id, waived: ["primary-authority", "excerpts"] });
  const steps = stepsOf(g, job.id);
  assert.deepEqual(
    steps.map((s) => s.text),
    [
      `primary-authority — Every proposition of law rests on primary authority: unmet (1 open) [rev ${revision}] — WAIVED: ${WORDS}`,
      `excerpts — Every excerpt is quoted, pinpointed and checked: unmet (1 open) [rev ${revision}] — WAIVED: ${WORDS}`,
    ]
  );
  assert.ok(steps.every((s) => s.done_at !== null));
  assert.equal(job.status, "completed");

  const after = filing(g, id);
  assert.equal(after.filed_on, "2026-09-25");
  assert.equal(after.sent_copy_id, result.sent_copy_id);
  assert.deepEqual(JSON.parse(after.signer_snapshot), {
    key: "pe", name: "Pat Example", designation: "Barrister & Solicitor", role: "lawyer", email: "pat@fixture.test",
    direct_line: "604-555-0100", closing: "Yours truly,", initials: "PE", active: true,
  });
  assert.deepEqual([after.layout_snapshot, after.needs_forum_parts], [before.layout_snapshot, before.needs_forum_parts], "the layout is not touched");
  assert.equal(documentCount(g), documents + 1);
  assert.deepEqual(g.query("SELECT label, document_date, file_path FROM documents WHERE id = ?", [result.sent_copy_id])[0], {
    label: "Sent copy — Letter to Cara",
    document_date: "2026-09-25",
    file_path: null,
  });
  assert.ok(result.revision > revision, "the Sent write moves the revision");
  assert.equal(result.revision, g.revision());
  assert.deepEqual([result.comparison.method, result.comparison.compared, result.comparison.paragraphs], ["text", true, 2]);
  assert.equal("offer_delivered" in result, false, "recording a Writing as sent never leads to a retirement offer (ADR 0042)");
  assert.equal(result.recorded_by, "pe");

  // The board reads the Writing as sent, its gate met with the waived steps.
  const board = render(g, id).board;
  assert.deepEqual([board.meta.state_label, board.goal.text], ["Sent", "Sent on 2026-09-25"]);
  assert.deepEqual(board.criteria.find((c) => c.id === "gate").state, "met");

  await assert.rejects(send(g, id), code("already_sent"));
});

test("with nothing held, a .eml copy is compared and recorded with no Pre-send gate job", async (t) => {
  const { g, id } = await drafted(t);
  setInventory(g, id, [unreviewed]);
  const eml = join(g.f.scratch, "sent.eml");
  writeFileSync(eml, `From: pat@fixture.test\r\nTo: cara@counsel.test\r\nSubject: Late objection\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${AS_SENT.replace(/\n/g, "\r\n")}\r\n`);

  const result = await send(g, id, { sent_copy_text: undefined, sent_copy_path: eml, send_anyway: WORDS });
  assert.equal(result.pre_send_gate, null);
  assert.equal(gateJobs(g, id).length, 0);
  assert.deepEqual([result.comparison.method, result.comparison.compared, result.comparison.missing], ["eml", true, []]);
  assert.match(result.note, /Nothing held sending, so the send_anyway words were not recorded/);
  assert.equal(g.query("SELECT file_path FROM documents WHERE id = ?", [result.sent_copy_id])[0].file_path, eml);
});

test("a party row another recorder wrote between the read and the write is refused as already_sent, and nothing is written", async (t) => {
  const { g, id } = await drafted(t);
  setInventory(g, id, [unreviewed]);
  // A concurrent recorder's party row, landing inside the Sent write's own transaction.
  await g.execute(
    `CREATE TRIGGER concurrent_snapshot AFTER UPDATE ON db_meta
     WHEN NEW.key = 'revision' AND NOT EXISTS (SELECT 1 FROM parties_snapshot WHERE filing_id = ${id})
     BEGIN
       INSERT INTO parties_snapshot (filing_id, party_id, name, role, ordinal, is_client, is_applicant, to_be_served, address_for_service_filed)
         VALUES (${id}, 1, 'Ada Client', 'Claimant', 1, 1, 0, 0, 'unknown');
     END;`
  );
  const documents = documentCount(g);
  await assert.rejects(send(g, id, { send_anyway: WORDS }), code("already_sent"));
  assert.deepEqual([filing(g, id).filed_on, filing(g, id).sent_copy_id], [null, null]);
  assert.equal(documentCount(g), documents);
  assert.deepEqual(printed(g, id), []);
});

test("the Sent write records the party rows from case data, and a later matter-data change leaves them as sent", async (t) => {
  const { g, id } = await drafted(t);
  updateCaseData(g.f.scratch, "UPDATE parties SET lawyer_name = 'Y. Counsel', lawyer_email = 'y@counsel.test', address = '2 Y St' WHERE party_id = 2;");
  await g.prose(id, "sender", "Fixture Law LLP");
  const toLine = "To: Y. Counsel — counsel for Bert Other (y@counsel.test | 2 Y St)";
  assert.ok(letterOf(render(g, id)).includes(toLine), "the drafting letter prints case data's counsel");
  await send(g, id);
  const sent = [
    [1, "Ada Client", "Claimant", null, "ada@client.test", null],
    [2, "Bert Other", "Respondent", "Y. Counsel", "y@counsel.test", "2 Y St"],
  ];
  assert.deepEqual(printed(g, id), sent);
  updateCaseData(g.f.scratch, "UPDATE parties SET lawyer_name = 'Z. Counsel', lawyer_email = NULL WHERE party_id = 2;");
  assert.ok(letterOf(render(g, id)).includes(toLine), "the sent letter prints the counsel it was sent with");
  assert.ok(letterOf(render(g, id, "filed")).includes(toLine));
  assert.deepEqual(printed(g, id), sent);
});

test("a sent letter's party-linked recipient re-pointed or re-described after the send prints the party and capacity it was sent with, with no 🏷️ line (#1307)", async (t) => {
  const { g, id } = await drafted(t);
  await g.prose(id, "sender", "Fixture Law LLP");
  render(g, id);
  await send(g, id);
  const toLine = "To: Cara Counsel — counsel for Bert Other (cara@counsel.test)";
  assert.ok(letterOf(render(g, id)).includes(toLine), letterOf(render(g, id)));
  await g.execute(
    "INSERT INTO parties (id, proceeding_id, name, role, ordinal, case_party_id) VALUES (5, 1, 'Cy Added', 'Respondent', 3, NULL); " +
      "UPDATE recipients SET party_id = 5, capacity = 'counsel for Cy Added' WHERE id = 1;"
  );
  for (const mode of ["mockup", "filed"]) {
    const letter = letterOf(render(g, id, mode));
    assert.ok(letter.includes(toLine), `${mode}: ${letter}`);
    assert.doesNotMatch(letter, /🏷️|Cy Added/, mode);
  }
});

test("a sent letter's recipient with no party keeps the values it was sent with, while a new draft prints the edited ones (#1307)", async (t) => {
  const { g, id } = await drafted(t);
  await g.prose(id, "sender", "Fixture Law LLP");
  await g.recipient(id, 3, "cc");
  render(g, id);
  await send(g, id);
  const ccLine = "cc: Dan Registrar — the registry (800 Smithe Street)";
  await g.execute("UPDATE recipients SET name = 'Eve Registrar', capacity = 'the new registry', email = 'eve@court.test', address = '1 New Street' WHERE id = 3;");
  for (const mode of ["mockup", "filed"]) {
    const letter = letterOf(render(g, id, mode));
    assert.ok(letter.includes(ccLine), `${mode}: ${letter}`);
    assert.doesNotMatch(letter, /Eve Registrar/, mode);
  }
  const { filing_id: next } = await g.createLetter({ title: "Second letter" });
  await g.recipient(next, 3, "to");
  assert.ok(letterOf(render(g, next)).includes("To: Eve Registrar — the new registry (eve@court.test | 1 New Street)"));
});

test("a sent letter's recipients are frozen: adding, changing or removing one is refused, and none moves in or out (#1307)", async (t) => {
  const { g, id } = await drafted(t);
  await g.prose(id, "sender", "Fixture Law LLP");
  render(g, id);
  await send(g, id);
  const { filing_id: next } = await g.createLetter({ title: "Second letter" });
  await g.recipient(next, 3, "to");
  const frozen = /a sent or retired Writing's recipients do not change/;
  await assert.rejects(g.recipient(id, 3, "cc"), frozen);
  await assert.rejects(g.execute(`UPDATE filing_recipients SET role = 'cc' WHERE filing_id = ${id};`), frozen);
  await assert.rejects(g.execute(`DELETE FROM filing_recipients WHERE filing_id = ${id};`), frozen);
  await assert.rejects(g.execute(`UPDATE filing_recipients SET filing_id = ${id} WHERE filing_id = ${next};`), frozen);
  await assert.rejects(g.execute(`UPDATE filing_recipients SET filing_id = ${next} WHERE filing_id = ${id};`), frozen);
  await g.execute(`UPDATE filing_recipients SET role = 'cc' WHERE filing_id = ${next};`);
  await g.execute(`DELETE FROM filing_recipients WHERE filing_id = ${next};`);
  assert.deepEqual(g.query("SELECT filing_id, recipient_id, role FROM filing_recipients ORDER BY id"), [{ filing_id: id, recipient_id: 1, role: "to" }]);
});

test("a retired letter's recipients are frozen, and retiring it snapshots none (#1307)", async (t) => {
  const { g, id } = await drafted(t);
  await g.execute(`UPDATE filings SET retired_on = '2026-09-25', retirement_reason = 'other' WHERE id = ${id};`);
  await assert.rejects(g.recipient(id, 3, "cc"), /a sent or retired Writing's recipients do not change/);
  assert.deepEqual(g.query("SELECT * FROM recipients_snapshot"), []);
});

test("a sent letter on a database migrated from v43 prints the same recipient lines, a 🏷️ line included (#1307)", async (t) => {
  const g = await generalWritingFixture(t, { front: null, block: VETTED_LETTER, version: 43 });
  const { filing_id: id } = await g.createLetter();
  await g.prose(id, "addressee", "Cara Counsel");
  await g.prose(id, "body", BODY);
  await g.prose(id, "sender", "Fixture Law LLP");
  await g.recipient(id, 1, "to");
  await g.recipient(id, 3, "cc");
  await g.recipient(id, 2, "bcc");
  await g.execute(`${partiesSnapshotSql(g.dbPath, id)} UPDATE filings SET filed_on = '2026-09-25' WHERE id = ${id};`);
  await g.execute(
    "INSERT INTO parties (id, proceeding_id, name, role, ordinal, case_party_id) VALUES (5, 1, 'Cy Added', 'Respondent', 3, NULL); " +
      "UPDATE recipients SET party_id = 5 WHERE id = 2;"
  );
  const recipientLines = (mode) =>
    letterOf(render(g, id, mode))
      .split("\n")
      // A blind copy is an item of the header's Blind copies list (plan 2026-10-07 step 3).
      .filter((l) => /^(?: {2}- )?(?:(?:To|cc|bcc): |🏷️ )/.test(l));
  const before = { mockup: recipientLines("mockup"), filed: recipientLines("filed") };
  assert.equal(before.mockup.length, 3, before.mockup.join("\n"));
  assert.ok(before.mockup.some((l) => l.startsWith("  - 🏷️ bcc recipient 2")), before.mockup.join("\n"));

  const migrated = await submissionDataMigrate(g.dbPath);
  assert.deepEqual(migrated.applied, hopsFrom(43));
  assert.deepEqual({ mockup: recipientLines("mockup"), filed: recipientLines("filed") }, before);
});

test("the Sent write refuses while a party drifts, before the hold, and writes nothing", async (t) => {
  const { g, id } = await drafted(t);
  await g.execute("UPDATE parties SET case_party_id = NULL WHERE id = 2;");
  render(g, id);
  setInventory(g, id, [unproven]);
  const revision = g.revision();
  const documents = documentCount(g);
  await assert.rejects(send(g, id), code("parties_drift", /Bert Other \(unlinked\).*drafting_data__record_sent again/));
  assert.deepEqual([filing(g, id).filed_on, documentCount(g), gateJobs(g, id).length, printed(g, id), g.revision()], [null, documents, 0, [], revision]);
});

test("a .msg copy is recorded by path and not compared, and the result says so", async (t) => {
  const { g, id } = await drafted(t);
  const msg = join(g.f.scratch, "sent.msg");
  writeFileSync(msg, "not readable without an external package");
  const result = await send(g, id, { sent_copy_text: undefined, sent_copy_path: msg });
  assert.deepEqual([result.comparison.method, result.comparison.compared], ["msg", false]);
  assert.match(result.note, /recorded by path and was not compared/);
  assert.match(g.query("SELECT description FROM documents WHERE id = ?", [result.sent_copy_id])[0].description, /\.msg\), recorded by path and not compared/);
});

test("a copy lacking a stored paragraph is refused, naming it, and nothing is written", async (t) => {
  const { g, id } = await drafted(t);
  const documents = documentCount(g);
  await assert.rejects(send(g, id, { sent_copy_text: "Dear Cara,\n\n1. First paragraph of the letter." }), code("sent_copy_mismatch", /"Second paragraph of the letter\."/));
  assert.deepEqual([filing(g, id).filed_on, documentCount(g)], [null, documents]);
});

test("with nothing held, a copy mismatch leaves an open Pre-send gate job and its steps as they were: step closure is in the Sent write's transaction", async (t) => {
  const { g, id } = await drafted(t);
  setInventory(g, id, [unquoted]);
  await assert.rejects(send(g, id), code("held"));
  const [job] = gateJobs(g, id);
  const steps = stepsOf(g, job.id);
  assert.equal(steps[0].done_at, null);

  setInventory(g, id, []);
  await assert.rejects(send(g, id, { sent_copy_text: "Dear Cara,\n\n1. First paragraph of the letter." }), code("sent_copy_mismatch"));
  assert.deepEqual(gateJobs(g, id), [job], "the job is still queued");
  assert.deepEqual(stepsOf(g, job.id), steps, "no step was closed as met");

  // The copy as sent closes the step as met and completes the job with the Sent write.
  const result = await send(g, id);
  assert.deepEqual(result.pre_send_gate, { ticket_id: job.id, waived: [] });
  assert.equal(gateJobs(g, id)[0].status, "completed");
  const [closed] = stepsOf(g, job.id);
  assert.match(closed.text, /^excerpts — Every excerpt is quoted, pinpointed and checked: met \[rev \d+\]$/);
  assert.notEqual(closed.done_at, null);
});

// A Pass 2 finding job holds sending (jobs-stock.md §3g; letter-passes spec §12 decision 1).
const PASS2 = "Decide a position our own correspondence contradicts";
const pass2Job = async (g, id, { rejected = false } = {}) => {
  await g.execute(
    `INSERT INTO tickets (proceeding_id, filing_id, title, intent, kind, priority, billing_anchor, created${rejected ? ", rejected_at" : ""})
       VALUES (1, ${id}, '${PASS2}', 'Counsel decides whether this Writing keeps, narrows or drops a position the firm''s own prior correspondence or filings contradict.', 'work', 0, 'L0000|late objection', '2026-09-25T09:10'${rejected ? ", '2026-09-25T09:20'" : ""});`
  );
  const [{ id: ticketId }] = g.query("SELECT id FROM tickets WHERE filing_id = ? AND title = ? ORDER BY id DESC LIMIT 1", [id, PASS2]);
  await g.execute(`INSERT INTO ticket_steps (ticket_id, ordinal, text) VALUES (${ticketId}, 1, '¶1: "First paragraph of the letter." — contradicts; our letter of 2 April: "Second paragraph."');`);
  return ticketId;
};

test("an open Pass 2 finding job holds sending as position-conflict, and closing it lets the letter be recorded as sent", async (t) => {
  const { g, id } = await drafted(t);
  setInventory(g, id, [unreviewed]);
  const finding = await pass2Job(g, id);
  const revision = g.revision();

  await assert.rejects(send(g, id), code("held", new RegExp(`position-conflict \\(decide Job #${finding}\\)`)));
  const [job] = gateJobs(g, id);
  assert.deepEqual(
    stepsOf(g, job.id).map((s) => [s.ordinal, s.text, s.done_at]),
    [[1, `position-conflict — Counsel has decided every position the firm's own correspondence contradicts: unmet (1 open) [rev ${revision}]`, null]]
  );

  // Counsel decides: the finding job completes, and the hold reads met.
  await g.execute(`UPDATE tickets SET status = 'completed', completed_at = '2026-09-25T09:40' WHERE id = ${finding};`);
  const result = await send(g, id);
  assert.deepEqual(result.pre_send_gate, { ticket_id: job.id, waived: [] });
  assert.match(stepsOf(g, job.id)[0].text, /^position-conflict — .*: met \[rev \d+\]$/);
  assert.equal(filing(g, id).filed_on, "2026-09-25");
});

test("a shelved Pass 2 finding job holds nothing, and send anyway waives an open one", async (t) => {
  const shelved = await drafted(t);
  setInventory(shelved.g, shelved.id, [unreviewed]);
  await pass2Job(shelved.g, shelved.id, { rejected: true });
  const recorded = await send(shelved.g, shelved.id);
  assert.equal(recorded.pre_send_gate, null);

  const { g, id } = await drafted(t);
  setInventory(g, id, [unreviewed]);
  await pass2Job(g, id);
  const result = await send(g, id, { send_anyway: WORDS });
  const [job] = gateJobs(g, id);
  assert.deepEqual(result.pre_send_gate, { ticket_id: job.id, waived: ["position-conflict"] });
  assert.ok(stepsOf(g, job.id)[0].text.endsWith(` — WAIVED: ${WORDS}`));
});

// The Deliver job closes with the Sent write (#1233), whichever route made it.
const deliverJob = (g, id) => g.query("SELECT id, status, completed_at, locked_by, locked_at FROM tickets WHERE filing_id = ? AND title = 'Deliver'", [id])[0];
const deliverOf = async (g, id, jobStatus = "queued") => {
  const { id: ticketId } = deliverJob(g, id);
  await g.execute(
    `INSERT INTO ticket_steps (ticket_id, ordinal, text) VALUES (${ticketId}, 1, 'Send the letter to its recipients'), (${ticketId}, 2, 'Record the letter as sent');` +
      (jobStatus === "wip" ? `UPDATE tickets SET status = 'wip', locked_by = 'session-1', locked_at = '2026-09-25T09:30' WHERE id = ${ticketId};` : "") +
      (jobStatus === "completed" ? `UPDATE tickets SET status = 'completed', completed_at = '2026-09-25T09:45' WHERE id = ${ticketId};` : "")
  );
  return ticketId;
};
const deliverSteps = (g, ticketId) => stepsOf(g, ticketId).map((s) => s.done_at !== null);

test("recording a letter as sent completes its queued Deliver job with both steps done, and the result names it", async (t) => {
  const { g, id } = await drafted(t);
  const ticketId = await deliverOf(g, id);
  const result = await send(g, id);
  assert.deepEqual(result.deliver, { ticket_id: ticketId });
  const job = deliverJob(g, id);
  assert.deepEqual([job.status, job.locked_by, job.locked_at], ["completed", null, null]);
  assert.notEqual(job.completed_at, null);
  assert.deepEqual(deliverSteps(g, ticketId), [true, true]);
});

test("send anyway on a held letter, and an internal memo, close Deliver too", async (t) => {
  const { g, id } = await drafted(t);
  const ticketId = await deliverOf(g, id);
  setInventory(g, id, [unquoted]);
  await assert.rejects(send(g, id), code("held"));
  assert.equal(deliverJob(g, id).status, "queued", "the held refusal leaves Deliver as it stood");
  assert.deepEqual(deliverSteps(g, ticketId), [false, false]);
  await send(g, id, { send_anyway: WORDS });
  assert.equal(deliverJob(g, id).status, "completed");
  assert.deepEqual(deliverSteps(g, ticketId), [true, true]);

  const memo = await draftedMemo(t);
  memo.setMemoInventory([]);
  const memoTicket = await deliverOf(memo.g, memo.id);
  assert.deepEqual((await send(memo.g, memo.id)).deliver, { ticket_id: memoTicket });
  assert.equal(deliverJob(memo.g, memo.id).status, "completed");
  assert.deepEqual(deliverSteps(memo.g, memoTicket), [true, true]);
});

test("a wip Deliver job ends completed with its lock cleared", async (t) => {
  const { g, id } = await drafted(t);
  const ticketId = await deliverOf(g, id, "wip");
  await send(g, id);
  const job = deliverJob(g, id);
  assert.deepEqual([job.status, job.locked_by, job.locked_at], ["completed", null, null]);
  assert.deepEqual(deliverSteps(g, ticketId), [true, true]);
});

test("a Writing with no Deliver job is recorded as sent with no error and no extra writes", async (t) => {
  const { g, id } = await drafted(t);
  await g.execute(`DELETE FROM tickets WHERE filing_id = ${id} AND title = 'Deliver';`);
  const result = await send(g, id);
  assert.equal(result.deliver, null);
  assert.equal(filing(g, id).filed_on, "2026-09-25");
  assert.equal(g.query("SELECT COUNT(*) AS n FROM tickets WHERE filing_id = ?", [id])[0].n, 0);
});

test("a refused Sent write leaves Deliver as it stood: held, render_first and sent_copy_mismatch", async (t) => {
  const { g, id } = await drafted(t);
  const ticketId = await deliverOf(g, id);
  const before = [deliverJob(g, id), stepsOf(g, ticketId)];
  const unchanged = () => assert.deepEqual([deliverJob(g, id), stepsOf(g, ticketId)], before);

  setInventory(g, id, [unquoted]);
  await assert.rejects(send(g, id), code("held"));
  unchanged();

  setInventory(g, id, []);
  await assert.rejects(send(g, id, { sent_copy_text: "Dear Cara,\n\n1. First paragraph of the letter." }), code("sent_copy_mismatch"));
  unchanged();

  await g.execute(`UPDATE filing_prose SET text = 'A changed first paragraph.' WHERE filing_id = ${id} AND slot = 'body';`);
  await assert.rejects(send(g, id), code("render_first"));
  unchanged();
});

test("a superseded or shelved Deliver job is left as it stands, and the Sent write still succeeds", async (t) => {
  for (const [label, set] of [
    ["superseded", (job) => `UPDATE tickets SET status = 'superseded', superseded_by = ${job + 1} WHERE id = ${job};`],
    ["shelved", (job) => `UPDATE tickets SET rejected_at = '2026-09-25T09:45' WHERE id = ${job};`],
  ]) {
    const { g, id } = await drafted(t);
    const ticketId = await deliverOf(g, id);
    await g.execute(`INSERT INTO tickets (proceeding_id, filing_id, title, intent, kind, priority, billing_anchor, created) VALUES (1, ${id}, 'Other', 'x', 'work', 5, 'L0000|x', '2026-09-25T09:00');`);
    await g.execute(set(ticketId));
    const before = [deliverJob(g, id), stepsOf(g, ticketId)];
    assert.equal((await send(g, id)).deliver, null, label);
    assert.deepEqual([deliverJob(g, id), stepsOf(g, ticketId)], before, label);
    assert.equal(filing(g, id).filed_on, "2026-09-25", label);
  }
});

test("a Deliver job a job session already completed is left as it is, and the Sent write still succeeds", async (t) => {
  const { g, id } = await drafted(t);
  const ticketId = await deliverOf(g, id, "completed");
  const before = [deliverJob(g, id), stepsOf(g, ticketId)];
  const result = await send(g, id);
  assert.equal(result.deliver, null);
  assert.deepEqual([deliverJob(g, id), stepsOf(g, ticketId)], before, "no double-stamp");
  assert.equal(filing(g, id).filed_on, "2026-09-25");
});

/** An internal memo (#1161: sent like a letter), saved with the memo's `Deliver` job (jobs.md §3b), drafted and rendered once. */
async function draftedMemo(t) {
  const g = await generalWritingFixture(t);
  const part = (source) => ({ heading: null, heading_numbering: "none", paragraph_numbering: "none", source });
  g.f.local(
    MEMO_FILE,
    knowledgeFile(null, { ...MEMO_BLOCK, goal_criteria: ["primary-authority", "excerpts", "noting-up"], parts: [part("addressee"), part("slot:body")] })
  );
  const { filing_id: id } = await g.create({ proceeding_id: 1, tree: NO_VENUE_TREE, kind: "internal_memo", recipient: "internal", title: "Memo to file" });
  await g.confirm(id);
  await g.prose(id, "addressee", "File");
  await g.prose(id, "body", BODY);
  await g.execute(
    `INSERT INTO tickets (proceeding_id, filing_id, title, intent, kind, priority, billing_anchor, created)
       VALUES (1, ${id}, 'Deliver', 'Circulate this memo or put it on file, and record it as sent.', 'work', 0, 'L0000|limitation analysis', '2026-09-25T09:00');`
  );
  render(g, id);
  const manifest = join(dirname(g.dbPath), "mockups", `Filing ${id}`, "render-manifest.json");
  const setMemoInventory = (inventory) =>
    writeFileSync(manifest, JSON.stringify({ ...JSON.parse(readFileSync(manifest, "utf-8")), inventory }), "utf-8");
  return { g, id, setMemoInventory };
}

test("an internal memo is sent like a letter: an unmet held criterion holds it, copying the anchor of its Deliver job", async (t) => {
  const { g, id, setMemoInventory } = await draftedMemo(t);
  setMemoInventory([unquoted]);
  await assert.rejects(send(g, id), code("held", /excerpts/));
  const [job] = gateJobs(g, id);
  assert.equal(job.billing_anchor, "L0000|limitation analysis");
  assert.equal(filing(g, id).filed_on, null);
});

test("an internal memo with nothing held is recorded as sent, its lawyer signer snapshotted", async (t) => {
  const { g, id, setMemoInventory } = await draftedMemo(t);
  setMemoInventory([]);
  const result = await send(g, id);
  assert.equal(result.pre_send_gate, null);
  assert.equal(result.signer_snapshot.key, "pe");
  assert.equal(filing(g, id).filed_on, "2026-09-25");
});

// A `terms` part's clauses are stored text (#1164): each selected clause, in filing_clauses order,
// as its wording_override when set, else its wording.
const CLAUSE_1 = "The Releasor releases the Releasee from every claim arising from the accident.";
const CLAUSE_2 = "This settlement admits no liability.";
const RELEASE_COPY = `Release\n\n1. ${CLAUSE_1}\n\n2. ${CLAUSE_2}\n\nAda Client`;

/** A release (signed by Ada Client) whose layout is `sources` then its signature block, with two
 * clauses selected, the second worded by this Writing, and `body` as its body prose row when given;
 * rendered once, with nothing held. */
async function draftedRelease(t, { sources = ["terms"], body = null } = {}) {
  const g = await generalWritingFixture(t);
  const part = (source) => ({ heading: null, heading_numbering: "none", paragraph_numbering: source === "terms" ? "restart" : "none", source });
  g.f.local("draft/CAN/FX/_NoVenue/Documents/kinds.local.json", {
    kinds: [{ file: "release", name: "Release", recipient: "opposing-party", aliases: [{ name: "release", source: "agent", ref: "L0000", recorded: "2026-09-20" }] }],
  });
  g.f.local(
    "draft/CAN/FX/_NoVenue/Documents/release.md",
    knowledgeFile(null, {
      renderer: "general", needs_forum_parts: false, folder_code: "REL", title: "Release", exhibit_numbering: "writing", signer: "party",
      goal_criteria: ["terms-traced"], parts: [...sources.map(part), part("signature-block")],
    })
  );
  const { filing_id: id } = await g.create({ proceeding_id: 1, tree: NO_VENUE_TREE, kind: "release", recipient: "opposing-party", title: "Release", signer_party_id: 1 });
  await g.execute(`
INSERT INTO clauses (id, proceeding_id, wording, basis, document_id, pinpoint, excerpt, excerpt_id) VALUES
  (1, 1, '${CLAUSE_1}', 'implied', NULL, NULL, NULL, NULL),
  (2, 1, 'The settlement is no admission of liability.', 'implied', NULL, NULL, NULL, NULL);
INSERT INTO filing_clauses (filing_id, clause_id, ordinal, wording_override) VALUES (${id}, 1, 1, NULL), (${id}, 2, 2, '${CLAUSE_2}');
`);
  if (body !== null) await g.prose(id, "body", body);
  render(g, id);
  const manifest = join(dirname(g.dbPath), "mockups", `Filing ${id}`, "render-manifest.json");
  writeFileSync(manifest, JSON.stringify({ ...JSON.parse(readFileSync(manifest, "utf-8")), inventory: [] }), "utf-8");
  return { g, id };
}

test("a Writing whose only content is a terms part has stored text: a copy with every clause's wording is recorded as sent", async (t) => {
  const { g, id } = await draftedRelease(t);
  const result = await send(g, id, { sent_copy_text: RELEASE_COPY });
  assert.deepEqual([result.comparison.compared, result.comparison.missing, result.comparison.paragraphs], [true, [], 2]);
  assert.equal(filing(g, id).filed_on, "2026-09-25");
});

test("a copy missing a clause, or altering it, is refused naming the clause, and nothing is written", async (t) => {
  const { g, id } = await draftedRelease(t);
  const documents = documentCount(g);
  await assert.rejects(send(g, id, { sent_copy_text: `Release\n\n1. ${CLAUSE_1}\n\nAda Client` }), code("sent_copy_mismatch", /"This settlement admits no liability\."/));
  // The clause's own wording, where this Writing overrides it, is an altered clause.
  await assert.rejects(
    send(g, id, { sent_copy_text: RELEASE_COPY.replace(CLAUSE_2, "The settlement is no admission of liability.") }),
    code("sent_copy_mismatch", /"This settlement admits no liability\."/)
  );
  assert.deepEqual([filing(g, id).filed_on, documentCount(g)], [null, documents]);
});

test("a Writing with slot prose and a terms part is checked against both, in part order", async (t) => {
  const { g, id } = await draftedRelease(t, { sources: ["slot:body", "terms"], body: BODY });
  const both = `First paragraph of the letter.\n\nSecond paragraph of the letter.\n\n${RELEASE_COPY}`;
  await assert.rejects(send(g, id, { sent_copy_text: both.replace(CLAUSE_1, "The Releasor releases nothing.") }), code("sent_copy_mismatch", /"The Releasor releases the Releasee/));
  await assert.rejects(send(g, id, { sent_copy_text: both.replace("Second paragraph", "Another paragraph") }), code("sent_copy_mismatch", /"Second paragraph of the letter\."/));
  const result = await send(g, id, { sent_copy_text: both });
  assert.equal(result.comparison.paragraphs, 4);
});

// #1229: the hold's universal currency check. An implied clause the Writing prints, naming the
// enactment its cited statement rests on while that authority's stored statute-currency result is
// not `current`, holds sending; send_anyway waives it like any held criterion.
const CLAUSE_3 = "The Releasor accepts that the Limitation Act, SBC 2012, c 13 governs every claim.";
const ENACTMENT_COPY = `Release\n\n1. ${CLAUSE_1}\n\n2. ${CLAUSE_2}\n\n3. ${CLAUSE_3}\n\nAda Client`;
const CURRENCY_STEP = "currency — No implied clause names an enactment whose statute-currency result is not current";

/** draftedRelease with a third clause naming the Limitation Act, a statute whose stored currency
 * result is `currency` (null: never checked): `implied`, citing a statement on it, or `express`, from
 * an offer letter. With the Deliver job a Pre-send gate job copies its anchor from; rendered again. */
async function enactmentRelease(t, { currency, basis = "implied", sources = ["terms"] }) {
  const { g, id } = await draftedRelease(t, { sources, body: sources.includes("slot:body") ? BODY : null });
  const clause =
    basis === "implied" ? `(3, 1, '${CLAUSE_3}', 'implied', NULL, NULL, NULL, 81)` : `(3, 1, '${CLAUSE_3}', 'express', 50, 'p. 1', 'the Limitation Act governs', NULL)`;
  await g.execute(`
INSERT INTO documents (id, proceeding_id, label) VALUES (50, 1, 'Offer letter');
INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind, currency_status) VALUES
  (80, 1, 'Limitation Act', 'SBC 2012, c 13', 'statute', ${currency === null ? "NULL" : `'${currency}'`});
INSERT INTO statements_of_law (id, proceeding_id, authority_id, pinpoint, excerpt, verification) VALUES (81, 1, 80, 's 6', 'The statute passage.', 'verified');
INSERT INTO clauses (id, proceeding_id, wording, basis, document_id, pinpoint, excerpt, excerpt_id) VALUES ${clause};
INSERT INTO filing_clauses (filing_id, clause_id, ordinal, wording_override) VALUES (${id}, 3, 3, NULL);
INSERT INTO tickets (proceeding_id, filing_id, title, intent, kind, priority, billing_anchor, created)
  VALUES (1, ${id}, 'Deliver', 'Send this release and record it as sent.', 'work', 0, 'L0000|settlement', '2026-09-25T09:00');
`);
  render(g, id);
  return { g, id };
}

test("an implied clause naming an enactment never checked holds sending: a currency step comes last on the Pre-send gate job, and the refusal names the clause", async (t) => {
  const { g, id } = await enactmentRelease(t, { currency: null });
  const revision = g.revision();
  await assert.rejects(send(g, id, { sent_copy_text: ENACTMENT_COPY }), code("held", /currency \(clause_id 3 \[currency: unchecked\]\) unmet now/));
  const [job] = gateJobs(g, id);
  assert.deepEqual(
    stepsOf(g, job.id).map((s) => [s.ordinal, s.text, s.done_at]),
    [[1, `${CURRENCY_STEP}: unmet (1 open) [rev ${revision}]`, null]]
  );
  assert.equal(filing(g, id).filed_on, null);
});

test("an implied clause naming a repealed enactment holds sending", async (t) => {
  const { g, id } = await enactmentRelease(t, { currency: "repealed" });
  await assert.rejects(send(g, id, { sent_copy_text: ENACTMENT_COPY }), code("held", /clause_id 3 \[currency: repealed\]/));
  assert.match(stepsOf(g, gateJobs(g, id)[0].id)[0].text, /^currency — .*: unmet \(1 open\) \[rev \d+\]$/);
});

test("send anyway waives the currency check: recorded WAIVED, the job completed, and currency listed as waived", async (t) => {
  const { g, id } = await enactmentRelease(t, { currency: "repealed" });
  const revision = g.revision();
  const result = await send(g, id, { sent_copy_text: ENACTMENT_COPY, send_anyway: WORDS });
  const [job] = gateJobs(g, id);
  assert.deepEqual(result.pre_send_gate, { ticket_id: job.id, waived: ["currency"] });
  const [step] = stepsOf(g, job.id);
  assert.equal(step.text, `${CURRENCY_STEP}: unmet (1 open) [rev ${revision}] — WAIVED: ${WORDS}`);
  assert.notEqual(step.done_at, null);
  assert.equal(job.status, "completed");
  assert.equal(filing(g, id).filed_on, "2026-09-25");
});

test("once the stored currency result is current and the Writing is rendered again, nothing holds it: the currency step closes as met", async (t) => {
  const { g, id } = await enactmentRelease(t, { currency: "repealed" });
  await assert.rejects(send(g, id, { sent_copy_text: ENACTMENT_COPY }), code("held"));
  const [job] = gateJobs(g, id);
  await g.execute(`UPDATE authorities SET currency_status = 'current', currency_checked_on = '2026-09-28' WHERE id = 80;
INSERT INTO provision_currency (authority_id, provision, currency_status, checked_on, current_to) VALUES (80, 's 6', 'current', '2026-09-28', '2026-09-01');`);
  render(g, id);

  const result = await send(g, id, { sent_copy_text: ENACTMENT_COPY });
  assert.deepEqual(result.pre_send_gate, { ticket_id: job.id, waived: [] });
  assert.match(stepsOf(g, job.id)[0].text, /^currency — .*: met \[rev \d+\]$/);
  assert.equal(gateJobs(g, id)[0].status, "completed");
});

test("an express clause naming a repealed enactment does not hold sending", async (t) => {
  const { g, id } = await enactmentRelease(t, { currency: "repealed", basis: "express" });
  const result = await send(g, id, { sent_copy_text: ENACTMENT_COPY });
  assert.equal(result.pre_send_gate, null);
  assert.equal(filing(g, id).filed_on, "2026-09-25");
});

test("a selected clause no part prints does not hold sending: a Writing whose stored layout has no terms part", async (t) => {
  const { g, id } = await enactmentRelease(t, { currency: null, sources: ["slot:body"] });
  const result = await send(g, id, { sent_copy_text: BODY });
  assert.equal(result.pre_send_gate, null);
  assert.equal(filing(g, id).filed_on, "2026-09-25");
});

/** A BCSC letter to the court: it needs forum parts and declares the three authority criteria (#1236), drafted, with its
 * Deliver job, and rendered once. Its title is the counsel letter's, so the render helpers find its manifest. */
async function venueLetter(t) {
  const g = await generalWritingFixture(t, { front: null, block: VETTED_LETTER });
  const part = (source) => ({ heading: null, heading_numbering: "none", paragraph_numbering: "none", source });
  g.f.local("draft/CAN/BC/BCSC/Documents/kinds.local.json", {
    kinds: [{ file: "letter", name: "Letter to the court", aliases: [{ name: "letter", source: "agent", ref: "L0000", recorded: "2026-09-20" }] }],
  });
  g.f.local(
    "draft/CAN/BC/BCSC/Documents/letter.md",
    knowledgeFile(null, {
      renderer: "general",
      needs_forum_parts: true,
      folder_code: "LTR",
      title: "Letter to the court",
      exhibit_numbering: "writing",
      goal_criteria: ["primary-authority", "excerpts", "noting-up"],
      parts: [part("slot:body")],
    })
  );
  const { filing_id: id, needs_forum_parts } = await g.create({ proceeding_id: 2, tree: BCSC_TREE, kind: "letter", title: "Letter to Cara" });
  assert.equal(needs_forum_parts, 1);
  await g.prose(id, "body", BODY);
  await g.execute(
    `INSERT INTO tickets (proceeding_id, filing_id, title, intent, kind, priority, billing_anchor, created)
       VALUES (2, ${id}, 'Deliver', 'Send this letter to its recipients and record it as sent.', 'work', 0, 'L0000|late objection', '2026-09-25T09:00');`
  );
  render(g, id);
  return { g, id };
}

test("a venue's letter is held like any other: an unmet criterion refuses the Sent write and leaves a Pre-send gate job", async (t) => {
  const { g, id } = await venueLetter(t);
  setInventory(g, id, [unquoted]);
  await assert.rejects(send(g, id), code("held", /excerpts \(Example v\. Authority, 2020 BCSC 1\)/));
  const [job] = gateJobs(g, id);
  assert.equal(job.status, "queued");
  assert.match(stepsOf(g, job.id)[0].text, /^excerpts — .*: unmet \(1 open\) \[rev \d+\]$/);
  assert.deepEqual([filing(g, id).filed_on, filing(g, id).sent_copy_id], [null, null]);
});

test("send anyway records a venue's letter as sent with the waiver on each open step", async (t) => {
  const { g, id } = await venueLetter(t);
  setInventory(g, id, [unquoted]);
  const result = await send(g, id, { send_anyway: WORDS });
  const [job] = gateJobs(g, id);
  assert.deepEqual(result.pre_send_gate, { ticket_id: job.id, waived: ["excerpts"] });
  assert.match(stepsOf(g, job.id)[0].text, new RegExp(` — WAIVED: ${WORDS}$`));
  assert.equal(job.status, "completed");
  assert.equal(filing(g, id).filed_on, "2026-09-25");
});

test("a venue's letter meeting every criterion is recorded as sent with no Pre-send gate job, but only after it is rendered", async (t) => {
  const { g, id } = await venueLetter(t);
  const result = await send(g, id);
  assert.equal(result.pre_send_gate, null);
  assert.equal(filing(g, id).filed_on, "2026-09-25");

  const { filing_id: unrendered } = await g.create({ proceeding_id: 2, tree: BCSC_TREE, kind: "letter", title: "Never rendered" });
  await g.prose(unrendered, "body", BODY);
  await assert.rejects(send(g, unrendered), code("render_first", /no render of filing/));
});
