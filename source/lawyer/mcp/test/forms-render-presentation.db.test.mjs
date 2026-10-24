// Golden-fixture tests for the submission form renderers (build ticket #297): draft_dir and presentation_dir,
// the two ways a render names where it writes, since each Writing's mockups live in its own folder in the
// matter's 0. DRAFT (spec 2026-10-22 §9). draft_dir is the database's own draft folder and the render finds
// the Writing's folder in it; presentation_dir names that Writing folder itself. Either way a document
// comes back with its path and length, and with its markdown only when named in `documents`.
// Split out of the former forms-render.test.mjs; shared seeds live in fixtures/forms-render-seeds.mjs,
// which also documents regenerating the golden fixtures.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { seededDbFixture, seedVaniacProceeding, seedTickets, readBoardData, ASHBOURNE, draftFolder } from "./fixtures/forms-render-seeds.mjs";
const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute } = await import("../build/submission/backend.js");
const { submissionFormsRender } = await import("../build/submission/forms.js");
const { renderBoardSummary, TODOS_NOT_READ } = await import("../build/submission/matter-pages.js");

/** The VanIAC seed's Writing title, so the name of its folder. */
const TITLE = "Opening Submissions Package";
/** A Writing's own Job Board page, in its folder. */
const PAGE = "Job Board.html";

function renderFromDraft(f, draftDir, mode = "mockup", documents) {
  return submissionFormsRender(f.dbPath, 1, ASHBOURNE, mode, documents, undefined, undefined, undefined, undefined, draftDir);
}

function renderInto(f, presentationDir, mode = "mockup", documents) {
  return submissionFormsRender(f.dbPath, 1, ASHBOURNE, mode, documents, undefined, presentationDir);
}

const recordsOf = (draft) => join(draft, "Drafting records");
const manifestOf = (draft) => JSON.parse(readFileSync(join(recordsOf(draft), "render-manifest-1.json"), "utf-8"));
const advocacyOf = (result) => result.documents.filter((d) => d.document_type !== "Work_board");

/** The one section of the Writing's own Job Board page. */
function sectionIn(folder) {
  const page = readBoardData(join(folder, PAGE));
  assert.equal(page.sections.length, 1);
  return page.sections[0];
}

test("render with draft_dir writes every mockup and the Writing's pages into its folder, inline markdown only for named documents", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);
    const { draft, leaf } = draftFolder(f);

    const result = renderFromDraft(f, draft, "mockup", ["Evidence_index"]);

    assert.ok(advocacyOf(result).length > 1, "fixture should render several documents");
    assert.ok(result.rendered_at, "still a mockup render");
    for (const doc of result.documents) {
      if (doc.document_type === "Work_board") {
        assert.equal(doc.path, join(leaf, PAGE), "the board is the Writing's own page, in its folder");
        assert.equal(doc.markdown_chars, undefined, "the board's markup is never returned, so never measured");
        assert.equal(doc.board_summary, undefined, "not named, so no board_summary");
        continue;
      }
      assert.equal(doc.path, join(leaf, doc.file_name));
      assert.equal(doc.presentation_path, undefined, "the file in the Writing's folder is the only copy");
      const file = readFileSync(doc.path, "utf-8");
      assert.equal(doc.markdown_chars, file.length);
      if (doc.document_type === "Evidence_index") assert.equal(doc.markdown, file);
      else assert.equal(doc.markdown, undefined, `${doc.document_type} was not named, so no inline markdown`);
    }
    assert.ok(result.view_page_paths.length > 0, "the Writing's view pages are written");
    for (const view of result.view_page_paths) assert.equal(dirname(view.path), leaf, view.path);
    assert.deepEqual(readdirSync(draft).sort(), ["Drafting records", "Litigation Strategy.html", TITLE]);
    assert.equal(manifestOf(draft).folder, TITLE);
    for (const name of ["workboard.css", "workboard.js"]) assert.ok(!existsSync(join(draft, name)), `expected no ${name} in the draft folder`);
  } finally {
    f.cleanup();
  }
});

