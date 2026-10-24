// drafting_forms__pre_filing_check (issue #615): fixture packages built in a temp
// 0. DRAFT folder, seeded through the real migrate + execute path, checked by the
// built tool. Every PDF here is a minimal hand-written one-page PDF with a text
// stream (no extra dependency); DOCX fixtures are written by host Python's zipfile.
// Run after `node_modules/.bin/tsc` (imports ../build/**); pypdf must be installed
// for the host python -- its absence is a hard error, which one test pins.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute } = await import("../build/submission/backend.js");
const { submissionFormsPreFilingCheck } = await import("../build/submission/forms.js");
const { isPlaceholder, extractExhibitReferences } = await import("../build/submission/pre-filing/checks.js");
const { extractDocuments } = await import("../build/submission/pre-filing/extract.js");

/** A minimal PDF, one entry of `pages` per page (a bare string is one page), each "\n"-separated line
 * a Helvetica text line -- enough for pypdf's extract_text. */
function pdfBytes(pages) {
  const texts = Array.isArray(pages) ? pages : [pages];
  const esc = (t) => t.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const fontObj = 3 + 2 * texts.length;
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${texts.map((_, i) => `${3 + 2 * i} 0 R`).join(" ")}] /Count ${texts.length} >>`];
  texts.forEach((text, i) => {
    const stream = `BT /F1 12 Tf 72 720 Td ${text.split("\n").map((l) => `(${esc(l)}) Tj`).join(" 0 -16 Td ")} ET`;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${4 + 2 * i} 0 R /Resources << /Font << /F1 ${fontObj} 0 R >> >> >>`);
    objs.push(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
  });
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let out = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

function writeDocx(path, text) {
  const py = `
import sys, zipfile
from xml.sax.saxutils import escape
path, text = sys.argv[1], sys.argv[2]
body = "".join("<w:p><w:r><w:t xml:space=\\"preserve\\">%s</w:t></w:r></w:p>" % escape(line) for line in text.split("\\n"))
doc = '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>%s</w:body></w:document>' % body
with zipfile.ZipFile(path, "w") as z:
    z.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
    z.writestr("word/document.xml", doc)
`;
  const res = spawnSync(process.env.COCLERK_PYTHON ?? "python", ["-c", py, path, text], { encoding: "utf-8" });
  assert.equal(res.status, 0, res.stderr);
}

/** A matter-shaped temp tree: <root>/0. DRAFT/Test filing/Package plus <root>/0. CASE DATA/submission.sqlite beside it. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "coclerk-prefiling-"));
  const pkg = join(root, "0. DRAFT", "Test filing", "Package");
  mkdirSync(pkg, { recursive: true });
  mkdirSync(join(root, "0. CASE DATA"));
  const dbPath = join(root, "0. CASE DATA", "submission.sqlite");
  return { root, pkg, dbPath, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** One VanIAC filing with `labels.length` exhibits (Ex. 1..n in order) and one witness-statement document. */
async function seed(dbPath, labels) {
  await freshSubmissionDb(dbPath);
  const docs = labels
    .map((label, i) => `INSERT INTO documents (id, proceeding_id, label) VALUES (${i + 1}, 1, '${label.replace(/'/g, "''")}');
      INSERT INTO filing_documents (filing_id, document_id, ordinal, role) VALUES (1, ${i + 1}, ${i + 1}, 'evidence');`)
    .join("\n");
  await submissionDataExecute(
    dbPath,
    `
    INSERT INTO proceedings (id, matter_reference, forum, court_or_centre, style_of_cause) VALUES (1, 'T1', 'CAN/BC/Vancouver-International-Arbitration-Centre', 'VanIAC', 'A v. B');
    INSERT INTO filings (id, proceeding_id, kind, round, title) VALUES (1, 1, 'submissions_package', 'opening', 'Test filing');
    ${docs}
    INSERT INTO witnesses (id, proceeding_id, name) VALUES (1, 1, 'W. Ness');
    INSERT INTO documents (id, proceeding_id, label, instrument, deponent) VALUES (90, 1, 'Witness Statement of W. Ness', 'witness_statement', 1);
    INSERT INTO filing_documents (filing_id, document_id, ordinal, role) VALUES (1, 90, 1, 'witness_statement');
    `
  );
}

