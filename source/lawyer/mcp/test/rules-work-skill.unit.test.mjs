// /work's pilot atoms: the Work Board's entry, moved off /draft. They lint, serve session entry and
// dispatch by operation, leave no tagged line unmapped, and load in a checkout that holds no /draft
// at all, so /work reads no /draft file.

import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const WORK = join(REPO, "source", "skills", "work");
process.env.COCLERK_REPO_ROOT = REPO;
const { skillRulesApplicable, skillRulesCoverage } = await import("../build/files/skill-rules.js");

const ids = (op, facts = {}) => skillRulesApplicable("work", op, facts).rules.map((r) => r.id);

test("session entry and the fast open are /work's", () => {
  const enter = ids("enter");
  for (const id of ["work.enter.tools", "work.enter.matter-folder", "work.enter.call", "work.enter.refusals", "work.enter.keep", "work.enter.responses", "work.open.which-filing", "work.open.fast"]) {
    assert.ok(enter.includes(id), id);
  }
  assert.ok(enter.every((id) => id.startsWith("work.")), enter.join(" "));
});

test("the folder grant is served on its own, and the plural-boards rule arrives with session entry", () => {
  const enter = ids("enter");
  assert.ok(enter.includes("work.open.all-boards"));
  assert.ok(!enter.includes("work.enter.folder-grant"));
  assert.deepEqual(ids("folder_grant"), ["work.enter.folder-grant"]);
});

test("dispatch is /work's, and one take call serves the judgements before the assigning write", () => {
  const dispatch = ids("dispatch");
  for (const id of ["work.dispatch", "work.dispatch.choose", "work.dispatch.work-gone", "work.dispatch.assign"]) {
    assert.ok(dispatch.includes(id), id);
  }
  assert.ok(dispatch.every((id) => id.startsWith("work.")), dispatch.join(" "));
  const take = ids("take");
  for (const id of ["work.assign", "work.assign.refused", "work.input-check", "work.pickup-review", "work.duplicate-check", "work.pre-claim", "work.posture-check", "work.steps.restated"]) {
    assert.ok(take.includes(id), id);
  }
  assert.ok(take.every((id) => id.startsWith("work.")), take.join(" "));
});

test("every tagged /work file is fully mapped and the always-on atoms are its own", () => {
  assert.deepEqual(skillRulesCoverage("work").files.filter((f) => f.lines_unmapped > 0).map((f) => f.path), []);
  assert.deepEqual(skillRulesApplicable("work", "enter").always_on, ["work.what", "work.bounds", "work.hand-off", "work.from-memory", "work.start-planning", "work.each-step"]);
});

test("/work loads in a checkout with no /draft skill", (t) => {
  const root = mkdtempSync(join(tmpdir(), "coclerk-work-only-"));
  t.after(() => {
    process.env.COCLERK_REPO_ROOT = REPO;
    rmSync(root, { recursive: true, force: true });
  });
  const skill = join(root, "source", "skills", "work");
  mkdirSync(join(skill, "references"), { recursive: true });
  copyFileSync(join(WORK, "SKILL.md"), join(skill, "SKILL.md"));
  for (const e of readdirSync(join(WORK, "references"), { withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith(".md")) copyFileSync(join(WORK, "references", e.name), join(skill, "references", e.name));
  }
  process.env.COCLERK_REPO_ROOT = root;
  const result = skillRulesApplicable("work", "dispatch");
  assert.ok(result.matched);
  assert.ok(result.sources.every(({ path }) => path === "SKILL.md" || path.startsWith("references/")), JSON.stringify(result.sources));
});