test("render with draft_dir writes into the Writing's folder again on the next render, and ignores another Writing's coded folder", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);
    const { draft, leaf } = draftFolder(f);
    mkdirSync(join(draft, `NOA ${TITLE}`)); // another kind's code is not a match

    const first = renderFromDraft(f, draft);
    const again = renderFromDraft(f, draft);

    for (const doc of advocacyOf(first)) assert.equal(doc.path, join(leaf, doc.file_name));
    assert.deepEqual(again.documents.map((d) => d.path), first.documents.map((d) => d.path));
    assert.deepEqual(readdirSync(join(draft, `NOA ${TITLE}`)), [], "the other folder is untouched");
  } finally {
    f.cleanup();
  }
});

test("render with draft_dir uses the one dated folder named for the Writing, and records it", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);
    const { draft, leaf } = draftFolder(f);
    const dated = join(draft, `2026-09-10 ${TITLE}`);
    mkdirSync(dated);

    const result = renderFromDraft(f, draft);

    for (const doc of advocacyOf(result)) assert.equal(doc.path, join(dated, doc.file_name));
    assert.ok(!existsSync(leaf), "no undated folder is made beside it");
    assert.equal(manifestOf(draft).folder, `2026-09-10 ${TITLE}`);
  } finally {
    f.cleanup();
  }
});

test("render refuses, writing nothing, when two or more folders could each be the Writing's, naming each and never a Superseded folder", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);
    const { draft, leaf } = draftFolder(f);
    const superseded = join(draft, "Superseded");
    mkdirSync(superseded);
    writeFileSync(join(superseded, "2024-04-20 AFF Smith DRAFT.pdf"), "%PDF-1.4 draft\n", "utf-8");
    mkdirSync(leaf);
    const dated = join(draft, `2026-09-10 ${TITLE}`);
    mkdirSync(dated);

    for (const render of [() => renderFromDraft(f, draft), () => submissionFormsRender(f.dbPath, 1, ASHBOURNE)]) {
      assert.throws(render, (err) => {
        assert.equal(err.code, "presentation_dir_ambiguous");
        assert.ok(err.message.includes(`"${leaf}"`), err.message);
        assert.ok(err.message.includes(`"${dated}"`), err.message);
        assert.ok(!err.message.includes("Superseded"), err.message);
        return true;
      });
    }
    assert.deepEqual(readdirSync(leaf), [], "nothing written");
    assert.deepEqual(readdirSync(dated), [], "nothing written");
    assert.ok(!existsSync(recordsOf(draft)), "no manifest written");
    assert.deepEqual(readdirSync(superseded), ["2024-04-20 AFF Smith DRAFT.pdf"]);

    const chosen = renderInto(f, dated);
    for (const doc of advocacyOf(chosen)) assert.equal(doc.path, join(dated, doc.file_name));
    assert.equal(manifestOf(draft).folder, `2026-09-10 ${TITLE}`);
    assert.deepEqual(renderFromDraft(f, draft).documents.map((d) => d.path), chosen.documents.map((d) => d.path), "the chosen folder is used from then on");
  } finally {
    f.cleanup();
  }
});

test("render refuses a draft_dir that is not the database's own draft folder, or one given with presentation_dir or in filed mode", async () => {
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
    const otherDraft = join(f.dir, "L4802 Other", "0. DRAFT");
    mkdirSync(otherDraft, { recursive: true });
    assert.throws(() => renderFromDraft(f, otherDraft), /not the 0\. DRAFT folder of this database's matter/);
    const privilegedDraft = join(f.dir, "privileged", "0. DRAFT");
    mkdirSync(privilegedDraft, { recursive: true });
    assert.throws(() => renderFromDraft(f, privilegedDraft), /privileged or disclosed/);
    const trashedDraft = join(f.dir, "TRASH", "0. DRAFT");
    mkdirSync(trashedDraft, { recursive: true });
    assert.throws(() => renderFromDraft(f, trashedDraft), /TRASH or 0\. CASE DATA/);
    assert.ok(!existsSync(leaf));
    assert.deepEqual(readdirSync(otherDraft), []);
  } finally {
    f.cleanup();
  }
});

