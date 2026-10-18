// Golden-fixture tests for the submission form renderers (build ticket #297): presentation copies: presentation_dir and draft_dir confinement and copying.
// Split out of the former forms-render.test.mjs; shared seeds live in fixtures/forms-render-seeds.mjs,
// which also documents regenerating the golden fixtures.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { seededDbFixture, seedVaniacProceeding, seedTickets, sectionOf, ASHBOURNE, draftFolder } from "./fixtures/forms-render-seeds.mjs";
const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute } = await import("../build/submission/backend.js");
const { submissionFormsRender } = await import("../build/submission/forms.js");
const { renderBoardSummary, TODOS_NOT_READ } = await import("../build/submission/matter-pages.js");

/** Filing 1's Job Board page (ADR 0033, 2026-10-05 amendment). */
const OPENING_PAGE = "Job Board 1.html";

test("render with presentation_dir writes every copy byte-identical to its canonical mockup, inline markdown only for named documents", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);
    const { draft, leaf } = draftFolder(f);

    const result = submissionFormsRender(f.dbPath, 1, ASHBOURNE, "mockup", ["Evidence_index"], undefined, leaf);

    assert.ok(result.documents.length > 2, "fixture should render several documents");
    assert.ok(result.rendered_at, "still a mockup render");
    for (const doc of result.documents) {
      if (doc.document_type === "Work_board") {
        assert.equal(doc.path, join(draft, OPENING_PAGE), "the board is the filing's page at the draft folder's top, never a presentation copy");
        assert.equal(doc.presentation_path, undefined);
        assert.equal(doc.markdown_chars, undefined, "the board's markup is never returned, so never measured");
        assert.equal(doc.board_summary, undefined, "not named, so no board_summary");
        assert.equal(readdirSync(leaf).some((name) => name.endsWith(".html")), false, "no board in the presentation folder");
        assert.ok(!existsSync(join(leaf, "workboard-data.js")));
        continue;
      }
      const canonical = readFileSync(doc.path, "utf-8");
      assert.equal(doc.presentation_path, join(leaf, doc.file_name));
      assert.equal(readFileSync(doc.presentation_path, "utf-8"), canonical, `${doc.file_name}: copy must match the canonical mockup byte-for-byte`);
      assert.equal(doc.markdown_chars, canonical.length);
      if (doc.document_type === "Evidence_index") assert.equal(doc.markdown, canonical);
      else assert.equal(doc.markdown, undefined, `${doc.document_type} was not named, so no inline markdown`);
    }
    for (const name of ["workboard.css", "workboard.js"]) assert.ok(!existsSync(join(draft, name)), `expected no ${name} in the draft folder`);
  } finally {
    f.cleanup();
  }
});

// #689: given draft_dir, the server resolves the presentation folder itself: none, one undated, one dated, two or more.
function renderFromDraft(f, draftDir, mode = "mockup") {
  return submissionFormsRender(f.dbPath, 1, ASHBOURNE, mode, undefined, undefined, undefined, undefined, undefined, draftDir);
}

test("render with draft_dir and no presentation folder yet creates the undated one", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);
    const { draft, leaf } = draftFolder(f);
    mkdirSync(join(draft, "NOA Opening Submissions Package")); // another kind's code is not a match

    const result = renderFromDraft(f, draft);

    assert.ok(result.documents.length > 2);
    for (const doc of result.documents.filter((d) => d.document_type !== "Work_board")) assert.equal(doc.presentation_path, join(leaf, doc.file_name));
  } finally {
    f.cleanup();
  }
});

test("render with draft_dir uses the one undated presentation folder", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);
    const { draft, leaf } = draftFolder(f);
    const first = renderFromDraft(f, draft);
    const again = renderFromDraft(f, draft);

    assert.deepEqual(again.documents.map((d) => d.presentation_path), first.documents.map((d) => d.presentation_path));
    assert.deepEqual(readdirSync(draft).sort(), ["Arguments - Job Board 1.html", OPENING_PAGE, "Litigation Strategy.html", "Loose Threads - Job Board 1.html", "Provable Facts - Job Board 1.html", "Raw Research - Job Board 1.html", "SUB Opening Submissions Package"]);
    assert.equal(readdirSync(leaf).some((name) => name.endsWith(".html")), false, "the board is the filing's page at the draft folder's top, not a presentation copy");
  } finally {
    f.cleanup();
  }
});

