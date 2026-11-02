// #1234: the held `recipients` goal criterion. A general Writing whose stored layout declares it and
// has no 'to' filing_recipients row, a cc-only one included, prints a mockup-only `🧩 ________ <!--
// no To recipient -->` line, recorded as a non-generating 🧩 entry keyed on the Writing, which `recipients`
// counts and open-items does not. The filed face drops the line and the filed render is not refused
// on it. The Work Board's gate row and the Sent write's pre-send hold read it like the other held
// criteria: `held` until a 'to' row exists, or waived by send_anyway. A layout that does not declare
// it is unaffected. The letters live in a firm overlay (helpers/general-writing-fixture.mjs).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";

import { assertFiledFaceClean } from "./helpers/filed-face-scan.mjs";
import { generalWritingFixture, LETTER_BLOCK, NO_VENUE_TREE } from "./helpers/general-writing-fixture.mjs";
import { knowledgeFile } from "./helpers/knowledge-fixture.mjs";
import { boardDataOf } from "./fixtures/forms-render-seeds.mjs";

const { submissionFormsRender } = await import("../build/submission/forms.js");
const { submissionDataRecordSent } = await import("../build/submission/forms/sent-write.js");
const { fetchRevision } = await import("../build/submission/forms/query.js");

const CLIENT = { clientName: "Ada Client", clientNo: "0001", matterNo: "L0000" };
const NOW = "2026-09-28 10:00";
const BODY = "First paragraph of the letter.\n\nSecond paragraph of the letter.";
const AS_SENT = "Dear Wanda,\n\n1. First paragraph of the letter.\n\n2. Second paragraph of the letter.\n\nYours truly,\nPat Example";
const WORDS = "The client instructs us to send it today; the witness's address follows by separate letter.";
const GAP = "no To recipient";
const CARD = "The Writing is addressed to a recipient";

/** The fixture's counsel letter, vetted (no rule_ref), declaring `goal_criteria` as given. */
const vetted = (goal_criteria) => ({ ...LETTER_BLOCK, title: "Letter to opposing counsel", goal_criteria, parts: LETTER_BLOCK.parts.map(({ rule_ref, ...rest }) => rest) });
const DECLARING = vetted(["primary-authority", "excerpts", "noting-up", "recipients", "open-items", "counsel-review"]);
const NOT_DECLARING = vetted(["primary-authority", "excerpts", "noting-up", "open-items", "counsel-review"]);

// #1365: a render returns its board as board_summary; the board's data is this filing's section of
// the matter's Work Board page, read the way the page builds it, right after the render.
const render = (g, id, mode = "mockup") => {
  const result = submissionFormsRender(g.dbPath, id, CLIENT, mode, undefined, undefined, undefined, NOW);
  return mode === "mockup" ? { ...result, board: boardDataOf(g.dbPath, id, CLIENT, NOW) } : result;
};
const docOf = (result, type) => result.documents.find((d) => d.document_type === type);
const boardOf = (result) => result.board;
const criterionOf = (board, id) => board.criteria.find((c) => c.id === id);
const letterOf = (result) => docOf(result, "General_writing").markdown;
const gapEntries = (result) =>
  JSON.parse(readFileSync(join(dirname(dirname(docOf(result, "General_writing").path)), "Drafting records", `render-manifest-${result.filing_id}.json`), "utf-8"))
    .inventory.filter((e) => e.marker === "🧩")
    .map((e) => [e.generating, e.table, e.id, e.item, e.doc]);

/** A letter with every part written and the signer chosen, with no recipient, and its Deliver job,
 * whose billing anchor a Pre-send gate job copies. */
async function written(t, block = DECLARING) {
  const g = await generalWritingFixture(t, { front: null, block });
  const { filing_id: id } = await g.createLetter();
  await g.prose(id, "addressee", "Wanda Witness\n12 Elm Street");
  await g.prose(id, "body", BODY);
  await g.prose(id, "sender", "Fixture Law LLP");
  await g.execute(
    `INSERT INTO recipients (id, proceeding_id, name, capacity, email, party_id, ordinal, forum_default) VALUES
       (4, 1, 'Wanda Witness', 'a witness to the accident', 'wanda@witness.test', NULL, 4, 0);
     INSERT INTO tickets (proceeding_id, filing_id, title, intent, kind, priority, billing_anchor, created)
       VALUES (1, ${id}, 'Deliver', 'Send this letter to its recipients and record it as sent.', 'work', 0, 'L0000|witness letter', '2026-09-28T09:00');`
  );
  return { g, id };
}

