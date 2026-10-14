// Rules DAG composition and its XML (Engineering/1. Spec/2026-10-09_rules-dag-spec.md §4.3, §4.4,
// §4.9). fixtures/rules-dag/compose/ is a map built for the three override cases. The pilot's
// premise conflict (pilot spec §13) runs on fixtures/rules-dag/pass/, whose two rules rebuild the
// fixture SKILL.md's two §13 atoms with the same `when` conditions. The pilot has no tests of its
// own, so the DAG's outcomes are compared with the pilot engine's on those atoms.

import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const { composeRules, loadRulesDag, rulesAt, rulesAudit } = await import("../build/files/rules-dag.js");
const { skillRulesApplicable } = await import("../build/files/skill-rules.js");
const { callTool, dispatchTool } = await import("../build/dispatch.js");
const { buildToolDefinitions } = await import("../build/schema-gen.js");

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "rules-dag");

/** A checkout holding skill `rdag`: the fixture SKILL.md and one fixture map as its node files, or none. */
function checkout(t, map) {
  const root = mkdtempSync(join(tmpdir(), "coclerk-rules-dag-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const skill = join(root, ".claude", "skills", "rdag");
  const nodes = join(skill, "rules", "nodes");
  mkdirSync(map ? nodes : skill, { recursive: true });
  copyFileSync(join(FIXTURES, "SKILL.md"), join(skill, "SKILL.md"));
  if (map) for (const name of readdirSync(join(FIXTURES, map))) copyFileSync(join(FIXTURES, map, name), join(nodes, name));
  process.env.COCLERK_REPO_ROOT = root;
}

const ids = (path, facts) => composeRules(loadRulesDag("rdag"), path, facts).rules.map(({ rule }) => rule.id);

const CHAIN = ["rdag", "rdag/job", "rdag/job/release"];
const SIDE = ["rdag", "rdag/job", "rdag/job/side"];
const VIA_JOB = ["rdag", "rdag/job", "rdag/both"];
const VIA_OTHER = ["rdag", "rdag/other", "rdag/both"];

test("the output is byte-identical for the same input, and pins the XML", (t) => {
  checkout(t, "compose");
  const expected = [
    '<rules position="rdag/job">',
    '  <position path="rdag rdag/job"/>',
    '  <rule id="rdag.root.z" node="rdag">',
    "Root rule Z.",
    "  </rule>",
    '  <rule id="rdag.job.b" node="rdag/job">',
    "Job rule B.",
    "  </rule>",
    "  <likely_next>",
    '    <node id="rdag/job/side" weight="0.5" when="The practitioner asks something off the job"/>',
    '    <node id="rdag/job/release" weight="0.2" when="The practitioner lets go of the job"/>',
    '    <node id="rdag/both" weight="0.2" when="A step that a job and other work both reach"/>',
    "  </likely_next>",
    "</rules>",
  ].join("\n");
  const first = rulesAt("rdag", ["rdag", "rdag/job"]);
  assert.equal(first, expected);
  assert.equal(rulesAt("rdag", ["rdag", "rdag/job"]), first);
  // Rule text is escaped for XML, never indented; a leaf has no likely_next.
  assert.equal(
    rulesAt("rdag", VIA_JOB, {}),
    [
      '<rules position="rdag/both">',
      '  <position path="rdag rdag/job rdag/both"/>',
      '  <rule id="rdag.root.z" node="rdag">',
      "Root rule Z.",
      "  </rule>",
      '  <rule id="rdag.job.b" node="rdag/job">',
      "Job rule B.",
      "  </rule>",
      '  <rule id="rdag.both.e" node="rdag/both">',
      'Shared rule E, for &lt;matter> &amp; "its" folder.',
      "  </rule>",
      "</rules>",
    ].join("\n")
  );
});

test("a chain collapses: B overrides A and C overrides B, all on the path, so only C is output", (t) => {
  checkout(t, "compose");
  assert.deepEqual(ids(CHAIN), ["rdag.root.z", "rdag.release.c"]);
});

test("a sibling branch's override is ignored", (t) => {
  checkout(t, "compose");
  // rdag.release.c overrides rdag.job.b from the sibling node rdag/job/release.
  assert.deepEqual(ids(SIDE), ["rdag.root.z", "rdag.job.b", "rdag.side.s"]);
});

test("an override from off the path has no effect, even on a node reached through two parents", (t) => {
  checkout(t, "compose");
  // rdag/both has parents rdag/job and rdag/other. Each parent's override applies only on its own path.
  assert.deepEqual(ids(VIA_JOB), ["rdag.root.z", "rdag.job.b", "rdag.both.e"]);
  assert.deepEqual(ids(VIA_OTHER), ["rdag.root.a", "rdag.other.d", "rdag.both.e"]);
  // A descendant not yet reached overrides nothing either.
  assert.deepEqual(ids(["rdag", "rdag/job"]), ["rdag.root.z", "rdag.job.b"]);
});

const P13 = ["rdag", "rdag/job", "rdag/job/release"];
const NEVER_OFFER = "rdag.shelve.never-offer";
const SPIN_OFF = "rdag.obstacle.spin-off";

/** The DAG's rules that replace a pilot atom, named by that atom, with their conditional facts. */
function dagOutcome(facts) {
  return composeRules(loadRulesDag("rdag"), P13, facts)
    .rules.filter(({ rule }) => rule.replaces.length > 0)
    .map(({ rule, conditional }) => ({ id: rule.replaces.join(","), ...(conditional.length > 0 ? { conditional_on: conditional } : {}) }));
}

function pilotOutcome(operation, facts) {
  return skillRulesApplicable("rdag", operation, facts).rules.map(({ id, conditional_on }) => ({
    id,
    ...(conditional_on ? { conditional_on } : {}),
  }));
}

// Pilot spec §13, its three outcomes first, then two fact sets it leaves implicit.
const PREMISE_CASES = [
  ["job held, separate work: the spin-off and not never-offer", { job_held: true, obstacle: "separate_work" }, [{ id: SPIN_OFF }]],
  [
    "job held, no obstacle fact: both, the spin-off conditional on obstacle",
    { job_held: true },
    [{ id: NEVER_OFFER }, { id: SPIN_OFF, conditional_on: ["obstacle"] }],
  ],
  ["job held, obstacle in the job: never-offer and not the spin-off", { job_held: true, obstacle: "in_job" }, [{ id: NEVER_OFFER }]],
  ["obstacle in the job, job_held unknown: never-offer conditional on job_held", { obstacle: "in_job" }, [{ id: NEVER_OFFER, conditional_on: ["job_held"] }]],
  [
    "no facts: both conditional",
    {},
    [
      { id: NEVER_OFFER, conditional_on: ["job_held"] },
      { id: SPIN_OFF, conditional_on: ["obstacle"] },
    ],
  ],
];

for (const [what, facts, expected] of PREMISE_CASES) {
  test(`premise conflict (pilot §13): ${what}, matching the pilot engine on the same atoms`, (t) => {
    checkout(t, "pass");
    const dag = dagOutcome(facts);
    assert.deepEqual(dag, expected);
    // The root rule has no pilot atom and always applies.
    assert.equal(composeRules(loadRulesDag("rdag"), P13, facts).rules[0].rule.id, "rdag.general");
    // The pilot runs without the map, since a node rule that `replaces` an atom drops it from the pilot.
    checkout(t, null);
    for (const operation of ["release", "obstacle"]) assert.deepEqual(pilotOutcome(operation, facts), dag, operation);
  });
}

test("the premise conflict's conditional spin-off is marked in the XML", (t) => {
  checkout(t, "pass");
  const xml = rulesAt("rdag", P13, { job_held: true });
  assert.match(xml, /\n {2}<rule id="rdag\.job\.hold" node="rdag\/job">\n/);
  assert.match(xml, /\n {2}<rule id="rdag\.job\.release\.spin-off" node="rdag\/job\/release" conditional_on="obstacle">\n/);
});

test("a path off the move edges is refused, with the children of its last good node", (t) => {
  checkout(t, "compose");
  const refused = (path, message) => assert.throws(() => rulesAt("rdag", path), { code: "data_error", message });
  const list = 'path must be a list of node ids from the root, such as ["rdag", "rdag/job"]';
  refused("rdag/job", list);
  refused([], list);
  refused(["rdag", 7], list);
  refused(["rdag/job"], "path must start at the root node 'rdag', not 'rdag/job'");
  refused(["rdag", "rdag/ghost"], "path names an unknown node 'rdag/ghost'; the children of rdag are: rdag/other, rdag/job");
  refused(["rdag", "rdag/job/release"], "rdag has no move edge to rdag/job/release; the children of rdag are: rdag/other, rdag/job");
  refused([...CHAIN, "rdag/job"], "rdag/job/release has no move edge to rdag/job; the children of rdag/job/release are: none");
});

test("facts follow the pilot: a bad value is refused and an unknown key is reported", (t) => {
  checkout(t, "pass");
  assert.throws(() => rulesAt("rdag", P13, { job_held: "maybe" }), {
    message: 'facts.job_held must be one of: true, false (got "maybe")',
  });
  assert.match(rulesAt("rdag", P13, { colour: "red", job_held: true }), /^<rules position="rdag\/job\/release">\n {2}<position path="rdag rdag\/job rdag\/job\/release"\/>\n {2}<unknown_facts names="colour"\/>\n/);
});

test("the audit lists every omitted rule, the overrides of root rules, and a rule's incoming edges", (t) => {
  checkout(t, "compose");
  const base = rulesAt("rdag", CHAIN).replace(/\n<\/rules>$/, "");
  assert.equal(
    rulesAudit("rdag", CHAIN, "rdag.job.b"),
    [
      base,
      "  <omitted>",
      '    <dropped id="rdag.root.a" node="rdag" by="rdag.job.b" reason="A job narrows rule A"/>',
      '    <dropped id="rdag.job.b" node="rdag/job" by="rdag.release.c" reason="Releasing narrows rule B"/>',
      "  </omitted>",
      "  <root_overrides>",
      '    <override by="rdag.job.b" node="rdag/job" target="rdag.root.a" reason="A job narrows rule A"/>',
      '    <override by="rdag.other.d" node="rdag/other" target="rdag.root.z" reason="Other work narrows rule Z"/>',
      "  </root_overrides>",
      '  <incoming rule="rdag.job.b" node="rdag/job">',
      '    <override by="rdag.release.c" node="rdag/job/release" reason="Releasing narrows rule B"/>',
      "  </incoming>",
      "</rules>",
    ].join("\n")
  );
  assert.match(rulesAudit("rdag", SIDE, "rdag.side.s"), /\n {2}<incoming rule="rdag\.side\.s" node="rdag\/job\/side"\/>\n<\/rules>$/);
  assert.throws(() => rulesAudit("rdag", CHAIN, "rdag.ghost"), { message: "rule_id 'rdag.ghost' names no rule in the rdag map" });
});

test("the audit names the condition a supplied fact failed, and shows empty sections", (t) => {
  checkout(t, "pass");
  const audit = rulesAudit("rdag", P13, undefined, { job_held: true, obstacle: "in_job" });
  assert.ok(audit.startsWith(rulesAt("rdag", P13, { job_held: true, obstacle: "in_job" }).replace(/\n<\/rules>$/, "")));
  assert.ok(
    audit.endsWith(
      [
        "  <omitted>",
        '    <dropped id="rdag.job.release.spin-off" node="rdag/job/release" failed="obstacle:separate_work"/>',
        "  </omitted>",
        "  <root_overrides/>",
        "</rules>",
      ].join("\n")
    )
  );
  assert.ok(rulesAudit("rdag", ["rdag"]).endsWith("  <omitted/>\n  <root_overrides/>\n</rules>"));
});

test("the tools are registered read-only, take no session, and answer in raw XML", async (t) => {
  checkout(t, "compose");
  const defs = Object.fromEntries(buildToolDefinitions().map((d) => [d.name, d]));
  assert.deepEqual(Object.keys(defs.rules__at.inputSchema.properties), ["skill", "path", "facts"]);
  assert.deepEqual(Object.keys(defs.rules__audit.inputSchema.properties), ["skill", "path", "rule_id", "facts"]);
  for (const name of ["rules__at", "rules__audit"]) {
    assert.deepEqual(defs[name].annotations, { readOnlyHint: true, openWorldHint: false });
    assert.deepEqual(defs[name].inputSchema.required, ["skill", "path"]);
  }
  assert.equal(await callTool({}, "rules__at", { skill: "rdag", path: CHAIN }), rulesAt("rdag", CHAIN));
  assert.equal(await callTool({}, "rules__audit", { skill: "rdag", path: CHAIN, rule_id: "rdag.job.b" }), rulesAudit("rdag", CHAIN, "rdag.job.b"));
  const served = await dispatchTool({}, "rules__at", { skill: "rdag", path: CHAIN });
  assert.deepEqual(served, { content: [{ type: "text", text: rulesAt("rdag", CHAIN) }] });
  const refused = await dispatchTool({}, "rules__at", { skill: "rdag", path: ["rdag/job"] });
  assert.equal(refused.isError, true);
  assert.deepEqual(JSON.parse(refused.content[0].text), {
    error: { code: "data_error", message: "path must start at the root node 'rdag', not 'rdag/job'" },
  });
});
