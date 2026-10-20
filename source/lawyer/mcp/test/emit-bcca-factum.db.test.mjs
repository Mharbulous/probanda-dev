// bcca-factum.md filed-face emitter (#648). The emitted file passes the publish-bcca-factum
// validator (fill_factum.py --validate, the contract's oracle), lists the same authorities and
// paragraphs as the Factum.md mockup, refuses a filing of another kind, and names what is missing.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { assertMatchesGolden } from "./fixtures/forms-render-seeds.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const { subskillScriptPath } = await import("../build/submission/publish-host.js");
// The runtime's own lookup, given an install root with no skill source, so it serves the
// checkout's .claude/skills copy: plugins/litigation/skills/ is untracked since #1266.
const VALIDATOR = subskillScriptPath("publish", "publish-bcca-factum", "fill_factum.py", process.env, join(HERE, "no-install"));
const PY_CANDIDATES = [process.env.COCLERK_PYTHON, "python", "python3"].filter(Boolean);

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { writePartiesOfRecord } = await import("./helpers/matter-data-fixture.mjs");
const { submissionDataExecute } = await import("../build/submission/backend.js");
const { submissionFormsRender, submissionFormsEmitBccaFactum } = await import("../build/submission/forms.js");
const { ALL_MARKER_GLYPHS } = await import("../build/submission/forms/markers.js");
const { FACTUM_CASE_DATA, FACTUM_SEED } = await import("./fixtures/bcca-factum-seed.mjs");

