// A mockup render archives every document the previous render's manifest listed that this render
// no longer writes (#1339): a re-snapshot after the type file's title changed, a witness removed, a
// companion dropped. Only listed files move; an unlisted file and archive/ are left alone, a listed
// file already gone is skipped, and one the sync client holds is left in place rather than failing the render.

import assert from "node:assert/strict";
import { closeSync, constants, existsSync, mkdirSync, openSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";

import { generalWritingFixture, LETTER_BLOCK, LETTER_FILE, NO_VENUE_TREE } from "./helpers/general-writing-fixture.mjs";
import { knowledgeFile } from "./helpers/knowledge-fixture.mjs";
import { seededDbFixture, seedVaniacProceeding } from "./fixtures/forms-render-seeds.mjs";

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute } = await import("../build/submission/backend.js");
const { submissionFormsRender } = await import("../build/submission/forms.js");
const { resnapshotWriting } = await import("../build/submission/writing-snapshot.js");

const CLIENT = { clientName: "Ada Client", clientNo: "0001", matterNo: "L0000" };
const NOW = "2026-09-25 10:00";
const JURISDICTION = { country: NO_VENUE_TREE.country, jurisdiction: NO_VENUE_TREE.jurisdiction };
const EXLOCK = 0x10000000; // libuv UV_FS_O_EXLOCK: an open that shares nothing, so a rename fails

const render = (dbPath, id, mode = "mockup") => submissionFormsRender(dbPath, id, CLIENT, mode, undefined, undefined, undefined, NOW);
const folderOf = (result) => dirname(result.documents[0].path);
const topLevelMd = (dir) => readdirSync(dir).filter((name) => name.endsWith(".md")).sort();
/** The stamped revision in filing `id`'s render manifest, in `0. DRAFT\Drafting records\` beside its Writing folder `dir`. */
const revisionOf = (dir, id) => JSON.parse(readFileSync(join(dirname(dir), "Drafting records", `render-manifest-${id}.json`), "utf-8")).stamp.revision;
const archived = (dir) => (existsSync(join(dir, "archive")) ? readdirSync(join(dir, "archive")) : []);

const UNCITED_LETTER = { ...LETTER_BLOCK, title: "Letter to opposing counsel", parts: LETTER_BLOCK.parts.map(({ rule_ref, ...rest }) => rest) };

async function letter(t) {
  const g = await generalWritingFixture(t, { front: null, block: UNCITED_LETTER });
  const { filing_id: id } = await g.createLetter();
  await g.prose(id, "addressee", "Cara Counsel");
  await g.prose(id, "body", "First paragraph of the letter.");
  return { g, id };
}

/** Renders the letter, retitles its type file and re-snapshots, so the next render writes a new file name. */
async function retitledLetter(t) {
  const { g, id } = await letter(t);
  const dir = folderOf(render(g.dbPath, id));
  assert.deepEqual(topLevelMd(dir), ["Letter to opposing counsel.md"]);
  g.f.local(LETTER_FILE, knowledgeFile(null, { ...UNCITED_LETTER, title: "Letter re costs" }));
  await resnapshotWriting(g.dbPath, id, { jurisdiction: JURISDICTION, seams: g.seams });
  return { g, id, dir };
}

test("a re-snapshot after the type title changed archives the old-title file, and leaves an unlisted file and archive/ where they are", async (t) => {
  const { g, id, dir } = await retitledLetter(t);
  const previous = revisionOf(dir, id);
  writeFileSync(join(dir, "My notes.md"), "practitioner's own notes", "utf-8");
  mkdirSync(join(dir, "archive"), { recursive: true });
  writeFileSync(join(dir, "archive", "Older copy.md"), "an earlier archive", "utf-8");

  render(g.dbPath, id);
  assert.deepEqual(topLevelMd(dir), ["Letter re costs.md", "My notes.md"]);
  const moved = archived(dir).filter((name) => name.startsWith("Letter re costs @rev"));
  assert.equal(moved.length, 1, "archived under the name the render now gives its document");
  assert.match(moved[0], new RegExp(`^Letter re costs @rev${previous} .+\\.md$`));
  assert.ok(archived(dir).includes("Older copy.md"));
});

test("a listed file already gone is skipped", async (t) => {
  const { g, id, dir } = await retitledLetter(t);
  render(g.dbPath, id, "filed");
  assert.ok(existsSync(join(dir, "Letter to opposing counsel.md")), "a filed render moves nothing");
  unlinkSync(join(dir, "Letter to opposing counsel.md"));

  render(g.dbPath, id);
  assert.deepEqual(topLevelMd(dir), ["Letter re costs.md"]);
  assert.deepEqual(archived(dir).filter((name) => name.startsWith("Letter re costs @rev")), []);
});

// UV_FS_O_EXLOCK denies sharing only on Windows, so elsewhere the rename would succeed and prove nothing.
test("a dropped file the sync client holds does not fail the render, and stays where it is", { skip: process.platform !== "win32" }, async (t) => {
  const { g, id, dir } = await retitledLetter(t);
  const old = join(dir, "Letter to opposing counsel.md");
  const fd = openSync(old, constants.O_RDONLY | EXLOCK);
  try {
    render(g.dbPath, id);
  } finally {
    closeSync(fd);
  }
  assert.ok(existsSync(join(dir, "Letter re costs.md")));
  assert.ok(existsSync(old));
  assert.deepEqual(archived(dir).filter((name) => name.startsWith("Letter re costs @rev")), []);
});

test("a memoisation hit moves nothing", async (t) => {
  const { g, id } = await letter(t);
  const dir = folderOf(render(g.dbPath, id));
  const before = readdirSync(dir).sort();
  render(g.dbPath, id);
  assert.deepEqual(readdirSync(dir).sort(), before);
  assert.deepEqual(archived(dir), []);
});

test("removing a witness from a VanIAC filing archives that witness's statement beside its stale siblings, none overwriting another", async (t) => {
  const f = seededDbFixture();
  t.after(f.cleanup);
  await freshSubmissionDb(f.dbPath);
  await seedVaniacProceeding(f.dbPath);
  const dir = folderOf(render(f.dbPath, 1));
  const statements = topLevelMd(dir).filter((name) => name.startsWith("Witness Statement - "));
  assert.equal(statements.length, 4);
  assert.ok(statements.includes("Witness Statement - J. Renwick.md"));

  await submissionDataExecute(f.dbPath, "DELETE FROM filing_documents WHERE filing_id = 1 AND document_id = 4;");
  render(f.dbPath, 1);
  assert.equal(topLevelMd(dir).includes("Witness Statement - J. Renwick.md"), false);
  // The dropped statement and the three stale ones share a type, a revision and a minute.
  const statementsArchived = archived(dir).filter((name) => name.startsWith("Witness Statement - "));
  assert.equal(statementsArchived.length, 4);
  assert.ok(statementsArchived.some((name) => name.startsWith("Witness Statement - J. Renwick @rev")), "each archived under its own file's name");
});