const send = (g, id, extra = {}) => submissionDataRecordSent({ db_path: g.dbPath, filing_id: id, sent_on: "2026-09-28", sent_copy_text: AS_SENT, expect_revision: fetchRevision(g.dbPath), ...extra }, g.seams.env);
const code = (expected, message) => (err) => {
  assert.equal(err.code, expected, err.message);
  if (message) assert.match(err.message, message);
  return true;
};
const gateSteps = (g, id) =>
  g.query("SELECT s.text, s.done_at FROM ticket_steps s JOIN tickets t ON t.id = s.ticket_id WHERE t.filing_id = ? AND t.title = 'Pre-send gate' ORDER BY s.ordinal", [id]);

test("create_writing accepts a layout declaring recipients, and stores it", async (t) => {
  const { g, id } = await written(t);
  const stored = JSON.parse(g.query("SELECT layout_snapshot FROM filings WHERE id = ?", [id])[0].layout_snapshot);
  assert.deepEqual(stored.layout.goal_criteria, DECLARING.goal_criteria);
});

test("with no To recipient the mockup prints the gap line, recorded on the Writing's filing_recipients; recipients reads unmet and open-items does not count it twice", async (t) => {
  const { g, id } = await written(t);
  const result = render(g, id);
  assert.match(letterOf(result), /^🧩 ________ <!-- no To recipient -->$/m);
  assert.deepEqual(gapEntries(result), [[false, "filing_recipients", id, GAP, "General_writing"]]);

  const board = boardOf(result);
  assert.deepEqual(board.criteria.map((c) => c.id), [...DECLARING.goal_criteria, "gate"]);
  assert.deepEqual(criterionOf(board, "recipients"), { id: "recipients", text: CARD, state: "unmet", outstanding: 1, items: [GAP], source: "inventory" });
  assert.deepEqual([criterionOf(board, "open-items").state, criterionOf(board, "open-items").items], ["met", []], "open-items leaves the gap to recipients");
  // No Pre-send gate job yet: the gate row reads the held criteria itself, recipients among them.
  assert.deepEqual([criterionOf(board, "gate").state, criterionOf(board, "gate").items], ["unmet", [CARD]]);
});

test("a cc-only Writing has no addressee: the gap prints above the cc line, and a To recipient clears the gap, recipients and the gate row", async (t) => {
  const { g, id } = await written(t);
  await g.recipient(id, 1, "cc");
  const ccOnly = render(g, id);
  assert.ok(letterOf(ccOnly).includes(`🧩 ________ <!-- ${GAP} -->\ncc: Cara Counsel — counsel for Bert Other (cara@counsel.test)`), letterOf(ccOnly));
  assert.equal(criterionOf(boardOf(ccOnly), "recipients").state, "unmet");

  await g.recipient(id, 4, "to");
  const addressed = render(g, id);
  assert.doesNotMatch(letterOf(addressed), /no To recipient/);
  assert.ok(letterOf(addressed).includes("To: Wanda Witness — a witness to the accident (wanda@witness.test)\ncc: Cara Counsel"), letterOf(addressed));
  assert.deepEqual(gapEntries(addressed), []);
  const board = boardOf(addressed);
  assert.deepEqual([criterionOf(board, "recipients").state, criterionOf(board, "recipients").items], ["met", []]);
  assert.equal(criterionOf(board, "gate").state, "met");
});

test("the filed face drops the gap lines whole: with no signer and no To recipient it shows no stray underline, the signing space still prints, and the filed render is not refused", async (t) => {
  const { g, id } = await written(t);
  await g.execute(`UPDATE filings SET signer_key = NULL WHERE id = ${id};`);
  const md = letterOf(render(g, id));
  assert.match(md, /^🧩 ________ <!-- no To recipient -->$/m);
  assert.match(md, /^_{32}\n🧩 ________ <!-- signer not chosen -->$/m);
  const filed = render(g, id, "filed");
  assert.deepEqual([filed.unwritten_gate_failed, filed.unwritten], [undefined, undefined]);
  assert.deepEqual(filed.documents.map((d) => d.document_type), ["General_writing"]);
  const face = filed.documents[0].markdown;
  assert.doesNotMatch(face, /To recipient|signer not chosen|🧩/);
  assert.deepEqual(face.split("\n").filter((line) => line.includes("_")), ["_".repeat(32)], "the signing space is the only underline");
  assertFiledFaceClean(face, "General_writing");
});