async function seeded(extraSql = "") {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-emit-factum-"));
  const dbPath = join(dir, "submission.sqlite");
  await freshSubmissionDb(dbPath);
  writePartiesOfRecord(dirname(dbPath), FACTUM_CASE_DATA);
  await submissionDataExecute(dbPath, FACTUM_SEED + extraSql);
  return { dir, dbPath, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function validate(dir, markdown) {
  const path = join(dir, "bcca-factum.md");
  writeFileSync(path, markdown, "utf-8");
  let lastErr = "";
  for (const py of PY_CANDIDATES) {
    // -B: write no __pycache__ into the checkout's .claude/skills tree.
    const res = spawnSync(py, ["-B", VALIDATOR, "--validate", path], { encoding: "utf-8" });
    if (res.error) {
      lastErr = String(res.error);
      continue;
    }
    return { status: res.status, stdout: res.stdout.trim() };
  }
  throw new Error(`No Python interpreter found (tried ${PY_CANDIDATES.join(", ")}). Last error: ${lastErr}`);
}

function frontmatterJson(markdown, key) {
  const line = markdown.split("\n").find((l) => l.startsWith(`${key}: `));
  return line === undefined ? undefined : JSON.parse(line.slice(key.length + 2));
}

test("emitted bcca-factum.md passes the publish-bcca-factum validator and carries no marker", async () => {
  const f = await seeded();
  try {
    const result = submissionFormsEmitBccaFactum(f.dbPath, 1, "2026-09-16");
    assert.equal(result.file_name, "bcca-factum.md");
    const md = result.markdown;
    for (const glyph of ALL_MARKER_GLYPHS) assert.ok(!md.includes(glyph), `no ${glyph} in the filed face`);
    assert.ok(!md.includes("<!--"), "no HTML comment");
    const check = validate(f.dir, md);
    assert.equal(check.status, 0, check.stdout);
    assert.deepEqual(JSON.parse(check.stdout), { success: true });

    assert.match(md, /^dated_on: 2026-09-16$/m);
    assert.match(md, /^signing_place: Vancouver$/m);
    assert.match(md, /^authorizing_line: Counsel for the Respondents$/m);
    assert.deepEqual(frontmatterJson(md, "enactments").map((e) => e.title), ["Arbitration Act"], "rules and cases stay out of the enactments");

    // #816: the whole emitted face, byte for byte. Everything above is a
    // presence check, and the validator guards line SHAPE, not content -- the
    // OPENING STATEMENT and the PART 4 order wordings are free prose by the
    // contract's own grammar, so a prose annotation there ("Power to make:
    // jurisdictional basis not yet filled.") passes the validator and every
    // assertion in this file. Only this golden catches it. `datedOn` is the
    // caller's parameter, not a clock read, so the face is deterministic and
    // needs no normalizer.
    assertMatchesGolden("bcca-factum-emitted", md);
  } finally {
    f.cleanup();
  }
});

test("authorities and paragraph numbers match the mockup the practitioner reviewed", async () => {
  const f = await seeded();
  try {
    const md = submissionFormsEmitBccaFactum(f.dbPath, 1, "2026-09-16").markdown;
    const mockup = submissionFormsRender(f.dbPath, 1, {}).documents.find((d) => d.document_type === "Factum").markdown;
    const mockupRows = [...mockup.matchAll(/^\| .+ \| \(fills in Word\) \| ([\d, ]+) \|$/gm)].map((m) => m[1].split(", ").map(Number));
    assert.deepEqual(frontmatterJson(md, "authorities").map((a) => a.paras), mockupRows);

    const filed = [...md.matchAll(/^(\d+)\. (.*)$/gm)].map((m) => [Number(m[1]), m[2]]);
    const mockupParts = mockup.slice(mockup.indexOf("## PART 1"), mockup.indexOf("## APPENDICES: LIST OF AUTHORITIES"));
    const mockupLines = new Map([...mockupParts.matchAll(/^(\d+)\. (.*)$/gm)].map((m) => [Number(m[1]), m[2].replace(/\*\*/g, "")]));
    assert.deepEqual(filed.map(([n]) => n), [...mockupLines.keys()], "same paragraph numbers");
    for (const [n, text] of filed) assert.ok(mockupLines.get(n).startsWith(text), `paragraph ${n} matches the mockup: ${text}`);
  } finally {
    f.cleanup();
  }
});

test("refuses a filing that isn't bcca_factum", async () => {
  const f = await seeded("INSERT INTO filings (id, proceeding_id, kind, title) VALUES (2, 1, 'bcca_stay_response', 'Stay');");
  try {
    assert.throws(() => submissionFormsEmitBccaFactum(f.dbPath, 2, "2026-09-16"), /has kind "bcca_stay_response", not "bcca_factum"/);
  } finally {
    f.cleanup();
  }
});

test("names the missing cover-critical or required field", async () => {
  const cases = [
    ["UPDATE proceedings SET file_number = NULL WHERE id = 1;", /no file_number recorded/],
    ["UPDATE parties SET is_client = 0;", /no party is flagged is_client/],
    ["DELETE FROM filing_prose WHERE slot = 'signing_place';", /place of signing \(signing_place\)/],
    ["DELETE FROM filing_chronology;", /chronology has no events/],
    ["UPDATE authorities SET citation = NULL WHERE id = 1;", /have no authorities.citation/],
  ];
  for (const [sql, expected] of cases) {
    const f = await seeded(sql);
    try {
      assert.throws(() => submissionFormsEmitBccaFactum(f.dbPath, 1, "2026-09-16"), expected, sql);
    } finally {
      f.cleanup();
    }
  }
});

// #842: an overruled authority's statements ride the brief-only cap -- never
// a venue mockup and never a filed face. Two sites on this face: printedLaw, which decides what
// Part 3 quotes, and fetchCitedStatements, which feeds the Appendix: List of Authorities, the
// Book of Authorities and the Enactments appendix. Without the second, the factum would name an
// authority Part 3 never cites. Authority 5 is overruled but NOT killed: killed_on stays NULL,
// so only the treatment clause can drop it.
//
// It hangs off law assertion 1, which keeps its live Housen statement -- the survival assertions
// below are the guard against a filter that drops the whole proposition, or the whole appendix.
test("#842: an overruled authority is absent from the emitted factum's argument, List of Authorities and appendices", async () => {
  const f = await seeded(`
INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind, treatment, weight)
  VALUES (5, 1, 'Ashford v. Pell Holdings Ltd.', '1998 BCCA 404', 'case', 'overruled', 'binding');
INSERT INTO statements_of_law (proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, source, verification)
  VALUES (1, 1, 5, 'para 22', 'the standard of review on a question of law is reasonableness', 'primary', 'verified');
`);
  try {
    const md = submissionFormsEmitBccaFactum(f.dbPath, 1, "2026-09-16").markdown;

    // Part 3 (printedLaw).
    assert.doesNotMatch(md, /the standard of review on a question of law is reasonableness/, "expected the overruled authority's excerpt off the filed face");
    assert.doesNotMatch(md, /Ashford v\. Pell Holdings Ltd\./, "expected its style of cause withheld everywhere on the face, frontmatter included");
    assert.doesNotMatch(md, /1998 BCCA 404/, "expected its citation withheld -- naming it cites a case the factum never quotes");
    assert.match(md, /the standard of review for questions of law is correctness/, "expected the live statement of the same proposition to still print");

    // Appendix: List of Authorities (fetchCitedStatements, via factumAuthorities).
    const listed = frontmatterJson(md, "authorities").map((a) => a.authority);
    assert.equal(listed.includes("Ashford v. Pell Holdings Ltd."), false, "expected the overruled authority off the List of Authorities");
    assert.ok(listed.includes("Housen v Nikolaisen"), "expected the live authority behind the same paragraph still listed");

    // Enactments appendix -- same query, so the live enactment must be untouched.
    assert.deepEqual(frontmatterJson(md, "enactments").map((e) => e.title), ["Arbitration Act"], "expected the Enactments appendix unchanged");

    // Book of Authorities (factumBookAuthorities, the same query narrowed by kind). emit-bcca-book.ts
    // reads it from here, so the book is pinned at its source rather than through a second emitter.
    const { factumBookAuthorities } = await import("../build/submission/forms/render-bcca-factum.js");
    const book = factumBookAuthorities(f.dbPath, 1).map((a) => a.authority);
    assert.equal(book.includes("Ashford v. Pell Holdings Ltd."), false, "expected the overruled authority out of the Book of Authorities");
    assert.ok(book.includes("Housen v Nikolaisen"), "expected the live case still in the book");
  } finally {
    f.cleanup();
  }
});