function writeExhibits(pkg, n) {
  for (let i = 1; i <= n; i++) writeFileSync(join(pkg, `Exhibit ${i} - Document ${i}.pdf`), pdfBytes(`Exhibit ${i} body text`));
}

function check(id, result) {
  return result.checks.find((c) => c.id === id);
}

test("C1 fails when a statement cites an exhibit number the Index numbers differently, naming both", async () => {
  const f = fixture();
  try {
    await seed(f.dbPath, ["Demand letter", "Contract", "Notice of Civil Claim"]); // Ex. 1-3; no Ex. 9
    writeExhibits(f.pkg, 3);
    writeFileSync(join(f.pkg, "Witness Statement of W. Ness.pdf"), pdfBytes("A true copy of the Notice of Civil Claim is Exhibit 9."));
    const r = submissionFormsPreFilingCheck(f.dbPath, 1, f.pkg);
    const c1 = check("C1", r);
    assert.equal(c1.status, "fail");
    assert.equal(c1.findings.length, 2); // not in Index, and no file
    assert.equal(c1.findings[0].document, "Witness Statement of W. Ness.pdf");
    assert.match(c1.findings[0].problem, /Exhibit 9/);
    assert.match(c1.findings[0].conflict, /Ex\. 1 to Ex\. 3/);
    assert.match(c1.findings[0].quote, /is Exhibit 9\./);
  } finally {
    f.cleanup();
  }
});

test("C1 fails on an Index row with no file, and on a file with no Index row", async () => {
  const f = fixture();
  try {
    await seed(f.dbPath, ["Demand letter", "Contract"]);
    writeExhibits(f.pkg, 1);
    writeFileSync(join(f.pkg, "Exhibit 7 - Stray.pdf"), pdfBytes("stray"));
    const r = submissionFormsPreFilingCheck(f.dbPath, 1, f.pkg);
    const c1 = check("C1", r);
    assert.equal(c1.status, "fail");
    assert.deepEqual(
      c1.findings.map((x) => x.problem),
      ['exhibit file numbered 7 has no row in the Index of Exhibits', 'Index row Ex. 2 has no "Exhibit 2 - …" file in the package folder']
    );
  } finally {
    f.cleanup();
  }
});

test("clean package: all six checks pass; ranges expand; deterministic; no API key needed", async () => {
  const f = fixture();
  try {
    await seed(f.dbPath, ["A", "B", "C", "D"]);
    writeExhibits(f.pkg, 4);
    writeFileSync(join(f.pkg, "Witness Statement of W. Ness - signed.pdf"), pdfBytes("See Exhibits 1 to 3 and Ex. 4. Cited at [2019] and [para. 12] and [...].\nSigned by W. Ness on September 10, 2026."));
    writeDocx(join(f.pkg, "Written Arguments.docx"), "Argument relies on Exhibits 2 and 3.\nThe court held [emphasis added] that [sic] applies.");
    delete process.env.ANTHROPIC_API_KEY;
    const a = submissionFormsPreFilingCheck(f.dbPath, 1, f.pkg);
    const b = submissionFormsPreFilingCheck(f.dbPath, 1, f.pkg);
    assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
    for (const c of a.checks) assert.equal(c.status, "pass", `${c.id}: ${JSON.stringify(c.findings)}`);
    assert.equal(a.package_total_pages, 5);
    assert.deepEqual(a.checks.map((c) => c.id), ["C1", "C2", "C3", "C4", "C5", "C6"]);
    assert.equal(a.index.length, 4);
    assert.equal(a.index[3].file, "Exhibit 4 - Document 4.pdf");
  } finally {
    f.cleanup();
  }
});

