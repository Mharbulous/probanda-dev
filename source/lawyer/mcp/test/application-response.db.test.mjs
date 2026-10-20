// Tests for the BCSC Application Response (Form 33) build (issue #386): the
// mockup renderer (render-application-response.ts) and the filed-face
// emitter (render-form33-filed-face.ts / submissionFormsEmitForm33), mirroring
// form32-emitter.db.test.mjs's (#392) seed/oracle pattern for the emitter half.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { assertMatchesGolden, replaceStamp, seedApplicationResponse } from "./fixtures/forms-render-seeds.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const { bcscFormHarnessPath } = await import("../build/submission/bcsc-form-harness.js");
// The runtime's own lookup, given an install root with no skill source, so it serves the
// checkout's .claude/skills copy: plugins/litigation/skills/ is untracked since #1266.
const HARNESS_PATH = bcscFormHarnessPath(process.env, join(HERE, "no-install"));
const PY_CANDIDATES = [process.env.COCLERK_PYTHON, "python", "python3"].filter(Boolean);

const { freshSubmissionDb, submissionDbAt } = await import("./helpers/template-db.mjs");
const { assertFiledFaceDocumentsClean } = await import("./helpers/filed-face-scan.mjs");
const { submissionDataExecute } = await import("../build/submission/backend.js");
const { submissionFormsRender, submissionFormsEmitForm33 } = await import("../build/submission/forms.js");
const { ALL_MARKER_GLYPHS } = await import("../build/submission/forms/markers.js");

