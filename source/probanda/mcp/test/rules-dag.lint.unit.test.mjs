// Rules DAG node files: the grammar and every lint of the spec's §8
// (Engineering/1. Spec/2026-10-09_rules-dag-spec.md, grammar in §11). Each lint fixture under
// fixtures/rules-dag/lint-*/ overlays the passing map in fixtures/rules-dag/pass/ (same name
// replaces, a new name adds), and fails with its own exact rules_dag_lint message.

import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const { loadRulesDag } = await import("../build/files/rules-dag.js");
const { parseTagAttributes } = await import("../build/files/skill-rules.js");
const { DataServerError } = await import("../build/errors.js");

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "rules-dag");

/** A checkout holding skill `rdag`: the fixture SKILL.md, the passing map, then the overlay. */
function mapWith(t, overlay) {
  const root = mkdtempSync(join(tmpdir(), "coclerk-rules-dag-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const skill = join(root, ".claude", "skills", "rdag");
  const nodes = join(skill, "rules", "nodes");
  mkdirSync(nodes, { recursive: true });
  copyFileSync(join(FIXTURES, "SKILL.md"), join(skill, "SKILL.md"));
  for (const dir of ["pass", ...(overlay ? [overlay] : [])]) {
    for (const name of readdirSync(join(FIXTURES, dir))) copyFileSync(join(FIXTURES, dir, name), join(nodes, name));
  }
  process.env.COCLERK_REPO_ROOT = root;
}

const lintError = (message) => (err) => {
  assert.equal(err.code, "rules_dag_lint");
  assert.equal(err.message, message);
  return true;
};

test("the passing map loads, with quoted values, edges, conditions, overrides and provenance", (t) => {
  mapWith(t);
  const dag = loadRulesDag("rdag");
  assert.deepEqual(dag.nodes.map((n) => n.id), ["rdag/job", "rdag/job/release", "rdag"]);
  assert.deepEqual(dag.files.map((f) => f.path), ["rules/nodes/job.md", "rules/nodes/release.md", "rules/nodes/root.md"]);
  const root = dag.byId.get("rdag");
  assert.equal(root.title, "Drafting session");
  assert.equal(root.when, "The practitioner opens a drafting session");
  assert.deepEqual(root.parents, []);
  assert.deepEqual(root.edges.map(({ to, weight }) => ({ to, weight })), [{ to: "rdag/job", weight: 0.71 }]);
  assert.equal(dag.rules.get("rdag.general").provenance, "E2E report 12, turn 3: the session offered to shelve");
  const hold = dag.rules.get("rdag.job.hold");
  assert.deepEqual(hold.when, [{ fact: "job_held", values: ["true"] }]);
  assert.deepEqual(hold.replaces, ["rdag.shelve.never-offer"]);
  assert.equal(hold.text, "Shelving and releasing are received, never offered.\n\n## Still the same rule\n\nA heading inside a rule stays in its text.");
  assert.deepEqual([hold.start, hold.end], [5, 9]);
  const spin = dag.rules.get("rdag.job.release.spin-off");
  assert.equal(spin.node, "rdag/job/release");
  assert.equal(spin.overrides, "rdag.job.hold");
  assert.equal(spin.reason, "A spin-off of blocker jobs ends with a release");
});

const LINTS = [
  ["lint-cycle", "a cycle in move edges", "rules/nodes/release.md:2: move edge cycle: rdag/job -> rdag/job/release -> rdag/job"],
  ["lint-no-path", "a node with no path from the root", "rules/nodes/orphan.md:1: node rdag/orphan has no path from the root"],
  ["lint-duplicate-node", "a duplicate node id", "rules/nodes/zz-again.md:1: duplicate node id rdag/job (also rules/nodes/job.md:1)"],
  ["lint-duplicate-rule", "a duplicate rule id", "rules/nodes/root.md:6: duplicate rule id rdag.general (also rules/nodes/release.md:3)"],
  ["lint-missing-parent", "a missing parent", "rules/nodes/job.md:1: node rdag/job names a missing parent 'rdag/nowhere'"],
  ["lint-override-off-path", "an override whose target is not on any ancestor path", "rules/nodes/root.md:4 (rdag.general): overrides rdag.job.hold on rdag/job, which is not an ancestor of rdag"],
  ["lint-override-no-reason", "an override with no reason", "rules/nodes/release.md:3 (rdag.job.release.spin-off): override of rdag.job.hold has no reason"],
  ["lint-override-cycle", "an override cycle", "rules/nodes/job.md:4: override cycle: rdag.job.hold -> rdag.general -> rdag.job.hold"],
  ["lint-when-fact", "a when naming a fact outside the vocabulary", "rules/nodes/job.md:4 (rdag.job.hold): fact 'premise' is not in the vocabulary"],
  ["lint-when-value", "a when naming a value outside the vocabulary", "rules/nodes/job.md:4 (rdag.job.hold): 'maybe' is not a value of fact 'job_held'"],
  ["lint-replaces-missing", "a replaces naming an atom that does not exist", "rules/nodes/job.md:4 (rdag.job.hold): replaces a missing atom 'rdag.shelve.gone'"],
  ["lint-provisional", "a provisional rule in a node file", "rules/nodes/job.md:4: rule rdag.job.hold is provisional; provisional rules live only in the out-of-bounds log"],
  ["lint-no-when", "a node with no when line", "rules/nodes/job.md:1: node rdag/job has no when line"],
  // The grammar's own lints (spec §11).
  ["lint-bad-node-id", "a bad node id", "rules/nodes/job.md:1: bad node id 'rdag/Job'"],
  ["lint-bad-rule-id", "a bad rule id", "rules/nodes/job.md:4: bad rule id 'Rdag.hold'"],
  ["lint-bad-weight", "a weight outside 0 to 1", "rules/nodes/root.md:2: edge weight '1.5' is not a number from 0 to 1"],
  ["lint-comment-in-rule", "another comment tag inside a rule", "rules/nodes/job.md:6: not a node, edge or rule tag: <!-- atom id=rdag.pasted ops=release -->"],
  ["lint-duplicate-parent", "a parent named twice", "rules/nodes/job.md:1: 'parents' names rdag twice"],
  ["lint-duplicate-replaces", "an atom replaced twice", "rules/nodes/job.md:4: 'replaces' names rdag.shelve.never-offer twice"],
  ["lint-edge-missing-node", "an edge to a missing node", "rules/nodes/root.md:3: edge to a missing node 'rdag/ghost'"],
  ["lint-edge-not-parent", "an edge whose target does not name this node as a parent", "rules/nodes/root.md:3: edge to rdag/job/release, which does not name rdag as a parent"],
  ["lint-malformed-tag", "a malformed tag", "rules/nodes/job.md:4: malformed rule tag: <!-- rule id=rdag.job.hold"],
  ["lint-missing-title", "a node with no title", "rules/nodes/job.md:1: node rdag/job has no title"],
  ["lint-no-root", "no root node", "rdag/rules/nodes: no root node 'rdag'"],
  ["lint-outside-map", "a node outside the skill's map", "rules/nodes/other.md:1: node other/x is outside the rdag map"],
  ["lint-override-missing", "an override of a missing rule", "rules/nodes/release.md:3 (rdag.job.release.spin-off): overrides a missing rule 'rdag.ghost'"],
  ["lint-override-same-node", "an override on the rule's own node", "rules/nodes/job.md:7 (rdag.job.other): overrides rdag.job.hold on its own node; an override targets a rule on an ancestor"],
  ["lint-override-self", "a rule overriding itself", "rules/nodes/release.md:3 (rdag.job.release.spin-off): a rule cannot override itself"],
  ["lint-parent-without-edge", "a parent link with no move edge", "rules/nodes/extra.md:1: parent rdag has no move edge to rdag/extra"],
  ["lint-reason-no-override", "a reason with no override", "rules/nodes/release.md:3 (rdag.job.release.spin-off): a reason with no override"],
  ["lint-root-with-parents", "a root with parents", "rules/nodes/root.md:1: the root node rdag takes no parents"],
  ["lint-rule-no-text", "a rule with no text", "rules/nodes/release.md:3: rule rdag.job.release.spin-off has no text"],
  ["lint-second-edge", "a second edge to one node", "rules/nodes/root.md:3: a second edge to rdag/job"],
  ["lint-second-node", "a second node tag", "rules/nodes/job.md:3: a second node tag (the file's node is rdag/job)"],
  ["lint-stray-file", "a file in rules/nodes that is not a node file", "rdag/rules/nodes: 'rdag/rules/nodes/notes.txt' is not a node file (only .md files belong here)"],
  ["lint-tag-before-node", "a tag before the node tag", "rules/nodes/job.md:1: a node file must open with its node tag"],
  ["lint-text-outside-rule", "text outside a rule", "rules/nodes/root.md:4: text outside a rule"],
];

for (const [overlay, what, message] of LINTS) {
  test(`lint: ${what}`, (t) => {
    mapWith(t, overlay);
    assert.throws(() => loadRulesDag("rdag"), lintError(message));
  });
}

test("every lint fixture folder has a test", () => {
  const folders = readdirSync(FIXTURES).filter((f) => f.startsWith("lint-")).sort();
  assert.deepEqual(folders, LINTS.map(([overlay]) => overlay).sort());
});

test("no node files is a lint, not an empty map", (t) => {
  const root = mkdtempSync(join(tmpdir(), "coclerk-rules-dag-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".claude", "skills", "rdag"), { recursive: true });
  copyFileSync(join(FIXTURES, "SKILL.md"), join(root, ".claude", "skills", "rdag", "SKILL.md"));
  process.env.COCLERK_REPO_ROOT = root;
  assert.throws(() => loadRulesDag("rdag"), lintError("rdag/rules/nodes: no node files"));
});

const fail = (message) => new DataServerError(message, "rules_dag_lint");
const attrs = (body) => Object.fromEntries(parseTagAttributes(body, "f.md:1", "rule", ["id", "reason", "when"], fail));

test("the tag reader takes double-quoted values with spaces, and bare values as before", () => {
  assert.deepEqual(attrs('id=a.b reason="A spin-off ends, with a release" when=x:y|z'), {
    id: "a.b",
    reason: "A spin-off ends, with a release",
    when: "x:y|z",
  });
  assert.deepEqual(attrs('reason="=a b=c"   id=a'), { reason: "=a b=c", id: "a" });
});

test("the tag reader refuses an unclosed quote, text after a closing quote, and an empty quoted value", () => {
  assert.throws(() => attrs('id=a reason="no end'), { message: "f.md:1: rule tag 'reason' has an unclosed quote" });
  assert.throws(() => attrs('reason="a b"c id=a'), { message: "f.md:1: rule tag 'reason' has text after its closing quote" });
  assert.throws(() => attrs('id=a reason=""'), { message: "f.md:1: rule tag 'reason' is empty" });
  assert.throws(() => attrs('id=a reason="ends --> early"'), { message: "f.md:1: rule tag 'reason' holds '--' inside its quotes" });
  assert.throws(() => attrs("id=a reason"), { message: "f.md:1: rule tag attribute without '=': reason" });
  assert.throws(() => attrs('id=a title="x"'), { message: "f.md:1: unknown rule tag attribute 'title'" });
  assert.throws(() => attrs("id=a id=b"), { message: "f.md:1: rule tag repeats 'id'" });
});