test("C2 flags [DATE] in a signed document at high severity, quoting the line, and ignores exhibits", async () => {
  const f = fixture();
  try {
    await seed(f.dbPath, ["A"]);
    writeFileSync(join(f.pkg, "Exhibit 1 - Pleading.pdf"), pdfBytes("[ ] a class action [x] lawyer for Plaintiffs"));
    writeFileSync(join(f.pkg, "Witness Statement of W. Ness - signed.pdf"), pdfBytes("as at [DATE] the WIP amounts to [___] hours and $[______]."));
    writeDocx(join(f.pkg, "Index of Exhibits.docx"), "Ex. 1 Statement of Account [allocation between heads to be confirmed]");
    const r = submissionFormsPreFilingCheck(f.dbPath, 1, f.pkg);
    const c2 = check("C2", r);
    assert.equal(c2.status, "fail");
    const signed = c2.findings.filter((x) => x.document === "Witness Statement of W. Ness - signed.pdf");
    assert.equal(signed.length, 3);
    assert.ok(signed.every((x) => x.severity === "high"));
    assert.ok(signed.every((x) => x.page === 1));
    assert.match(signed[0].quote, /as at \[DATE\]/);
    const index = c2.findings.filter((x) => x.document === "Index of Exhibits.docx");
    assert.equal(index.length, 1);
    assert.equal(index[0].severity, "normal");
    assert.ok(!c2.findings.some((x) => x.document.startsWith("Exhibit 1")));
  } finally {
    f.cleanup();
  }
});

test("isPlaceholder: pattern, not a list", () => {
  for (const s of ["[DATE]", "[___]", "[ ]", "[TBD]", "[to be confirmed]", "[WIP figures to be inserted before signing]", "[CLIENT NAME]", "[allocation between heads to be confirmed]"]) {
    assert.equal(isPlaceholder(s, ""), true, s);
  }
  assert.equal(isPlaceholder("[123456]", "$"), true, "$[123456]");
  for (const s of ["[...]", "[…]", "[sic]", "[emphasis added]", "[1998]", "[para. 33]", "[paras. 26, 34]", "[In Chambers]", "[12]", "[A]", "[the defendant]"]) {
    assert.equal(isPlaceholder(s, ""), false, s);
  }
});

/** Ex. 1 "Demand letter" dated 2024-01-05, Ex. 2 "Reply" dated 2024-01-19, and a $150,000 order sought. */
async function seedFigures(dbPath) {
  await seed(dbPath, ["Demand letter", "Reply"]);
  await submissionDataExecute(
    dbPath,
    `UPDATE documents SET document_date = '2024-01-05' WHERE id = 1;
     UPDATE documents SET document_date = '2024-01-19' WHERE id = 2;
     INSERT INTO order_sought (id, proceeding_id, wording, amount) VALUES (1, 1, 'Judgment for $150,000', 150000);
     INSERT INTO filing_orders (filing_id, order_sought_id, document, ordinal) VALUES (1, 1, 'written_argument', 1);`
  );
}

test("C3 flags a keyed date and a one-digit amount typo against the database, never a chronology date, citation year or pinpoint", async () => {
  const f = fixture();
  try {
    await seedFigures(f.dbPath);
    writeDocx(
      join(f.pkg, "Written Arguments.docx"),
      [
        "The demand letter (Exhibit 1) is dated January 6, 2024.",
        "On January 12, 2024 the parties spoke by phone.",
        "The Reply of January 19, 2024 is Exhibit 2.",
        "The claim is for $150,500, plus $15,000 interest.",
        "See Smith v Jones, 2019 BCSC 1123 at para. 150, and [2019] 3 SCR 5.",
      ].join("\n")
    );
    const r = submissionFormsPreFilingCheck(f.dbPath, 1, f.pkg);
    const c3 = check("C3", r);
    assert.equal(c3.status, "fail");
    assert.deepEqual(
      c3.findings.map((x) => [x.quote, x.problem, x.conflict]),
      [
        ["The claim is for $150,500, plus $15,000 interest.", "amount $150,500.00 is one digit off the order sought's $150,000.00", "order_sought #1: Judgment for $150,000"],
        ["The demand letter (Exhibit 1) is dated January 6, 2024.", "date January 6, 2024 differs from Ex. 1's document date 2024-01-05", "Ex. 1 — Demand letter (document_date 2024-01-05)"],
      ]
    );
  } finally {
    f.cleanup();
  }
});

