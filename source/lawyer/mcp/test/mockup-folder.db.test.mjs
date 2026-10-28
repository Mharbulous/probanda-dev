// Each Writing's own folder in the matter's 0. DRAFT (spec 2026-10-22, writing file and folder names):
// named after the document, holding its one mockup file, its archive and its Milestone page, with the
// render manifests in `0. DRAFT\Drafting records\`. No user-visible path carries a stock type's name,
// a type's code or a filing id. A retitle keeps the folder, a second Writing with the same title gets
// ` (2)`, and an older build's case-data mockups tree moves into 0. DRAFT on the next bootstrap or
// render with nothing left behind. Temporary matter folders only, never a live matter.

import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import test from "node:test";

import { BCSC_TREE, generalWritingFixture, LETTER_BLOCK } from "./helpers/general-writing-fixture.mjs";

const { submissionFormsRender, submissionFormsBootstrap } = await import("../build/submission/forms.js");
const { submissionDataRecordSent } = await import("../build/submission/forms/sent-write.js");

const CLIENT = { clientName: "Ada Client", clientNo: "0001", matterNo: "L0000" };
const NOW = "2026-10-22 10:00";
const HEARING = "Notice of Hearing of Application";
/** What no user-visible path may hold (spec 2026-10-22 §8 criterion 2). */
const INTERNAL = /Unstructured|\bUNS\b|General_writing|Filing \d+/;

const render = (g, id, mode = "mockup", extra = {}) =>
  submissionFormsRender(g.dbPath, id, CLIENT, mode, extra.documents, undefined, extra.presentationDir, NOW, undefined, extra.draftDir);
const bootstrap = (g) => submissionFormsBootstrap(g.dbPath, CLIENT, NOW);
const renderState = (g, id) => bootstrap(g).filings.find((f) => f.filing_id === id).render_state;
const docOf = (result) => result.documents.find((d) => d.document_type === "General_writing");
const records = (g) => join(g.draft, "Drafting records");
const manifestOf = (g, id) => JSON.parse(readFileSync(join(records(g), `render-manifest-${id}.json`), "utf-8"));
const retitle = (g, id, title) => g.execute(`UPDATE filings SET title = '${title}' WHERE id = ${id};`);

/** Every path under `dir`, relative to it, folders included. */
function tree(dir) {
  return readdirSync(dir, { recursive: true }).map((p) => String(p));
}

/** A BC Supreme Court Unstructured Writing, created as the stock kind's miss route creates it. */
async function unstructured(g, title = HEARING) {
  await g.execute("UPDATE proceedings SET registry = 'Vancouver' WHERE id = 2;");
  const { filing_id } = await g.create({ proceeding_id: 2, tree: BCSC_TREE, kind: "unstructured", title });
  await g.prose(filing_id, "body", "TAKE NOTICE that the application will be heard.");
  return filing_id;
}

// Cites nothing: a Writing whose layout cites an item has live tags and never reads fresh.
const UNCITED_LETTER = { ...LETTER_BLOCK, title: "Letter to opposing counsel", parts: LETTER_BLOCK.parts.map(({ rule_ref, ...rest }) => rest) };

test("an Unstructured Writing renders into a folder named after the document, one file named after it, nothing internal in any path", async (t) => {
  const g = await generalWritingFixture(t);
  const id = await unstructured(g);

  const doc = docOf(render(g, id));
  assert.equal(doc.path, join(g.draft, HEARING, `${HEARING}.md`));
  assert.equal(doc.file_name, `${HEARING}.md`);
  assert.ok(existsSync(doc.path));
  assert.ok(doc.markdown.includes(`Document Type: ${HEARING}`), "the header names the document, not the stock type");
  assert.doesNotMatch(doc.markdown, /Unstructured/);
  assert.equal(manifestOf(g, id).folder, HEARING);
  assert.equal(manifestOf(g, id).files[0].label.short, HEARING, "the Milestone thumbnail prints the document's name");
  assert.equal(existsSync(join(dirname(g.dbPath), "mockups")), false, "nothing is written beside the database");
  for (const path of tree(g.draft)) assert.doesNotMatch(path, INTERNAL, path);
  assert.equal(renderState(g, id), "fresh");
});

