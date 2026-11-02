// Unstructured Writings (plan 2026-10-07, structured and unstructured Writings, steps 6 to 8): a
// venue's stock `unstructured` type, created for a document type with no type file of its own,
// renders through the general renderer with the Q3 header naming its type and title, the caption,
// no title heading, and the `form-source` projection, a gap until the saved form copy is linked. It
// publishes through the venue's generic template. The conversion's `/localize create` with a
// practitioner layout writes a type file the next lookup resolves. The Sent write records one, and
// the accepted conversion job sits on its Work Board. /draft's and /publish's shipped
// trees under CAN/BC; the firm overlay, matter and databases are temporary. Never a live matter.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { inflateRawSync } from "node:zlib";

import { BCSC_TREE, generalWritingFixture } from "./helpers/general-writing-fixture.mjs";
import { knowledgeFile } from "./helpers/knowledge-fixture.mjs";
import { assertFiledFaceClean } from "./helpers/filed-face-scan.mjs";
import { boardDataOf } from "./fixtures/forms-render-seeds.mjs";

const { submissionFormsRender } = await import("../build/submission/forms.js");
const { knowledgeList, knowledgeWrite } = await import("../build/knowledge/tools.js");
const { publishGeneral } = await import("../build/submission/publish-tools.js");
const { submissionDataRecordSent } = await import("../build/submission/forms/sent-write.js");
const { fetchRevision } = await import("../build/submission/forms/query.js");

const CLIENT = { clientName: "Ada Client", clientNo: "0001", matterNo: "L0000" };
const NOW = "2026-10-08 10:00";
const TITLE = "notice of discontinuance";
const BODY = "NOTICE OF DISCONTINUANCE\n\nThe plaintiff discontinues this action against the defendant.";
const VENUES = ["BCSC", "BCCA", "Vancouver-International-Arbitration-Centre"];
const GAP = (what) => new RegExp(`^🧩 ________ <!-- ${what} -->$`, "m");

const render = (g, id, mode = "mockup") => submissionFormsRender(g.dbPath, id, CLIENT, mode, undefined, undefined, undefined, NOW);
const docOf = (result) => result.documents.find((d) => d.document_type === "General_writing");
const headerOf = (md) => md.slice("---\n".length, md.indexOf("\n---\n")).split("\n");
const criterion = (g, id, name) => boardDataOf(g.dbPath, id, CLIENT, NOW).criteria.find((c) => c.id === name);

/** The BCSC Unstructured Writing, created as the lookup's miss route creates it: the stock kind, the
 * phrase as given as its title. Proceeding 2 is in the BC Supreme Court. */
async function unstructured(g) {
  await g.execute("UPDATE proceedings SET registry = 'Vancouver' WHERE id = 2;");
  const { filing_id } = await g.create({ proceeding_id: 2, tree: BCSC_TREE, kind: "unstructured", title: TITLE });
  return filing_id;
}

/** The saved form copy, recorded and linked as /drafting-data's filing-checklists.md §13 "Form copy" says. */
async function linkForm(g, id, role = "other") {
  await g.execute(
    "INSERT INTO documents (id, proceeding_id, label, file_path) VALUES (40, 2, 'Form 36 notice of discontinuance', 'form-36.pdf');" +
      `INSERT INTO filing_documents (filing_id, document_id, ordinal, role) VALUES (${id}, 40, 1, '${role}');`
  );
}

test("each venue's stock kind resolves, and a document type with no type file of its own is not_found at BCSC", async (t) => {
  const g = await generalWritingFixture(t);
  for (const venue of VENUES) {
    const r = knowledgeList({ dir: `draft/CAN/BC/${venue}/Documents`, resolve: "unstructured" }, g.seams);
    assert.deepEqual([r.result, r.code], ["resolved", "unstructured"], venue);
  }
  assert.equal(knowledgeList({ dir: "draft/CAN/BC/BCSC/Documents", resolve: TITLE }, g.seams).result, "not_found");
});

// _NoVenue holds one stock type per recipient, `unstructured-<recipient>`, because the kinds index
// refuses two rows naming one file. Proceeding 1 has no forum.
const NO_VENUE_BC = { country: "CAN", jurisdiction: "BC", venue: "_NoVenue" };
const NO_VENUE_RECIPIENTS = ["opposing-counsel", "opposing-party", "witness", "expert", "public-body", "non-party", "internal"];
const UNDERTAKING = "letter of undertaking";