test("C3 passes when anchored figures agree in any date style", async () => {
  const f = fixture();
  try {
    await seedFigures(f.dbPath);
    writeDocx(join(f.pkg, "Written Arguments.docx"), "The Demand letter of 5 January 2024 (Exhibit 1) claimed $150,000.00.\nExhibit 2 is dated 2024-01-19.");
    assert.equal(check("C3", submissionFormsPreFilingCheck(f.dbPath, 1, f.pkg)).status, "pass");
  } finally {
    f.cleanup();
  }
});

async function seedParties(dbPath) {
  await seed(dbPath, ["A"]);
  await submissionDataExecute(
    dbPath,
    `UPDATE proceedings SET file_number = 'VANIAC-2026-0412' WHERE id = 1;
     INSERT INTO parties (proceeding_id, name, role, ordinal) VALUES (1, 'Acme Holdings Ltd.', 'claimant', 1), (1, 'Jane Doe', 'respondent', 2);`
  );
}

const CLEAN_CAPTION = "ACME HOLDINGS LTD. v. JANE DOE\nFile No. VANIAC-2026-0412\nJane Doe signed the contract with Acme Holdings Ltd.";

test("C4 reports raw party-name and file-number variants against the database; case and whitespace pass", async () => {
  const f = fixture();
  try {
    await seedParties(f.dbPath);
    writeDocx(join(f.pkg, "Written Arguments.docx"), CLEAN_CAPTION);
    writeDocx(join(f.pkg, "Reply Submissions.docx"), "Acme Holding Limited and Jane  Doe\nFile No. VANIAC-2026-0421\nAlso styled VANIAC 2026 0412.\nCompare Action No. S-987654.");
    const c4 = check("C4", submissionFormsPreFilingCheck(f.dbPath, 1, f.pkg));
    assert.equal(c4.status, "fail");
    assert.deepEqual(
      c4.findings.map((x) => [x.document, x.problem, x.conflict]),
      [
        ["Reply Submissions.docx", 'party name styled "Acme Holding Limited"', 'parties.name "Acme Holdings Ltd."'],
        ["Reply Submissions.docx", 'file number styled "VANIAC 2026 0412"', 'proceedings.file_number "VANIAC-2026-0412"'],
        ["Reply Submissions.docx", 'file number styled "VANIAC-2026-0421"', 'proceedings.file_number "VANIAC-2026-0412"'],
      ]
    );
  } finally {
    f.cleanup();
  }
});

test("C4 passes when every name and file number matches the database", async () => {
  const f = fixture();
  try {
    await seedParties(f.dbPath);
    writeDocx(join(f.pkg, "Written Arguments.docx"), CLEAN_CAPTION);
    assert.equal(check("C4", submissionFormsPreFilingCheck(f.dbPath, 1, f.pkg)).status, "pass");
  } finally {
    f.cleanup();
  }
});

test("C5 fails blank execution blocks, a pending audit page and a missing instrument; deterministic", async () => {
  const f = fixture();
  try {
    await seed(f.dbPath, ["A"]);
    await submissionDataExecute(
      f.dbPath,
      `INSERT INTO witnesses (id, proceeding_id, name) VALUES (2, 1, 'J. Doe'), (3, 1, 'A. Smith');
       INSERT INTO documents (id, proceeding_id, label, instrument, deponent) VALUES (91, 1, 'Affidavit #1 of J. Doe', 'affidavit', 2), (92, 1, 'Witness Statement of A. Smith', 'witness_statement', 3);
       INSERT INTO filing_documents (filing_id, document_id, ordinal, role) VALUES (1, 91, 2, 'witness_statement'), (1, 92, 3, 'witness_statement');`
    );
    writeFileSync(join(f.pkg, "Witness Statement of W. Ness - signed.pdf"), pdfBytes(["1. I am the claimant.", "Name: [NAME]   Date: [DATE]"]));
    writeFileSync(
      join(f.pkg, "Affidavit #1 of J. Doe.pdf"),
      pdfBytes(["SWORN BEFORE ME at Vancouver on September 12, 2026.\nJ. Doe", "Final Audit Report\nStatus: Sent 2026-09-12\nDocument e-signed by J. Doe"])
    );
    // A signature sits over its rule; the underscores survive extraction and must not read as blank.
    writeFileSync(join(f.pkg, "Consent Order - signed.pdf"), pdfBytes("Dated September 1, 2026\nPer: ______________ J. Lawyer"));
    const a = submissionFormsPreFilingCheck(f.dbPath, 1, f.pkg);
    const b = submissionFormsPreFilingCheck(f.dbPath, 1, f.pkg);
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    const c5 = check("C5", a);
    assert.equal(c5.status, "fail");
    assert.ok(c5.findings.every((x) => x.severity === "high"));
    assert.deepEqual(
      c5.findings.map((x) => `${x.document} p${x.page}: ${x.problem}`),
      [
        'Affidavit #1 of J. Doe.pdf p2: e-signature audit status is "Sent", not completed or signed',
        "Witness Statement of A. Smith p1: the filing records this witness_statement, but no package file name begins with its label",
        "Witness Statement of W. Ness - signed.pdf p2: signer line is blank",
        "Witness Statement of W. Ness - signed.pdf p2: no execution date on the last page",
        "Witness Statement of W. Ness - signed.pdf p2: deponent W. Ness is not named on the last page",
      ]
    );
  } finally {
    f.cleanup();
  }
});

