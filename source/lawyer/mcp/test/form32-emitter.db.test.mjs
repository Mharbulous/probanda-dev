// Tests for the Form 32 filed-face emitter (issue #392). The golden case
// reuses the exact seed SQL already proven by forms-render-bcsc.db.test.mjs's own
// "renders BCSC Form 32 notice of application" test, so both tests exercise
// identical underlying data. validate32 (publish-bcsc-form's own strict
// parser, invoked as a subprocess) is the dev-time acceptance oracle the
// ticket's constraints require -- it, not this test's own assertions, is
// the final word on grammar compliance.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { assertMatchesGolden, DEFAULT_JUDGMENT_CASE_DATA } from "./fixtures/forms-render-seeds.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const { bcscFormHarnessPath } = await import("../build/submission/bcsc-form-harness.js");
// The runtime's own lookup, given an install root with no skill source, so it serves the
// checkout's .claude/skills copy: plugins/litigation/skills/ is untracked since #1266.
const HARNESS_PATH = bcscFormHarnessPath(process.env, join(HERE, "no-install"));
const PY_CANDIDATES = [process.env.COCLERK_PYTHON, "python", "python3"].filter(Boolean);

const { freshSubmissionDb, submissionDbAt } = await import("./helpers/template-db.mjs");
const { writePartiesOfRecord } = await import("./helpers/matter-data-fixture.mjs");
const { submissionDataExecute } = await import("../build/submission/backend.js");
const { submissionFormsEmitForm32, submissionFormsRender } = await import("../build/submission/forms.js");
const { ALL_MARKER_GLYPHS } = await import("../build/submission/forms/markers.js");

/** A matter folder in a scratch dir: the database in its own `0. CASE DATA`, beside the `0. DRAFT` its
 * Writings' mockups are written in (spec 2026-10-22). */