test("render with draft_dir refuses one dated presentation folder, reporting whether it is renameable, writing nothing", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);
    const { draft, leaf } = draftFolder(f);
    submissionFormsRender(f.dbPath, 1, ASHBOURNE, "mockup", undefined, undefined, leaf);
    const dated = join(draft, "2026-09-10 SUB Opening Submissions Package");
    renameSync(leaf, dated);
    const before = readdirSync(dated).sort();

    assert.throws(() => renderFromDraft(f, draft), (err) => {
      assert.equal(err.code, "presentation_dir_dated");
      assert.ok(err.message.includes(`"${dated}" (dated, renameable: yes)`), err.message);
      return true;
    });
    assert.ok(!existsSync(leaf), "no folder created");
    assert.deepEqual(readdirSync(dated).sort(), before, "the dated folder is untouched");

    writeFileSync(join(dated, "notes.docx"), "the practitioner's own file", "utf-8");
    assert.throws(() => renderFromDraft(f, draft), /\(dated, renameable: no\)/, "a file this renderer did not write blocks the rename");

    const bare = join(draft, "2026-09-11 SUB Opening Submissions Package");
    renameSync(dated, bare);
    rmSync(join(bare, "notes.docx"));
    writeFileSync(join(bare, "Work Board.html"), '<!doctype html>\n<html lang="en" data-workboard-shell>\n', "utf-8");
    assert.throws(() => renderFromDraft(f, draft), /\(dated, renameable: yes\)/, "a board an older render left there is this renderer's own file");

    const lower = join(draft, "2026-09-11 sub opening submissions package");
    renameSync(bare, lower);
    assert.throws(() => renderFromDraft(f, draft), { code: "presentation_dir_dated" }, "matched regardless of case");

    for (const name of readdirSync(lower)) rmSync(join(lower, name));
    assert.throws(() => renderFromDraft(f, draft), /\(dated, renameable: no\)/, "an empty folder is not renameable");
  } finally {
    f.cleanup();
  }
});

test("a Superseded folder holding a PDF beside the presentation folder is never taken or named as one", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);
    const { draft, leaf } = draftFolder(f);
    const superseded = join(draft, "Superseded");
    mkdirSync(superseded);
    writeFileSync(join(superseded, "2024-04-20 AFF Smith DRAFT.pdf"), "%PDF-1.4 draft\n", "utf-8");

    const result = renderFromDraft(f, draft);

    for (const doc of result.documents.filter((d) => d.document_type !== "Work_board")) assert.equal(doc.presentation_path, join(leaf, doc.file_name));
    assert.deepEqual(readdirSync(superseded), ["2024-04-20 AFF Smith DRAFT.pdf"]);
    assert.equal(readFileSync(join(superseded, "2024-04-20 AFF Smith DRAFT.pdf"), "utf-8"), "%PDF-1.4 draft\n");

    for (const dated of ["2026-09-10 SUB Opening Submissions Package", "2026-09-11 SUB Opening Submissions Package"]) {
      mkdirSync(join(draft, dated));
      assert.throws(() => renderFromDraft(f, draft), (err) => {
        assert.ok(["presentation_dir_dated", "presentation_dir_ambiguous"].includes(err.code), err.code);
        assert.ok(!err.message.includes("Superseded"), err.message);
        return true;
      });
    }
  } finally {
    f.cleanup();
  }
});

test("render with draft_dir refuses two or more presentation folders, naming each", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);
    const { draft, leaf } = draftFolder(f);
    mkdirSync(leaf);
    const dated = join(draft, "2026-09-10 SUB Opening Submissions Package");
    mkdirSync(dated);

    assert.throws(() => renderFromDraft(f, draft), (err) => {
      assert.equal(err.code, "presentation_dir_ambiguous");
      assert.ok(err.message.includes(`"${leaf}" (undated)`), err.message);
      assert.ok(err.message.includes(`"${dated}" (dated, renameable: no)`), err.message);
      return true;
    });
    assert.deepEqual(readdirSync(leaf), [], "nothing written");
  } finally {
    f.cleanup();
  }
});