test("under _NoVenue a document type with no type file is not_found for every recipient, and that recipient's stock kind resolves", async (t) => {
  const g = await generalWritingFixture(t);
  const dir = "draft/CAN/BC/_NoVenue/Documents";
  for (const recipient of NO_VENUE_RECIPIENTS) {
    assert.equal(knowledgeList({ dir, resolve: UNDERTAKING, recipient }, g.seams).result, "not_found", recipient);
    const r = knowledgeList({ dir, resolve: "unstructured", recipient }, g.seams);
    assert.deepEqual([r.result, r.code], ["resolved", `unstructured-${recipient}`], recipient);
  }
});

test("a _NoVenue recipient's stock kind creates a Writing whose header names the type and the title, with no title heading", async (t) => {
  const g = await generalWritingFixture(t);
  for (const recipient of ["opposing-counsel", "witness"]) {
    const { filing_id } = await g.create({ proceeding_id: 1, tree: NO_VENUE_BC, kind: `unstructured-${recipient}`, recipient, title: UNDERTAKING });
    const [row] = g.query("SELECT kind, needs_forum_parts, layout_snapshot FROM filings WHERE id = ?", [filing_id]);
    const { layout } = JSON.parse(row.layout_snapshot);
    assert.deepEqual([row.kind, row.needs_forum_parts, layout.folder_code, layout.title], [`unstructured-${recipient}`, 0, undefined, "Unstructured"]);
    assert.deepEqual(layout.parts.map((p) => p.source), ["slot:date", "addressee", "slot:body", "signature-block"]);

    const md = docOf(render(g, filing_id)).markdown;
    for (const field of [`Document Type: ${UNDERTAKING}`, `Document Name: ${UNDERTAKING}`]) assert.ok(headerOf(md).includes(field), `${field}\n${md}`);
    assert.doesNotMatch(md, /^# /m, recipient);
  }
});

test("each venue's stock type is created on a proceeding in that venue, with no folder code and needs_forum_parts 1", async (t) => {
  const g = await generalWritingFixture(t);
  const ids = [await unstructured(g)];
  const bcca = await g.create({ proceeding_id: 3, tree: { ...BCSC_TREE, venue: "BCCA" }, kind: "unstructured", title: "notice of abandonment" });
  ids.push(bcca.filing_id);
  for (const id of ids) {
    const [row] = g.query("SELECT needs_forum_parts, layout_snapshot FROM filings WHERE id = ?", [id]);
    const { layout } = JSON.parse(row.layout_snapshot);
    assert.equal(row.needs_forum_parts, 1);
    assert.deepEqual([layout.folder_code, layout.title], [undefined, "Unstructured"]);
    assert.deepEqual(layout.parts.map((p) => p.source), ["caption", "form-source", "slot:body", "signature-block"]);
  }
});

test("the mockup names the type and the title in its header, prints the caption and no title heading, and a gap where the form copy goes; the filed render refuses naming it", async (t) => {
  const g = await generalWritingFixture(t);
  const id = await unstructured(g);

  const md = docOf(render(g, id)).markdown;
  const header = headerOf(md);
  for (const field of [`Document Type: ${TITLE}`, `Document Name: ${TITLE}`, "Document Date: ________", "Venue: BC Supreme Court"]) {
    assert.ok(header.includes(field), `${field}\n${md}`);
  }
  assert.doesNotMatch(md, /^# /m, "no title heading: the type's title names the type, not the document");
  assert.match(md, /\| \| \*\*IN THE SUPREME COURT OF BRITISH COLUMBIA\*\* \| \|/);
  assert.match(md, GAP("form-source empty"));
  assert.match(md, GAP("body not written"));
  assert.match(md, /Fixture Law LLP\nCounsel for the Plaintiff/);

  const filed = render(g, id, "filed");
  assert.equal(filed.unwritten_gate_failed, true);
  assert.deepEqual(filed.unwritten, ["form-source", "body"]);
  assert.deepEqual(filed.documents, []);
});

test("a linked form copy prints only its comment, and the filed face carries the caption, the body and the signature block, nothing human-side", async (t) => {
  const g = await generalWritingFixture(t);
  const id = await unstructured(g);
  await g.prose(id, "body", BODY);
  await linkForm(g, id);

  const md = docOf(render(g, id)).markdown;
  assert.match(md, /^<!-- form copy: document_id 40 -->$/m);
  assert.doesNotMatch(md, /form-source empty/);

  const filed = render(g, id, "filed");
  const face = docOf(filed)?.markdown;
  assert.ok(face, JSON.stringify(filed));
  assertFiledFaceClean(face, "the Unstructured Writing's filed face");
  assert.match(face, /IN THE SUPREME COURT OF BRITISH COLUMBIA/);
  assert.ok(face.includes("NOTICE OF DISCONTINUANCE\n\nThe plaintiff discontinues this action against the defendant.\n"), face);
  assert.match(face, /Counsel for the Plaintiff/);
  assert.doesNotMatch(face, /Unstructured|form copy|document_id|🧩/);
});

test("a document linked with another role is not the form copy, so the gap stays", async (t) => {
  const g = await generalWritingFixture(t);
  const id = await unstructured(g);
  await linkForm(g, id, "evidence");
  assert.match(docOf(render(g, id)).markdown, GAP("form-source empty"));
});

test("open-items names the form copy's gap until it is linked", async (t) => {
  const g = await generalWritingFixture(t);
  const id = await unstructured(g);
  await g.prose(id, "body", BODY);

  render(g, id);
  const before = criterion(g, id, "open-items");
  assert.equal(before.state, "unmet");
  assert.deepEqual(before.items, ["form-source empty"]);

  await linkForm(g, id);
  render(g, id);
  assert.equal(criterion(g, id, "open-items").state, "met");
});

test("the save's stock jobs, Draft the Writing and Deliver, never hold the gate row", async (t) => {
  const g = await generalWritingFixture(t);
  const id = await unstructured(g);
  await g.execute(
    "INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, kind, priority, billing_anchor, created) VALUES " +
      `(20, 2, ${id}, 'Draft the Writing', 'Draft this Writing and render its mockup for review.', 'work', 0, 'L0000|${TITLE}', '2026-10-08T10:00'),` +
      `(21, 2, ${id}, 'Deliver', 'Send this letter to its recipients and record it as sent.', 'work', 0, 'L0000|${TITLE}', '2026-10-08T10:00');` +
      "INSERT INTO ticket_blocks (blocker_id, blocked_id) VALUES (20, 21);"
  );
  render(g, id);
  const gate = criterion(g, id, "gate");
  assert.equal(gate.state, "met", JSON.stringify(gate));
  assert.deepEqual(gate.items, []);
});

/** A matter folder with one 0. DRAFT folder, whose pointer names the folder holding the database. */
function matterOver(t, caseData) {
  const base = mkdtempSync(join(tmpdir(), "coclerk-unstructured-"));
  t.after(() => rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  const root = join(base, "L0000 Matter");
  mkdirSync(join(root, "0. DRAFT"), { recursive: true });
  writeFileSync(join(root, "coclerk.json"), JSON.stringify({ schema_version: 5, matter_root: root, case_data_dir: caseData }));
  return { root: realpathSync.native(root), draft: realpathSync.native(join(root, "0. DRAFT")) };
}

/** word/document.xml of a .docx, stored or deflated. */
function documentXml(path) {
  const buf = readFileSync(path);
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let at = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < buf.readUInt16LE(eocd + 10); i += 1) {
    const nameLength = buf.readUInt16LE(at + 28);
    if (buf.toString("utf-8", at + 46, at + 46 + nameLength) === "word/document.xml") {
      const local = buf.readUInt32LE(at + 42);
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + buf.readUInt32LE(at + 20));
      return (buf.readUInt16LE(at + 10) === 8 ? inflateRawSync(data) : data).toString("utf-8");
    }
    at += 46 + nameLength + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
  }
  throw new Error(`${path} holds no word/document.xml`);
}

test("publish_general writes the Word document through the BCSC generic template, the caption and the body included, and no type name", async (t) => {
  const g = await generalWritingFixture(t);
  const id = await unstructured(g);
  await g.prose(id, "body", BODY);
  await linkForm(g, id);
  const m = matterOver(t, realpathSync.native(dirname(g.dbPath)));
  const name = "2026-10-08 NOD re discontinuance";

  const result = publishGeneral({ matter_root: m.root, db_path: g.dbPath, filing_id: id, output_name: name, format_path: "publish/CAN/BC/BCSC/format.md" });
  assert.equal(result.success, true, JSON.stringify(result));
  assert.deepEqual(readdirSync(m.draft), [`${name}.docx`]);
  const xml = documentXml(result.deliverable);
  assert.match(xml, /IN THE SUPREME COURT OF BRITISH COLUMBIA/);
  assert.match(xml, /NOTICE OF DISCONTINUANCE/);
  assert.match(xml, /The plaintiff discontinues this action against the defendant\./);
  assert.match(xml, /Counsel for the Plaintiff/);
  assert.doesNotMatch(xml, /Unstructured|form copy/);
});

// Step 7: the conversion job's `/localize create` with a practitioner layout and the saved form,
// run as /localize's playbook section 3a writes it, the helper's knowledge__write calls made here.
test("a practitioner layout's create writes the form's source record, a learned type file and its kinds row; the next lookup resolves it and a new Writing takes it", async (t) => {
  const g = await generalWritingFixture(t);
  const seams = { ...g.seams, lookUpMatter: g.f.seams.lookUpMatter };
  const write = (args) => knowledgeWrite({ matter: "L8443", operation: "create", ...args }, seams);
  const DIR = "draft/CAN/BC/BCSC";
  const REF = "notice-of-discontinuance-part-0";
  // /localize staged the practitioner's saved form into _inbox before spawning.
  mkdirSync(g.f.localPath("_inbox"), { recursive: true });
  writeFileSync(g.f.localPath("_inbox/form-36.pdf"), "%PDF-1.4\nNOTICE OF DISCONTINUANCE\n%%EOF\n");

  const record = [
    "---",
    "page_url: https://www.bccourts.ca/forms/form-36",
    "accessed: 2026-10-08",
    "checked: 2026-10-08",
    'fetch_note: "saved by practitioner; form copy for a practitioner layout"',
    "items:",
    `  - rule_ref: ${REF}`,
    "    passage: NOTICE OF DISCONTINUANCE",
    "    checked_by: file_sha256",
    "    page: 1",
    "---",
    "# Form 36",
    "",
  ].join("\n");
  const saved = await write({ path: `${DIR}/Sources/notice-of-discontinuance.md`, content: record, saved_copy: "_inbox/form-36.pdf" });
  assert.equal(saved.status, "created");
  assert.equal(saved.saved_copy.copied, true);

  const part = (source, extra = {}) => ({ heading: null, heading_numbering: "none", paragraph_numbering: "none", source, ...extra });
  const layout = {
    renderer: "general",
    needs_forum_parts: true,
    folder_code: "NOD",
    title: "Notice of discontinuance",
    exhibit_numbering: "writing",
    goal_criteria: ["open-items", "counsel-review"],
    parts: [part("literal", { text: "NOTICE OF DISCONTINUANCE", rule_ref: REF }), part("slot:body")],
  };
  const typeFile = `${DIR}/Documents/notice-of-discontinuance.md`;
  const front = "sources:\n  - ../Sources/notice-of-discontinuance.md";
  assert.equal((await write({ path: typeFile, content: knowledgeFile(front, layout, "Recorded from a Writing the practitioner sent.\n") })).status, "created");
  await write({ path: `${DIR}/Documents/kinds.local.json`, row: { file: "notice-of-discontinuance", name: "Notice of discontinuance", aliases: [] } });

  const resolved = knowledgeList({ dir: `${DIR}/Documents`, resolve: TITLE }, seams);
  assert.deepEqual([resolved.result, resolved.code], ["resolved", "notice-of-discontinuance"]);
  assert.match(readFileSync(g.f.localPath(typeFile), "utf-8"), /^learned_by: "agent"$/m);

  // A part outside the vocabulary is refused by the runtime too, writing nothing.
  const bad = { ...layout, parts: [part("form-copy-text"), part("slot:body")] };
  await assert.rejects(write({ path: `${DIR}/Documents/bad-layout.md`, content: knowledgeFile("accessed: 2026-10-08", bad) }), (err) => err.code === "invalid_layout");

  // The next Writing of that type is Structured: its literal prints, tagged unverified until a lawyer confirms it.
  await g.execute("UPDATE proceedings SET registry = 'Vancouver' WHERE id = 2;");
  const { filing_id } = await g.create({ proceeding_id: 2, tree: BCSC_TREE, kind: "notice-of-discontinuance", title: "notice of discontinuance re Bert" });
  await g.prose(filing_id, "body", "The plaintiff discontinues this action against the defendant.");
  const md = docOf(render(g, filing_id)).markdown;
  assert.ok(headerOf(md).includes("Document Type: Notice of discontinuance"), md);
  assert.match(md, /^# Notice of discontinuance$/m);
  assert.ok(md.split("\n").includes(`NOTICE OF DISCONTINUANCE [unverified: ${REF}, transcribed from PDF p. 1]`), md);
});

// Step 8: the Sent write on an Unstructured Writing, then the conversion job written by the SQL
// /drafting-data's jobs-stock.md §3h gives, as an accepted offer writes it.
const JOBS_STOCK = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", ".claude", "skills", "drafting-data", "references", "jobs-stock.md");

test("the Sent write records a written Unstructured Writing from a pasted copy, closes Deliver and offers no retirement at a venue; the accepted conversion job sits on its Work Board", async (t) => {
  const g = await generalWritingFixture(t);
  const id = await unstructured(g);
  await g.prose(id, "body", BODY);
  await linkForm(g, id);
  // The save's stock jobs (jobs-stock.md §3b): Draft the Writing, completed once drafted, and Deliver.
  await g.execute(
    "INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, kind, priority, billing_anchor, created, status, completed_at) VALUES " +
      `(20, 2, ${id}, 'Draft the Writing', 'Draft this Writing and render its mockup for review.', 'work', 0, 'L0000|${TITLE}', '2026-10-08T10:00', 'completed', '2026-10-08T11:00'),` +
      `(21, 2, ${id}, 'Deliver', 'Send this letter to its recipients and record it as sent.', 'work', 0, 'L0000|${TITLE}', '2026-10-08T10:00', 'queued', NULL);` +
      "INSERT INTO ticket_steps (ticket_id, ordinal, text) VALUES (21, 1, 'Send the letter to its recipients'), (21, 2, 'Record the letter as sent');" +
      "INSERT INTO ticket_blocks (blocker_id, blocked_id) VALUES (20, 21);"
  );
  render(g, id);

  const sent = await submissionDataRecordSent(
    { db_path: g.dbPath, filing_id: id, sent_on: "2026-10-08", sent_copy_text: `IN THE SUPREME COURT OF BRITISH COLUMBIA\n\n${BODY}\n\nPat Example`, expect_revision: fetchRevision(g.dbPath) },
    g.seams.env
  );
  assert.equal("offer_delivered" in sent, false, "recording a Writing as sent never leads to a retirement offer (ADR 0042)");
  assert.deepEqual(sent.deliver, { ticket_id: 21 });
  assert.equal(g.query("SELECT filed_on FROM filings WHERE id = ?", [id])[0].filed_on, "2026-10-08");

  // Accepted: §3h's call 1, call 2's recovery, and call 3 with no retirement step on a venue's Writing.
  const text = readFileSync(JOBS_STOCK, "utf-8").replace(/\r\n/g, "\n");
  // §3h alone: the sections after it carry SQL of their own.
  const from = text.indexOf("## 3h.");
  const end = text.indexOf("\n## ", from + 1);
  const blocks = [...text.slice(from, end === -1 ? undefined : end).matchAll(/```sql\n([\s\S]*?)\n```/g)].map((m) => m[1]);
  assert.equal(blocks.length, 2, "§3h's call 1 and call 3");
  await g.execute(blocks[0].replace("VALUES (1, 9,", `VALUES (2, ${id},`).replaceAll("Notice of discontinuance", TITLE));
  const jobTitle = `Keep the layout of ${TITLE} for next time`;
  const [job] = g.query("SELECT id, filing_id, intent, status, kind, billing_anchor FROM tickets WHERE filing_id = ? AND title = ?", [id, jobTitle]);
  assert.deepEqual(
    { ...job, id: undefined },
    {
      id: undefined,
      filing_id: id,
      intent: `Record this document's layout so the next ${TITLE} is drafted from it. Unbilled: firm infrastructure.`,
      status: "queued",
      kind: "work",
      billing_anchor: "<matter>|unbilled firm infrastructure",
    }
  );
  const call3 = blocks[1].split("\n").filter((line) => !line.includes("'Offer retirement'")).join("\n").replaceAll("(30,", `(${job.id},`);
  await g.execute(call3);
  assert.deepEqual(
    g.query("SELECT ordinal, text FROM ticket_steps WHERE ticket_id = ? ORDER BY ordinal", [job.id]).map((s) => [s.ordinal, s.text]),
    [
      [1, "Compose the candidate layout from the frozen Writing, structure only"],
      [2, "Run /localize create with the practitioner layout and, for a court form, the saved copy of the linked form"],
    ]
  );
  assert.ok(criterion(g, id, "gate").items.includes(jobTitle), "the job is ordinary work on the Writing's own board");
});