function seededDbFixture() {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-application-response-"));
  const dbPath = join(dir, "submission.sqlite");
  return { dir, dbPath, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("renders the Application Response mockup with positions grouped by Part and continuous Part 4-5 numbering", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedApplicationResponse(f.dbPath);

    const result = submissionFormsRender(f.dbPath, 1, {}, "mockup");
    const doc = result.documents.find((d) => d.document_type === "Application_response");
    assert.ok(doc, "expected an Application_response document");
    const md = doc.markdown;

    assert.match(md, /## PART 1: ORDER\(S\) CONSENTED TO/);
    assert.match(md, /Order 1:.*within 14 days/);
    assert.match(md, /## PART 2: ORDER\(S\) OPPOSED/);
    assert.match(md, /paragraphs 2 of Part 1/);
    assert.match(md, /## PART 3: ORDER\(S\) ON WHICH NO POSITION IS TAKEN/);
    assert.match(md, /paragraphs 3 of Part 1/);
    assert.doesNotMatch(md, /Positions not yet taken/);

    // Continuous Part 4->5 numbering: 3 Part-4 facts, the third placed there by the database when
    // the seed attached it to the deployed submission (schema v59), then submission 1's contention
    // paragraph naming it -- 1..4, not restarted at Part 5.
    assert.match(md, /^1\. The correspondence sought was already produced on 2026-07-15\.[^\n]*<!-- fact 1 -->$/m);
    assert.match(md, /^2\. The defendant has sufficient assets within the jurisdiction\.[^\n]*<!-- fact 2 -->$/m);
    assert.match(md, /^3\. The defendant has never previously failed to satisfy a costs award\.[^\n]*<!-- fact 3 -->$/m);
    assert.match(md, /^4\. Security for costs is unwarranted given the defendant's assets in this jurisdiction\.[^\n]* <!-- submission_id 1 --> <!-- supporting fact paragraphs: 3 -->$/m);

    // Part 6 restarts at 1, provenance rendered.
    assert.match(md, /^1\. Affidavit of Reece Ferris \(2026-08-10\) \(served with this application response\)/m);
    // The standard closing lines number on from the documents, unmarked and untraced.
    assert.match(md, /^2\. Pleadings filed in this proceeding$/m);
    assert.match(md, /^3\. Such further affidavits or filed court documents as this honourable court may allow$/m);

    // AFS: party 2 (client, 'yes') is the filer line's checkbox subject.
    assert.match(md, /\[x\] Yes {2}\[ \] No/);

    // #805: nothing pinned this kind's delivered face. A mockup annotation written as plain prose
    // carries none of the mechanisms toFiledFace strips, so only a golden catches it reaching the
    // forum. (Distinct from the assembly-mode emitter below -- this is submissionFormsRender's
    // own filed face for the same filing.)
    const filed = submissionFormsRender(f.dbPath, 1, {}, "filed");
    assertFiledFaceDocumentsClean(filed.documents);
    const filedResponse = filed.documents.find((d) => d.document_type === "Application_response");
    assert.ok(filedResponse, "expected an Application_response document in filed mode");
    assertMatchesGolden("application-response-filed", replaceStamp(filedResponse.markdown));
  } finally {
    f.cleanup();
  }
});

// A submission's linked fact that is also a Part 4 paragraph is not re-printed under it in Part 5:
// the contention line names its Part 4 number. The database placed fact 3 in Part 4 when the seed
// attached it to the deployed submission (schema v59), and Parts 4-5 share one counter, so the
// contention is paragraph 4.
test("a linked fact already in Part 4 is referenced by its paragraph number, not re-printed in Part 5", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedApplicationResponse(f.dbPath);

    const md = submissionFormsRender(f.dbPath, 1, {}, "mockup").documents.find((d) => d.document_type === "Application_response").markdown;
    assert.match(md, /^1\. The correspondence sought was already produced on 2026-07-15\.[^\n]*<!-- fact 1 -->$/m);
    assert.match(md, /^2\. The defendant has sufficient assets within the jurisdiction\.[^\n]*<!-- fact 2 -->$/m);
    assert.match(md, /^3\. The defendant has never previously failed to satisfy a costs award\.[^\n]*<!-- fact 3 -->$/m);
    assert.match(
      md,
      /^4\. Security for costs is unwarranted given the defendant's assets in this jurisdiction\.[^\n]* <!-- submission_id 1 --> <!-- supporting fact paragraphs: 3 -->$/m
    );
    assert.doesNotMatch(md, /<!-- fact_id 3 -->/, "expected fact 3 not re-printed under the submission");
  } finally {
    f.cleanup();
  }
});

test("an unpositioned order renders the derived ⬜ marker, not a new glyph", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedApplicationResponse(f.dbPath);
    await submissionDataExecute(f.dbPath, `DELETE FROM filing_positions WHERE filing_id = 1 AND opposing_order_id = 3;`);

    const result = submissionFormsRender(f.dbPath, 1, {}, "mockup");
    const md = result.documents.find((d) => d.document_type === "Application_response").markdown;
    assert.match(md, /## Positions not yet taken/);
    assert.match(md, /Order 3: costs of the application ⬜/);
  } finally {
    f.cleanup();
  }
});

// Form 33's template (publish-bcsc-form/templates/form-33.dotx) carries one estimate
// sentence, after THIS IS A RESPONSE TO and before PART 1, with no colon and no
// closing period. The mockup keeps only template sentences, so no "Time estimate:" label.
test("Application Response states the time estimate once, in the template's sentence and position", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedApplicationResponse(f.dbPath);
    const renderMockup = () =>
      submissionFormsRender(f.dbPath, 1, {}, "mockup").documents.find((d) => d.document_type === "Application_response").markdown;
    const assertOneTemplateSentence = (md, expected) => {
      const estimateSection = md.split("THIS IS A RESPONSE TO")[1].split("## PART 1")[0];
      assert.match(estimateSection, new RegExp(`^The application respondent estimates that the application will take ${expected}$`, "m"));
      assert.equal((md.match(/estimates that the application will take/g) ?? []).length, 1, "expected exactly one estimate sentence");
      assert.doesNotMatch(md, /Time estimate/);
    };

    assertOneTemplateSentence(renderMockup(), "1 hour 30 minutes");
    await submissionDataExecute(f.dbPath, `UPDATE hearing_details SET time_estimate_minutes = NULL WHERE filing_id = 1;`);
    assertOneTemplateSentence(renderMockup(), "🧩");
  } finally {
    f.cleanup();
  }
});

function runValidate33(path) {
  let lastErr = "";
  for (const py of PY_CANDIDATES) {
    // -B: write no __pycache__ into the checkout's .claude/skills tree.
    const res = spawnSync(py, ["-B", HARNESS_PATH, "validate33", path], { encoding: "utf-8" });
    if (res.error) {
      lastErr = String(res.error);
      continue;
    }
    return { status: res.status, stdout: res.stdout, stderr: res.stderr };
  }
  throw new Error(`No Python interpreter found (tried ${PY_CANDIDATES.join(", ")}). Last error: ${lastErr}`);
}