test("render with presentation_dir writes into the Writing folder it names, dated or not, inline markdown only for named documents", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);
    const { draft, leaf } = draftFolder(f);

    const result = renderInto(f, leaf, "mockup", ["Evidence_index"]);
    for (const doc of advocacyOf(result)) {
      assert.equal(doc.path, join(leaf, doc.file_name));
      assert.equal(doc.presentation_path, undefined);
      const file = readFileSync(doc.path, "utf-8");
      assert.equal(doc.markdown_chars, file.length);
      if (doc.document_type === "Evidence_index") assert.equal(doc.markdown, file);
      else assert.equal(doc.markdown, undefined, `${doc.document_type} was not named, so no inline markdown`);
    }
    assert.equal(manifestOf(draft).folder, TITLE);
  } finally {
    f.cleanup();
  }

  const g = seededDbFixture();
  try {
    await freshSubmissionDb(g.dbPath);
    await seedVaniacProceeding(g.dbPath);
    const { draft, leaf } = draftFolder(g);
    const dated = join(draft, `2026-09-10 ${TITLE.toLowerCase()}`);

    const result = renderInto(g, dated);
    for (const doc of advocacyOf(result)) assert.equal(doc.path, join(dated, doc.file_name), "a leading date is allowed, and the title matched regardless of case");
    assert.ok(!existsSync(leaf));
    assert.equal(manifestOf(draft).folder, `2026-09-10 ${TITLE.toLowerCase()}`);
  } finally {
    g.cleanup();
  }
});

test("render refuses a presentation_dir that is misnamed or outside the database's own draft folder, writing nothing", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);
    const { draft, leaf } = draftFolder(f);

    assert.throws(() => renderInto(f, leaf, "filed"), /presentation_dir.*mockup/, "filed mode writes nothing to disk");
    assert.throws(() => renderInto(f, join(draft, `SUB ${TITLE}`)), new RegExp(`must be named "${TITLE}"`), "a type's code before the title is refused");
    assert.throws(() => renderInto(f, join(draft, "Some Other Filing")), new RegExp(`must be named "${TITLE}"`), "names the expected folder");
    assert.throws(() => renderInto(f, join(draft, "Superseded")), new RegExp(`must be named "${TITLE}"`));
    assert.throws(() => renderInto(f, join(f.dir, "L4801 Matter", "4. LAWYER BRIEF", TITLE)), /0\. DRAFT/);
    const otherDraft = join(f.dir, "L4802 Other", "0. DRAFT");
    mkdirSync(otherDraft, { recursive: true });
    assert.throws(() => renderInto(f, join(otherDraft, TITLE)), /0\. DRAFT folder of this database's matter/, "another matter's draft folder is refused");
    assert.throws(() => renderInto(f, join(f.dir, "Nowhere", "0. DRAFT", TITLE)), /0\. DRAFT/);
    assert.throws(() => renderInto(f, `0. DRAFT\\${TITLE}`), /absolute/);
    const privilegedDraft = join(f.dir, "privileged", "0. DRAFT");
    mkdirSync(privilegedDraft, { recursive: true });
    assert.throws(() => renderInto(f, join(privilegedDraft, TITLE)), /privileged or disclosed/);
    const junctionDraft = join(f.dir, "L4801 Other", "0. DRAFT");
    mkdirSync(dirname(junctionDraft), { recursive: true });
    symlinkSync(privilegedDraft, junctionDraft, "junction");
    assert.throws(() => renderInto(f, join(junctionDraft, TITLE)), /privileged or disclosed/, "judged by the real path, not the typed one");
    assert.ok(!existsSync(leaf), "no refusal creates the folder");
    assert.deepEqual(readdirSync(otherDraft), []);

    const elsewhere = join(f.dir, "outside");
    mkdirSync(elsewhere);
    symlinkSync(elsewhere, leaf, "junction");
    assert.throws(() => renderInto(f, leaf), /0\. DRAFT/, "a junction out of the draft folder is refused");
    assert.deepEqual(readdirSync(elsewhere), []);
    rmSync(leaf);
    assert.deepEqual(readdirSync(draft), [], "nothing was written in the draft folder");
    // Checked after the mockups are written, as it was when they were written beside the database.
    assert.throws(() => renderInto(f, leaf, "mockup", ["Nonexistent_doc"]), /no Nonexistent_doc/);
  } finally {
    f.cleanup();
  }
});

