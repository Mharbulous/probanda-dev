// Finding a matter's matter-data folder through the small locate driver (#186), which the files
// server runs without carrying case/backend.ts. The location search's own order is pinned by
// case-data-resolver.db.test.mjs. These pin the pointer read in front of it.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, normalize } from "node:path";
import test, { after } from "node:test";

import { writeCaseData } from "./helpers/matter-data-fixture.mjs";

const { caseDataFolder } = await import("../build/case/locate.js");

const scratches = [];
after(() => scratches.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const env = { ...process.env };
delete env.COCLERK_CASE_DATA_ROOT;

/** A matter folder holding one pointer file, `name`, with `pointer` as its content. */
function matter(name, pointer) {
  const scratch = mkdtempSync(join(tmpdir(), "coclerk-case-locate-"));
  scratches.push(scratch);
  const matterRoot = join(scratch, "T9999 Scratch Matter");
  mkdirSync(matterRoot, { recursive: true });
  writeFileSync(join(matterRoot, name), JSON.stringify(pointer(matterRoot, scratch)));
  return { matterRoot, scratch };
}

function assertSameFolder(actual, expected) {
  assert.equal(normalize(actual).toLowerCase(), normalize(expected).toLowerCase());
}

for (const name of ["probanda.json", "coclerk.json"]) {
  test(`a ${name} pointer's nominee holding main.sqlite is the folder`, () => {
    const { matterRoot, scratch } = matter(name, (root, base) => ({
      schema_version: 5,
      matter_root: root,
      case_data_dir: join(base, "Custom case data"),
    }));
    const custom = join(scratch, "Custom case data");
    mkdirSync(custom);
    writeCaseData(custom, "");
    assertSameFolder(caseDataFolder(matterRoot, env), custom);
  });
}

test("a pointer at the wrong schema_version is refused, naming both versions", () => {
  const { matterRoot } = matter("probanda.json", (root) => ({ schema_version: 4, matter_root: root }));
  assert.throws(
    () => caseDataFolder(matterRoot, env),
    /stale pointer -- re-run initialize \(the pointer is schema_version 4, expected 5\)/
  );
});

test("the matter's own 0. CASE DATA folder holding main.sqlite is the folder", () => {
  const { matterRoot } = matter("probanda.json", (root) => ({
    schema_version: 5,
    matter_root: root,
    case_data_dir: join(root, "missing"),
  }));
  const own = join(matterRoot, "0. CASE DATA");
  mkdirSync(own);
  writeCaseData(own, "");
  assertSameFolder(caseDataFolder(matterRoot, env), own);
});
