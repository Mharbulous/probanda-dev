// The drafting runtime reads /matter-data only through /matter-data's own script (party/counsel SSOT;
// /matter-data design-decisions.md #56), so no matter-data table or column name may appear in the
// TypeScript under src/submission/. The identifiers are read from both canonical schemas with host
// Python, so a column /matter-data adds later is covered without editing this test.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const { caseDataMigrateScriptsDir, submissionDataMigrateScriptsDir } = await import("../build/repo-root.js");

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "submission");

// Every table, view, index, trigger and column name of each canonical schema.
const IDENTIFIERS = `
import json, sqlite3, sys
sys.path.insert(0, sys.argv[1])
import rebuild

def names(scripts):
    found = set()
    con = sqlite3.connect(':memory:')
    for script in scripts:
        con.executescript(script)
    for name, kind in con.execute("SELECT name, type FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").fetchall():
        found.add(name)
        if kind in ('table', 'view'):
            found.update(row[1] for row in con.execute('PRAGMA table_info("%s")' % name))
    return found

case = set()
for section in rebuild.parse_sections(rebuild.read_ref('schema.sql')).values():
    case |= names([section])
submission = names([open(sys.argv[2], encoding='utf-8').read()])
print(json.dumps({"case": sorted(case), "submission": sorted(submission)}))
`;

// matter-data identifiers that are also ordinary words, or this runtime's own names for its own
// concepts, and appeared under src/submission/ before this test. None of them is a read of case
// data. Only an identifier on this list may appear; anything else matter-data names fails the test.
const PREDATING_WORDS = new Set([
  "admission_id", "author", "category", "court", "date", "disposition", "file_name", "finding",
  "issues", "jurisdiction", "listed", "notes", "outcome", "positions", "qualified", "reason", "recipient",
  "relief_items", "scope", "sources", "verified",
]);

// A matter-data identifier that one file must write because another contract names it: `lawyer_name` is
// a key of the publish sidecar (publish-bcsc-form's assembly-input-contract.md), filled from the
// runtime's own counsel_name. The case-brief contract (shared/case-brief-template.md) names the slot
// `obiter`, which the renderer checks by name in filing_prose. Each is allowed in that file only.
const CONTRACT_KEYS = new Set(["publish-sidecar.ts: lawyer_name", "forms/projections.ts: obiter"]);

function tsFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? tsFiles(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []
  );
}

test("no matter-data table or column name appears in the TypeScript under src/submission/", () => {
  const res = spawnSync(
    process.env.COCLERK_PYTHON || "python",
    ["-c", IDENTIFIERS, caseDataMigrateScriptsDir(process.env), join(submissionDataMigrateScriptsDir(process.env), "..", "schema.sql")],
    { encoding: "utf-8" }
  );
  assert.equal(res.status, 0, res.stderr);
  const { case: caseNames, submission } = JSON.parse(res.stdout);
  const submissionNames = new Set(submission);
  const forbidden = caseNames.filter((name) => !submissionNames.has(name) && !PREDATING_WORDS.has(name));
  assert.ok(forbidden.includes("lawyer_name") && forbidden.includes("proceeding_parties"), "the identifier read found case data's party columns");

  const hits = [];
  for (const file of tsFiles(SRC)) {
    const text = readFileSync(file, "utf-8");
    for (const name of forbidden) {
      if (new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`).test(text)) hits.push(`${relative(SRC, file).split(sep).join("/")}: ${name}`);
    }
  }
  assert.deepEqual(hits.filter((hit) => !CONTRACT_KEYS.has(hit)), []);
});