test("render refuses to overwrite a file in the Writing's folder that carries no render revision stamp, writing nothing", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);
    const { draft, leaf } = draftFolder(f);
    mkdirSync(leaf);
    writeFileSync(join(leaf, "Evidence Index.md"), "the practitioner's own notes\n", "utf-8");

    for (const render of [() => renderInto(f, leaf), () => renderFromDraft(f, draft)]) {
      assert.throws(render, /Evidence Index\.md was not written by Probanda, so it is not overwritten/);
    }
    assert.deepEqual(readdirSync(leaf), ["Evidence Index.md"], "refused before any file is written");
    assert.equal(readFileSync(join(leaf, "Evidence Index.md"), "utf-8"), "the practitioner's own notes\n");
    assert.ok(!existsSync(recordsOf(draft)), "no manifest written");
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

    await submissionDataExecute(f.dbPath, "UPDATE db_meta SET value = '2' WHERE key = 'revision';");
    const projected = renderInto(f, leaf);
    const fileStamps = advocacyOf(projected).flatMap((doc) => renderedStamps(readFileSync(doc.path, "utf-8")));
    assert.ok(fileStamps.length > 1, "fixture should print several Rendered stamps");
    for (const stamp of fileStamps) assert.equal(stamp, projected.rendered_at);

    assert.equal(submissionFormsRender(f.dbPath, 1, ASHBOURNE, "filed").rendered_at, undefined, "filed mode is unchanged");
  } finally {
    f.cleanup();
  }
});

test("render with presentation_dir rewrites its files in place on a revision change, archiving each previous one by its file's name", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);
    const { leaf } = draftFolder(f);

    const first = renderInto(f, leaf);
    await submissionDataExecute(f.dbPath, "UPDATE db_meta SET value = '2' WHERE key = 'revision';");
    const second = renderInto(f, leaf);

    assert.deepEqual(second.documents.map((d) => d.path), first.documents.map((d) => d.path), "written in place");
    for (const doc of advocacyOf(second)) assert.match(readFileSync(doc.path, "utf-8"), /^Revision: 2$/m, `${doc.file_name} refreshed to revision 2`);
    const archived = readdirSync(join(leaf, "archive"));
    for (const doc of advocacyOf(first)) {
      const stem = doc.file_name.replace(/\.md$/, "");
      assert.ok(archived.some((name) => name.startsWith(`${stem} @rev1 `)), `${doc.file_name} archived by its stem: ${archived.join(", ")}`);
    }
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

    const result = renderInto(f, leaf, "mockup", ["Work_board"]);

    const board = result.documents.find((d) => d.document_type === "Work_board");
    assert.equal(board.path, join(leaf, PAGE));
    assert.equal(board.presentation_path, undefined);
    assert.equal(board.board_summary, renderBoardSummary(sectionIn(leaf), ASHBOURNE, TODOS_NOT_READ), "named, so its summary comes back, the page's own section as text");
    assert.equal(board.markdown, undefined);
    for (const name of ["workboard.css", "workboard.js"]) assert.ok(!existsSync(join(draft, name)));
  } finally {
    f.cleanup();
  }
});

test("render of a retired filing with presentation_dir writes the matter's pages with no page for it, and no mockup", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);
    await submissionDataExecute(f.dbPath, "UPDATE filings SET decided_on = '2026-09-02', retired_on = '2026-09-10', retirement_reason = 'decided' WHERE id = 1;");
    const { draft, leaf } = draftFolder(f);

    const result = renderInto(f, leaf, "mockup", ["Work_board"]);

    assert.equal(result.filing_retired, true);
    assert.ok(!existsSync(leaf), "no mockup is refreshed for a retired filing");
    assert.deepEqual(readdirSync(draft).filter((name) => name !== "Drafting records"), ["Litigation Strategy.html"], "a retired filing has no Job Board page (D1)");
    const board = result.documents[0];
    assert.equal(board.path, undefined, "no page, so no path");
    assert.equal(board.file_name, PAGE, "no page, so the generic name, never a page that does not exist");
    assert.equal(board.pages_written, true);
    assert.match(board.board_summary, /^State: Retired 2026-09-10 — Retired on 2026-09-10 — decided$/m);
    assert.ok(!existsSync(join(draft, "workboard.css")));
  } finally {
    f.cleanup();
  }
});