test("two Unstructured Writings in one proceeding get the names of their own documents, a shared title disambiguated without an id", async (t) => {
  const g = await generalWritingFixture(t);
  const first = await unstructured(g);
  const second = await unstructured(g, "Notice of Withdrawal of Lawyer");
  const third = await unstructured(g);

  const paths = [first, second, third].map((id) => docOf(render(g, id)).path);
  assert.deepEqual(
    paths.map((p) => relative(g.draft, p)),
    [join(HEARING, `${HEARING}.md`), join("Notice of Withdrawal of Lawyer", "Notice of Withdrawal of Lawyer.md"), join(`${HEARING} (2)`, `${HEARING}.md`)]
  );
  assert.equal(new Set(paths).size, 3);
  for (const path of tree(g.draft)) assert.doesNotMatch(path, INTERNAL, path);
  // The second render of each writes back into its own folder.
  assert.equal(docOf(render(g, third)).path, paths[2]);
  assert.equal(docOf(render(g, first)).path, paths[0]);
});

test("a retitle keeps the Writing's folder and archives the old-named mockup under the new name, and the Sent write still finds the manifest", async (t) => {
  const g = await generalWritingFixture(t);
  const id = await unstructured(g);
  render(g, id);

  await retitle(g, id, "Notice of Hearing re Costs");
  assert.equal(renderState(g, id), "stale");
  await assert.rejects(
    submissionDataRecordSent({ db_path: g.dbPath, filing_id: id, sent_on: "2026-10-22", sent_copy_text: "x" }, g.seams.env),
    (err) => err.code === "render_first" && /changed after its mockup was last rendered/.test(err.message)
  );

  const doc = docOf(render(g, id));
  assert.equal(doc.path, join(g.draft, HEARING, "Notice of Hearing re Costs.md"), "the folder is kept; the file takes the new title");
  assert.equal(existsSync(join(g.draft, HEARING, `${HEARING}.md`)), false);
  const archived = readdirSync(join(g.draft, HEARING, "archive"));
  assert.equal(archived.length, 1);
  assert.match(archived[0], /^Notice of Hearing re Costs @rev\d+ /);
});

test("a render never overwrites a file it did not write, and never touches a Word document or PDF in the Writing's folder", async (t) => {
  const g = await generalWritingFixture(t);
  const id = await unstructured(g);
  const folder = join(g.draft, HEARING);
  mkdirSync(folder);
  writeFileSync(join(folder, `${HEARING}.md`), "the practitioner's own notes", "utf-8");
  assert.throws(() => render(g, id), /was not written by Probanda, so it is not overwritten/);
  assert.equal(readFileSync(join(folder, `${HEARING}.md`), "utf-8"), "the practitioner's own notes");

  rmSync(join(folder, `${HEARING}.md`));
  // The deliverables a publish wrote beside the mockup, the second one under its " vN" name.
  for (const name of [`${HEARING}.docx`, `${HEARING} v2.docx`, `${HEARING}.pdf`]) writeFileSync(join(folder, name), name, "utf-8");
  render(g, id);
  await g.prose(id, "addressee", "A change that moves the revision");
  render(g, id);
  for (const name of [`${HEARING}.docx`, `${HEARING} v2.docx`, `${HEARING}.pdf`]) assert.equal(readFileSync(join(folder, name), "utf-8"), name);
  assert.deepEqual(readdirSync(join(folder, "archive")).filter((n) => !n.endsWith(".md")), [], "only mockups are ever archived");
});