test("extractExhibitReferences expands ranges and lists", () => {
  const doc = { path: "", file_name: "x.pdf", kind: "pdf", pages: 1, text_by_page: ["Exhibits 13 to 16 and Exhibits 3 and 4, Ex. 1, Exhibits 5, 6 and 7."] };
  assert.deepEqual(extractExhibitReferences(doc).map((r) => r.number), [13, 14, 15, 16, 3, 4, 1, 5, 6, 7]);
});

test("C6 fails on a zero-byte exhibit file and reports page counts", async () => {
  const f = fixture();
  try {
    await seed(f.dbPath, ["A", "B"]);
    writeExhibits(f.pkg, 1);
    writeFileSync(join(f.pkg, "Exhibit 2 - Empty.pdf"), "");
    const r = submissionFormsPreFilingCheck(f.dbPath, 1, f.pkg);
    const c6 = check("C6", r);
    assert.equal(c6.status, "fail");
    assert.equal(c6.findings.length, 1);
    assert.equal(c6.findings[0].document, "Exhibit 2 - Empty.pdf");
    assert.match(c6.findings[0].problem, /0 bytes/);
    assert.deepEqual(c6.files, [{ file: "Exhibit 1 - Document 1.pdf", pages: 1 }, { file: "Exhibit 2 - Empty.pdf", pages: null }]);
    assert.equal(r.package_total_pages, 1);
  } finally {
    f.cleanup();
  }
});

test("package_dir confinement: outside 0. DRAFT, or inside privileged/, is refused", async () => {
  const f = fixture();
  try {
    await seed(f.dbPath, ["A"]);
    const outside = join(f.root, "elsewhere");
    mkdirSync(outside);
    assert.throws(() => submissionFormsPreFilingCheck(f.dbPath, 1, outside), /beneath the matter's 0\. DRAFT folder/);
    const priv = join(f.root, "0. DRAFT", "privileged", "pkg");
    mkdirSync(priv, { recursive: true });
    assert.throws(() => submissionFormsPreFilingCheck(f.dbPath, 1, priv), /privileged or disclosed/);
    const trashed = join(f.root, "0. DRAFT", "TRASH", "pkg");
    mkdirSync(trashed, { recursive: true });
    assert.throws(() => submissionFormsPreFilingCheck(f.dbPath, 1, trashed), /TRASH or 0\. CASE DATA/);
    assert.throws(() => submissionFormsPreFilingCheck(f.dbPath, 1, "relative/path"), /absolute/);
  } finally {
    f.cleanup();
  }
});

test("missing pypdf is a hard error naming the fix, never a pass", () => {
  const f = fixture();
  try {
    writeExhibits(f.pkg, 1);
    process.env.COCLERK_PREFILING_FORCE_NO_PYPDF = "1";
    assert.throws(() => extractDocuments([join(f.pkg, "Exhibit 1 - Document 1.pdf")]), /pypdf is not installed .* pip install pypdf/);
  } finally {
    delete process.env.COCLERK_PREFILING_FORCE_NO_PYPDF;
    f.cleanup();
  }
});
