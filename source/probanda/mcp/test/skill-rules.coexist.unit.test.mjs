// Pilot and rules DAG coexistence (Engineering/1. Spec/2026-10-09_rules-dag-spec.md §5): the pilot
// engine drops an atom that a node rule `replaces`, and an atom no node rule replaces is served as
// before. Runs on the rules-DAG fixture SKILL.md, whose two atoms are the pilot's §13 pair.

import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const { skillRulesApplicable } = await import("../build/files/skill-rules.js");

const SKILL_MD = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "rules-dag", "SKILL.md");
const NEVER_OFFER = "rdag.shelve.never-offer";
const SPIN_OFF = "rdag.obstacle.spin-off";

const ROOT = [
  '<!-- node id=rdag title="Drafting session" when="The practitioner opens a drafting session" -->',
  "<!-- edge to=rdag/job weight=1 -->",
].join("\n");
const job = (rule) =>
  ['<!-- node id=rdag/job title="A job" parents=rdag when="The practitioner picks a job to work" -->', ...rule].join("\n");

/** A checkout holding skill `rdag`, with these node files (by name), or no `rules/nodes/` at all. */
function checkout(t, nodes) {
  const root = mkdtempSync(join(tmpdir(), "coclerk-coexist-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const skill = join(root, ".claude", "skills", "rdag");
  mkdirSync(skill, { recursive: true });
  copyFileSync(SKILL_MD, join(skill, "SKILL.md"));
  if (nodes) {
    mkdirSync(join(skill, "rules", "nodes"), { recursive: true });
    for (const [name, text] of Object.entries(nodes)) writeFileSync(join(skill, "rules", "nodes", name), text + "\n");
  }
  process.env.COCLERK_REPO_ROOT = root;
}

const served = (facts) => {
  const result = skillRulesApplicable("rdag", "release", facts);
  return { ids: result.rules.map((r) => r.id), replaced: result.replaced };
};

test("with no node map, every atom is served as before", (t) => {
  checkout(t, null);
  assert.deepEqual(served({ job_held: true }), { ids: [NEVER_OFFER, SPIN_OFF], replaced: undefined });
});

test("a node map that replaces no atom changes nothing", (t) => {
  checkout(t, { "root.md": ROOT, "job.md": job(["<!-- rule id=rdag.job.other -->", "A rule that replaces no atom."]) });
  assert.deepEqual(served({ job_held: true }), { ids: [NEVER_OFFER, SPIN_OFF], replaced: undefined });
});

test("an atom a node rule replaces is dropped and named in `replaced`; the other is still served", (t) => {
  checkout(t, {
    "root.md": ROOT,
    "job.md": job([`<!-- rule id=rdag.job.spin-off when=obstacle:separate_work replaces=${SPIN_OFF} -->`, "The spin-off, migrated."]),
  });
  const result = skillRulesApplicable("rdag", "release", { job_held: true });
  assert.deepEqual(result.rules.map((r) => r.id), [NEVER_OFFER]);
  assert.deepEqual(result.replaced, [SPIN_OFF]);
  assert.equal(result.matched, true);
});

test("a replaced atom's defeats edge still holds while its other end has not migrated", (t) => {
  checkout(t, {
    "root.md": ROOT,
    "job.md": job([`<!-- rule id=rdag.job.spin-off when=obstacle:separate_work replaces=${SPIN_OFF} -->`, "The spin-off, migrated."]),
  });
  assert.deepEqual(served({ job_held: true, obstacle: "separate_work" }), { ids: [], replaced: [SPIN_OFF] });
});

test("a node map failing its lints fails the pilot call too", (t) => {
  checkout(t, { "root.md": ROOT });
  assert.throws(() => skillRulesApplicable("rdag", "release", {}), { code: "rules_dag_lint" });
});
