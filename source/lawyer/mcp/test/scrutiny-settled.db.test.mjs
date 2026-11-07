// Scrutiny settles once (schema v47; planning/2. Plan/2026-10-02_scrutiny-settles-once-plan.md),
// through the real renderer.
//
// A settled statement is counsel's confirmed close over a failed scrutiny finding. It counts as
// support like a verified one, prints on the filed face, and carries a plain-text settled tag on
// every mockup line it prints on, with no 🔬 and no 👃 for its kept finding. A statement under a
// submission or order deployed on no live Writing raises no 🔬 (spec R6), and re-linking it makes 🔬
// derive again. An excerpt edit on a settled row reopens it to 'lead', so 🔬 derives once.
//
// Seed pattern follows markers-doctrinal-slot.db.test.mjs's minimal seed (freshSubmissionDb +
// submissionDataExecute + submissionFormsRender).

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

const { freshSubmissionDb, seedSql } = await import("./helpers/template-db.mjs");
const { writePartiesOfRecord } = await import("./helpers/matter-data-fixture.mjs");
const { submissionDataExecute } = await import("../build/submission/backend.js");
const { submissionFormsRender } = await import("../build/submission/forms.js");
const { proposalKey } = await import("../build/submission/forms/proposal-inventory.js");
const { boardDataOf } = await import("./fixtures/forms-render-seeds.mjs");

const CLAIMANT_CASE_DATA = {
  parties: [
    { id: 1, name: "Claimant Co.", counsel_name: "A. Lawyer" },
    { id: 2, name: "Respondent Co." },
  ],
};

const SEED = `
INSERT INTO proceedings (id, matter_reference, forum, court_or_centre, registry, file_number, style_of_cause, courthouse_address)
  VALUES (1, 'L9002 - Settled', 'CAN/BC/Vancouver-International-Arbitration-Centre', 'VanIAC', NULL, NULL, 'Settled v. Test', NULL);

INSERT INTO parties (id, proceeding_id, name, role, ordinal, is_client, is_applicant, to_be_served, case_party_id)
  VALUES
    (1, 1, 'Claimant Co.', 'Claimant', 1, 1, 1, 0, 1),
    (2, 1, 'Respondent Co.', 'Respondent', 2, 0, 0, 1, 2);

INSERT INTO filings (id, proceeding_id, kind, subkind, round, title)
  VALUES (1, 1, 'submissions_package', NULL, 'opening', 'Opening Submissions Package');

-- Authority 1 is not yet noted up, so the settled statement's line owes 📇 and the note-up gate reads it.
INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind, weight, treatment, killed_on)
  VALUES
    (1, 1, 'Settled Authority v. S', '2021 BCSC 11', 'case', NULL, NULL, NULL),
    (2, 1, 'Failed Authority v. F', '2022 BCSC 12', 'case', NULL, 'good_law', NULL),
    (3, 1, 'Lead Authority v. L', '2023 BCSC 13', 'case', NULL, 'good_law', NULL),
    (4, 1, 'Reserved Lead v. R', '2024 BCSC 14', 'case', NULL, 'good_law', NULL),
    (5, 1, 'Settled Power v. O', '2019 BCCA 15', 'case', NULL, 'good_law', NULL),
    (6, 1, 'Lead Power v. P', '2018 BCCA 16', 'case', NULL, 'good_law', NULL);

INSERT INTO submissions (id, proceeding_id, contention, ordinal)
  VALUES (1, 1, 'A deployed contention.', 1), (2, 1, 'A reserved contention.', 2);
INSERT INTO filing_submissions (filing_id, submission_id, document, ordinal) VALUES (1, 1, 'form', 1);

INSERT INTO law_assertions (id, proceeding_id, proposition, dead_end)
  VALUES
    (1, 1, 'a proposition resting on a settled statement', 0),
    (2, 1, 'a proposition resting on a failed statement', 0),
    (3, 1, 'a proposition resting on a lead statement', 0),
    (4, 1, 'a reserved proposition resting on a lead statement', 0);
INSERT INTO submission_law (submission_id, law_assertion_id) VALUES (1, 1), (1, 2), (1, 3), (2, 4);

INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, source, doubt, verification,
                               settled_on, settled_note, scrutinized_authority_id, scrutinized_pinpoint, scrutinized_excerpt)
  VALUES
    (1, 1, 1, 1, 'para 11', 'A passage counsel confirmed over the finding.', 'primary',
     'Scrutiny failed 2026-10-01: fit failed.', 'settled', '2026-10-02', 'Keep it as it is: the finding misreads para 11.',
     1, 'para 11', 'A passage counsel confirmed over the finding.'),
    (2, 1, 2, 2, 'para 12', 'A passage the research lawyer failed.', 'primary',
     'Scrutiny failed 2026-10-02: ratio failed.', 'failed', NULL, NULL, NULL, NULL, NULL),
    (3, 1, 3, 3, 'para 13', 'A deployed lead passage.', 'primary', NULL, 'lead', NULL, NULL, NULL, NULL, NULL),
    (4, 1, 4, 4, 'para 14', 'A reserved lead passage.', 'primary', NULL, 'lead', NULL, NULL, NULL, NULL, NULL),
    (5, 1, NULL, 5, 'para 15', 'The power to grant, confirmed by counsel.', 'primary',
     'Scrutiny failed 2026-10-01: power doubted.', 'settled', '2026-10-02', 'Keep.', 5, 'para 15', 'The power to grant, confirmed by counsel.'),
    (6, 1, NULL, 6, 'para 16', 'The power to grant, a reserved lead.', 'primary', NULL, 'lead', NULL, NULL, NULL, NULL, NULL),
    (7, 1, NULL, 6, 'para 17', 'The power to grant, a deployed lead.', 'primary', NULL, 'lead', NULL, NULL, NULL, NULL, NULL);

INSERT INTO order_sought (id, proceeding_id, wording, amount)
  VALUES
    (1, 1, 'an order resting on a settled basis', NULL),
    (2, 1, 'a reserved order resting on a lead basis', NULL),
    (3, 1, 'an order resting on a lead basis', NULL);
INSERT INTO order_sought_requires (order_sought_id, excerpt_id, basis_state) VALUES (1, 5, 'filled'), (2, 6, 'filled'), (3, 7, 'filled');
INSERT INTO filing_orders (filing_id, order_sought_id, document, ordinal) VALUES (1, 1, 'form', 1), (1, 3, 'form', 2);

UPDATE db_meta SET value = '1' WHERE key = 'revision';
`.trim();

