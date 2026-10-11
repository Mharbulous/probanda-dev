// The real /draft rules map loads with no lint error. Since rules-DAG step 5.3 a broken node file
// fails every `skill_rules__applicable` call for /draft, so this guards the live files.

import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
process.env.COCLERK_REPO_ROOT = REPO;
const { loadRulesDag } = await import("../build/files/rules-dag.js");
const { skillRulesCoverage } = await import("../build/files/skill-rules.js");

test("the real /draft map loads with no lint error, one node per file, and leaves no SKILL.md line unmapped", () => {
  const dag = loadRulesDag("draft");
  assert.equal(dag.nodes.length, readdirSync(join(REPO, ".claude", "skills", "draft", "rules", "nodes")).length);
  assert.equal(dag.byId.has("draft/session"), true);
  assert.deepEqual(
    skillRulesCoverage("draft").files.filter((f) => f.lines_unmapped > 0).map((f) => f.path),
    []
  );
});