test("render refuses a draft_dir it cannot confine, or one given with presentation_dir or in filed mode", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);
    const { draft, leaf } = draftFolder(f);

    assert.throws(() => renderFromDraft(f, draft, "filed"), /draft_dir is mockup mode only/);
    assert.throws(
      () => submissionFormsRender(f.dbPath, 1, ASHBOURNE, "mockup", undefined, undefined, leaf, undefined, undefined, draft),
      /draft_dir or presentation_dir, never both/
    );
    const brief = join(f.dir, "L4801 Matter", "4. LAWYER BRIEF");
    mkdirSync(brief);
    assert.throws(() => renderFromDraft(f, brief), /draft_dir.*0\. DRAFT folder/);
    const privilegedDraft = join(f.dir, "privileged", "0. DRAFT");
    mkdirSync(privilegedDraft, { recursive: true });
    assert.throws(() => renderFromDraft(f, privilegedDraft), /privileged or disclosed/);
    assert.ok(!existsSync(leaf));
  } finally {
    f.cleanup();
  }
});

// #548: a caller reads the Rendered stamp off the render response rather than a second clock read.
function renderedStamps(text) {
  return [...text.matchAll(/^Rendered: (.*)$/gm), ...text.matchAll(/"rendered":"([^"]*)"/g)].map((m) => m[1]);
}

test("a successful mockup render returns rendered_at, equal to the Rendered stamp it printed", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);
    const { leaf } = draftFolder(f);

    const inline = submissionFormsRender(f.dbPath, 1, ASHBOURNE, "mockup");
    assert.match(inline.rendered_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    const inlineStamps = inline.documents.flatMap((doc) => renderedStamps(doc.markdown ?? ""));
    assert.ok(inlineStamps.length > 1, "fixture should print several Rendered stamps");
    for (const stamp of inlineStamps) assert.equal(stamp, inline.rendered_at);

    const projected = submissionFormsRender(f.dbPath, 1, ASHBOURNE, "mockup", undefined, undefined, leaf);
    const copies = projected.documents.filter((doc) => doc.document_type !== "Work_board");
    const copyStamps = copies.flatMap((doc) => renderedStamps(readFileSync(doc.presentation_path, "utf-8")));
    assert.ok(copyStamps.length > 1, "fixture should print several Rendered stamps");
    for (const stamp of copyStamps) assert.equal(stamp, projected.rendered_at);

    assert.equal(submissionFormsRender(f.dbPath, 1, ASHBOURNE, "filed").rendered_at, undefined, "filed mode is unchanged");
  } finally {
    f.cleanup();
  }
});

test("render with presentation_dir overwrites its own copies in place on a revision change, never archiving them", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);
    const { leaf } = draftFolder(f);

    submissionFormsRender(f.dbPath, 1, ASHBOURNE, "mockup", undefined, undefined, leaf);
    await submissionDataExecute(f.dbPath, "UPDATE db_meta SET value = '2' WHERE key = 'revision';");
    const second = submissionFormsRender(f.dbPath, 1, ASHBOURNE, "mockup", undefined, undefined, leaf);

    for (const doc of second.documents.filter((d) => d.document_type !== "Work_board")) {
      assert.equal(readFileSync(doc.presentation_path, "utf-8"), readFileSync(doc.path, "utf-8"), `${doc.file_name} refreshed to revision 2`);
    }
    assert.ok(!existsSync(join(leaf, "archive")), "a disposable projection is overwritten, not archived");
  } finally {
    f.cleanup();
  }
});

test("render with presentation_dir returns the board's summary, never its markup, when the board is named", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);
    await seedTickets(f.dbPath);
    const { draft, leaf } = draftFolder(f);

    const result = submissionFormsRender(f.dbPath, 1, ASHBOURNE, "mockup", ["Work_board"], undefined, leaf);

    const board = result.documents.find((d) => d.document_type === "Work_board");
    assert.equal(board.path, join(draft, OPENING_PAGE));
    assert.equal(board.presentation_path, undefined);
    assert.equal(board.board_summary, renderBoardSummary(sectionOf(draft, 1), ASHBOURNE, TODOS_NOT_READ), "named, so its summary comes back, the page's own section as text");
    assert.equal(board.markdown, undefined);
    assert.equal(readdirSync(leaf).some((name) => name.endsWith(".html")), false);
    for (const name of ["workboard.css", "workboard.js"]) assert.ok(!existsSync(join(draft, name)));
  } finally {
    f.cleanup();
  }
});

