// The one case-data resolver (issue #177): the matter-data skill's case_data_resolver.py, which
// resolve_paths.py imports and the build pastes into case/backend.ts. These cases run it through the
// backend's `locate` op, the cases test_resolve_paths.py runs through resolve_paths, so both readers
// are held to the same behaviour (ADR 0013's order).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, normalize } from "node:path";
import test, { after } from "node:test";

import { resolverText } from "../scripts/resolver.mjs";

const { caseDataFolder } = await import("../build/case/backend.js");

const scratches = [];
after(() => scratches.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

// The firm root is derived from the matter folder's parent, never the developer's override.
const env = { ...process.env };
delete env.COCLERK_CASE_DATA_ROOT;

function writeDb(folder, metadata) {
  mkdirSync(folder, { recursive: true });
  const python = process.env.COCLERK_PYTHON || "python";
  const result = spawnSync(
    python,
    ["-c", "import json,sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute('PRAGMA user_version = 90'); m=json.loads(sys.argv[2]); c.execute('CREATE TABLE matter_metadata(key TEXT PRIMARY KEY, value TEXT)') if m else None; c.executemany('INSERT INTO matter_metadata VALUES (?, ?)', m.items()) if m else None; c.commit(); c.close()",
      join(folder, "main.sqlite"), JSON.stringify(metadata ?? {})],
    { encoding: "utf-8" },
  );
  if (result.status !== 0) throw new Error(`fixture Python failed: ${result.stderr}`);
}

/** A litigation library holding one matter folder whose pointer stores `stored`. */
function library(matterFolder = "T9999 Scratch Matter") {
  const scratch = mkdtempSync(join(tmpdir(), "coclerk-case-resolver-"));
  scratches.push(scratch);
  const litigation = join(scratch, "Litigation - Documents");
  const matterRoot = join(litigation, matterFolder);
  mkdirSync(matterRoot, { recursive: true });
  const pointer = (stored) => writeFileSync(join(matterRoot, "probanda.json"), JSON.stringify({
    schema_version: 5,
    matter_root: matterRoot,
    case_data_dir: stored,
    evidence_sql_path: join("0. CASE DATA", "evidence.sql"),
  }));
  return { litigation, matterRoot, firmRoot: join(litigation, "0. CASE DATA"), pointer };
}

const CASES = [
  {
    name: "a stored nominee holding main.sqlite wins",
    arrange: ({ litigation, pointer }) => {
      const custom = join(litigation, "Custom case data");
      writeDb(custom);
      pointer(custom);
      return custom;
    },
  },
  {
    name: "the matter's own 0. CASE DATA, when the nominee holds no database",
    arrange: ({ matterRoot, pointer }) => {
      const own = join(matterRoot, "0. CASE DATA");
      writeDb(own);
      pointer(join(matterRoot, "missing"));
      return own;
    },
  },
  {
    name: "a not-yet-relocated firm-root folder, found by matter id after the matter folder was renamed",
    folder: "T9999 Renamed Matter",
    arrange: ({ firmRoot, pointer }) => {
      const old = join(firmRoot, "T9999 Scratch Matter");
      writeDb(old, { matter_id: "T9999", short_name: "Scratch Matter" });
      pointer("missing");
      return old;
    },
  },
  {
    name: "a not-yet-relocated firm-root folder, by its old derived name, even without main.sqlite",
    arrange: ({ firmRoot, pointer }) => {
      const old = join(firmRoot, "T9999 Scratch Matter");
      mkdirSync(old, { recursive: true });
      pointer("missing");
      return old;
    },
  },
  {
    name: "the matter's own 0. CASE DATA as the default, when nothing exists",
    arrange: ({ matterRoot, pointer }) => {
      pointer("missing");
      return join(matterRoot, "0. CASE DATA");
    },
  },
];

for (const c of CASES) {
  test(`locate: ${c.name}`, () => {
    const lib = library(c.folder);
    const expected = c.arrange(lib);
    assert.equal(normalize(caseDataFolder(lib.matterRoot, env)).toLowerCase(), normalize(expected).toLowerCase());
  });
}

test("the generator refuses a resolver that would carry the schema-guard bypass", () => {
  for (const text of [
    "def resolve_case_data_dir(matter_root, migrate_only=False):\n",
    "def resolve_pointer(matter_root):\n",
    "import resolve_paths\n",
    "from resolve_paths import resolve_pointer\n",
  ]) {
    assert.throws(() => resolverText(text), /guard bypass/);
  }
  assert.equal(resolverText("def resolve_case_data_dir(matter_root):\n"), "def resolve_case_data_dir(matter_root):\n");
});
