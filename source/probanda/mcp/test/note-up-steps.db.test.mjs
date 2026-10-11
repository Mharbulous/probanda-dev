// A note-up of a statute, regulation or rule is done provision by provision: its Proposal's card
// prints one `step <n>:` line per provision the filing cites, a pinpoint its statements of law
// print 📇 on or a provision cited only in a contention's text, and intake (/drafting-data §3e)
// writes the job with those steps instead of one step restating its title. A case's card is
// unchanged. The VanIAC seed's authority 1 becomes the Supreme Court Civil Rules, cited at three
// pinpoints (statement 1's doctrinal line, statement 3 on order 1's basis line, and a new statement
// 7) and once in submission 2's text.

import assert from "node:assert/strict";
import test from "node:test";

import { seededDbFixture, seedVaniacProceeding, ASHBOURNE } from "./fixtures/forms-render-seeds.mjs";
const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute, submissionDataQuery } = await import("../build/submission/backend.js");
const { submissionFormsRender } = await import("../build/submission/forms.js");
const { submissionFormsBoardCard } = await import("../build/submission/matter-pages.js");

const TITLE = "Note up: Supreme Court Civil Rules, B.C. Reg. 168/2009";

const card = (dbPath, selection) => submissionFormsBoardCard({ db_path: dbPath, filing_id: 1, ...selection }, ASHBOURNE).card.split("\n");

/** The Proposal's own lines on the Proposed card: its line, its detail line and any step lines. */
function proposalBlock(lines, key) {
  const at = lines.findIndex((l) => l.startsWith(`  key: ${key} `));
  assert.ok(at > 0, `expected ${key} on the card:\n${lines.join("\n")}`);
  const block = [lines[at - 1], lines[at]];
  for (let i = at + 1; i < lines.length && /^ {2}(step \d+|steps):/.test(lines[i]); i++) block.push(lines[i]);
  return block;
}