test("render of a retired filing with presentation_dir writes the matter's pages with no page for it, and no presentation copy", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);
    await submissionDataExecute(f.dbPath, "UPDATE filings SET decided_on = '2026-09-02', retired_on = '2026-09-10', retirement_reason = 'decided' WHERE id = 1;");
    const { draft, leaf } = draftFolder(f);

    const result = submissionFormsRender(f.dbPath, 1, ASHBOURNE, "mockup", ["Work_board"], undefined, leaf);

    assert.equal(result.filing_retired, true);
    assert.ok(!existsSync(leaf), "no advocacy copy is refreshed for a retired filing");
    assert.deepEqual(readdirSync(draft), ["Litigation Strategy.html"], "a retired filing has no Job Board page (D1)");
    const board = result.documents[0];
    assert.equal(board.path, undefined, "no page, so no path");
    assert.equal(board.file_name, "Job Board.html", "no page, so the generic name, never a page that does not exist");
    assert.equal(board.pages_written, true);
    assert.match(board.board_summary, /^State: Retired 2026-09-10 — Retired on 2026-09-10 — decided$/m);
    assert.ok(!existsSync(join(draft, "workboard.css")));
  } finally {
    f.cleanup();
  }
});

test("render refuses a presentation_dir it cannot confine, writing no copy", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);
    const { draft, leaf } = draftFolder(f);
    const render = (dir, mode = "mockup", docs) => submissionFormsRender(f.dbPath, 1, ASHBOURNE, mode, docs, undefined, dir);

    assert.throws(() => render(leaf, "filed"), /presentation_dir.*mockup/, "filed mode writes nothing to disk");
    assert.throws(() => render(join(f.dir, "L4801 Matter", "4. LAWYER BRIEF", "SUB Opening Submissions Package")), /0\. DRAFT/);
    assert.throws(() => render(join(f.dir, "Nowhere", "0. DRAFT", "SUB Opening Submissions Package")), /0\. DRAFT/);
    assert.throws(() => render(join(draft, "SUB Some Other Filing")), / Opening Submissions Package/, "names the expected folder ending");
    assert.throws(() => render("0. DRAFT\\SUB Opening Submissions Package"), /absolute/);
    assert.throws(() => render(leaf, "mockup", ["Nonexistent_doc"]), /no Nonexistent_doc/);
    const privilegedDraft = join(f.dir, "privileged", "0. DRAFT");
    mkdirSync(privilegedDraft, { recursive: true });
    assert.throws(() => render(join(privilegedDraft, "SUB Opening Submissions Package")), /privileged or disclosed/);
    const junctionDraft = join(f.dir, "L4801 Other", "0. DRAFT");
    mkdirSync(dirname(junctionDraft), { recursive: true });
    symlinkSync(privilegedDraft, junctionDraft, "junction");
    assert.throws(() => render(join(junctionDraft, "SUB Opening Submissions Package")), /privileged or disclosed/, "judged by the real path, not the typed one");
    assert.ok(!existsSync(leaf), "no refusal creates the folder");

    const elsewhere = join(f.dir, "outside");
    mkdirSync(elsewhere);
    symlinkSync(elsewhere, leaf, "junction");
    assert.throws(() => render(leaf), /0\. DRAFT/, "a junction out of the draft folder is refused");
    assert.deepEqual(readdirSync(elsewhere), []);
    rmSync(leaf);

    mkdirSync(leaf);
    writeFileSync(join(leaf, "Evidence Index.md"), "the practitioner's own notes\n", "utf-8");
    assert.throws(() => render(leaf), /Evidence Index\.md/, "never overwrites a file this renderer did not write");
    assert.deepEqual(readdirSync(leaf), ["Evidence Index.md"], "refused before any copy is written");
  } finally {
    f.cleanup();
  }
});
