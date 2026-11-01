// The general renderer (plan Phase 14; spec §6 pieces 4-5): a `general` Writing renders its mockup
// from its stored layout, part by part, with the recipients after the last part, a party-linked one
// printing its party's counsel from case data; the filed face is toFiledFace's. The confirmation
// gate tags each unconfirmed cited item on the mockup and refuses the filed render until a roster
// lawyer confirms it, whoever reviewed the file (#163). The fixture letter lives in a firm overlay (helpers/general-writing-fixture.mjs).

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";

import { knowledgeFile, passageHash } from "./helpers/knowledge-fixture.mjs";
import { assertFiledFaceClean } from "./helpers/filed-face-scan.mjs";
import { updateCaseData } from "./helpers/matter-data-fixture.mjs";
import { partiesSnapshotSql, seedSql } from "./helpers/template-db.mjs";
import {
  BCSC_TREE,
  generalWritingFixture,
  installCaptionedNote,
  LEARNED_FRONT,
  LETTER_BLOCK,
  LETTER_FILE,
  NO_VENUE_TREE,
  PASSAGES,
  SOURCE_FILE,
  sourceRecord,
  REVIEWED_FRONT,
} from "./helpers/general-writing-fixture.mjs";
import { boardDataOf } from "./fixtures/forms-render-seeds.mjs";

const { submissionFormsBootstrap, submissionFormsRender } = await import("../build/submission/forms.js");
const { resnapshotWriting } = await import("../build/submission/writing-snapshot.js");
const { reviewSnapshotSql } = await import("../build/submission/forms/markers.js");
const { mergeSharedRecipients } = await import("../build/submission/forms/query.js");

const FIXTURE_JURISDICTION = { country: NO_VENUE_TREE.country, jurisdiction: NO_VENUE_TREE.jurisdiction };

const CLIENT = { clientName: "Ada Client", clientNo: "0001", matterNo: "L0000" };
const NOW = "2026-09-25 10:00";
const ADDRESSEE = "Cara Counsel\nCounsel Chambers\n1 Main Street";
const BODY = "First paragraph of the letter.\n\nSecond paragraph of the letter.";
const SENDER = "Fixture Law LLP\n2 Bay Street";
const CHANGED_BODY = "A lawyer's correspondence with other counsel is courteous, candid and made in good faith.";

// #1365: a render returns its board as board_summary; the board's data is this filing's section of
// the matter's Milestone page, read the way the page builds it, right after the render.
function render(g, filingId, mode = "mockup", draftDir) {
  const result = submissionFormsRender(g.dbPath, filingId, CLIENT, mode, undefined, undefined, undefined, NOW, undefined, draftDir);
  return mode === "mockup" ? { ...result, board: boardDataOf(g.dbPath, filingId, CLIENT, NOW) } : result;
}

const docOf = (result, type) => result.documents.find((d) => d.document_type === type);

/** The mockup header, both `---` lines included. */
const headerOf = (md) => md.slice(0, md.indexOf("\n---\n") + "\n---\n".length);

/** The header's four optional fields (plan 2026-10-07 step 3). */
const OPTIONAL_FIELDS = ["Authorities cited:", "Page budget:", "Layout confirmation:", "Blind copies:"];

/** A gap line as the placeholder format prints it (plan 2026-10-07, Q2). */
const gapLine = (what) => `🧩 ________ <!-- ${what} -->`;

/** The optional fields the header carries, in order. */
const optionalFieldsOf = (md) => OPTIONAL_FIELDS.filter((label) => headerOf(md).includes(`\n${label}\n`));

/** The counsel letter, its three prose rows written, Cara as `to`. */
async function letter(g, extra = {}) {
  const { filing_id } = await g.createLetter(extra);
  await g.prose(filing_id, "addressee", ADDRESSEE);
  await g.prose(filing_id, "body", BODY);
  await g.prose(filing_id, "sender", SENDER);
  await g.recipient(filing_id, 1, "to");
  return filing_id;
}

function confirm(g, refs) {
  const row = (rule_ref) => ({
    rule_ref,
    status: "confirmed",
    by: "pe",
    on: "2026-09-25",
    confirmed_against: { passage_hash: passageHash(PASSAGES[rule_ref]), currency: "September 1, 2020" },
  });
  g.f.local(`${LETTER_FILE}.confirmations.local.json`, { file: LETTER_FILE, items: refs.map(row) });
}

const BODY_LINES = ["## Re [unverified: R-body]", "", "1. First paragraph of the letter.", "", "2. Second paragraph of the letter. 🧐"].join("\n");

test("the mockup prints each part in order with its numbering, the To line, and a blank signing space only when the signer is not this machine's person", async (t) => {
  const g = await generalWritingFixture(t);
  const id = await letter(g);

  const result = render(g, id);
  assert.deepEqual(result.documents.map((d) => d.document_type), ["General_writing", "Work_board"]);
  const md = docOf(result, "General_writing").markdown;
  const face = [
    "# Letter to opposing counsel [unverified: R-title]",
    "",
    `${ADDRESSEE} 🧐`,
    "",
    BODY_LINES,
    "",
    "Without prejudice.",
    "",
    `${SENDER} 🧐`,
    "",
    "Yours truly,",
    "",
    "Pat Example",
    "Barrister & Solicitor",
    "Fixture Law LLP",
    "",
    "To: Cara Counsel — counsel for Bert Other (cara@counsel.test)",
  ].join("\n");
  assert.ok(md.includes(face), md);
  assert.doesNotMatch(md, /^To: Ada Client/m, "no client-side recipient");
  assert.doesNotMatch(md.replace(/^---\n[\s\S]*?\n---\n/, ""), /_{8,}/, "the signer is this machine's person");

  g.setPerson("st");
  const other = docOf(render(g, id), "General_writing").markdown;
  assert.ok(other.includes("Yours truly,\n\n________________________________\nPat Example\n"), other);
  g.setPerson(null);
  assert.ok(docOf(render(g, id), "General_writing").markdown.includes("________________________________\nPat Example\n"));
});

// Plan 2026-10-07 (structured and unstructured Writings), Q3: the header's fields in Brahm's order,
// "Document Type" the type file's title, "Document Name" the Writing's title, "Document Date" the
// `date` slot's text or a blank underline, "Matter Description" from the caller's resolved client.
const Q3_HEADER = [
  "Matter no",
  "Matter Description",
  "Client Name",
  "Client no",
  "Document Type",
  "Document Name",
  "Document Date",
  "Venue",
  "Proceeding File no",
  "Revision",
  "Rendered",
];

test("the mockup header carries the Q3 fields in order, naming the Writing's type, title and date", async (t) => {
  const g = await generalWritingFixture(t, { front: REVIEWED_FRONT });
  const id = await letter(g);
  confirm(g, ["R-title", "R-body"]);
  const header = (md) => md.slice("---\n".length, md.indexOf("\n---\n")).split("\n");
  const client = { ...CLIENT, matterDescription: "Client v Other, wrongful dismissal" };

  const blank = header(docOf(submissionFormsRender(g.dbPath, id, client, "mockup", undefined, undefined, undefined, NOW), "General_writing").markdown);
  assert.deepEqual(blank.map((l) => l.slice(0, l.indexOf(":"))), Q3_HEADER);
  assert.deepEqual(blank.slice(0, 7), [
    "Matter no: L0000",
    "Matter Description: Client v Other, wrongful dismissal",
    "Client Name: Ada Client",
    "Client no: 0001",
    "Document Type: Letter to opposing counsel",
    "Document Name: Letter to Cara",
    "Document Date: ________",
  ]);

  await g.prose(id, "date", "8 October 2026");
  const dated = header(docOf(submissionFormsRender(g.dbPath, id, client, "mockup", undefined, undefined, undefined, NOW), "General_writing").markdown);
  assert.equal(dated[6], "Document Date: 8 October 2026");
});