function writeTemp(dir, markdown) {
  const path = join(dir, "form-33.md");
  writeFileSync(path, markdown, "utf-8");
  return path;
}

test("emits a form-33.md that validate33 accepts, matching the reviewed data", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedApplicationResponse(f.dbPath);
    // Part 4 citation lines: fact 1 cites its court-record pinpoint, fact 2 its affidavit
    // statement (its impeachment statement never prints).
    await submissionDataExecute(
      f.dbPath,
      `
      INSERT INTO documents (id, proceeding_id, label, document_date) VALUES (3, 1, 'Order of Associate Judge Lin', '2026-07-02');
      UPDATE facts SET court_record = 3, court_record_pinpoint = 'Order of Associate Judge Lin, 2 July 2026, para 1' WHERE id = 1;
      INSERT INTO witnesses (id, proceeding_id, name) VALUES (1, 1, 'Reece Ferris');
      INSERT INTO statements_of_fact (id, proceeding_id, fact_id, witness_id, instrument, pinpoint, purpose, excerpt)
        VALUES
          (1, 1, 2, 1, 2, 'para 4', NULL, 'I hold assets in British Columbia.'),
          (2, 1, 2, 1, 2, 'para 9', 'impeachment', NULL);
      `
    );

    const result = submissionFormsEmitForm33(f.dbPath, 1);
    assert.equal(result.file_name, "form-33.md");
    // ADR 0038: Form 33's currency rides beside the markdown, which the golden below shows carries none of it.
    assert.equal(result.form_currency.form_key, "form-33");
    const md = result.markdown;

    assert.match(md, /^notice_filed: 2026-08-01$/m);
    assert.match(md, /^time_estimate: 1 hour 30 minutes$/m);
    const ordersLine = md.match(/^orders: (.+)$/m)[1];
    assert.deepEqual(JSON.parse(ordersLine), [
      { order: 1, position: "consent", terms: "within 14 days" },
      { order: 2, position: "oppose", terms: "" },
      { order: 3, position: "no-position", terms: "" },
    ]);
    assert.doesNotMatch(md, /pure_law_confirmed/);

    assert.doesNotMatch(md, /## Part 1/);
    assert.match(md, /## Part 4/);
    assert.match(md, /## Part 5/);
    assert.match(md, /## Part 6/);

    // Part 4 holds facts 1..3: submission 1's rested-on fact 3 is placed there by the database
    // (schema v59). Part 5 prints no fact text and never the contention (ticket 2026-08-31).
    assert.match(md, /^1\. The correspondence sought was already produced on 2026-07-15\.$/m);
    assert.match(md, /^2\. The defendant has sufficient assets within the jurisdiction\.$/m);
    assert.match(md, /^3\. The defendant has never previously failed to satisfy a costs award\.$/m);
    assert.doesNotMatch(md, /Security for costs is unwarranted/, "expected the submission's contention sentence never to print");

    // Part 4 citation lines: citation only (no excerpt), and the mockup's own lines less indent and trace.
    const part4Body = md.split("## Part 4")[1].split("## Part 5")[0];
    assert.equal(
      part4Body.trim(),
      [
        "1. The correspondence sought was already produced on 2026-07-15.",
        "> (Order of Associate Judge Lin, 2 July 2026, para 1)",
        "2. The defendant has sufficient assets within the jurisdiction.",
        "> Affidavit of Reece Ferris, para 4",
        "3. The defendant has never previously failed to satisfy a costs award.",
      ].join("\n")
    );
    const mockup = submissionFormsRender(f.dbPath, 1, {}, "mockup").documents.find((d) => d.document_type === "Application_response").markdown;
    const mockupCitations = mockup
      .split("## PART 4: FACTUAL BASIS")[1]
      .split("## PART 5")[0]
      .split("\n")
      .filter((l) => l.startsWith("   > "))
      .map((l) => l.slice(3).replace(/ <!-- fact \d+ -->$/, ""));
    assert.deepEqual(
      part4Body.split("\n").filter((l) => l.startsWith("> ")),
      mockupCitations,
      "expected the filed Part 4 citation lines to be the mockup's"
    );

    assert.match(md, /^- Affidavit of Reece Ferris, dated 2026-08-10$/m);
    assert.ok(
      md.endsWith(
        "- Affidavit of Reece Ferris, dated 2026-08-10\n- Pleadings filed in this proceeding\n- Such further affidavits or filed court documents as this honourable court may allow\n"
      ),
      "expected Part 6 to close with the two standard lines after the affidavit"
    );

    assert.doesNotMatch(md, /\*\*/);
    assert.doesNotMatch(md, /<!--/);
    assert.doesNotMatch(md, /~~/);
    assert.doesNotMatch(md, /```/);
    for (const glyph of ALL_MARKER_GLYPHS) {
      assert.doesNotMatch(md, new RegExp(glyph), `expected no marker glyph ${glyph} in the filed face`);
    }

    const tmpPath = writeTemp(f.dir, md);
    const { status, stderr } = runValidate33(tmpPath);
    assert.equal(status, 0, `expected validate33 to accept the emitted file; stderr: ${stderr}`);

    // #816: the whole emitted face, byte for byte. Every assertion above is a
    // `match` -- it asks whether a line is present, never whether anything else
    // is. validate33 guards line SHAPE, not content: a prose annotation written
    // as a legal Part 6 list item ("- Proof of service not yet on file.")
    // passes it and every assertion here. Only this golden catches that.
    assertMatchesGolden("form-33-emitted", md);
  } finally {
    f.cleanup();
  }
});

// The filed face states each fact once: a submission's linked fact that is also a Part 4 paragraph
// is not printed again in Part 5. The database placed it in Part 4 when the seed attached it
// (schema v59). Here it is the submission's only content, so Part 5 is Nil.
test("emits a linked fact already in Part 4 once, leaving Part 5 Nil. when nothing else is linked", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedApplicationResponse(f.dbPath);

    const { markdown } = submissionFormsEmitForm33(f.dbPath, 1);
    assert.match(markdown, /^3\. The defendant has never previously failed to satisfy a costs award\.$/m);
    assert.equal((markdown.match(/The defendant has never previously failed to satisfy a costs award/g) ?? []).length, 1);
    assert.match(markdown, /## Part 5\n\nNil\.\n/);
    const { status, stderr } = runValidate33(writeTemp(f.dir, markdown));
    assert.equal(status, 0, `expected validate33 to accept the emitted file; stderr: ${stderr}`);
  } finally {
    f.cleanup();
  }
});

test("refuses (does not silently omit) when an order has no position taken", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedApplicationResponse(f.dbPath);
    await submissionDataExecute(f.dbPath, `DELETE FROM filing_positions WHERE filing_id = 1 AND opposing_order_id = 3;`);
    assert.throws(() => submissionFormsEmitForm33(f.dbPath, 1), /no position taken/);
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
    await seedApplicationResponse(f.dbPath);
    await submissionDataExecute(
      f.dbPath,
      `
      INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind, weight, treatment)
        VALUES (1, 1, 'Unreported Authority v. Nobody', NULL, 'case', 'binding', NULL);
      INSERT INTO law_assertions (id, proceeding_id, proposition, dead_end)
        VALUES (1, 1, 'a proposition backed by an uncited authority', 0);
      INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, source, verification)
        VALUES (1, 1, 1, 1, 'para 1', 'the relevant excerpt', 'primary', 'verified');
      INSERT INTO submission_law (submission_id, law_assertion_id) VALUES (1, 1);
      `.trim()
    );
    assert.throws(() => submissionFormsEmitForm33(f.dbPath, 1), /statement\(s\) of law.*authorities\.citation/s);
  } finally {
    f.cleanup();
  }
});

// Empties Part 4. Fact 3 is detached from submission 1 first: a fact attached to a deployed
// submission stays in Part 4 (schema v59), and an attached fact missing from it refuses the emit.
const EMPTY_PART_4 = `DELETE FROM submission_facts WHERE submission_id = 1; DELETE FROM filing_facts WHERE filing_id = 1;`;

test("throws on an empty Part 4 rather than auto-asserting pure_law_confirmed", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedApplicationResponse(f.dbPath);
    await submissionDataExecute(f.dbPath, EMPTY_PART_4);
    assert.throws(() => submissionFormsEmitForm33(f.dbPath, 1), /Part 4.*no pure-law decision/s);
  } finally {
    f.cleanup();
  }
});

// Schema v49: counsel's recorded pure-law decision (filings.pure_law_on and pure_law_note) is the
// only thing that lets an empty Part 4 through, as `Nil.` under `pure_law_confirmed: true`.
const RECORD_PURE_LAW = `UPDATE filings SET pure_law_on = '2026-10-04', pure_law_note = 'The application turns on the Rules alone.' WHERE id = 1;`;

test("emits an empty Part 4 as Nil. under pure_law_confirmed: true while counsel's pure-law decision is recorded", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedApplicationResponse(f.dbPath);
    // Submission 1 rests on law alone once fact 3 is detached, so Part 5 has a paragraph to number.
    await submissionDataExecute(
      f.dbPath,
      `
      INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind, weight, treatment)
        VALUES (1, 1, 'Example Authority v. Sample', '2020 BCSC 1', 'case', 'binding', 'good_law');
      INSERT INTO law_assertions (id, proceeding_id, proposition, dead_end) VALUES (1, 1, 'security for costs is discretionary', 0);
      INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, source, verification)
        VALUES (1, 1, 1, 1, 'para 1', 'the relevant excerpt', 'primary', 'verified');
      INSERT INTO submission_law (submission_id, law_assertion_id) VALUES (1, 1);
      `.trim()
    );
    // Delete first: a delete resets nothing, but an insert of a form fact would clear the decision.
    await submissionDataExecute(f.dbPath, EMPTY_PART_4);
    await submissionDataExecute(f.dbPath, RECORD_PURE_LAW);
    const { markdown } = submissionFormsEmitForm33(f.dbPath, 1);
    assert.match(markdown, /^pure_law_confirmed: true$/m);
    assert.match(markdown, /## Part 4\n\nNil\.\n/);
    assert.match(markdown, /## Part 5\n\n1\. security for costs is discretionary\n/, "expected Part 5 to number from 1 after an empty Part 4");
    const { status, stderr } = runValidate33(writeTemp(f.dir, markdown));
    assert.equal(status, 0, `expected validate33 to accept the pure-law form-33.md; stderr: ${stderr}`);
  } finally {
    f.cleanup();
  }
});

test("throws when Part 4 facts and counsel's pure-law decision are both on record", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedApplicationResponse(f.dbPath);
    await submissionDataExecute(f.dbPath, RECORD_PURE_LAW);
    assert.throws(() => submissionFormsEmitForm33(f.dbPath, 1), /also on record/);
  } finally {
    f.cleanup();
  }
});

test("a database held below v49 still refuses an empty Part 4 rather than crashing on the missing column", async () => {
  const f = seededDbFixture();
  try {
    submissionDbAt(f.dbPath, 48);
    await seedApplicationResponse(f.dbPath);
    await submissionDataExecute(f.dbPath, EMPTY_PART_4);
    assert.throws(() => submissionFormsEmitForm33(f.dbPath, 1), /no pure-law decision/);
  } finally {
    f.cleanup();
  }
});

test("refuses a filing that isn't an application_response", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await submissionDataExecute(
      f.dbPath,
      `
      INSERT INTO proceedings (id, matter_reference, forum, court_or_centre, registry, file_number, style_of_cause, courthouse_address)
        VALUES (1, 'T601 - Okonkwo', 'CAN/BC/BCSC', 'BC Supreme Court', 'Vancouver', 'S-601122', 'Okonkwo v. Ferris', '800 Smithe Street');
      INSERT INTO order_sought (id, proceeding_id, wording) VALUES (1, 1, 'damages to be assessed');
      INSERT INTO filings (id, proceeding_id, kind, subkind, round, title)
        VALUES (1, 1, 'requisition_default_judgment', 'default_judgment', NULL, 'Default Judgment Requisition');
      INSERT INTO filing_orders (filing_id, order_sought_id, document, ordinal) VALUES (1, 1, 'form', 1);

      -- Revision reset LAST: schema v21 triggers move db_meta.revision on every seeded row (#607).
      UPDATE db_meta SET value = '1' WHERE key = 'revision';
      `.trim()
    );
    assert.throws(() => submissionFormsEmitForm33(f.dbPath, 1), /application_response/);
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
// seedApplicationResponse deploys no law at all, so the live statement this test keeps beside the
// overruled one is seeded here rather than inherited -- both hang off the one law assertion, which
// is the guard against a filter that drops the whole proposition instead of the one statement.
test("#842: an overruled authority's statement is withheld from the Form 33 filed face, and its live neighbour still prints", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedApplicationResponse(f.dbPath);
    await submissionDataExecute(
      f.dbPath,
      `
      INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind, weight, treatment) VALUES
        (1, 1, 'Cavell v. Rooke', '2011 BCCA 77', 'case', 'binding', 'good_law'),
        (2, 1, 'Ashford v. Pell Holdings Ltd.', '1998 BCCA 404', 'case', 'binding', 'overruled');
      INSERT INTO law_assertions (id, proceeding_id, proposition, dead_end)
        VALUES (1, 1, 'security for costs is not ordered against a defendant with assets in the jurisdiction', 0);
      INSERT INTO submission_law (submission_id, law_assertion_id) VALUES (1, 1);
      INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, source, verification) VALUES
        (1, 1, 1, 1, 'para 9', 'assets within the jurisdiction answer the risk security for costs protects against', 'primary', 'verified'),
        (2, 1, 1, 2, 'para 22', 'residence outside the province is itself sufficient to order security', 'primary', 'verified');
      `.trim()
    );

    const { markdown: md } = submissionFormsEmitForm33(f.dbPath, 1);

    assert.doesNotMatch(md, /residence outside the province is itself sufficient to order security/, "expected the overruled authority's excerpt off the filed face");
    assert.doesNotMatch(md, /Ashford v\. Pell Holdings Ltd\./, "expected the overruled authority's style of cause withheld too, not just the quotation");
    assert.doesNotMatch(md, /1998 BCCA 404/, "expected its citation withheld -- naming it cites a case the document never quotes");

    assert.match(md, /^> assets within the jurisdiction answer the risk security for costs protects against$/m, "expected the live statement of the same proposition to still print");
    assert.match(md, /^> \*Cavell v\. Rooke\*, 2011 BCCA 77, para 9$/m, "expected the live statement's citation to still print");
    assert.match(md, /security for costs is not ordered against a defendant with assets in the jurisdiction/, "expected the proposition itself to survive -- the statement is dropped, not the paragraph");
  } finally {
    f.cleanup();
  }
});

// #842, the gate half. The CITATION_MISSING filing gate counted statements the filed face no
// longer prints, so an overruled authority with no citation refused the whole emit over a
// placeholder that could never have appeared.
test("#842: an overruled authority with no citation no longer refuses the Form 33 emit", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedApplicationResponse(f.dbPath);
    await submissionDataExecute(
      f.dbPath,
      `
      INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind, weight, treatment)
        VALUES (3, 1, 'Wrenfield v. Bowen', NULL, 'case', 'binding', 'overruled');
      INSERT INTO law_assertions (id, proceeding_id, proposition, dead_end)
        VALUES (3, 1, 'a proposition supported only by an uncited overruled authority', 0);
      INSERT INTO submission_law (submission_id, law_assertion_id) VALUES (1, 3);
      INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, source, verification)
        VALUES (3, 1, 3, 3, 'para 4', 'an uncited excerpt from an overruled authority', 'primary', 'verified');
      `.trim()
    );

    let md;
    assert.doesNotThrow(() => {
      md = submissionFormsEmitForm33(f.dbPath, 1).markdown;
    }, "expected the citation gate to ignore a statement the filed face never prints");
    assert.doesNotMatch(md, /an uncited excerpt from an overruled authority/, "expected the statement itself still withheld");
    assert.doesNotMatch(md, /Wrenfield v\. Bowen/, "expected the uncited overruled authority unnamed");
  } finally {
    f.cleanup();
  }
});
