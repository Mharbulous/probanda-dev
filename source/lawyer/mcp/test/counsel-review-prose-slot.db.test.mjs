// 🧐 final review of a Writing's own text (#1207; work-markers.md row 🧐, review.md "Snapshot
// fields"): each filing_prose row a stored-layout part prints is a prose slot, reviewed whole and
// marked once, on its last line. The letter is /draft's shipped letter to opposing counsel, on a
// proceeding with no forum and on one in the BC Supreme Court.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { assertFiledFaceClean } from "./helpers/filed-face-scan.mjs";
import { generalWritingFixture } from "./helpers/general-writing-fixture.mjs";
import { boardDataOf } from "./fixtures/forms-render-seeds.mjs";

const { submissionFormsRender } = await import("../build/submission/forms.js");
const { fetchReviewState } = await import("../build/submission/forms/render-vaniac-submissions.js");

const SHIPPED_LETTER = new URL("../../../../.claude/skills/draft/references/CAN/BC/_NoVenue/Documents/letter-to-opposing-counsel.md", import.meta.url);
const LETTER_BLOCK = JSON.parse(/^```json\n([\s\S]*?)\n```$/m.exec(readFileSync(SHIPPED_LETTER, "utf-8").replace(/\r\n/g, "\n"))[1]);

const CLIENT = { clientName: "Ada Client", clientNo: "0001", matterNo: "L0000" };
const NOW = "2026-09-27 10:00";
const SLOTS = [
  ["date", "28 September 2026"],
  ["addressee", "Cara Counsel\nCounsel Chambers\nVancouver, BC"],
  ["salutation", "Dear Ms. Counsel:"],
  ["re", "Re: Confirm Hearing Date"],
  ["body", "I write to confirm the hearing of the application on 14 October 2026.\n\nPlease confirm by 3 October 2026 that the date suits your client."],
];

// #1365: a render returns its board as board_summary; the board's data is this filing's section of
// the matter's Milestone page, read the way the page builds it, right after the render.
const render = (g, id, mode = "mockup") => {
  const result = submissionFormsRender(g.dbPath, id, CLIENT, mode, undefined, undefined, undefined, NOW);
  return mode === "mockup" ? { ...result, board: boardDataOf(g.dbPath, id, CLIENT, NOW) } : result;
};
const letterOf = (result) => result.documents.find((d) => d.document_type === "General_writing").markdown;
const reviewOf = (result) => result.board.criteria.find((c) => c.id === "counsel-review");
// Counted above the closing legend, which lists 🧐 once more.
const glyphCount = (md) => md.split("\n## Legend\n")[0].split("🧐").length - 1;

/** review.md's approval, written by the session holding review job `ticket` under its lock, with
 * counsel of record copied from case data. */
const approve = (g, ticket, proseId) =>
  g.execute(
    `INSERT INTO review_approvals (entity, entity_id, approved_at, session_token, practitioner, revision, snapshot)
       SELECT 'filing_prose', id, strftime('%Y-%m-%dT%H:%M', 'now', 'localtime'), 'sess-a1', 'Pat Example',
              (SELECT CAST(value AS INTEGER) FROM db_meta WHERE key = 'revision'),
              json_object('text', text)
         FROM filing_prose WHERE id = ${proseId}
           AND EXISTS (SELECT 1 FROM tickets WHERE id = ${ticket} AND locked_by = 'sess-a1');`
  );