test("an unconfirmed cited item is tagged on its line with the notice, and the filed render refuses naming each", async (t) => {
  const g = await generalWritingFixture(t);
  const id = await letter(g);

  const md = docOf(render(g, id), "General_writing").markdown;
  assert.match(md, /^# Letter to opposing counsel \[unverified: R-title\]$/m);
  assert.match(md, /^## Re \[unverified: R-body\]$/m);
  assert.ok(
    headerOf(md).includes(
      "\nLayout confirmation:\n  - Note: the No venue requirements for Letter to opposing counsel used here were learned by an agent on 2026-09-20 from the venue's published sources"
    ),
    md
  );
  assert.deepEqual(optionalFieldsOf(md), ["Layout confirmation:"], "only the field whose condition holds");

  const filed = render(g, id, "filed");
  assert.equal(filed.confirmation_gate_failed, true);
  assert.deepEqual(filed.unconfirmed, ["R-title", "R-body"]);
  assert.deepEqual(filed.documents, []);
  assert.equal(filed.changed_since_snapshot, undefined);
  assert.match(filed.note, /R-title, R-body/);
});

test("a re-snapshot of the cited _NoVenue letter keeps both knowledge paths, so the filed render still finds each unconfirmed item; a layout now declaring an unbuilt projection refuses it", async (t) => {
  const g = await generalWritingFixture(t);
  const id = await letter(g);
  const stored = () => g.query("SELECT layout_snapshot FROM filings WHERE id = ?", [id])[0].layout_snapshot;
  const created = stored();

  await resnapshotWriting(g.dbPath, id, { jurisdiction: FIXTURE_JURISDICTION, seams: g.seams });
  const snapshot = JSON.parse(stored());
  assert.equal(snapshot.type_file, LETTER_FILE);
  assert.equal(snapshot.venue_file, null);
  assert.equal(stored(), created, "the same tree composes the snapshot creation stored");

  const filed = render(g, id, "filed");
  assert.equal(filed.confirmation_gate_failed, true);
  assert.deepEqual(filed.unconfirmed, ["R-title", "R-body"]);

  const facts = { heading: null, heading_numbering: "none", paragraph_numbering: "none", source: "facts" };
  g.f.local(LETTER_FILE, knowledgeFile(LEARNED_FRONT, { ...LETTER_BLOCK, parts: [...LETTER_BLOCK.parts, facts] }));
  await assert.rejects(resnapshotWriting(g.dbPath, id, { jurisdiction: FIXTURE_JURISDICTION, seams: g.seams }), (err) => {
    assert.equal(err.code, "projection_not_built", err.message);
    assert.match(err.message, /"facts"/);
    return true;
  });
  assert.equal(stored(), created, "a refused re-snapshot writes nothing");
});

test("confirming both items lifts the tags and the refusal without a re-snapshot, and the filed face carries no human-side text", async (t) => {
  const g = await generalWritingFixture(t);
  const id = await letter(g);
  render(g, id);
  const revision = g.revision();

  confirm(g, ["R-title", "R-body"]);
  const md = docOf(render(g, id), "General_writing").markdown;
  assert.doesNotMatch(md, /\[unverified/);
  assert.doesNotMatch(md, /Layout confirmation/);
  assert.deepEqual(optionalFieldsOf(md), []);
  assert.equal(g.revision(), revision, "no re-snapshot");

  const filed = render(g, id, "filed");
  assert.equal(filed.confirmation_gate_failed, undefined);
  assert.deepEqual(filed.documents.map((d) => d.document_type), ["General_writing"]);
  const face = filed.documents[0].markdown;
  assert.ok(face.includes("## Re\n\n1. First paragraph of the letter.\n\n2. Second paragraph of the letter."), face);
  assert.ok(face.includes("To: Cara Counsel — counsel for Bert Other (cara@counsel.test)"), face);
  assert.ok(face.includes("Yours truly,\n\nPat Example\nBarrister & Solicitor\nFixture Law LLP"), face);
  for (const text of ["[unverified", "[source changed", "Blind copies", "Layout confirmation", "Page budget", "<!--"]) {
    assert.ok(!face.includes(text), `filed face carries ${text}`);
  }
  assertFiledFaceClean(face, "General_writing");
});

test("a passage changed after confirmation reads unverified again and the filed render names it changed since the snapshot", async (t) => {
  const g = await generalWritingFixture(t);
  const id = await letter(g);
  confirm(g, ["R-title", "R-body"]);
  g.f.local(SOURCE_FILE, sourceRecord({ ...PASSAGES, "R-body": CHANGED_BODY }));

  const md = docOf(render(g, id), "General_writing").markdown;
  assert.match(md, /^## Re \[unverified: R-body\]$/m);
  assert.match(md, /^# Letter to opposing counsel$/m, "R-title's confirmation still holds");

  const filed = render(g, id, "filed");
  assert.equal(filed.confirmation_gate_failed, true);
  assert.deepEqual(filed.unconfirmed, ["R-body"]);
  assert.deepEqual(filed.changed_since_snapshot, [
    { rule_ref: "R-body", snapshot_hash: passageHash(PASSAGES["R-body"]), current_hash: passageHash(CHANGED_BODY) },
  ]);
});

test("a confirmed item whose passage moved since the snapshot tags source changed on the mockup, and its filed render succeeds reporting the change", async (t) => {
  const g = await generalWritingFixture(t, { front: REVIEWED_FRONT });
  const id = await letter(g);
  g.f.local(SOURCE_FILE, sourceRecord({ ...PASSAGES, "R-body": CHANGED_BODY }));
  g.f.local(`${LETTER_FILE}.confirmations.local.json`, {
    file: LETTER_FILE,
    items: [
      { rule_ref: "R-title", status: "confirmed", by: "pe", on: "2026-09-25", confirmed_against: { passage_hash: passageHash(PASSAGES["R-title"]), currency: "September 1, 2020" } },
      { rule_ref: "R-body", status: "confirmed", by: "pe", on: "2026-09-25", confirmed_against: { passage_hash: passageHash(CHANGED_BODY), currency: "September 1, 2020" } },
    ],
  });

  const md = docOf(render(g, id), "General_writing").markdown;
  assert.match(md, /^## Re \[source changed: R-body\]$/m);
  assert.doesNotMatch(md, /\[unverified/);

  const filed = render(g, id, "filed");
  assert.equal(filed.confirmation_gate_failed, undefined);
  assert.deepEqual(filed.changed_since_snapshot, [
    { rule_ref: "R-body", snapshot_hash: passageHash(PASSAGES["R-body"]), current_hash: passageHash(CHANGED_BODY) },
  ]);
  assert.doesNotMatch(filed.documents[0].markdown, /source changed/);
  assertFiledFaceClean(filed.documents[0].markdown, "General_writing");
});

// #163: a maintainer's review is provenance only. A reviewed file's notice names its reviewer, and
// each cited item is tagged and refused until this firm's sidecar confirms or corrects it.
const REVIEWED_NOTICE =
  "\nLayout confirmation:\n  - Note: the No venue requirements for Letter to opposing counsel used here were reviewed by Pat Example on 2026-09-22, " +
  "but this firm has not yet confirmed or corrected every item; confirm each item before relying on it.\n";

test("a reviewed file with no firm rows shows the reviewer's notice, tags each cited item, and the filed render refuses naming each", async (t) => {
  const g = await generalWritingFixture(t, { front: REVIEWED_FRONT });
  const id = await letter(g);
  const md = docOf(render(g, id), "General_writing").markdown;
  assert.ok(headerOf(md).includes(REVIEWED_NOTICE), md);
  assert.doesNotMatch(md, /learned by an agent/);
  assert.match(md, /^# Letter to opposing counsel \[unverified: R-title\]$/m);
  assert.match(md, /^## Re \[unverified: R-body\]$/m);
  assert.doesNotMatch(md, /need not|no need|not necessary|unnecessary/i, "the notice never excuses the firm's own review");

  const filed = render(g, id, "filed");
  assert.equal(filed.confirmation_gate_failed, true);
  assert.deepEqual(filed.unconfirmed, ["R-title", "R-body"]);
  assert.deepEqual(filed.documents, []);
  assert.match(filed.note, /R-title, R-body/);
});

test("a reviewed file with only some items confirmed tags and refuses only the unconfirmed one", async (t) => {
  const g = await generalWritingFixture(t, { front: REVIEWED_FRONT });
  const id = await letter(g);
  confirm(g, ["R-title"]);
  const md = docOf(render(g, id), "General_writing").markdown;
  assert.ok(headerOf(md).includes(REVIEWED_NOTICE));
  assert.match(md, /^# Letter to opposing counsel$/m);
  assert.match(md, /^## Re \[unverified: R-body\]$/m);

  const filed = render(g, id, "filed");
  assert.equal(filed.confirmation_gate_failed, true);
  assert.deepEqual(filed.unconfirmed, ["R-body"]);
});

test("a reviewed file's confirmation against a stale passage hash lifts neither the tag nor the refusal", async (t) => {
  const g = await generalWritingFixture(t, { front: REVIEWED_FRONT });
  const id = await letter(g);
  g.f.local(`${LETTER_FILE}.confirmations.local.json`, {
    file: LETTER_FILE,
    items: [
      { rule_ref: "R-title", status: "confirmed", by: "pe", on: "2026-09-25", confirmed_against: { passage_hash: passageHash(PASSAGES["R-title"]), currency: "September 1, 2020" } },
      { rule_ref: "R-body", status: "confirmed", by: "pe", on: "2026-09-25", confirmed_against: { passage_hash: passageHash("an older passage"), currency: "September 1, 2020" } },
    ],
  });
  assert.match(docOf(render(g, id), "General_writing").markdown, /^## Re \[unverified: R-body\]$/m);
  const filed = render(g, id, "filed");
  assert.equal(filed.confirmation_gate_failed, true);
  assert.deepEqual(filed.unconfirmed, ["R-body"]);
});

test("a reviewed file whose every cited item the firm confirmed or corrected shows no notice and renders filed", async (t) => {
  const g = await generalWritingFixture(t, { front: REVIEWED_FRONT });
  const id = await letter(g);
  g.f.local(`${LETTER_FILE}.confirmations.local.json`, {
    file: LETTER_FILE,
    items: [
      { rule_ref: "R-title", status: "corrected", by: "pe", on: "2026-09-25", value: "Letter to opposing counsel", confirmed_against: { passage_hash: passageHash(PASSAGES["R-title"]), currency: "September 1, 2020" } },
      { rule_ref: "R-body", status: "confirmed", by: "pe", on: "2026-09-25", confirmed_against: { passage_hash: passageHash(PASSAGES["R-body"]), currency: "September 1, 2020" } },
    ],
  });
  const md = docOf(render(g, id), "General_writing").markdown;
  assert.doesNotMatch(md, /Layout confirmation|\[unverified/);
  assert.deepEqual(optionalFieldsOf(md), []);
  const filed = render(g, id, "filed");
  assert.equal(filed.confirmation_gate_failed, undefined);
  assert.deepEqual(filed.documents.map((d) => d.document_type), ["General_writing"]);
});

test("a blind copy prints in the header's Blind copies on the mockup and nowhere on the filed face; a cc prints on both", async (t) => {
  const g = await generalWritingFixture(t, { front: REVIEWED_FRONT });
  const id = await letter(g);
  confirm(g, ["R-title", "R-body"]);
  await g.recipient(id, 3, "cc");
  await g.recipient(id, 2, "bcc");

  const md = docOf(render(g, id), "General_writing").markdown;
  assert.ok(md.includes("cc: Dan Registrar — the registry (800 Smithe Street)"), md);
  assert.ok(headerOf(md).includes("\nBlind copies:\n  - bcc: Ada Client — the client (ada@client.test)\n"), md);
  assert.deepEqual(optionalFieldsOf(md), ["Blind copies:"]);

  const face = render(g, id, "filed").documents[0].markdown;
  assert.ok(face.includes("cc: Dan Registrar — the registry (800 Smithe Street)"), face);
  assert.doesNotMatch(face, /Ada Client|Blind copies|bcc:/);
});

test("a party-linked recipient prints its party's counsel, email and address for service from case data, and keeps its own capacity", async (t) => {
  const g = await generalWritingFixture(t, { front: REVIEWED_FRONT });
  const id = await letter(g);
  await g.recipient(id, 3, "cc");
  updateCaseData(dirname(g.dbPath), "UPDATE parties SET lawyer_name = 'Y. Counsel', lawyer_email = 'y@counsel.test', address = '2 Y St' WHERE party_id = 2;");
  await g.execute("UPDATE recipients SET name = 'Stale Name', email = 'stale@copy.test', address = '9 Stale St' WHERE id = 3;");
  // Schema v43 holds no name, email or address on a party-linked row.
  await assert.rejects(g.execute("UPDATE recipients SET name = 'Stale Name' WHERE id = 1;"), /CHECK constraint failed/);

  const md = docOf(render(g, id), "General_writing").markdown;
  assert.ok(md.includes("To: Y. Counsel — counsel for Bert Other (y@counsel.test | 2 Y St)"), md);
  assert.ok(md.includes("cc: Stale Name — the registry (stale@copy.test | 9 Stale St)"), "a recipient with no party prints its own row");
  assert.doesNotMatch(md, /^To: .*(Stale|stale|cara@counsel)/m);

  // Withdrawn counsel: the recipient prints the party's own name, with no counsel email.
  updateCaseData(dirname(g.dbPath), "UPDATE parties SET lawyer_name = NULL, lawyer_email = NULL WHERE party_id = 2;");
  assert.ok(docOf(render(g, id), "General_writing").markdown.includes("To: Bert Other — counsel for Bert Other (2 Y St)"));
});

test("two party-linked recipients with the same counsel print one To line with their capacities joined, and the stored rows stay one per party", async (t) => {
  const g = await generalWritingFixture(t, { front: REVIEWED_FRONT });
  const id = await letter(g);
  updateCaseData(dirname(g.dbPath), "INSERT INTO parties (party_id, name, lawyer_name, lawyer_email) VALUES (5, 'Cy Third', 'Cara Counsel', 'Cara@Counsel.test');");
  await g.execute(
    "INSERT INTO parties (id, proceeding_id, name, role, ordinal, is_client, case_party_id) VALUES (5, 1, 'Cy Third', 'Respondent', 3, 0, 5); " +
      "INSERT INTO recipients (id, proceeding_id, name, capacity, email, address, party_id, ordinal) VALUES (4, 1, NULL, 'counsel for Cy Third', NULL, NULL, 5, 4);"
  );
  await g.recipient(id, 3, "to", 2);
  await g.recipient(id, 4, "to", 3);

  const toLines = (mode = "mockup") =>
    (mode === "mockup" ? docOf(render(g, id), "General_writing").markdown : render(g, id, "filed").documents[0].markdown).split("\n").filter((l) => l.startsWith("To: "));
  assert.deepEqual(toLines(), [
    "To: Cara Counsel — counsel for Bert Other and Cy Third (cara@counsel.test)",
    "To: Dan Registrar — the registry (800 Smithe Street)",
  ]);
  assert.equal(g.query(`SELECT COUNT(*) AS n FROM filing_recipients WHERE filing_id = ${id}`)[0].n, 3, "each party keeps its own row");

  // Capacities with no shared lead ending in "for" are joined whole.
  await g.execute("UPDATE recipients SET capacity = 'agent for Cy Third' WHERE id = 4;");
  assert.equal(toLines()[0], "To: Cara Counsel — counsel for Bert Other and agent for Cy Third (cara@counsel.test)");

  // A different email is a different person: two lines.
  updateCaseData(dirname(g.dbPath), "UPDATE parties SET lawyer_email = 'cara2@counsel.test' WHERE party_id = 5;");
  assert.deepEqual(toLines(), [
    "To: Cara Counsel — counsel for Bert Other (cara@counsel.test)",
    "To: Dan Registrar — the registry (800 Smithe Street)",
    "To: Cara Counsel — agent for Cy Third (cara2@counsel.test)",
  ]);
});

test("mergeSharedRecipients merges only rows of one role and one name, email and address, and never an unrecorded row", () => {
  const row = (id, role, capacity, extra = {}) => ({ id, name: "Cara Counsel", capacity, email: "cara@counsel.test", address: null, party_id: id, role, ordinal: id, ...extra });
  const merged = mergeSharedRecipients([
    row(1, "to", "counsel for A"),
    row(2, "to", "counsel for B"),
    row(3, "cc", "counsel for C"),
    row(4, "to", "counsel for C"),
    row(5, "to", "counsel for A"),
    row(6, "to", null, { name: null, email: null, unrecorded: true }),
    row(7, "to", null, { name: null, email: null, unrecorded: true }),
  ]);
  assert.deepEqual(
    merged.map((r) => [r.id, r.role, r.capacity]),
    [
      [1, "to", "counsel for A, B and C"],
      [3, "cc", "counsel for C"],
      [6, "to", null],
      [7, "to", null],
    ]
  );
  assert.equal(mergeSharedRecipients([row(1, "to", "counsel for A"), row(2, "to", "counsel for A")])[0].capacity, "counsel for A");
  assert.equal(mergeSharedRecipients([row(1, "to", "counsel for A"), row(2, "to", null)])[0].capacity, "counsel for A");
  assert.equal(mergeSharedRecipients([row(1, "to", "counsel for A"), row(2, "to", "counsel for A", { address: "1 Other St" })]).length, 2, "a different address is not merged");
});

test("a drafting letter's party-linked recipient whose party is not of its proceeding is a hard error naming the recipient", async (t) => {
  const g = await generalWritingFixture(t, { front: REVIEWED_FRONT });
  const id = await letter(g);
  await g.execute("UPDATE recipients SET party_id = 3 WHERE id = 1;");
  assert.throws(
    () => render(g, id),
    (err) => {
      assert.equal(err.code, "recipient_party_missing", err.message);
      assert.match(err.message, /a recipient \(counsel for Bert Other\) is linked to a party that is not a party of the proceeding/);
      return true;
    }
  );
});

test("a page_limit prints the header's Page budget on the mockup only", async (t) => {
  const g = await generalWritingFixture(t, { front: REVIEWED_FRONT, block: { ...LETTER_BLOCK, page_limit: 2 } });
  const id = await letter(g);
  confirm(g, ["R-title", "R-body"]);
  const md = docOf(render(g, id), "General_writing").markdown;
  assert.ok(headerOf(md).includes("\nPage budget:\n  - Limit: 2 pages; estimate: 1 pages\n"), md);
  assert.deepEqual(optionalFieldsOf(md), ["Page budget:"]);
  assert.doesNotMatch(render(g, id, "filed").documents[0].markdown, /Page budget|Limit:/);
});

test("the Writing's folder is named by its title with no folder_code, though the stored layout carries one, and bootstrap lists the Writing on its forum-less proceeding", async (t) => {
  const g = await generalWritingFixture(t);
  const id = await letter(g);
  const draft = g.draft;

  const rendered = render(g, id, "mockup", draft);
  const general = docOf(rendered, "General_writing");
  // LETTER_BLOCK declares folder_code "LTR": the folder ignores it.
  assert.equal(general.path, join(draft, "Letter to Cara", "Letter to opposing counsel.md"));
  assert.equal(existsSync(join(draft, "LTR Letter to Cara")), false);

  const boot = submissionFormsBootstrap(g.dbPath, CLIENT, NOW, draft);
  assert.ok(boot.filings.some((f) => f.filing_id === id));
  const page = boot.milestone_paths.find((p) => p.filing_id === id);
  assert.equal(page.path, join(draft, "Letter to Cara", "Milestone.html"), "the Writing's page is in its own folder, with no filing id");
  assert.ok(existsSync(page.path));
  assert.deepEqual(boot.pre_filing_proceedings.map((p) => p.proceeding_id), [2, 3]);
});

test("a slot, addressee and sender with no text, and no signer chosen, print whole mockup lines, and the filed render refuses naming each unwritten part", async (t) => {
  const g = await generalWritingFixture(t, { front: REVIEWED_FRONT, person: null });
  const { filing_id: id } = await g.createLetter();
  confirm(g, ["R-title", "R-body"]);

  const md = docOf(render(g, id), "General_writing").markdown;
  for (const what of ["addressee not written", "body not written", "sender not written", "signer not chosen"]) {
    assert.match(md, new RegExp(`^${gapLine(what)}$`, "m"));
  }
  const filed = render(g, id, "filed");
  assert.equal(filed.unwritten_gate_failed, true);
  assert.deepEqual(filed.unwritten, ["addressee", "body", "sender"]);
  assert.deepEqual(filed.documents, []);
  assert.match(filed.note, /addressee, body, sender/);
});

// #1213: each 🧩 gap line is a non-generating open-items entry, keyed on its layout part, so a
// Writing with an unwritten part never reads every condition held.
const openItemsOf = (result) => result.board.criteria.find((c) => c.id === "open-items");

test("each 🧩 gap line is recorded on its layout part, stamped General_writing, and open-items names each until every part is written (#1213)", async (t) => {
  const g = await generalWritingFixture(t);
  const { filing_id: id } = await g.createLetter();

  const result = render(g, id);
  const manifest = JSON.parse(readFileSync(join(g.draft, "Drafting records", `render-manifest-${id}.json`), "utf-8"));
  assert.deepEqual(
    manifest.inventory.filter((e) => e.marker === "🧩").map((e) => [e.generating, e.table, e.id, e.item, e.doc]),
    [
      [false, "layout_parts", 0, "addressee not written", "General_writing"],
      [false, "layout_parts", 1, "body not written", "General_writing"],
      [false, "layout_parts", 3, "sender not written", "General_writing"],
    ]
  );
  const before = openItemsOf(result);
  assert.equal(before.state, "unmet");
  assert.deepEqual(before.items, ["addressee not written", "body not written", "sender not written"]);
  const goal = result.board.goal;
  assert.equal(goal.state, "unmet");
  assert.notEqual(goal.text, "Every condition holds. Awaiting your approval to send.");

  await g.prose(id, "addressee", ADDRESSEE);
  await g.prose(id, "body", BODY);
  await g.prose(id, "sender", SENDER);
  const after = openItemsOf(render(g, id));
  assert.equal(after.state, "met");
  assert.deepEqual(after.items, []);
});

test("an empty terms projection and an unchosen signer each give open-items an item (#1213)", async (t) => {
  const g = await generalWritingFixture(t);
  const id = await release(g);
  await g.execute(`UPDATE filings SET signer_party_id = NULL WHERE id = ${id};`);

  const openItems = openItemsOf(render(g, id));
  assert.equal(openItems.state, "unmet");
  assert.deepEqual(openItems.items, ["terms empty", "signer not chosen"]);
});

test("an internal memo prints every DB-backed projection, each heading numbering, and a paragraph count carried from restart into continue", async (t) => {
  const g = await generalWritingFixture(t);
  await g.execute("INSERT INTO proceedings (id, matter_reference, forum) VALUES (4, 'L0000', NULL);");
  const { filing_id: id } = await g.create({ proceeding_id: 4, tree: NO_VENUE_TREE, kind: "internal_memo", recipient: "internal", title: "Memo" });

  const empty = docOf(render(g, id), "General_writing").markdown;
  for (const what of ["parties empty", "orders-sought empty", "background not written", "legal-basis empty", "material-relied-on empty"]) {
    assert.match(empty, new RegExp(`^${gapLine(what)}$`, "m"));
  }
  const refused = render(g, id, "filed");
  assert.equal(refused.unwritten_gate_failed, true);
  assert.deepEqual(refused.unwritten, ["parties", "orders-sought", "background", "legal-basis", "material-relied-on"]);
  assert.deepEqual(refused.documents, []);

  await g.execute(`
INSERT INTO parties (id, proceeding_id, name, role, ordinal, is_client, case_party_id) VALUES (10, 4, 'Ada Client', 'Petitioner', 1, 1, 1), (11, 4, 'Bert Other', 'Respondent', 2, 0, 2);
INSERT INTO order_sought (id, proceeding_id, wording) VALUES (20, 4, 'An order that the respondent pay costs.'), (21, 4, 'An order for an accounting.');
INSERT INTO filing_orders (filing_id, order_sought_id, document, ordinal) VALUES (${id}, 20, 'form', 1), (${id}, 21, 'form', 2);
INSERT INTO submissions (id, proceeding_id, contention, ordinal) VALUES (30, 4, 'The respondent breached the agreement.', 1), (31, 4, 'The breach caused the loss.', 2);
INSERT INTO filing_submissions (filing_id, submission_id, document, ordinal) VALUES (${id}, 30, 'form', 1), (${id}, 31, 'form', 2);
INSERT INTO documents (id, proceeding_id, label, document_date) VALUES (40, 4, 'Agreement', '2026-01-15'), (41, 4, 'Demand letter', NULL);
INSERT INTO filing_documents (filing_id, document_id, ordinal, role) VALUES (${id}, 40, 1, 'evidence'), (${id}, 41, 2, 'evidence');
`);
  await g.prose(id, "background", "The parties signed the agreement.\n\nThe respondent stopped paying.");

  const md = docOf(render(g, id), "General_writing").markdown;
  for (const line of [
    /^## Part I — Parties$/m,
    /^Ada Client, Petitioner$/m,
    /^## Part 2 — Orders sought$/m,
    /^\(a\) An order that the respondent pay costs\. .*<!-- relief_item a -->$/m,
    /^## C\. Background$/m,
    /^1\. The parties signed the agreement\.$/m,
    /^2\. The respondent stopped paying\. 🧐$/m,
    /^## D\. Legal basis$/m,
    /^3\. The respondent breached the agreement\. .*<!-- submission_id 30 -->$/m,
    /^4\. The breach caused the loss\. .*<!-- submission_id 31 -->$/m,
    /^## Material relied on$/m,
    /^Ex\. 1 — Agreement, 2026-01-15 <!-- document_id 40 -->$/m,
    /^Ex\. 2 — Demand letter, undated <!-- document_id 41 -->$/m,
  ]) {
    assert.match(md, line);
  }

  const filed = render(g, id, "filed");
  assert.equal(filed.unwritten_gate_failed, undefined);
  const snapshot = JSON.parse(g.query("SELECT layout_snapshot FROM filings WHERE id = ?", [id])[0].layout_snapshot);
  assert.deepEqual(filed.stored_layout.layout, snapshot.layout);
  assert.equal(filed.stored_layout.venue, null);
  const face = filed.documents[0].markdown;
  const expected = [
    "# Internal memo",
    "",
    "## Part I — Parties",
    "",
    "Ada Client, Petitioner",
    "Bert Other, Respondent",
    "",
    "## Part 2 — Orders sought",
    "",
    "(a) An order that the respondent pay costs.",
    "(b) An order for an accounting.",
    "",
    "## C. Background",
    "",
    "1. The parties signed the agreement.",
    "",
    "2. The respondent stopped paying.",
    "",
    "## D. Legal basis",
    "",
    "3. The respondent breached the agreement.",
    "",
    "4. The breach caused the loss.",
    "",
    "## Material relied on",
    "",
    "Ex. 1 — Agreement, 2026-01-15",
    "Ex. 2 — Demand letter, undated",
  ].join("\n");
  assert.ok(face.includes(expected), face);
  assertFiledFaceClean(face, "General_writing");
});

test("a research memo's item paragraphs print summary, excerpt, citation and markers, numbered across Rule and Application, each naming its statement of law", async (t) => {
  const g = await generalWritingFixture(t);
  await g.execute("INSERT INTO proceedings (id, matter_reference, forum) VALUES (4, 'L0000', NULL);");
  // The shipped ICRA type's own block, in /legal-research's tree under the fixture's jurisdiction.
  const shipped = readFileSync(new URL("../../../../.claude/skills/legal-research/references/CAN/BC/_NoVenue/Documents/research-memo.md", import.meta.url), "utf-8");
  const memoDocs = `legal-research/${NO_VENUE_TREE.country}/${NO_VENUE_TREE.jurisdiction}/_NoVenue/Documents`;
  g.f.local(`${memoDocs}/kinds.local.json`, {
    kinds: [{ file: "research-memo", name: "Research memo", recipient: "internal", aliases: [{ name: "research_memo", source: "agent", ref: "L0000", recorded: "2026-10-31" }] }],
  });
  g.f.local(`${memoDocs}/research-memo.md`, shipped);
  const created = await g.create({ proceeding_id: 4, tree: NO_VENUE_TREE, kind: "research_memo", recipient: "internal", title: "2026-10-31 ML re test" });
  assert.equal(created.type_file, `${memoDocs}/research-memo.md`);
  const id = created.filing_id;
  await g.execute(`
INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind) VALUES (60, 4, 'Alpha v Beta', '2020 BCCA 1', 'case');
INSERT INTO statements_of_law (id, proceeding_id, authority_id, pinpoint, excerpt, source, verification) VALUES
  (70, 4, 60, 'para. 5', 'The first passage.', 'primary', 'lead'),
  (71, 4, 60, 'para. 9', 'The second passage.\nIts second line.', 'primary', 'lead');
INSERT INTO filing_law (filing_id, statement_id) VALUES (${id}, 70), (${id}, 71);
`);
  await g.prose(id, "memo-header", "---\nDocument: MEMORANDUM OF LAW\nFormat: ICRA\n---");
  await g.prose(id, "issue", "**Is the test met?**");
  await g.prose(id, "conclusion", "Yes (Alpha v Beta, 2020 BCCA 1, at para. 5).");
  await g.prose(id, "rule", "The first rule. <!-- statement_of_law_id 70 -->\n\nThe second rule. <!-- statement_of_law_id 71 -->");
  await g.prose(id, "application", "The court applied it. <!-- statement_of_law_id 70 -->\n\nAn unlinked item. <!-- statement_of_law_id 99 -->");
  await g.prose(id, "sources", "### Case authority\n\n- Alpha v Beta, 2020 BCCA 1, paras. 5, 9");

  const md = docOf(render(g, id), "General_writing").markdown;
  const body = [
    "## Rule",
    "",
    "1. The first rule.",
    "",
    "> The first passage.",
    ">",
  ].join("\n");
  assert.ok(md.includes(body), md);
  for (const line of [
    /^> \*Alpha v Beta\*, 2020 BCCA 1, para\. 5 .*📇.* <!-- statement_of_law_id 70 -->$/m,
    /^2\. The second rule\.$/m,
    /^> The second passage\.\n> Its second line\.\n>\n> \*Alpha v Beta\*, 2020 BCCA 1, para\. 9 .*<!-- statement_of_law_id 71 -->/m,
    /^## Application$/m,
    /^3\. The court applied it\.$/m,
    /^4\. An unlinked item\.$/m,
    /^🧩 ________ <!-- statement_of_law 99 is not cited by this Writing -->/m,
    /^## Issue\n\n\*\*Is the test met\?\*\*/m,
    /^## Sources\n\n### Case authority$/m,
  ]) {
    assert.match(md, line);
  }
  assert.doesNotMatch(md, /^\d+\. Yes/m, "the Conclusion is prose, never numbered");
});

test("a caption part under BCSC prints the BC Supreme Court caption from the stored venue block, with no title row", async (t) => {
  const g = await generalWritingFixture(t);
  installCaptionedNote(g, "BCSC");
  await g.execute("UPDATE proceedings SET registry = 'Vancouver', file_number = 'S-1' WHERE id = 2;");
  const { filing_id } = await g.create({ proceeding_id: 2, tree: BCSC_TREE, kind: "captioned_note", title: "Captioned note" });
  await g.prose(filing_id, "body", "The note's body.");

  const md = docOf(render(g, filing_id), "General_writing").markdown;
  const face = [
    "# Captioned note",
    "",
    "| | | |",
    "| :--- | :---: | ---: |",
    "| | | Vancouver Registry |",
    "| | | No. S-1 |",
    "| | **IN THE SUPREME COURT OF BRITISH COLUMBIA** | |",
    "| BETWEEN: | | |",
    "| | ADA CLIENT | |",
    "| | | *Plaintiff* |",
    "| AND: | | |",
    "| | BERT OTHER | |",
    "| | | *Defendant* |",
    "",
    "The note's body.",
  ].join("\n");
  assert.ok(md.includes(face), md);
  assert.match(md, /^Venue: BC Supreme Court$/m, "the frontmatter reads the stored venue block's display label");
});

test("a caption under a venue with no registry prints its file-number row from a stored file number, and no registry row (#1246)", async (t) => {
  const g = await generalWritingFixture(t);
  installCaptionedNote(g, "FAT");
  g.f.local("draft/CAN/BC/FAT/venue.md", knowledgeFile(null, { caption_lines: "IN THE FIXTURE APPEALS TRIBUNAL", file_number_label: "Appeal No.", registry_label: null, party_roles: { appellant: "Appellant", respondent: "Respondent" }, display_label: "Fixture Appeals Tribunal" }));
  await g.execute("UPDATE proceedings SET forum = 'CAN/BC/FAT', file_number = 'FAT-1' WHERE id = 2;");
  const { filing_id } = await g.create({ proceeding_id: 2, tree: { country: "CAN", jurisdiction: "BC", venue: "FAT" }, kind: "captioned_note", title: "Captioned note" });
  await g.prose(filing_id, "body", "The note's body.");

  const md = docOf(render(g, filing_id), "General_writing").markdown;
  assert.ok(md.includes("| | | Appeal No. FAT-1 |\n| | **IN THE FIXTURE APPEALS TRIBUNAL** | |"), md);
  assert.ok(!md.includes("Registry"), md);
});

// Plan Phase 17: the `terms` projection. A vetted _NoVenue release the client signs, printing the
// Writing's selected clauses under one heading. work-markers.md rows 📑 📌 📍 🔬 🧐 and §1 give each
// clause line's markers; `terms-traced` (shared/declared-layout.md section 6) counts 📑, 📌 and 📍.

const RELEASE_BLOCK = {
  renderer: "general",
  needs_forum_parts: false,
  folder_code: "REL",
  title: "Release",
  exhibit_numbering: "writing",
  signer: "party",
  goal_criteria: ["terms-traced", "open-items", "counsel-review"],
  parts: [
    { heading: "Terms", heading_numbering: "none", paragraph_numbering: "restart", source: "terms" },
    { heading: null, heading_numbering: "none", paragraph_numbering: "none", source: "signature-block" },
  ],
};

/** The release Writing on proceeding 1, signed by Ada Client, with no clause selected yet. */
async function release(g, block = RELEASE_BLOCK) {
  g.f.local("draft/CAN/FX/_NoVenue/Documents/kinds.local.json", {
    kinds: [{ file: "release", name: "Release", recipient: "opposing-party", aliases: [{ name: "release", source: "agent", ref: "L0000", recorded: "2026-09-20" }] }],
  });
  g.f.local("draft/CAN/FX/_NoVenue/Documents/release.md", knowledgeFile(null, block));
  const { filing_id } = await g.create({ proceeding_id: 1, tree: NO_VENUE_TREE, kind: "release", recipient: "opposing-party", title: "Release", signer_party_id: 1 });
  return filing_id;
}

/** An approval of one clause, its snapshot built by the json_object review.md fixes. */
const approveClause = (g, id) =>
  g.execute(
    `INSERT INTO review_approvals (entity, entity_id, approved_at, session_token, practitioner, revision, snapshot)
       SELECT 'clauses', id, '2026-09-25T10:00', 'sess-r1', 'Pat Example', 1, ${reviewSnapshotSql("clauses")} FROM clauses WHERE id = ${id};`
  );

/**
 * Six clauses, selected out of id order: 1 express with no excerpt and no pinpoint (📑 📌); 2 implied, citing a lead
 * with no pinpoint (📍 🔬); 3 and 4 implied, citing an overruled and a killed authority's statement;
 * 5 implied, citing nothing, approved as it stands and worded differently by this Writing; 6 express
 * with its pinpoint, approved and then reworded.
 */
async function seedClauses(g, id) {
  await g.execute(`
INSERT INTO documents (id, proceeding_id, label) VALUES (50, 1, 'Offer letter');
INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind, treatment, killed_on) VALUES
  (60, 1, 'Live Authority v. Example', '2020 BCSC 1', 'case', NULL, NULL),
  (61, 1, 'Overruled Authority v. Example', '2019 BCSC 2', 'case', 'overruled', NULL),
  (62, 1, 'Killed Authority v. Example', '2018 BCSC 3', 'case', NULL, '2026-09-01');
INSERT INTO statements_of_law (id, proceeding_id, authority_id, pinpoint, excerpt, verification) VALUES
  (70, 1, 60, NULL, 'The live passage.', 'lead'),
  (71, 1, 61, NULL, 'The overruled passage.', 'lead'),
  (72, 1, 62, NULL, 'The killed passage.', 'lead');
INSERT INTO clauses (id, proceeding_id, wording, basis, document_id, pinpoint, excerpt, excerpt_id) VALUES
  (1, 1, 'The Releasor releases the Releasee from every claim arising from the accident.', 'express', 50, NULL, NULL, NULL),
  (2, 1, 'The Releasor will not sue anyone who may claim over against the Releasee.', 'implied', NULL, NULL, NULL, 70),
  (3, 1, 'The clause resting on overruled law.', 'implied', NULL, NULL, NULL, 71),
  (4, 1, 'The clause resting on killed law.', 'implied', NULL, NULL, NULL, 72),
  (5, 1, 'The settlement is no admission of liability.', 'implied', NULL, NULL, NULL, NULL),
  (6, 1, 'The Releasee pays the settlement sum.', 'express', 50, 'para 2', 'the sum is paid', NULL);
INSERT INTO filing_clauses (filing_id, clause_id, ordinal, wording_override) VALUES
  (${id}, 2, 1, NULL), (${id}, 1, 2, NULL), (${id}, 6, 3, NULL), (${id}, 5, 4, 'This settlement admits no liability.'), (${id}, 3, 5, NULL), (${id}, 4, 6, NULL);
`);
  await approveClause(g, 5);
  await approveClause(g, 6);
  await g.execute("UPDATE clauses SET wording = 'The Releasee pays the settlement sum within 30 days.' WHERE id = 6;");
}

const TERMS_MOCKUP = [
  "## Terms",
  "",
  "1. The Releasor will not sue anyone who may claim over against the Releasee. 📍🔬 <!-- clause_id 2 -->",
  "",
  "2. The Releasor releases the Releasee from every claim arising from the accident. 📑📌 <!-- clause_id 1 -->",
  "",
  "3. The Releasee pays the settlement sum within 30 days. 🧐 <!-- clause_id 6 -->",
  "",
  "4. This settlement admits no liability. <!-- clause_id 5 -->",
  "",
  "5. The clause resting on overruled law. ⛔🧐 <!-- clause_id 3 -->",
  "",
  "6. The clause resting on killed law. (killed 2026-09-01) 🧐 <!-- clause_id 4 -->",
  "",
  "________________________________",
  "Ada Client",
].join("\n");

test("a release declaring terms is created, and with no clause selected prints an empty terms line the filed render refuses", async (t) => {
  const g = await generalWritingFixture(t);
  const id = await release(g);

  assert.match(docOf(render(g, id), "General_writing").markdown, /^🧩 ________ <!-- terms empty -->$/m);
  const filed = render(g, id, "filed");
  assert.equal(filed.unwritten_gate_failed, true);
  assert.deepEqual(filed.unwritten, ["terms"]);
  assert.deepEqual(filed.documents, []);
});

test("terms prints the selected clauses in ordinal order, an override over the clause's wording, and each line's markers", async (t) => {
  const g = await generalWritingFixture(t);
  const id = await release(g);
  await seedClauses(g, id);

  const md = docOf(render(g, id), "General_writing").markdown;
  assert.ok(md.includes(TERMS_MOCKUP), md);
  assert.doesNotMatch(md, /The settlement is no admission of liability\./, "the override replaces the clause's own wording");
});

test("terms-traced counts the 📑, 📌 and 📍 on clause lines, and reads met once the excerpt and both pinpoints exist", async (t) => {
  const g = await generalWritingFixture(t);
  const id = await release(g);
  await seedClauses(g, id);
  const termsTraced = () => render(g, id).board.criteria.find((c) => c.id === "terms-traced");

  const before = termsTraced();
  assert.equal(before.state, "unmet");
  assert.equal(before.outstanding, 3);
  assert.deepEqual(before.items, [
    "The Releasor will not sue anyone who may claim over against the Releasee.",
    "The Releasor releases the Releasee from every claim arising from the accident.",
    "The Releasor releases the Releasee from every claim arising from the accident.",
  ]);

  await g.execute("UPDATE clauses SET pinpoint = 'p. 1' WHERE id = 1; UPDATE statements_of_law SET pinpoint = 'para 7' WHERE id = 70;");
  const excerptOwed = termsTraced();
  assert.equal(excerptOwed.state, "unmet", "a located express clause whose passage is not captured is not yet traced");
  assert.deepEqual(excerptOwed.items, ["The Releasor releases the Releasee from every claim arising from the accident."]);

  await g.execute("UPDATE clauses SET excerpt = 'releases every claim' WHERE id = 1;");
  const after = termsTraced();
  assert.equal(after.state, "met");
  assert.equal(after.outstanding, 0);

  const counselReview = () => render(g, id).board.criteria.find((c) => c.id === "counsel-review");
  assert.equal(counselReview().state, "unmet");
  for (const clause of [1, 2, 3, 4, 5, 6]) await approveClause(g, clause);
  assert.equal(counselReview().state, "met", "every clause's approval matches its current snapshot");
});

test("a lead-backed clause's 🔬 is recorded on its statement of law, and terms-traced still counts only 📑, 📌 and 📍", async (t) => {
  const g = await generalWritingFixture(t);
  const id = await release(g);
  await seedClauses(g, id);

  const result = render(g, id);
  const manifest = JSON.parse(readFileSync(join(g.draft, "Drafting records", `render-manifest-${id}.json`), "utf-8"));
  const scrutinize = manifest.inventory.filter((e) => e.marker === "🔬");
  assert.deepEqual(
    scrutinize.map((e) => [e.table, e.id, e.item]),
    [["statements_of_law", 70, "Live Authority v. Example, 2020 BCSC 1"]]
  );
  assert.deepEqual(
    manifest.inventory.filter((e) => e.table === "clauses" && e.generating).map((e) => [e.id, e.marker]),
    [[2, "📍"], [1, "📑"], [1, "📌"]]
  );
  const termsTraced = result.board.criteria.find((c) => c.id === "terms-traced");
  assert.equal(termsTraced.outstanding, 3);
});

test("an express clause with its pinpoint and no excerpt prints 📑 in place of 🧐, then 🧐 once the passage is captured (#1158)", async (t) => {
  const g = await generalWritingFixture(t);
  const id = await release(g);
  await g.execute(`
INSERT INTO documents (id, proceeding_id, label) VALUES (50, 1, 'Offer letter');
INSERT INTO clauses (id, proceeding_id, wording, basis, document_id, pinpoint, excerpt, excerpt_id) VALUES
  (12, 1, 'The Releasee pays the settlement sum.', 'express', 50, 'para 2', NULL, NULL);
INSERT INTO filing_clauses (filing_id, clause_id, ordinal, wording_override) VALUES (${id}, 12, 1, NULL);
`);
  await approveClause(g, 12);
  const line = () => docOf(render(g, id), "General_writing").markdown.split("\n").find((l) => l.includes("<!-- clause_id 12 -->"));

  assert.equal(line(), "1. The Releasee pays the settlement sum. 📑 <!-- clause_id 12 -->", "an approved clause still owes its passage");
  await g.execute("UPDATE clauses SET excerpt = 'the sum is paid' WHERE id = 12;");
  assert.equal(line(), "1. The Releasee pays the settlement sum. 🧐 <!-- clause_id 12 -->", "the capture changes the snapshot, so counsel reviews again");
});

test("approving a clause citing overruled or killed law clears 🧐 alone; a later overruling re-raises it, a later kill does not (#1198)", async (t) => {
  const g = await generalWritingFixture(t);
  const id = await release(g);
  await seedClauses(g, id);
  // The verified write snapshots the pair it leaves (v47), so the reopen trigger keeps the row verified.
  await g.execute(
    "UPDATE statements_of_law SET pinpoint = 'para 7', verification = 'verified', scrutinized_authority_id = authority_id, scrutinized_pinpoint = 'para 7', scrutinized_excerpt = excerpt WHERE id = 70;"
  );
  for (const clause of [2, 3, 4]) await approveClause(g, clause);
  const line = (clause) => docOf(render(g, id), "General_writing").markdown.split("\n").find((l) => l.includes(`<!-- clause_id ${clause} -->`));

  assert.equal(line(3), "5. The clause resting on overruled law. ⛔ <!-- clause_id 3 -->", "the bare ⛔ stays: its routing is the work left");
  assert.equal(line(4), "6. The clause resting on killed law. (killed 2026-09-01) <!-- clause_id 4 -->", "the tag stays on the clean line");
  assert.equal(line(2), "1. The Releasor will not sue anyone who may claim over against the Releasee. <!-- clause_id 2 -->");

  await g.execute("UPDATE authorities SET killed_on = '2026-09-26' WHERE id = 60;");
  assert.equal(
    line(2),
    "1. The Releasor will not sue anyone who may claim over against the Releasee. (killed 2026-09-26) <!-- clause_id 2 -->",
    "the kill is counsel's own act, so it re-raises no 🧐"
  );
  await g.execute("UPDATE authorities SET killed_on = NULL, treatment = 'overruled' WHERE id = 60;");
  assert.equal(
    line(2),
    "1. The Releasor will not sue anyone who may claim over against the Releasee. ⛔🧐 <!-- clause_id 2 -->",
    "an overruling after approval is unconfirmed, so 🧐 returns"
  );
});

test("an implied clause citing a verified statement with its pinpoint, from a live authority, prints no 📍 and no 🔬: 🧐 until approved, then nothing", async (t) => {
  const g = await generalWritingFixture(t);
  const id = await release(g);
  await g.execute(`
INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind, treatment, killed_on) VALUES
  (60, 1, 'Live Authority v. Example', '2020 BCSC 1', 'case', NULL, NULL);
INSERT INTO statements_of_law (id, proceeding_id, authority_id, pinpoint, excerpt, verification) VALUES
  (73, 1, 60, 'para 3', 'The verified passage.', 'verified');
INSERT INTO clauses (id, proceeding_id, wording, basis, document_id, pinpoint, excerpt, excerpt_id) VALUES
  (7, 1, 'The Releasor accepts the sum in full satisfaction.', 'implied', NULL, NULL, NULL, 73);
INSERT INTO filing_clauses (filing_id, clause_id, ordinal, wording_override) VALUES (${id}, 7, 1, NULL);
`);
  const line = () => docOf(render(g, id), "General_writing").markdown.split("\n").find((l) => l.includes("<!-- clause_id 7 -->"));

  assert.equal(line(), "1. The Releasor accepts the sum in full satisfaction. 🧐 <!-- clause_id 7 -->");
  await approveClause(g, 7);
  assert.equal(line(), "1. The Releasor accepts the sum in full satisfaction. <!-- clause_id 7 -->");
});

test("the filed face of the release prints the clauses with no marker glyph and no killed tag", async (t) => {
  const g = await generalWritingFixture(t);
  const id = await release(g);
  await seedClauses(g, id);

  const filed = render(g, id, "filed");
  assert.equal(filed.unwritten_gate_failed, undefined);
  assert.deepEqual(filed.documents.map((d) => d.document_type), ["General_writing"]);
  const face = filed.documents[0].markdown;
  const expected = [
    "# Release",
    "",
    "## Terms",
    "",
    "1. The Releasor will not sue anyone who may claim over against the Releasee.",
    "",
    "2. The Releasor releases the Releasee from every claim arising from the accident.",
    "",
    "3. The Releasee pays the settlement sum within 30 days.",
    "",
    "4. This settlement admits no liability.",
    "",
    "5. The clause resting on overruled law.",
    "",
    "6. The clause resting on killed law.",
    "",
    "________________________________",
    "Ada Client",
  ].join("\n");
  assert.ok(face.includes(expected), face);
  assert.doesNotMatch(face, /\(killed/);
  assertFiledFaceClean(face, "General_writing");
});

test("the filed face keeps a clause's own \"(killed ...)\" prose and strips only the dated killed tag", async (t) => {
  const g = await generalWritingFixture(t);
  const id = await release(g);
  await seedClauses(g, id);
  await g.execute("UPDATE clauses SET wording = 'The Releasor waives any claim for the dog (killed in the collision).' WHERE id = 4;");

  const mockup = docOf(render(g, id), "General_writing").markdown;
  assert.match(mockup, /^6\. The Releasor waives any claim for the dog \(killed in the collision\)\. \(killed 2026-09-01\) 🧐 <!-- clause_id 4 -->$/m);
  const face = render(g, id, "filed").documents[0].markdown;
  assert.match(face, /^6\. The Releasor waives any claim for the dog \(killed in the collision\)\.$/m);
  assert.doesNotMatch(face, /\(killed \d{4}-\d{2}-\d{2}\)/);
});

// Schema v46: an implied clause citing a statement the research lawyer failed never reads clean.
// clauseMarkers is unchanged, so the line carries no 🔬; it carries the finding as a plain-text tag
// instead, rendered for the human and withheld from the forum. The finding holds parentheses of its
// own, which the filed-face strip removes whole.
test("a clause citing a failed statement carries its finding on the mockup and never on the filed face (v46)", async (t) => {
  const g = await generalWritingFixture(t);
  const id = await release(g);
  await seedClauses(g, id);
  const finding = "Scrutiny failed 2026-10-02: ratio held; fit failed (the passage concerns (a) leases, not releases).";
  await g.execute(`UPDATE statements_of_law SET pinpoint = 'para 7', verification = 'failed', doubt = '${finding}' WHERE id = 70;`);

  const mockup = docOf(render(g, id), "General_writing").markdown;
  const line = mockup.split("\n").find((l) => l.includes("<!-- clause_id 2 -->"));
  assert.equal(line, `1. The Releasor will not sue anyone who may claim over against the Releasee. (scrutiny failed: ${finding}) 🧐 <!-- clause_id 2 -->`);

  const face = render(g, id, "filed").documents[0].markdown;
  assert.match(face, /^1\. The Releasor will not sue anyone who may claim over against the Releasee\.$/m);
  assert.doesNotMatch(face, /scrutiny failed/i);
  assertFiledFaceClean(face, "General_writing");
});

// #1181: an implied clause naming the enactment its cited statement rests on, while that
// authority's stored statute-currency result is anything but `current` (NULL included), carries a
// plain-text `[currency: <value>]` tag on its mockup line, and the filed render refuses.

/**
 * A statute authority whose currency result is `currency`, a case authority, and four clauses in
 * ordinal order: 8 implied, naming the statute; 9 express, naming it; 10 implied, citing the statute
 * but not naming it; 11 implied, naming the case.
 */
async function seedEnactmentClauses(g, id, currency) {
  const status = currency === null ? "NULL" : `'${currency}'`;
  await g.execute(`
INSERT INTO documents (id, proceeding_id, label) VALUES (50, 1, 'Offer letter');
INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind, currency_status, currency_checked_on) VALUES
  (80, 1, 'Limitation Act', 'SBC 2012, c 13', 'statute', ${status}, ${currency === null ? "NULL" : "'2026-09-20'"}),
  (82, 1, 'Smith v. Jones', '2020 BCSC 9', 'case', NULL, NULL);
INSERT INTO statements_of_law (id, proceeding_id, authority_id, pinpoint, excerpt, verification) VALUES
  (81, 1, 80, 's 6', 'The statute passage.', 'verified'),
  (83, 1, 82, 'para 4', 'The case passage.', 'verified');
INSERT INTO clauses (id, proceeding_id, wording, basis, document_id, pinpoint, excerpt, excerpt_id) VALUES
  (8, 1, 'The Releasor accepts that the Limitation Act governs every claim.', 'implied', NULL, NULL, NULL, 81),
  (9, 1, 'The Releasor has read the Limitation Act.', 'express', 50, 'p. 1', 'read it', NULL),
  (10, 1, 'The Releasor accepts the limitation defence.', 'implied', NULL, NULL, NULL, 81),
  (11, 1, 'As in Smith v. Jones, the release binds.', 'implied', NULL, NULL, NULL, 83);
INSERT INTO filing_clauses (filing_id, clause_id, ordinal, wording_override) VALUES
  (${id}, 8, 1, NULL), (${id}, 9, 2, NULL), (${id}, 10, 3, NULL), (${id}, 11, 4, NULL);
`);
}

const clauseLine = (md, clauseId) => md.split("\n").find((l) => l.includes(`<!-- clause_id ${clauseId} -->`));

test("an implied clause naming a repealed enactment is tagged [currency: repealed] on the mockup, and the filed render refuses naming it", async (t) => {
  const g = await generalWritingFixture(t);
  const id = await release(g);
  await seedEnactmentClauses(g, id, "repealed");

  const md = docOf(render(g, id), "General_writing").markdown;
  assert.equal(clauseLine(md, 8), "1. The Releasor accepts that the Limitation Act governs every claim. [currency: repealed] 🧐 <!-- clause_id 8 -->");
  for (const other of [9, 10, 11]) assert.doesNotMatch(clauseLine(md, other), /\[currency:/, `clause ${other} is not tagged`);

  const filed = render(g, id, "filed");
  assert.deepEqual(filed.documents, []);
  assert.equal(filed.currency_gate_failed, true);
  assert.deepEqual(filed.currency_withheld, [{ clause_id: 8, currency_status: "repealed", provision: null }]);
  assert.match(filed.note, /clause_id 8 \(repealed\)/);
});

test("an implied clause naming an enactment never checked is tagged [currency: unchecked], and the filed render refuses", async (t) => {
  const g = await generalWritingFixture(t);
  const id = await release(g);
  await seedEnactmentClauses(g, id, null);

  const md = docOf(render(g, id), "General_writing").markdown;
  assert.equal(clauseLine(md, 8), "1. The Releasor accepts that the Limitation Act governs every claim. [currency: unchecked] 🧐 <!-- clause_id 8 -->");

  const filed = render(g, id, "filed");
  assert.deepEqual(filed.documents, []);
  assert.equal(filed.currency_gate_failed, true);
  assert.deepEqual(filed.currency_withheld, [{ clause_id: 8, currency_status: null, provision: null }]);
  assert.match(filed.note, /clause_id 8 \(unchecked\)/);
});

test("an override naming the enactment in other case and spacing is tagged too", async (t) => {
  const g = await generalWritingFixture(t);
  const id = await release(g);
  await seedEnactmentClauses(g, id, "archived");
  await g.execute(`UPDATE filing_clauses SET wording_override = 'The  LIMITATION act bars nothing here.' WHERE clause_id = 10;`);

  const md = docOf(render(g, id), "General_writing").markdown;
  assert.equal(clauseLine(md, 10), "3. The  LIMITATION act bars nothing here. [currency: archived] 🧐 <!-- clause_id 10 -->");
  assert.deepEqual(render(g, id, "filed").currency_withheld, [
    { clause_id: 8, currency_status: "archived", provision: null },
    { clause_id: 10, currency_status: "archived", provision: null },
  ]);
});

test("a sent Writing's filed render prints a clause naming a repealed enactment, and a later shared edit changes neither render (#1227)", async (t) => {
  const g = await generalWritingFixture(t);
  const id = await release(g);
  await seedEnactmentClauses(g, id, "repealed");
  seedSql(g.dbPath, `${partiesSnapshotSql(g.dbPath, id)} UPDATE filings SET filed_on = '2026-09-28' WHERE id = ${id};`);

  const line = "1. The Releasor accepts that the Limitation Act governs every claim. [currency: repealed] 🧐 <!-- clause_id 8 -->";
  assert.equal(clauseLine(docOf(render(g, id), "General_writing").markdown, 8), line);
  const filed = render(g, id, "filed");
  assert.equal(filed.currency_gate_failed, undefined);
  const face = filed.documents[0].markdown;
  assert.match(face, /^1\. The Releasor accepts that the Limitation Act governs every claim\.$/m);

  await g.execute(`UPDATE clauses SET wording = 'The Releasor edited this later.' WHERE id = 8;`);
  assert.equal(clauseLine(docOf(render(g, id), "General_writing").markdown, 8), line);
  assert.equal(render(g, id, "filed").documents[0].markdown, face);
});

/** Records `status` for the Limitation Act's `provision`, from a consolidation current to 2026-09-01. */
const provisionSql = (provision, status, amendedOn = null, amendmentCheckedOn = null) =>
  `INSERT INTO provision_currency (authority_id, provision, currency_status, checked_on, current_to, amended_on, amendment_checked_on)
     VALUES (80, '${provision}', '${status}', '2026-10-04', '2026-09-01', ${amendedOn ? `'${amendedOn}'` : "NULL"}, ${amendmentCheckedOn ? `'${amendmentCheckedOn}'` : "NULL"});`;

test("a current enactment and a current cited provision are untagged, and the filed render prints the clause naming it", async (t) => {
  const g = await generalWritingFixture(t);
  const id = await release(g);
  await seedEnactmentClauses(g, id, "current");
  await g.execute(provisionSql("s 6", "current"));

  assert.doesNotMatch(docOf(render(g, id), "General_writing").markdown, /\[currency:/);
  const filed = render(g, id, "filed");
  assert.equal(filed.currency_gate_failed, undefined);
  const face = filed.documents[0].markdown;
  assert.match(face, /^1\. The Releasor accepts that the Limitation Act governs every claim\.$/m);
  assertFiledFaceClean(face, "General_writing");
});

// Statute currency per provision: an enactment whose own result is `current` still withholds an
// implied clause while the provision its cited statement pinpoints has no `current` result, and the
// tag names that provision, so one instrument can read "s 7 amended, s 6 untouched".
test("a current enactment's clauses are tagged per cited provision, and the filed render refuses until each provision is current", async (t) => {
  const g = await generalWritingFixture(t);
  const id = await release(g);
  await seedEnactmentClauses(g, id, "current");
  await g.execute(`
INSERT INTO statements_of_law (id, proceeding_id, authority_id, pinpoint, excerpt, verification) VALUES (84, 1, 80, 's 7', 'The second passage.', 'verified');
INSERT INTO clauses (id, proceeding_id, wording, basis, document_id, pinpoint, excerpt, excerpt_id) VALUES
  (12, 1, 'The Limitation Act sets the period.', 'implied', NULL, NULL, NULL, 84);
INSERT INTO filing_clauses (filing_id, clause_id, ordinal, wording_override) VALUES (${id}, 12, 5, NULL);
${provisionSql("s 6", "current")}
${provisionSql("s 7", "amendment-unchecked", "2026-09-15")}
`);

  const md = docOf(render(g, id), "General_writing").markdown;
  assert.doesNotMatch(clauseLine(md, 8), /\[currency:/, "s 6 is current");
  assert.match(clauseLine(md, 12), /^5\. The Limitation Act sets the period\. \[currency: s 7 amendment-unchecked\]/);
  const filed = render(g, id, "filed");
  assert.equal(filed.currency_gate_failed, true);
  assert.deepEqual(filed.currency_withheld, [{ clause_id: 12, currency_status: "amendment-unchecked", provision: "s 7" }]);
  assert.match(filed.note, /clause_id 12 \(s 7 amendment-unchecked\)/);

  await g.execute(`DELETE FROM provision_currency WHERE provision = 's 6';
UPDATE provision_currency SET currency_status = 'current', amendment_checked_on = '2026-10-04' WHERE provision = 's 7';`);
  assert.deepEqual(render(g, id, "filed").currency_withheld, [{ clause_id: 8, currency_status: null, provision: "s 6" }]);
  assert.match(clauseLine(docOf(render(g, id), "General_writing").markdown, 8), /\[currency: s 6 unchecked\]/);

  await g.execute(provisionSql("s 6", "current"));
  assert.equal(render(g, id, "filed").currency_gate_failed, undefined);
});

test("a terms part with paragraph_numbering none refuses at creation naming the part and the rule", async (t) => {
  const g = await generalWritingFixture(t);
  const parts = RELEASE_BLOCK.parts.map((p) => (p.source === "terms" ? { ...p, paragraph_numbering: "none" } : p));
  await assert.rejects(release(g, { ...RELEASE_BLOCK, parts }), (err) => {
    assert.equal(err.code, "invalid_layout");
    assert.match(err.message, /parts\[0\]\.paragraph_numbering/);
    assert.match(err.message, /"terms" part is always numbered/);
    return true;
  });
  assert.equal(g.query("SELECT count(*) AS n FROM filings")[0].n, 0, "a refusal writes nothing");
});

// #1260: a lawyer-signed general type that is not a letter prints no roster closing, and ends its
// signature block with a counsel line built from the client's role.

const SUBMISSION_BLOCK = {
  renderer: "general",
  needs_forum_parts: false,
  folder_code: "LTR",
  title: "Written submission",
  exhibit_numbering: "writing",
  parts: [
    { heading: null, heading_numbering: "none", paragraph_numbering: "none", source: "slot:body" },
    { heading: null, heading_numbering: "none", paragraph_numbering: "none", source: "signature-block" },
  ],
};

/** The non-letter lawyer-signed Writing on proceeding 1 (client Ada Client, Claimant), its body written. */
async function submission(g) {
  const { filing_id } = await g.createLetter({ signer_key: "pe" });
  await g.prose(filing_id, "body", "The submission.");
  return filing_id;
}

test("a lawyer-signed type without letterhead prints no closing and ends with the counsel line, plural when parties share the client's role", async (t) => {
  const g = await generalWritingFixture(t, { person: "st", front: REVIEWED_FRONT, block: SUBMISSION_BLOCK });
  const id = await submission(g);

  const md = docOf(render(g, id), "General_writing").markdown;
  assert.ok(md.includes("The submission. 🧐\n\n________________________________\nPat Example\nBarrister & Solicitor\nFixture Law LLP\nCounsel for the Claimant\n"), md);
  assert.doesNotMatch(md, /Yours truly/);

  await g.execute("INSERT INTO parties (id, proceeding_id, name, role, ordinal, is_client) VALUES (5, 1, 'Eve Client', 'Claimant', 3, 0);");
  assert.ok(docOf(render(g, id), "General_writing").markdown.includes("Fixture Law LLP\nCounsel for the Claimants"));
});

test("with no client party the counsel line is a gap on the mockup and absent from the filed face", async (t) => {
  const g = await generalWritingFixture(t, { front: REVIEWED_FRONT, block: SUBMISSION_BLOCK });
  const id = await submission(g);
  await g.execute("UPDATE parties SET is_client = 0 WHERE proceeding_id = 1;");

  const md = docOf(render(g, id), "General_writing").markdown;
  assert.match(md, /Fixture Law LLP\n🧩 ________ <!-- counsel empty -->/);
  assert.doesNotMatch(md, /Counsel for the/);

  const filed = render(g, id, "filed");
  const face = filed.documents.find((d) => d.document_type === "General_writing")?.markdown;
  assert.ok(face, JSON.stringify(filed));
  assert.ok(face.includes("Fixture Law LLP"), face);
  assert.doesNotMatch(face, /counsel empty|🧩|Counsel for the/);
});

// Plan 2026-10-07 step 5: a prose line holding what is not printed wording is flagged on the mockup
// and counted by open-items; a refused rule refuses the filed render, and a blank underline files.
test("a prose placeholder in brackets is flagged, counted and refuses the filed render; [sic] and the signing line are not flagged; a blank underline files", async (t) => {
  const g = await generalWritingFixture(t, { front: REVIEWED_FRONT });
  const { filing_id: id } = await g.createLetter();
  confirm(g, ["R-title", "R-body"]);
  g.setPerson("st"); // the signer is not this machine's person, so the signing line prints
  await g.prose(id, "addressee", ADDRESSEE);
  await g.prose(id, "body", "The judge said it was [sic] late.\n\nDated [insert date].");
  await g.prose(id, "sender", SENDER);
  await g.recipient(id, 1, "to");

  const result = render(g, id);
  const md = docOf(result, "General_writing").markdown;
  assert.match(md, /^1\. The judge said it was \[sic\] late\.$/m, "an ordinary [sic] is not flagged");
  assert.match(md, /^2\. Dated \[insert date\]\. 🧩 <!-- format: bracket --> 🧐$/m, md);
  assert.ok(md.includes("\n________________________________\nPat Example\n"), `the signing line is not flagged: ${md}`);
  assert.deepEqual([openItemsOf(result).state, openItemsOf(result).items], ["unmet", ["body format: bracket"]]);

  const refused = render(g, id, "filed");
  assert.equal(refused.prose_format_gate_failed, true);
  assert.deepEqual(refused.prose_format, [{ slot: "body", rules: ["bracket"], line: "Dated [insert date]." }]);
  assert.deepEqual(refused.documents, []);
  assert.match(refused.note, /body \(bracket\): "Dated \[insert date\]\."/);

  await g.execute(`UPDATE filing_prose SET text = 'The judge said it was [sic] late.

Dated ________.' WHERE filing_id = ${id} AND slot = 'body';`);
  const blank = render(g, id);
  assert.match(docOf(blank, "General_writing").markdown, /^2\. Dated ________\. 🧩 <!-- format: underscores --> 🧐$/m);
  assert.deepEqual(openItemsOf(blank).items, ["body format: underscores"]);
  const filed = render(g, id, "filed");
  assert.equal(filed.prose_format_gate_failed, undefined);
  const face = filed.documents[0].markdown;
  assert.ok(face.includes("1. The judge said it was [sic] late.\n\n2. Dated ________.\n"), face);
  assert.doesNotMatch(face, /🧩|format:/);
});
