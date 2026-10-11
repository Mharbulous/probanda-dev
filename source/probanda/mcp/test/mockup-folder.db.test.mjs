// The canonical mockup folder is keyed by filing id (#1317, ADR 0017's 2026-10-01 amendment):
// `<dirname(db)>/mockups/Filing <id>/`, so a retitle never moves a filing's mockups, manifest or
// archive/, and a later filing given an old title never inherits another filing's folder. A
// title-keyed folder an earlier build wrote is found by the filing id its manifest names, and the
// next mockup render renames it to the id folder.

import assert from "node:assert/strict";
import { cpSync, existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";

import { generalWritingFixture, LETTER_BLOCK } from "./helpers/general-writing-fixture.mjs";

const { submissionFormsRender, submissionFormsBootstrap } = await import("../build/submission/forms.js");
const { submissionDataRecordSent } = await import("../build/submission/forms/sent-write.js");

const CLIENT = { clientName: "Ada Client", clientNo: "0001", matterNo: "L0000" };
const NOW = "2026-09-25 10:00";

const render = (g, id, mode = "mockup") => submissionFormsRender(g.dbPath, id, CLIENT, mode, undefined, undefined, undefined, NOW);
const renderState = (g, id) => submissionFormsBootstrap(g.dbPath, CLIENT, NOW).filings.find((f) => f.filing_id === id).render_state;
const retitle = (g, id, title) => g.execute(`UPDATE filings SET title = '${title}' WHERE id = ${id};`);
const send = (g, id) => submissionDataRecordSent({ db_path: g.dbPath, filing_id: id, sent_on: "2026-09-25", sent_copy_text: "Dear Cara" }, g.seams.env);
const mockups = (g) => join(dirname(g.dbPath), "mockups");
const idFolder = (g, id) => join(mockups(g), `Filing ${id}`);
const manifestOf = (dir) => JSON.parse(readFileSync(join(dir, "render-manifest.json"), "utf-8"));
const folderOf = (result) => dirname(result.documents.find((d) => d.document_type === "General_writing").path);

// Cites nothing: a Writing whose layout cites an item has live tags and never reads fresh.
const UNCITED_LETTER = { ...LETTER_BLOCK, title: "Letter to opposing counsel", parts: LETTER_BLOCK.parts.map(({ rule_ref, ...rest }) => rest) };

async function letter(t) {
  const g = await generalWritingFixture(t, { front: null, block: UNCITED_LETTER });
  const { filing_id: id } = await g.createLetter();
  await g.prose(id, "addressee", "Cara Counsel");
  await g.prose(id, "body", "First paragraph of the letter.");
  return { g, id };
}

test("a filing renders into Filing <id>, and a retitle keeps its mockups, manifest and archive there", async (t) => {
  const { g, id } = await letter(t);
  assert.equal(folderOf(render(g, id)), idFolder(g, id));
  assert.equal(renderState(g, id), "fresh");

  await retitle(g, id, "Letter to Cara re costs");
  // The retitle moved the revision, so the filing reads stale -- as it would have under its old title -- never "never".
  assert.equal(renderState(g, id), "stale");
  // The Sent write finds the latest manifest without a re-render: it refuses for the revision, not for a missing render.
  await assert.rejects(send(g, id), (err) => err.code === "render_first" && /older than the Writing's revision/.test(err.message));

  assert.equal(folderOf(render(g, id)), idFolder(g, id), "the next render writes into the same folder");
  assert.equal(manifestOf(idFolder(g, id)).stamp.filing_id, id);
  assert.ok(readdirSync(join(idFolder(g, id), "archive")).length > 0, "the earlier render's copies archived beside it");
  assert.deepEqual(readdirSync(mockups(g)).sort(), [`Filing ${id}`], "no title-named folder is left behind");
});

test("a new filing given an earlier filing's former title writes and archives only into its own folder", async (t) => {
  const { g, id: first } = await letter(t);
  render(g, first);
  await retitle(g, first, "Letter to Cara re costs");
  const before = readdirSync(idFolder(g, first)).sort();

  const { filing_id: second } = await g.createLetter();
  await g.prose(second, "body", "Another letter.");
  assert.equal(folderOf(render(g, second)), idFolder(g, second));
  assert.deepEqual(readdirSync(idFolder(g, first)).sort(), before, "the first filing's folder is untouched");
  assert.equal(existsSync(join(idFolder(g, second), "archive")), false, "nothing of the first filing was archived into the second's folder");
});

test("a title-keyed folder from an earlier build is still found, then renamed to Filing <id> on the next mockup render", async (t) => {
  const { g, id } = await letter(t);
  render(g, id);
  // The layout an earlier build left: the folder named after a title the filing no longer has.
  const legacy = join(mockups(g), "Letter to Cara (old title)");
  renameSync(idFolder(g, id), legacy);

  assert.equal(renderState(g, id), "fresh", "bootstrap reads the legacy folder by the filing id its manifest names");
  render(g, id, "filed");
  assert.ok(existsSync(legacy), "a filed render writes nothing, so it migrates nothing");

  assert.equal(folderOf(render(g, id)), idFolder(g, id));
  assert.equal(existsSync(legacy), false, "the legacy folder was renamed, not copied");
  assert.equal(manifestOf(idFolder(g, id)).stamp.filing_id, id);
});

test("of two title-keyed folders claiming one filing, the later render's is the one found and migrated", async (t) => {
  const { g, id } = await letter(t);
  render(g, id);
  const older = join(mockups(g), "Letter to Cara");
  cpSync(idFolder(g, id), older, { recursive: true });
  await g.execute(`UPDATE filing_prose SET text = 'A changed paragraph.' WHERE filing_id = ${id} AND slot = 'body';`);
  render(g, id);
  const newer = join(mockups(g), "Letter to Cara re costs");
  renameSync(idFolder(g, id), newer);
  const latest = manifestOf(newer).stamp.revision;
  assert.ok(manifestOf(older).stamp.revision < latest);

  assert.equal(renderState(g, id), "fresh", "the newer folder's manifest is the one read");
  render(g, id);
  assert.equal(existsSync(newer), false);
  assert.ok(existsSync(older), "the older claimant is left as it was");
  assert.equal(manifestOf(idFolder(g, id)).stamp.revision, latest);
});

test("a render refuses to write into a Filing <id> folder whose manifest names another filing", async (t) => {
  const { g, id } = await letter(t);
  render(g, id);
  const file = join(idFolder(g, id), "render-manifest.json");
  const manifest = manifestOf(idFolder(g, id));
  writeFileSync(file, JSON.stringify({ ...manifest, stamp: { ...manifest.stamp, filing_id: id + 1 } }), "utf-8");
  assert.throws(() => render(g, id), new RegExp(`names filing ${id + 1}`));
});