for (const [proceeding, label] of [
  [1, "a proceeding with no forum"],
  [2, "a BC Supreme Court proceeding"],
]) {
  test(`a letter on ${label}: each written slot reads 🧐 once on its last line until approved, and an edit re-raises it`, async (t) => {
    const g = await generalWritingFixture(t, { front: null, block: LETTER_BLOCK });
    const { filing_id: id } = await g.createLetter({ proceeding_id: proceeding });
    await g.prose(id, "date", "  ");
    for (const [slot, text] of SLOTS.slice(1)) await g.prose(id, slot, text);

    // A blank slot prints its gap line as before, with no 🧐, and is not counted.
    const partial = render(g, id);
    assert.match(letterOf(partial), /^🧩 ________ <!-- date not written -->$/m);
    assert.deepEqual([reviewOf(partial).state, reviewOf(partial).outstanding], ["unmet", 4]);

    await g.execute(`UPDATE filing_prose SET text = '${SLOTS[0][1]}' WHERE filing_id = ${id} AND slot = 'date';`);
    const drafted = render(g, id);
    const md = letterOf(drafted);
    for (const line of [
      "28 September 2026 🧐",
      "Cara Counsel\nCounsel Chambers\nVancouver, BC 🧐",
      "Dear Ms. Counsel: 🧐",
      "Re: Confirm Hearing Date 🧐",
      "I write to confirm the hearing of the application on 14 October 2026.\n\nPlease confirm by 3 October 2026 that the date suits your client. 🧐",
    ]) {
      assert.ok(md.includes(line), md);
    }
    assert.equal(glyphCount(md), SLOTS.length, "one 🧐 per written slot, none on the signature block");
    assert.deepEqual(reviewOf(drafted), {
      id: "counsel-review",
      text: "Counsel has reviewed every paragraph",
      state: "unmet",
      outstanding: SLOTS.length,
      items: SLOTS.map(([slot]) => slot),
      source: "inventory",
    });

    const face = render(g, id, "filed").documents[0].markdown;
    assert.equal(glyphCount(face), 0, face);
    assert.ok(face.includes("Please confirm by 3 October 2026 that the date suits your client."), face);
    assertFiledFaceClean(face, "General_writing");

    await g.execute(
      `INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, kind, billing_anchor, locked_by, locked_at, created)
         VALUES (10, ${proceeding}, ${id}, 'Counsel''s review of Letter to Cara', 'Review the letter.', 'wip', 'work', 'L0000|hearing date', 'sess-a1', '2026-09-27T10:00', '2026-09-27T10:00');`
    );
    const rows = g.query("SELECT id, slot FROM filing_prose WHERE filing_id = ? ORDER BY id", [id]);
    for (const row of rows) await approve(g, 10, row.id);
    const approvals = g.query("SELECT entity, practitioner, snapshot FROM review_approvals ORDER BY id");
    assert.equal(approvals.length, SLOTS.length, "every approval landed under the lock");
    assert.ok(approvals.every((a) => a.entity === "filing_prose" && a.practitioner === "Pat Example"));
    assert.equal(approvals.find((a) => a.snapshot.includes("Dear")).snapshot, '{"text":"Dear Ms. Counsel:"}');

    const approved = render(g, id);
    assert.equal(glyphCount(letterOf(approved)), 0, letterOf(approved));
    assert.deepEqual([reviewOf(approved).state, reviewOf(approved).outstanding], ["met", 0]);

    await g.execute(`UPDATE filing_prose SET text = 'I write to confirm the hearing on 14 October 2026.' WHERE filing_id = ${id} AND slot = 'body';`);
    const edited = render(g, id);
    assert.ok(letterOf(edited).includes("I write to confirm the hearing on 14 October 2026. 🧐"), letterOf(edited));
    assert.equal(glyphCount(letterOf(edited)), 1);
    assert.deepEqual([reviewOf(edited).state, reviewOf(edited).outstanding, reviewOf(edited).items], ["unmet", 1, ["body"]]);
  });
}

test("fetchReviewState reads each proceeding's prose slots through their filing, beside its other reviewed kinds", async (t) => {
  const g = await generalWritingFixture(t, { front: null, block: LETTER_BLOCK });
  const { filing_id: first } = await g.createLetter({ proceeding_id: 1 });
  const { filing_id: second } = await g.createLetter({ proceeding_id: 2 });
  await g.prose(first, "body", "The first letter.");
  await g.prose(second, "body", "The second letter.");
  await g.execute("INSERT INTO submissions (id, proceeding_id, contention, ordinal) VALUES (5, 1, 'A contention.', 1);");
  const [firstRow] = g.query("SELECT id FROM filing_prose WHERE filing_id = ?", [first]);
  const [secondRow] = g.query("SELECT id FROM filing_prose WHERE filing_id = ?", [second]);

  const one = fetchReviewState(g.dbPath, 1);
  assert.equal(one.current.get(`filing_prose:${firstRow.id}`), '{"text":"The first letter."}');
  assert.equal(one.current.has(`filing_prose:${secondRow.id}`), false, "another proceeding's prose is not this proceeding's");
  assert.equal(one.current.get("submissions:5"), '{"contention":"A contention."}');
  assert.equal(fetchReviewState(g.dbPath, 2).current.get(`filing_prose:${secondRow.id}`), '{"text":"The second letter."}');
});