test("the Sent write holds a Writing with no To recipient, a cc-only one included, and records it as sent once one is added", async (t) => {
  const { g, id } = await written(t);
  render(g, id);
  const revision = g.revision();
  await assert.rejects(send(g, id), code("held", /recipients \(no To recipient\) unmet now/));
  assert.deepEqual(gateSteps(g, id), [{ text: `recipients — ${CARD}: unmet (1 open) [rev ${revision}]`, done_at: null }]);
  assert.equal(g.query("SELECT filed_on FROM filings WHERE id = ?", [id])[0].filed_on, null);

  await g.recipient(id, 1, "cc");
  render(g, id);
  await assert.rejects(send(g, id), code("held", /recipients \(no To recipient\)/));

  await g.recipient(id, 4, "to", 1);
  render(g, id);
  const result = await send(g, id);
  assert.deepEqual(result.pre_send_gate.waived, []);
  const [step] = gateSteps(g, id);
  assert.match(step.text, /^recipients — The Writing is addressed to a recipient: met \[rev \d+\]$/);
  assert.notEqual(step.done_at, null);
  assert.equal(g.query("SELECT filed_on FROM filings WHERE id = ?", [id])[0].filed_on, "2026-09-28");
});

test("send anyway waives recipients: recorded WAIVED on its step, and the Writing recorded as sent", async (t) => {
  const { g, id } = await written(t);
  render(g, id);
  const revision = g.revision();
  const result = await send(g, id, { send_anyway: WORDS });
  assert.deepEqual(result.pre_send_gate.waived, ["recipients"]);
  const [step] = gateSteps(g, id);
  assert.equal(step.text, `recipients — ${CARD}: unmet (1 open) [rev ${revision}] — WAIVED: ${WORDS}`);
  assert.notEqual(step.done_at, null);
  assert.equal(g.query("SELECT filed_on FROM filings WHERE id = ?", [id])[0].filed_on, "2026-09-28");
});

test("a Writing whose layout does not declare recipients prints no gap, carries no recipients row, and is not held for want of a To recipient", async (t) => {
  const { g, id } = await written(t, NOT_DECLARING);
  const result = render(g, id);
  assert.doesNotMatch(letterOf(result), /no To recipient/);
  assert.deepEqual(gapEntries(result), []);
  const board = boardOf(result);
  assert.equal(criterionOf(board, "recipients"), undefined);
  assert.equal(criterionOf(board, "gate").state, "met");
  const sent = await send(g, id);
  assert.equal(sent.pre_send_gate, null);
});

const deliverOf = (board) => board.tickets.find((t) => t.title === "Deliver");

// Spec 2026-10-08 (Deliver on internal Writings): Dispatch never chooses Deliver, whose sending is the
// practitioner's own act, and skips it while the Writing has no To recipient.
test("a Ready Deliver is the practitioner's own, and is skipped before recipients until a To recipient is added", async (t) => {
  const { g, id } = await written(t);
  assert.deepEqual(deliverOf(boardOf(render(g, id))).dispatch_skips, [{ reason: "practitioner_own" }, { reason: "before_recipients" }]);
  await g.recipient(id, 4, "to");
  assert.deepEqual(deliverOf(boardOf(render(g, id))).dispatch_skips, [{ reason: "practitioner_own" }]);
});

test("an unstructured-internal Writing has no gate row, and a Deliver an earlier save left on it is skipped as internal", async (t) => {
  const g = await generalWritingFixture(t, { front: null });
  const part = (source) => ({ heading: null, heading_numbering: "none", paragraph_numbering: "none", source });
  g.f.local("draft/CAN/FX/_NoVenue/Documents/kinds.local.json", {
    kinds: [{ file: "unstructured-internal", name: "Unstructured", recipient: "internal", aliases: [{ name: "unstructured_internal", source: "agent", ref: "L0000", recorded: "2026-09-20" }] }],
  });
  g.f.local(
    "draft/CAN/FX/_NoVenue/Documents/unstructured-internal.md",
    knowledgeFile(null, { renderer: "general", needs_forum_parts: false, title: "Unstructured", exhibit_numbering: "writing", goal_criteria: ["open-items", "counsel-review"], parts: [part("slot:body")] })
  );
  const { filing_id: id } = await g.create({ proceeding_id: 1, tree: NO_VENUE_TREE, kind: "unstructured_internal", recipient: "internal", title: "Discovery plan" });
  await g.execute(
    `INSERT INTO tickets (proceeding_id, filing_id, title, intent, kind, priority, billing_anchor, created)
       VALUES (1, ${id}, 'Deliver', 'Send this letter to its recipients and record it as sent.', 'work', 0, 'L0000|discovery plan', '2026-09-28T09:00');`
  );
  const board = boardOf(render(g, id));
  assert.deepEqual(board.criteria.map((c) => c.id), ["open-items", "counsel-review"]);
  assert.deepEqual(deliverOf(board).dispatch_skips, [{ reason: "practitioner_own" }, { reason: "internal" }]);
});