const CLIENT = { clientName: "Settled", clientNo: "9002", matterNo: "L9002" };
const TAG = " (settled by counsel 2026-10-02 over scrutiny finding)";
const SETTLED_EXCERPT = "A passage counsel confirmed over the finding.";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-scrutiny-settled-"));
  const matter = join(dir, "L4801 Matter");
  mkdirSync(join(matter, "0. CASE DATA"), { recursive: true });
  mkdirSync(join(matter, "0. DRAFT"));
  return { dbPath: join(matter, "0. CASE DATA", "submission.sqlite"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

async function seeded(f) {
  await freshSubmissionDb(f.dbPath);
  writePartiesOfRecord(dirname(f.dbPath), CLAIMANT_CASE_DATA);
  await submissionDataExecute(f.dbPath, SEED);
}

function doc(result, type) {
  const d = result.documents.find((x) => x.document_type === type);
  assert.ok(d, `expected a ${type} document`);
  return d;
}

/** The line traced `trace`, and its citation part: the line up to its first marker glyph or trace comment
 * (statementBlock prints citation, tags, markers and the id comment on one line). */
function traced(md, trace) {
  const line = md.split("\n").find((l) => l.includes(trace));
  assert.ok(line, `expected a line traced ${trace}`);
  return { line, before: line.slice(0, line.search(/\p{Extended_Pictographic}|<!--/u)).trimEnd() };
}

/** Every generating key the render recorded, and every key the board proposes. */
function keysOf(result) {
  const wa = doc(result, "Written_arguments");
  const draft = dirname(dirname(wa.path));
  const manifest = JSON.parse(readFileSync(join(draft, "Drafting records", `render-manifest-${result.filing_id}.json`), "utf-8"));
  return {
    manifest,
    recorded: new Set(manifest.inventory.filter((e) => e.generating !== false).map(proposalKey)),
    proposed: new Set(boardDataOf(join(dirname(draft), "0. CASE DATA", "submission.sqlite"), result.filing_id, CLIENT).proposals.map((p) => p.key)),
  };
}

test("a settled statement counts as support, carries its tag and no 🔬 or 👃, and prints on the filed face without the tag", async () => {
  const f = fixture();
  try {
    await seeded(f);
    const mockup = submissionFormsRender(f.dbPath, 1, CLIENT);
    const writtenArgument = doc(mockup, "Written_arguments").markdown;

    // The venue mockup prints the settled statement, as it prints a verified one.
    assert.ok(writtenArgument.includes(SETTLED_EXCERPT), "expected the settled excerpt on the venue mockup");
    const statement = traced(writtenArgument, "<!-- statement_of_law_id 1 -->");
    assert.ok(statement.before.endsWith(`*Settled Authority v. S*, 2021 BCSC 11, para 11${TAG}`), statement.before);
    assert.doesNotMatch(statement.line, /🔬|👃/, "expected no 🔬 and no 👃 on a settled statement");

    // Its proposition reads as supported: neither 📖 nor 🔬, and the source rung reads primary.
    const proposition = traced(writtenArgument, "<!-- law_assertion_id 1 -->").line;
    assert.doesNotMatch(proposition, /📖|🔬|🥉|🥈|🏅|scrutiny failed/, proposition);

    // The order whose basis rests on the settled statement is filled: no 🏛️ and no 🔬.
    const settledOrder = traced(writtenArgument, "<!-- relief_item a -->").line;
    assert.doesNotMatch(settledOrder, /🏛️|🔬/, settledOrder);

    // The filed face prints the excerpt and the citation, and never the tag.
    const filed = doc(submissionFormsRender(f.dbPath, 1, CLIENT, "filed"), "Written_arguments").markdown;
    assert.ok(filed.includes(SETTLED_EXCERPT), "expected the settled excerpt on the filed face");
    assert.ok(filed.includes("*Settled Authority v. S*, 2021 BCSC 11, para 11"), "expected the settled citation on the filed face");
    assert.doesNotMatch(filed, /settled by counsel/, "expected no settled tag on the filed face");
  } finally {
    f.cleanup();
  }
});

test("an authority's note-up note prints last on its statements' citation lines, whitespace collapsed, and never on the filed face (schema v51)", async () => {
  const f = fixture();
  try {
    await seeded(f);
    await submissionDataExecute(
      f.dbPath,
      "UPDATE authorities SET treatment = 'good_law', treatment_note = 'CanLII: noted up (2021 BCSC 11: 3 citing decisions;\n  3 read);   no qualification' WHERE id = 1;"
    );
    const note = " (note-up: CanLII: noted up (2021 BCSC 11: 3 citing decisions; 3 read); no qualification)";
    const mockup = submissionFormsRender(f.dbPath, 1, CLIENT);
    for (const type of ["Written_arguments"]) {
      const md = doc(mockup, type).markdown;
      const settled = traced(md, "<!-- statement_of_law_id 1 -->");
      assert.ok(settled.before.endsWith(`*Settled Authority v. S*, 2021 BCSC 11, para 11${TAG}${note}`), `${type}: ${settled.before}`);
      assert.doesNotMatch(traced(md, "<!-- law_assertion_id 1 -->").line, /note-up/, `${type}: no tag on the proposition line`);
    }
    const filed = doc(submissionFormsRender(f.dbPath, 1, CLIENT, "filed"), "Written_arguments").markdown;
    assert.ok(filed.includes("*Settled Authority v. S*, 2021 BCSC 11, para 11"), "expected the citation on the filed face");
    assert.doesNotMatch(filed, /note-up|noted up|settled by counsel/, "expected neither tag on the filed face");
  } finally {
    f.cleanup();
  }
});

test("a statement deployed on no live Writing raises no 🔬", async () => {
  const f = fixture();
  try {
    await seeded(f);
    const mockup = submissionFormsRender(f.dbPath, 1, CLIENT);
    const writtenArgument = doc(mockup, "Written_arguments").markdown;

    // The deployed order's control keeps its 🔬.
    assert.match(traced(writtenArgument, "<!-- relief_item b -->").line, /🔬/, "expected 🔬 on the deployed order's lead basis");

    const { manifest, recorded, proposed } = keysOf(mockup);
    for (const set of [recorded, proposed]) {
      assert.equal(set.has("scrutinize:statements_of_law:1"), false, "expected no 🔬 Proposal for the settled statement");
      assert.equal(set.has("scrutinize:statements_of_law:5"), false, "expected no 🔬 Proposal for the settled basis");
      assert.equal(set.has("scrutinize:statements_of_law:2"), false, "expected no 🔬 Proposal for the failed statement");
      assert.equal(set.has("scrutinize:statements_of_law:4"), false, "expected no 🔬 Proposal for the reserved submission's lead");
      assert.equal(set.has("scrutinize:statements_of_law:6"), false, "expected no 🔬 Proposal for the reserved order's lead");
      assert.ok(set.has("scrutinize:statements_of_law:3"), "expected the deployed submission's lead to propose 🔬");
      assert.ok(set.has("scrutinize:statements_of_law:7"), "expected the deployed order's lead to propose 🔬");
      assert.ok(set.has("note-up:authorities:1"), "expected the settled statement's authority to propose note-up");
    }
    assert.ok(
      manifest.inventory.some((e) => e.slug === "note-up" && e.table === "authorities" && e.id === 1 && e.cleared === true),
      "expected the settled statement to clear the note-up gate"
    );
  } finally {
    f.cleanup();
  }
});

// R6 reads per statement: a lead under the reserved submission keeps 🔬 while any live-deployed
// submission requires the same proposition, on this filing or another, and loses it once that
// other filing is retired.
test("a reserved submission's lead keeps 🔬 while a live-deployed submission shares its proposition", async () => {
  const cases = [
    { name: "shared with a submission this filing deploys", sql: "INSERT INTO submission_law (submission_id, law_assertion_id) VALUES (1, 4);", scrutiny: true },
    {
      name: "required by an order this filing deploys",
      sql: "INSERT INTO order_sought_requires (order_sought_id, law_assertion_id, basis_state) VALUES (1, 4, 'needed');",
      scrutiny: true,
    },
    {
      name: "shared with a submission another live filing deploys",
      sql: `INSERT INTO filings (id, proceeding_id, kind, subkind, round, title) VALUES (2, 1, 'submissions_package', NULL, 'reply', 'Reply Package');
            INSERT INTO submissions (id, proceeding_id, contention, ordinal) VALUES (3, 1, 'A contention on filing 2.', 3);
            INSERT INTO filing_submissions (filing_id, submission_id, document, ordinal) VALUES (2, 3, 'form', 1);
            INSERT INTO submission_law (submission_id, law_assertion_id) VALUES (3, 4);`,
      scrutiny: true,
    },
    {
      name: "shared with a submission only a retired filing deploys",
      sql: `INSERT INTO filings (id, proceeding_id, kind, subkind, round, title) VALUES (2, 1, 'submissions_package', NULL, 'reply', 'Reply Package');
            INSERT INTO submissions (id, proceeding_id, contention, ordinal) VALUES (3, 1, 'A contention on filing 2.', 3);
            INSERT INTO filing_submissions (filing_id, submission_id, document, ordinal) VALUES (2, 3, 'form', 1);
            INSERT INTO submission_law (submission_id, law_assertion_id) VALUES (3, 4);
            UPDATE filings SET retired_on = '2026-10-01', retirement_reason = 'abandoned' WHERE id = 2;`,
      scrutiny: false,
    },
    {
      // v58: a sent Writing keeps a later-killed submission's row, and the kill still drops it here.
      name: "shared with a killed submission a sent filing keeps",
      sql: `INSERT INTO filings (id, proceeding_id, kind, subkind, round, title) VALUES (2, 1, 'submissions_package', NULL, 'reply', 'Reply Package');
            INSERT INTO submissions (id, proceeding_id, contention, ordinal) VALUES (3, 1, 'A contention on filing 2.', 3);
            INSERT INTO filing_submissions (filing_id, submission_id, document, ordinal) VALUES (2, 3, 'form', 1);
            INSERT INTO submission_law (submission_id, law_assertion_id) VALUES (3, 4);
            INSERT INTO parties_snapshot (filing_id, party_id, name, role, ordinal, is_client, is_applicant, to_be_served, address_for_service_filed)
              VALUES (2, 1, 'A Party', 'claimant', 1, 1, 0, 0, '');
            UPDATE filings SET filed_on = '2026-10-01' WHERE id = 2;
            UPDATE submissions SET killed_on = '2026-10-02' WHERE id = 3;`,
      scrutiny: false,
    },
  ];
  for (const c of cases) {
    const f = fixture();
    try {
      await seeded(f);
      seedSql(f.dbPath, c.sql);
      const mockup = submissionFormsRender(f.dbPath, 1, CLIENT);
      const { recorded, proposed } = keysOf(mockup);
      assert.equal(recorded.has("scrutinize:statements_of_law:4"), c.scrutiny, `${c.name}: recorded`);
      assert.equal(proposed.has("scrutinize:statements_of_law:4"), c.scrutiny, `${c.name}: proposed`);
    } finally {
      f.cleanup();
    }
  }
});

test("re-linking a reserved submission derives 🔬 again, and an excerpt edit on a settled row reopens it once", async () => {
  const f = fixture();
  try {
    await seeded(f);
    submissionFormsRender(f.dbPath, 1, CLIENT);

    await submissionDataExecute(f.dbPath, "INSERT INTO filing_submissions (filing_id, submission_id, document, ordinal) VALUES (1, 2, 'form', 2);");
    const relinked = keysOf(submissionFormsRender(f.dbPath, 1, CLIENT));
    assert.ok(relinked.recorded.has("scrutinize:statements_of_law:4"), "expected the re-linked lead to propose 🔬");
    assert.ok(relinked.proposed.has("scrutinize:statements_of_law:4"), "expected the re-linked lead on the board");

    await submissionDataExecute(f.dbPath, "UPDATE statements_of_law SET excerpt = 'A passage counsel confirmed, re-captured.' WHERE id = 1;");
    const reopened = submissionFormsRender(f.dbPath, 1, CLIENT);
    const { recorded, proposed } = keysOf(reopened);
    assert.ok(recorded.has("scrutinize:statements_of_law:1"), "expected the reopened statement to propose 🔬");
    assert.ok(proposed.has("scrutinize:statements_of_law:1"), "expected the reopened statement on the board");
  } finally {
    f.cleanup();
  }
});