test("a render refuses, writing nothing, when two folders could each be the Writing's and none is recorded", async (t) => {
  const g = await generalWritingFixture(t);
  const id = await unstructured(g);
  mkdirSync(join(g.draft, HEARING));
  mkdirSync(join(g.draft, `2026-10-01 ${HEARING}`));
  assert.throws(() => render(g, id), (err) => err.code === "presentation_dir_ambiguous" && err.message.includes(`2026-10-01 ${HEARING}`));
  assert.equal(existsSync(records(g)), false);

  const chosen = join(g.draft, `2026-10-01 ${HEARING}`);
  const doc = docOf(render(g, id, "mockup", { presentationDir: chosen, documents: ["General_writing"] }));
  assert.equal(doc.path, join(chosen, `${HEARING}.md`));
  assert.equal(manifestOf(g, id).folder, `2026-10-01 ${HEARING}`);
  assert.equal(docOf(render(g, id)).path, doc.path, "the recorded folder is used from then on");
});

test("a matter with no 0. DRAFT folder lists its Writings as never rendered and refuses a mockup render", async (t) => {
  const g = await generalWritingFixture(t);
  const id = await unstructured(g);
  rmSync(g.draft, { recursive: true });
  assert.equal(renderState(g, id), "never");
  assert.throws(() => render(g, id), (err) => err.code === "draft_dir_missing");
  assert.ok(render(g, id, "filed"), "a filed render writes nothing, so it needs no folder");
});

/** The stored layout an older build snapshotted, which still carried the type's folder code. */
const olderSnapshot = (g, id) => g.execute(`UPDATE filings SET layout_snapshot = json_set(layout_snapshot, '$.layout.folder_code', 'UNS') WHERE id = ${id};`);

/** Puts a rendered Writing back in the layout an older build left: its mockup in
 * `<case data>\mockups\Filing <id>\` under the stock type's name with the old manifest and archive,
 * a presentation copy in `0. DRAFT\UNS <title>\`, and no new manifest. */
function asOlderBuild(g, id) {
  const manifest = manifestOf(g, id);
  const folder = join(g.draft, manifest.folder);
  const old = join(dirname(g.dbPath), "mockups", `Filing ${id}`);
  mkdirSync(join(old, "archive"), { recursive: true });
  const [file] = manifest.files;
  const text = readFileSync(join(folder, file.file_name), "utf-8");
  writeFileSync(join(old, "Unstructured.md"), text, "utf-8");
  writeFileSync(join(old, "archive", "General_writing @rev1 2026-10-01-09-00.md"), "Revision: 1\n", "utf-8");
  writeFileSync(join(old, "Milestone.html"), '<html data-workboard-shell data-k="Rev">1<', "utf-8");
  const { folder: _folder, ...rest } = manifest;
  writeFileSync(
    join(old, "render-manifest.json"),
    JSON.stringify({ ...rest, files: [{ ...file, file_name: "Unstructured.md", label: { short: "UNS", long: "Unstructured" } }] }),
    "utf-8"
  );
  const presentation = join(g.draft, `UNS ${manifest.folder}`);
  mkdirSync(presentation);
  writeFileSync(join(presentation, "Unstructured.md"), text, "utf-8");
  rmSync(folder, { recursive: true });
  rmSync(records(g), { recursive: true });
  return { old, text };
}