test("a rule cited at three pinpoints and once in a contention's text: four steps, one per provision; a case unchanged", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);
    await submissionDataExecute(
      f.dbPath,
      `UPDATE authorities SET style_of_cause_or_title = 'Supreme Court Civil Rules', citation = 'B.C. Reg. 168/2009', kind = 'rule', treatment = NULL WHERE id = 1;
       UPDATE statements_of_law SET pinpoint = 'r. 9-6(3)' WHERE id = 1;
       UPDATE statements_of_law SET pinpoint = 'r. 9-6(5)' WHERE id = 3;
       UPDATE statements_of_law SET verification = 'verified' WHERE id IN (1, 3, 4);
       INSERT INTO law_assertions (id, proceeding_id, proposition, dead_end) VALUES (5, 1, 'a third point of rule', 0);
       INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, source, verification)
         VALUES (7, 1, 5, 1, 'r. 3-4(7.1)', 'The subrule as it reads.', 'primary', 'verified');
       INSERT INTO submission_law (submission_id, law_assertion_id) VALUES (1, 5);
       UPDATE submissions SET contention = 'The respondent should also have its costs under Rule 14-1(12).' WHERE id = 2;`
    );
    submissionFormsRender(f.dbPath, 1, ASHBOURNE);
    const proposed = card(f.dbPath, { lanes: ["proposed"] });

    const rules = proposalBlock(proposed, "note-up:authorities:1");
    assert.equal(rules[0], `- 📇 ${TITLE}`);
    const steps = rules.slice(2).map((l) => l.replace(/^ {2}step \d+: /, ""));
    assert.deepEqual(
      rules.slice(2).map((l) => l.match(/^ {2}step (\d+):/)?.[1]),
      ["1", "2", "3", "4"],
      rules.join("\n")
    );
    assert.deepEqual(
      [...steps].sort(),
      [`${TITLE}, Rule 14-1(12)`, `${TITLE}, r. 3-4(7.1)`, `${TITLE}, r. 9-6(3)`, `${TITLE}, r. 9-6(5)`].sort()
    );
    assert.ok(!steps.includes(TITLE), "no step restates the title");

    // Authority 2 is a case (statement 4, now verified): its card is the two lines it always was.
    const caseLines = proposalBlock(proposed, "note-up:authorities:2");
    assert.deepEqual(caseLines, ["- 📇 Note up: Reserved Authority v. X, 2020 BCSC 1", "  key: note-up:authorities:2 · item: Reserved Authority v. X, 2020 BCSC 1 · lane: proposed"]);

    // Intake (/drafting-data §3e) writes the job, then one step per `step <n>:` line, in order.
    await submissionDataExecute(
      f.dbPath,
      `INSERT INTO tickets (proceeding_id, filing_id, title, intent, kind, priority, billing_anchor, created)
         VALUES (1, NULL, '${TITLE}', '${TITLE}', 'work', 0, 'L4801|Opening Submissions Package', strftime('%Y-%m-%dT%H:%M', 'now', 'localtime'));
       DELETE FROM tickets WHERE id = last_insert_rowid()
         AND EXISTS (SELECT 1 FROM ticket_proposals WHERE proposal_key = 'note-up:authorities:1');`
    );
    const recovered = submissionDataQuery(
      f.dbPath,
      `SELECT id FROM tickets t WHERE proceeding_id = 1 AND title = '${TITLE}' AND status = 'queued'
         AND NOT EXISTS (SELECT 1 FROM ticket_proposals p WHERE p.ticket_id = t.id);`
    ).rows;
    assert.equal(recovered.length, 1);
    const id = recovered[0].id;
    await submissionDataExecute(
      f.dbPath,
      [
        ...steps.map((text, i) => `INSERT INTO ticket_steps (ticket_id, ordinal, text) VALUES (${id}, ${i + 1}, '${text}');`),
        `INSERT INTO ticket_scope (ticket_id, entity, entity_id) VALUES (${id}, 'authorities', 1);`,
        `INSERT INTO ticket_proposals (ticket_id, proposal_key, item) VALUES (${id}, 'note-up:authorities:1', 'Supreme Court Civil Rules, B.C. Reg. 168/2009');`,
      ].join("\n")
    );
    const job = card(f.dbPath, { jobs: [id] });
    const stepsLine = job.find((l) => l.startsWith("  steps: "));
    assert.equal(stepsLine, `  steps: ${steps.map((s, i) => `${i + 1} ☐ ${s}`).join(" · ")}`);
  } finally {
    f.cleanup();
  }
});

test("a rule with no pinpoint derives no note-up Proposal, so intake writes no job restating its title", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);
    // Authority 3 backs statement 2, verified, with its pinpoint cleared: 📍 is owed, so nothing has
    // cleared 📜 📍 🔬 and 📇 proposes nothing. Since v61 a statement cannot move into 'verified'
    // with no pinpoint, so the row is built as one verified before v61 stands: verified first, its
    // snapshot holding no pinpoint, then the pinpoint cleared, which leaves it off no snapshot.
    await submissionDataExecute(
      f.dbPath,
      `UPDATE authorities SET style_of_cause_or_title = 'Supreme Court Civil Rules', citation = 'B.C. Reg. 168/2009', kind = 'rule', treatment = NULL WHERE id = 3;
       UPDATE statements_of_law SET verification = 'verified', scrutinized_authority_id = authority_id, scrutinized_pinpoint = NULL, scrutinized_excerpt = excerpt WHERE id = 2;
       UPDATE statements_of_law SET pinpoint = NULL WHERE id = 2;
       UPDATE submissions SET contention = 'Costs under Rule 14-1(12).' WHERE id = 2;`
    );
    submissionFormsRender(f.dbPath, 1, ASHBOURNE);
    const proposed = card(f.dbPath, { lanes: ["proposed"] });
    assert.ok(!proposed.some((l) => l.includes("note-up:authorities:3")), proposed.join("\n"));
  } finally {
    f.cleanup();
  }
});