function seededDbFixture() {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-form32-emitter-"));
  const matter = join(dir, "Matter");
  mkdirSync(join(matter, "0. CASE DATA"), { recursive: true });
  mkdirSync(join(matter, "0. DRAFT"));
  const dbPath = join(matter, "0. CASE DATA", "submission.sqlite");
  return { dir, dbPath, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// Same proceeding/party shape fixtures/forms-render-seeds.mjs's seedBcscDefaultJudgment
// uses, then remodelled into a notice_of_application filing with the exact
// hearing_details/facts/submissions/order_sought data proven at
// forms-render-bcsc.db.test.mjs ("renders BCSC Form 32 notice of
// application"): 3 Part 2 facts, 1 submission (contention + one law
// excerpt), 2 live orders with one crossed-out order interleaved at
// ordinal 2, one filing_document -- plus Part 2 citation rows of its own.
async function seedNoticeOfApplication(dbPath) {
  writePartiesOfRecord(dirname(dbPath), DEFAULT_JUDGMENT_CASE_DATA);
  await submissionDataExecute(
    dbPath,
    `
    INSERT INTO proceedings (id, matter_reference, forum, court_or_centre, registry, file_number, style_of_cause, courthouse_address)
      VALUES (1, 'L9002 - Halloway', 'CAN/BC/BCSC', 'BC Supreme Court', 'Vancouver', 'S-901433', 'Halloway v. Vasey', '800 Smithe Street');

    INSERT INTO parties (id, proceeding_id, name, role, ordinal, is_client, is_applicant, to_be_served, case_party_id)
      VALUES
        (1, 1, 'Wren Halloway', 'Plaintiff', 1, 1, 1, 0, 1),
        (2, 1, 'Corbin Vasey', 'Defendant', 2, 0, 0, 1, 2);

    INSERT INTO order_sought (id, proceeding_id, wording)
      VALUES (1, 1, 'damages to be assessed'), (2, 1, 'costs to be assessed');

    INSERT INTO documents (id, proceeding_id, label, document_date, description, file_path)
      VALUES (1, 1, 'Draft default judgment', '2026-08-01', NULL, NULL);

    INSERT INTO filings (id, proceeding_id, kind, subkind, round, title)
      VALUES (1, 1, 'notice_of_application', NULL, NULL, 'Notice of Application');

    INSERT INTO filing_orders (filing_id, order_sought_id, document, ordinal) VALUES (1, 1, 'form', 1), (1, 2, 'form', 3);
    INSERT INTO filing_documents (filing_id, document_id, ordinal, role) VALUES (1, 1, 1, 'order');

    INSERT INTO hearing_details (filing_id, hearing_date, hearing_time, time_estimate_minutes, associate_judge)
      VALUES (1, '2026-09-01', '9:45 am', 45, 1);

    INSERT INTO facts (id, proceeding_id, postulate)
      VALUES
        (1, 1, 'Corbin Vasey has not filed a response to civil claim.'),
        (2, 1, 'The property was inspected and found vacant on the relevant date.'),
        (3, 1, 'The final walkthrough occurred before handover.');
    INSERT INTO filing_facts (filing_id, fact_id, document, part, ordinal) VALUES (1, 1, 'form', 'part2', 1), (1, 2, 'form', 'part2', 2), (1, 3, 'form', 'part2', 3);
    -- Fact 1's Written Argument pointer, carrying this kind's own part value
    -- exactly as checklists section 9 requires of a both-documents pair. It is
    -- an accounting pointer only and must never reach the filed face.
    INSERT INTO filing_facts (filing_id, fact_id, document, part, ordinal) VALUES (1, 1, 'written_argument', 'part2', 1);
    -- Part 2 citation lines: fact 2 cites its affidavit statement (its impeachment statement
    -- never prints), fact 3 its court-record pinpoint.
    INSERT INTO documents (id, proceeding_id, label, document_date, description, file_path)
      VALUES (2, 1, 'Affidavit #1 of P. Inspector', '2026-08-05', NULL, NULL), (3, 1, 'Order of Associate Judge Lin', '2026-07-02', NULL, NULL);
    INSERT INTO witnesses (id, proceeding_id, name) VALUES (1, 1, 'P. Inspector');
    INSERT INTO statements_of_fact (id, proceeding_id, fact_id, witness_id, instrument, pinpoint, purpose, excerpt)
      VALUES
        (1, 1, 2, 1, 2, 'para 4', NULL, 'The property was empty when I inspected it.'),
        (2, 1, 2, 1, 2, 'para 9', 'impeachment', NULL);
    UPDATE facts SET court_record = 3, court_record_pinpoint = 'Order of Associate Judge Lin, 2 July 2026, para 1' WHERE id = 3;

    INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind, weight, treatment)
      VALUES (1, 1, 'Miazga v. Kvello Estate', '2009 SCC 51', 'case', 'binding', 'good_law');
    INSERT INTO submissions (id, proceeding_id, contention, ordinal)
      VALUES (1, 1, 'Corbin Vasey is in default under the Rules.', 1);
    INSERT INTO law_assertions (id, proceeding_id, proposition, dead_end)
      VALUES (1, 1, 'a defendant who fails to file a response to civil claim within the prescribed time is in default', 0);
    INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, verification)
      VALUES (1, 1, 1, 1, 'para 15', 'default judgment may be entered once the response period has expired without a filed response', 'verified');
    INSERT INTO submission_law (submission_id, law_assertion_id) VALUES (1, 1);
    INSERT INTO submission_facts (submission_id, fact_id) VALUES (1, 1);
    INSERT INTO filing_submissions (filing_id, submission_id, document, ordinal) VALUES (1, 1, 'form', 1);

    -- Crossed-out order interleaved at ordinal 2, between the two live orders
    -- (proves it's excluded and the live ones renumber contiguously, not
    -- just happen to already be contiguous).
    INSERT INTO order_sought (id, proceeding_id, wording, crossed_out_on)
      VALUES (4, 1, 'leave to file a further affidavit at the hearing', '2026-08-20');
    INSERT INTO filing_orders (filing_id, order_sought_id, document, ordinal) VALUES (1, 4, 'form', 2);

    -- Revision reset LAST: schema v21 triggers move db_meta.revision on every seeded row (#607).
    UPDATE db_meta SET value = '1' WHERE key = 'revision';
    `.trim()
  );
}

function runValidate32(path) {
  let lastErr = "";
  for (const py of PY_CANDIDATES) {
    // -B: write no __pycache__ into the checkout's .claude/skills tree.
    const res = spawnSync(py, ["-B", HARNESS_PATH, "validate32", path], { encoding: "utf-8" });
    if (res.error) {
      lastErr = String(res.error);
      continue;
    }
    return { status: res.status, stdout: res.stdout, stderr: res.stderr };
  }
  throw new Error(`No Python interpreter found (tried ${PY_CANDIDATES.join(", ")}). Last error: ${lastErr}`);
}

function writeTemp(dir, markdown) {
  const path = join(dir, "form-32.md");
  writeFileSync(path, markdown, "utf-8");
  return path;
}

test("emits a form-32.md that validate32 accepts, matching the reviewed data", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedNoticeOfApplication(f.dbPath);

    const result = submissionFormsEmitForm32(f.dbPath, 1);
    assert.equal(result.file_name, "form-32.md");
    // ADR 0038: Form 32's currency rides beside the markdown, which the golden below shows carries none of it.
    assert.equal(result.form_currency.form_key, "form-32");
    const md = result.markdown;

    // Frontmatter: the 6 required keys present, pure_law_confirmed absent. No proposed_hearing is
    // recorded, so the key carries the template's own leave-blank token for counsel to fill in Word.
    assert.match(md, /^proposed_hearing: \[proposed hearing\]$/m);
    assert.match(md, /^hearing_place: 800 Smithe Street$/m);
    assert.match(md, /^registry: Vancouver$/m);
    assert.match(md, /^time_estimate: 45 minutes$/m);
    assert.match(md, /^associate_judge: yes$/m);
    const ordersLine = md.match(/^orders: (.+)$/m)[1];
    assert.deepEqual(JSON.parse(ordersLine), [
      { order: 1, text: "damages to be assessed" },
      { order: 2, text: "costs to be assessed" },
    ]);
    // The "To:" line: every party of record but the applicant.
    assert.deepEqual(JSON.parse(md.match(/^to_parties: (.+)$/m)[1]), ["Corbin Vasey"]);
    assert.doesNotMatch(md, /pure_law_confirmed/);

    // Body structure.
    assert.doesNotMatch(md, /## Part 1/);
    assert.match(md, /## Part 2/);
    assert.match(md, /## Part 3/);
    assert.match(md, /## Part 4/);
    assert.ok(md.indexOf("## Part 2") < md.indexOf("## Part 3"));
    assert.ok(md.indexOf("## Part 3") < md.indexOf("## Part 4"));

    // Continuous numbering: 3 Part 2 facts, then submission 1's required proposition, 1..4. Its
    // rested-on fact 1 is already Part 2's paragraph 1, so Part 3 does not print it again, and never
    // prints the submission's contention (ticket 2026-08-31).
    assert.match(md, /^1\. Corbin Vasey has not filed a response to civil claim\.$/m);
    assert.match(md, /^2\. The property was inspected and found vacant on the relevant date\.$/m);
    assert.match(md, /^3\. The final walkthrough occurred before handover\.$/m);
    assert.match(md, /^4\. a defendant who fails to file a response to civil claim within the prescribed time is in default$/m);
    assert.equal((md.match(/Corbin Vasey has not filed a response to civil claim/g) ?? []).length, 1, "expected the linked Part 2 fact to print once");
    assert.doesNotMatch(md, /Corbin Vasey is in default under the Rules/, "expected the submission's contention sentence never to print");

    // The seeded document='written_argument' pointer row is an accounting
    // pointer (checklists section 9): Part 2 lists the three form facts only.
    const part2Body = md.split("## Part 2")[1].split("## Part 3")[0];
    assert.equal(
      (part2Body.match(/^\d+\. /gm) ?? []).length,
      3,
      "expected the written_argument pointer row not to add a fourth Part 2 paragraph to the filed face"
    );

    // Part 2 citation lines, each a ">> " line: one per non-impeachment statement, citation only
    // (no excerpt), and one evidence reference for a court record, which names its document once
    // even where the stored pinpoint already begins with the document's label.
    assert.equal(
      part2Body.trim(),
      [
        "1. Corbin Vasey has not filed a response to civil claim.",
        "2. The property was inspected and found vacant on the relevant date.",
        ">> Affidavit #1 of P. Inspector, para 4",
        "3. The final walkthrough occurred before handover.",
        ">> Order of Associate Judge Lin, 2 July 2026, para 1",
      ].join("\n")
    );
    // The statement citation line is the mockup's own, less indent and trace, under the ">> "
    // marker. The court-record line names its document (spec 2026-10-09, §4.3), so it is not the
    // mockup's parenthesized pinpoint.
    const mockup = submissionFormsRender(f.dbPath, 1, {}, "mockup").documents.find((d) => d.document_type === "Notice_of_application").markdown;
    const mockupCitations = mockup
      .split("## PART 2: FACTUAL BASIS")[1]
      .split("## PART 3")[0]
      .split("\n")
      .filter((l) => l.startsWith("   > "))
      .map((l) => l.slice(3).replace(/ <!-- fact \d+ -->$/, ""));
    const filedCitations = part2Body.split("\n").filter((l) => l.startsWith(">> "));
    assert.equal(filedCitations.length, mockupCitations.length, "expected one filed Part 2 citation line per mockup citation line");
    assert.equal(filedCitations[0], mockupCitations[0].replace(/^> /, ">> "), "expected the filed statement citation line to be the mockup's");

    // Verbatim law excerpt as a "> " blockquote, its citation as a ">> " line after it.
    assert.match(md, /^> default judgment may be entered once the response period has expired without a filed response$/m);
    assert.match(md, /^>> \*Miazga v\. Kvello Estate\*, 2009 SCC 51, para 15$/m);

    // Part 4 materials: a document's date as Form 32 prints it (", dated <Month D, YYYY>"), then the
    // pleadings line alone. The catch-all "Such further affidavits ..." line identifies no document,
    // so it is not printed.
    assert.match(md, /^- Draft default judgment, dated August 1, 2026$/m);
    assert.ok(md.endsWith("\n- Pleadings filed in this proceeding\n"), "expected Part 4 to close with the pleadings line");
    assert.doesNotMatch(md, /Such further affidavits/);

    // Never any marker, bold, comment, strikethrough, or fence.
    assert.doesNotMatch(md, /\*\*/);
    assert.doesNotMatch(md, /<!--/);
    assert.doesNotMatch(md, /~~/);
    assert.doesNotMatch(md, /```/);
    for (const glyph of ALL_MARKER_GLYPHS) {
      assert.doesNotMatch(md, new RegExp(glyph), `expected no marker glyph ${glyph} in the filed face`);
    }

    // Acceptance oracle: publish-bcsc-form's own strict parser must accept it.
    const tmpPath = writeTemp(f.dir, md);
    const { status, stderr } = runValidate32(tmpPath);
    assert.equal(status, 0, `expected validate32 to accept the emitted file; stderr: ${stderr}`);

    // #816: the whole emitted face, byte for byte. Every assertion above is a
    // `match` -- it asks whether a line is present, never whether anything else
    // is. validate32 guards line SHAPE, not content: a prose annotation written
    // as a legal Part 4 list item ("- Service of this notice has not yet been
    // effected.") passes it and every assertion here. Only this golden catches
    // that class on this face.
    assertMatchesGolden("form-32-emitted", md);
  } finally {
    f.cleanup();
  }
});

test("validate32 rejects a mutated (non-contiguous) paragraph numbering -- oracle sanity check", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedNoticeOfApplication(f.dbPath);
    const { markdown } = submissionFormsEmitForm32(f.dbPath, 1);
    const mutated = markdown.replace(/^2\. The property/m, "5. The property");
    const tmpPath = writeTemp(f.dir, mutated);
    const { status } = runValidate32(tmpPath);
    assert.notEqual(status, 0, "expected validate32 to reject non-contiguous paragraph numbering");
  } finally {
    f.cleanup();
  }
});

// Empties Part 2. Fact 1 is detached from submission 1 first: a fact attached to a deployed
// submission stays in Part 2 (schema v59), and an attached fact missing from it refuses the emit.
const EMPTY_PART_2 = `DELETE FROM submission_facts WHERE submission_id = 1; DELETE FROM filing_facts WHERE filing_id = 1;`;

test("throws on an empty Part 2 rather than emitting a file validate32 can only reject", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedNoticeOfApplication(f.dbPath);
    await submissionDataExecute(f.dbPath, EMPTY_PART_2);
    assert.throws(() => submissionFormsEmitForm32(f.dbPath, 1), /Part 2.*no pure-law decision/s);
  } finally {
    f.cleanup();
  }
});

// Schema v49: counsel's recorded pure-law decision (filings.pure_law_on and pure_law_note) is the
// only thing that lets an empty Part 2 through, as `Nil.` under `pure_law_confirmed: true`.
const RECORD_PURE_LAW = `UPDATE filings SET pure_law_on = '2026-10-04', pure_law_note = 'The application turns on the Rules alone.' WHERE id = 1;`;

test("emits an empty Part 2 as Nil. under pure_law_confirmed: true while counsel's pure-law decision is recorded", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedNoticeOfApplication(f.dbPath);
    // Delete first: a delete resets nothing, but an insert of a form fact would clear the decision.
    await submissionDataExecute(f.dbPath, EMPTY_PART_2);
    await submissionDataExecute(f.dbPath, RECORD_PURE_LAW);
    const { markdown } = submissionFormsEmitForm32(f.dbPath, 1);
    assert.match(markdown, /^pure_law_confirmed: true$/m);
    assert.match(markdown, /## Part 2\n\nNil\.\n/);
    assert.match(markdown, /## Part 3\n\n1\. /, "expected Part 3 to number from 1 after an empty Part 2");
    const { status, stderr } = runValidate32(writeTemp(f.dir, markdown));
    assert.equal(status, 0, `expected validate32 to accept the pure-law form-32.md; stderr: ${stderr}`);
  } finally {
    f.cleanup();
  }
});

test("throws when Part 2 facts and counsel's pure-law decision are both on record", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedNoticeOfApplication(f.dbPath);
    await submissionDataExecute(f.dbPath, RECORD_PURE_LAW);
    assert.throws(() => submissionFormsEmitForm32(f.dbPath, 1), /also on record/);
  } finally {
    f.cleanup();
  }
});

test("a database held below v49 still refuses an empty Part 2 rather than crashing on the missing column", async () => {
  const f = seededDbFixture();
  try {
    submissionDbAt(f.dbPath, 48);
    await seedNoticeOfApplication(f.dbPath);
    await submissionDataExecute(f.dbPath, EMPTY_PART_2);
    assert.throws(() => submissionFormsEmitForm32(f.dbPath, 1), /no pure-law decision/);
  } finally {
    f.cleanup();
  }
});

// Ticket 2026-08-31, decision 5: the same "less is more" filing gate as submissionFormsRender's
// renderMode:'filed' (forms-render-*.db.test.mjs / filed-face.db.test.mjs), enforced here as a throw
// (this emitter writes nothing to disk on any refusal, matching its other guards above).
test("throws when a deployed statement of law has no authorities.citation, instead of emitting a file with the placeholder in it", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedNoticeOfApplication(f.dbPath);
    await submissionDataExecute(f.dbPath, `UPDATE authorities SET citation = NULL WHERE id = 1;`);
    assert.throws(() => submissionFormsEmitForm32(f.dbPath, 1), /statement\(s\) of law.*cite an authority with no citation/s);
  } finally {
    f.cleanup();
  }
});

// #451: assembly's fill step defaults a missing associate_judge to "within the jurisdiction", so
// an undetermined value (NULL, or no hearing_details row) must stop here, never reach form-32.md.
test("throws while associate-judge jurisdiction is undetermined, and emits no for a matter outside it", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedNoticeOfApplication(f.dbPath);

    await submissionDataExecute(f.dbPath, `UPDATE hearing_details SET associate_judge = 0 WHERE filing_id = 1;`);
    const { markdown } = submissionFormsEmitForm32(f.dbPath, 1);
    assert.match(markdown, /^associate_judge: no$/m);
    const { status, stderr } = runValidate32(writeTemp(f.dir, markdown));
    assert.equal(status, 0, `expected validate32 to accept associate_judge: no; stderr: ${stderr}`);

    await submissionDataExecute(f.dbPath, `UPDATE hearing_details SET associate_judge = NULL WHERE filing_id = 1;`);
    assert.throws(() => submissionFormsEmitForm32(f.dbPath, 1), /associate judge is not yet settled/s);

    await submissionDataExecute(f.dbPath, `DELETE FROM hearing_details WHERE filing_id = 1;`);
    assert.throws(() => submissionFormsEmitForm32(f.dbPath, 1), /associate judge is not yet settled/s);
  } finally {
    f.cleanup();
  }
});

test("refuses a filing that isn't a notice_of_application", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    writePartiesOfRecord(dirname(f.dbPath), DEFAULT_JUDGMENT_CASE_DATA);
    await submissionDataExecute(
      f.dbPath,
      `
      INSERT INTO proceedings (id, matter_reference, forum, court_or_centre, registry, file_number, style_of_cause, courthouse_address)
        VALUES (1, 'L9002 - Halloway', 'CAN/BC/BCSC', 'BC Supreme Court', 'Vancouver', 'S-901433', 'Halloway v. Vasey', '800 Smithe Street');
      INSERT INTO order_sought (id, proceeding_id, wording) VALUES (1, 1, 'damages to be assessed');
      INSERT INTO filings (id, proceeding_id, kind, subkind, round, title)
        VALUES (1, 1, 'requisition_default_judgment', 'default_judgment', NULL, 'Default Judgment Requisition');
      INSERT INTO filing_orders (filing_id, order_sought_id, document, ordinal) VALUES (1, 1, 'form', 1);

      -- Revision reset LAST: schema v21 triggers move db_meta.revision on every seeded row (#607).
      UPDATE db_meta SET value = '1' WHERE key = 'revision';
      `.trim()
    );
    assert.throws(() => submissionFormsEmitForm32(f.dbPath, 1), /is not a Notice of Application/);
  } finally {
    f.cleanup();
  }
});

// #842: an overruled authority's statements ride the brief-only cap -- never
// a venue mockup and never a filed face. Before #842 this emitter printed the excerpt and the
// citation of a case the record says is not good law, indistinguishable from a sound one, because
// the filed face carries no marker to say otherwise. Authority 2 is overruled but NOT killed:
// killed_on stays NULL, so only the treatment clause can drop it.
//
// It hangs off law assertion 1, which keeps its live Miazga statement -- the third assertion below
// is the guard against a filter that drops the whole proposition instead of the one statement.
test("#842: an overruled authority's statement is withheld from the Form 32 filed face, and its live neighbour still prints", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedNoticeOfApplication(f.dbPath);
    await submissionDataExecute(
      f.dbPath,
      `
      INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind, weight, treatment)
        VALUES (2, 1, 'Ashford v. Pell Holdings Ltd.', '1998 BCCA 404', 'case', 'binding', 'overruled');
      INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, source, verification)
        VALUES (2, 1, 1, 2, 'para 22', 'the response period runs from personal service alone', 'primary', 'verified');
      `.trim()
    );

    const { markdown: md } = submissionFormsEmitForm32(f.dbPath, 1);

    assert.doesNotMatch(md, /the response period runs from personal service alone/, "expected the overruled authority's excerpt off the filed face");
    assert.doesNotMatch(md, /Ashford v\. Pell Holdings Ltd\./, "expected the overruled authority's style of cause withheld too, not just the quotation");
    assert.doesNotMatch(md, /1998 BCCA 404/, "expected its citation withheld -- naming it cites a case the document never quotes");

    assert.match(md, /^> default judgment may be entered once the response period has expired without a filed response$/m, "expected the live statement of the same proposition to still print");
    assert.match(md, /^>> \*Miazga v\. Kvello Estate\*, 2009 SCC 51, para 15$/m, "expected the live statement's citation to still print");
    assert.match(md, /^4\. a defendant who fails to file a response to civil claim within the prescribed time is in default$/m, "expected the proposition itself to survive -- the statement is dropped, not the paragraph");
  } finally {
    f.cleanup();
  }
});

// #842, the gate half. The CITATION_MISSING filing gate counted statements the filed face no
// longer prints, so an overruled authority with no citation refused the whole emit over a
// placeholder that could never have appeared.
test("#842: an overruled authority with no citation no longer refuses the Form 32 emit", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedNoticeOfApplication(f.dbPath);
    await submissionDataExecute(
      f.dbPath,
      `
      INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind, weight, treatment)
        VALUES (3, 1, 'Wrenfield v. Bowen', NULL, 'case', 'binding', 'overruled');
      INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, source, verification)
        VALUES (3, 1, 1, 3, 'para 4', 'an uncited excerpt from an overruled authority', 'primary', 'verified');
      `.trim()
    );

    let md;
    assert.doesNotThrow(() => {
      md = submissionFormsEmitForm32(f.dbPath, 1).markdown;
    }, "expected the citation gate to ignore a statement the filed face never prints");
    assert.doesNotMatch(md, /an uncited excerpt from an overruled authority/, "expected the statement itself still withheld");
    assert.doesNotMatch(md, /Wrenfield v\. Bowen/, "expected the uncited overruled authority unnamed");
  } finally {
    f.cleanup();
  }
});
