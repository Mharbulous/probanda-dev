// link_matter and matter_lookup's project_id: where a matter's folder is, relative to the
// litigation library when inside it, and which claude.ai Projects belong to the matter, so a session in a
// Project finds the matter root.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { startFakeCloud } from "./helpers/fake-cloud.mjs";

const { PracticeStore } = await import("../build/practice/store.js");
const reads = await import("../build/tools/practice/reads.js");
const writes = await import("../build/tools/practice/writes.js");

async function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-link-matter-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const library = join(dir, "library");
  const caseDataRoot = join(library, "0. CASE DATA");
  mkdirSync(caseDataRoot, { recursive: true });
  const appData = join(dir, "appdata");
  mkdirSync(join(appData, "Probanda"), { recursive: true });
  writeFileSync(join(appData, "Probanda", "probanda.json"), JSON.stringify({ case_data_root: caseDataRoot }));
  const cloud = await startFakeCloud(t);
  const store = new PracticeStore({ ...process.env, ...cloud.env, APPDATA: appData, COCLERK_CONFIG_PATH: "", COCLERK_DB_PATH: join(dir, `${randomUUID()}.db`) });
  await writes.upsert_client_matter(store, { client_num: "C-1", name: "Client 1", matt_num: "L101", file_number: "F-1" });
  await writes.upsert_client_matter(store, { client_num: "C-2", name: "Client 2", matt_num: "L202", file_number: "F-2" });
  return { store, library, dir };
}

test("a matter root is stored relative to the library and read back absolute", async (t) => {
  const { store, library } = await setup(t);
  const matterRoot = join(library, "L101 Example v Other");
  const row = await writes.link_matter(store, { matt_num: "L101", matter_root: matterRoot });
  assert.equal(row.folder, "L101 Example v Other", "never an absolute path");
  const [found] = (await reads.matter_lookup(store, { matt_num: "L101" })).rows;
  assert.equal(found.matter_root, matterRoot);
});

test("a matter root outside the library is stored absolute, and a moved matter re-records either way", async (t) => {
  const { store, library, dir } = await setup(t);
  const outside = join(dir, "second library", "L101 Example");
  const inside = join(library, "L101 Example");
  const lookup = async () => (await reads.matter_lookup(store, { matt_num: "L101" })).rows[0];
  await writes.link_matter(store, { matt_num: "L101", matter_root: inside });
  assert.equal((await writes.link_matter(store, { matt_num: "L101", matter_root: outside })).folder, outside);
  assert.equal((await lookup()).matter_root, outside);
  await writes.upsert_client_matter(store, { client_num: "C-1", matt_num: "L101", folder: inside });
  assert.deepEqual([(await lookup()).folder, (await lookup()).matter_root], ["L101 Example", inside]);
  await writes.upsert_client_matter(store, { client_num: "C-1", matt_num: "L101", folder: outside });
  assert.equal((await lookup()).matter_root, outside);
  await assert.rejects(writes.link_matter(store, { matt_num: "L101", matter_root: "L101 Example" }), /absolute path/);
});

test("a Project resolves to its matter and root; a matter holds several Projects, a Project one matter", async (t) => {
  const { store, library } = await setup(t);
  const matterRoot = join(library, "L101 Example v Other");
  await writes.link_matter(store, { matt_num: "L101", matter_root: matterRoot, project_id: "proj-a" });
  await writes.link_matter(store, { matt_num: "L101", project_id: "proj-b" });
  const again = await writes.link_matter(store, { matt_num: "L101", project_id: "proj-a" });
  assert.deepEqual(again.projects, ["proj-a", "proj-b"], "linking twice adds nothing");

  const { rows } = await reads.matter_lookup(store, { project_id: "proj-b" });
  assert.deepEqual(rows.map((row) => [row.matt_num, row.matter_root]), [["L101", matterRoot]]);
  assert.deepEqual((await reads.matter_lookup(store, { project_id: "proj-z" })).rows, []);

  await assert.rejects(writes.link_matter(store, { matt_num: "L202", project_id: "proj-a" }), /already linked to matter L101.*Nothing was saved/);
  const unlinked = await writes.link_matter(store, { matt_num: "L101", project_id: "proj-a", unlink_project: true });
  assert.deepEqual(unlinked.projects, ["proj-b"]);
  const moved = await writes.link_matter(store, { matt_num: "L202", project_id: "proj-a" });
  assert.deepEqual(moved.projects, ["proj-a"]);
});

test("a folder whose library cannot be resolved reads as a null matter_root that says why", async (t) => {
  const { store, library } = await setup(t);
  await writes.link_matter(store, { matt_num: "L101", matter_root: join(library, "L101 Example") });
  const broken = new PracticeStore({ ...store.env, APPDATA: join(library, "no appdata") });
  const [found] = (await reads.matter_lookup(broken, { matt_num: "L101" })).rows;
  assert.equal(found.matter_root, null);
  assert.match(found.matter_root_error, /probanda-setup/);
});

test("link_matter with neither matter_root nor project_id is refused", async (t) => {
  const { store } = await setup(t);
  await assert.rejects(writes.link_matter(store, { matt_num: "L101" }), /needs matter_root or project_id/);
});