test("bootstrap moves an older build's case-data mockups tree into 0. DRAFT, renamed after the document, and leaves nothing behind", async (t) => {
  const g = await generalWritingFixture(t);
  const id = await unstructured(g);
  await olderSnapshot(g, id);
  render(g, id);
  const { old, text } = asOlderBuild(g, id);
  const root = join(dirname(g.dbPath), "mockups");
  // A second, older folder claiming the same filing, the pages' state file, a retired support file,
  // and a folder of a filing this database does not hold.
  cpSync(old, join(root, "Notice of Hearing (old title)"), { recursive: true });
  const older = JSON.parse(readFileSync(join(root, "Notice of Hearing (old title)", "render-manifest.json"), "utf-8"));
  writeFileSync(join(root, "Notice of Hearing (old title)", "render-manifest.json"), JSON.stringify({ ...older, stamp: { ...older.stamp, revision: 1 } }), "utf-8");
  writeFileSync(join(root, "matter-pages-state.json"), '{"sections":{}}\n', "utf-8");
  writeFileSync(join(root, "workboard.css"), "", "utf-8");
  mkdirSync(join(root, "Filing 99"));
  writeFileSync(join(root, "Filing 99", "Something.md"), "kept", "utf-8");

  const result = bootstrap(g);
  assert.equal(result.mockups_moved.length, 3);
  assert.equal(existsSync(root), false, "no mockups folder is left in case data");
  assert.equal(readdirSync(dirname(g.dbPath)).some((n) => /mockups/i.test(n)), false);

  const folder = join(g.draft, HEARING);
  assert.equal(readFileSync(join(folder, `${HEARING}.md`), "utf-8"), text, "the mockup moved under the document's name");
  assert.equal(existsSync(join(g.draft, `UNS ${HEARING}`)), false, "the older presentation folder was renamed, its copy replaced");
  assert.equal(manifestOf(g, id).folder, HEARING);
  assert.equal(manifestOf(g, id).files[0].file_name, `${HEARING}.md`);
  assert.ok(existsSync(join(records(g), "matter-pages-state.json")));
  assert.ok(existsSync(join(records(g), "Older mockups", "Filing 99", "Something.md")), "a folder of no filing is kept, in the records folder");
  const archived = readdirSync(join(folder, "archive")).sort();
  assert.equal(archived.length, 3, archived.join(", "));
  for (const name of archived) assert.match(name, new RegExp(`^${HEARING} @rev\\d+ `), name);
  for (const path of tree(g.draft).filter((p) => !p.startsWith(join("Drafting records", "Older mockups")))) assert.doesNotMatch(path, INTERNAL, path);
  assert.equal(renderState(g, id), "fresh", "the moved mockup is the one the manifest recorded");
  assert.equal(docOf(render(g, id)).path, join(folder, `${HEARING}.md`));
});

test("a render moves the older tree too, and keeps an older coded folder holding the practitioner's file, naming the rename it needs", async (t) => {
  const g = await generalWritingFixture(t);
  const id = await unstructured(g);
  await olderSnapshot(g, id);
  render(g, id);
  asOlderBuild(g, id);
  const coded = join(g.draft, `UNS ${HEARING}`);
  writeFileSync(join(coded, "Signed copy.pdf"), "the practitioner's own", "utf-8");

  const result = render(g, id);
  assert.equal(result.mockups_moved.length, 1);
  assert.equal(docOf(result).path, join(coded, `${HEARING}.md`), "the folder is kept, so nothing the renderer did not write is moved");
  assert.deepEqual(result.writing_folder_rename, { from: coded, to: join(g.draft, HEARING) });
  assert.equal(readFileSync(join(coded, "Signed copy.pdf"), "utf-8"), "the practitioner's own");
  assert.equal(existsSync(join(coded, "Unstructured.md")), false, "the older presentation copy gave way to the mockup");

  // Once the practitioner renames it, the next render finds it by the title.
  renameSync(coded, join(g.draft, HEARING));
  const again = render(g, id);
  assert.equal(docOf(again).path, join(g.draft, HEARING, `${HEARING}.md`));
  assert.equal(again.writing_folder_rename, undefined);
});

test("a letter's mockup is named after its type and its folder after the Writing, with the Milestone page in that folder", async (t) => {
  const g = await generalWritingFixture(t, { front: null, block: UNCITED_LETTER });
  const { filing_id: id } = await g.createLetter();
  await g.prose(id, "addressee", "Cara Counsel");
  await g.prose(id, "body", "First paragraph of the letter.");

  const result = render(g, id, "mockup", { draftDir: g.draft, documents: ["Work_board"] });
  assert.equal(docOf(result).path, join(g.draft, "Letter to Cara", "Letter to opposing counsel.md"));
  assert.equal(docOf(result).markdown, undefined, "under draft_dir only named documents carry markdown");
  const board = result.documents.find((d) => d.document_type === "Work_board");
  assert.equal(board.path, join(g.draft, "Letter to Cara", "Milestone.html"));
  for (const view of result.view_page_paths) assert.equal(dirname(view.path), join(g.draft, "Letter to Cara"), view.path);
  assert.ok(existsSync(join(g.draft, "Litigation Strategy.html")));
  for (const path of tree(g.draft)) assert.doesNotMatch(path, /Milestone \d|LTR /, path);
});
