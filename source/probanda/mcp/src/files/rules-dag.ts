// Rules DAG: a skill's working rules placed on a map of practitioner positions
// (Engineering/1. Spec/2026-10-09_rules-dag-spec.md, grammar in its §11).
//
// Each node is one markdown file under `<skill>/rules/nodes/`, read through
// skill-source.ts like every other skill file. Its first tag names the node:
// `<!-- node id=draft/job title="A job" parents=draft when="The practitioner picks a job" -->`.
// `<!-- edge to=draft/job/release weight=0.12 -->` marks a move edge to a child,
// and `<!-- rule id=draft.job.x when=job_held:true overrides=draft.y reason="…" -->`
// marks a rule whose text runs to the next tag or the end of the file, as an
// atom does in skill-rules.ts, whose tag reader and vocabulary this reuses.
//
// Nothing is generated or cached: every call reads and lints the node files.
// A lint failure throws `rules_dag_lint` with the file and line.
//
// Composition (spec §4.3): the rules in force at a position are the rules on
// every node of its path, root first, filtered by `when` with the pilot's
// semantics, less any rule an unconditional rule on the same path overrides.
// `rules__at` and `rules__audit` return it as XML (spec §4.4, §4.9).

import { DataServerError, ValidationError } from "../errors.js";
import { loadSkill, normalizeFacts, parseTagAttributes, parseWhen, type Condition } from "./skill-rules.js";
import { skillSourceList, skillSourceRead } from "./skill-source.js";

const TAG_RE = /^<!-- (node|edge|rule) (.+) -->$/;
const TAG_START_RE = /^<!-- (node|edge|rule)(\s|$)/;
const NODE_ID_RE = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9_-]*)*$/;
const RULE_ID_RE = /^[a-z0-9][a-z0-9._-]*$/;
const SKILL_RE = /^[a-z0-9][a-z0-9-]*$/;
const WEIGHT_RE = /^\d+(\.\d+)?$/;
const HEADING_RE = /^#{1,6}(\s|$)/;

export interface DagEdge {
  to: string;
  weight: number;
  where: string;
}

export interface DagRule {
  id: string;
  node: string;
  when: Condition[];
  overrides: string | null;
  reason: string | null;
  replaces: string[];
  provenance: string | null;
  /** Tree-relative to the skill, e.g. `rules/nodes/job.md`. */
  path: string;
  /** The tag's line. */
  line: number;
  /** The text's first and last lines. */
  start: number;
  end: number;
  text: string;
}

export interface DagNode {
  id: string;
  title: string;
  when: string;
  parents: string[];
  edges: DagEdge[];
  rules: DagRule[];
  path: string;
  line: number;
}

export interface RulesDag {
  skill: string;
  /** Every node, in file order (files sorted by path). */
  nodes: DagNode[];
  byId: Map<string, DagNode>;
  rules: Map<string, DagRule>;
  files: Array<{ path: string; sha256: string }>;
  /** The pilot vocabulary's facts and their values, which every `when` is checked against. */
  facts: Map<string, string[]>;
}

function lint(message: string): DataServerError {
  return new DataServerError(message, "rules_dag_lint");
}

/** A comma list attribute, refusing a name given twice. */
function uniqueList(raw: string | undefined, where: string, key: string): string[] {
  const items = (raw ?? "").split(",").filter((p) => p !== "");
  const twice = items.find((p, i) => items.indexOf(p) !== i);
  if (twice !== undefined) throw lint(`${where}: '${key}' names ${twice} twice`);
  return items;
}

/** Parse one node file. `path` is tree-relative to the skill. */
function parseNodeFile(path: string, content: string): DagNode {
  let lines = content.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines = lines.slice(0, -1);
  lines = lines.map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));

  let node: DagNode | null = null;
  let current: { rule: DagRule; body: number[] } | null = null;
  const spans: Array<{ rule: DagRule; body: number[] }> = [];

  for (let i = 0; i < lines.length; i++) {
    const where = `${path}:${i + 1}`;
    const trimmed = lines[i].trimEnd();
    if (!TAG_START_RE.test(trimmed)) {
      // Any other comment line (a pilot atom tag, an indented or mis-cased tag) would be served as rule text.
      if (trimmed.trim().startsWith("<!--")) throw lint(`${where}: not a node, edge or rule tag: ${trimmed.trim()}`);
      if (current) current.body.push(i);
      else if (trimmed.trim() !== "" && !HEADING_RE.test(trimmed)) throw lint(`${where}: text outside a rule`);
      continue;
    }
    const match = TAG_RE.exec(trimmed);
    if (!match) throw lint(`${where}: malformed ${TAG_START_RE.exec(trimmed)![1]} tag: ${trimmed}`);
    const kind = match[1];
    current = null;
    if (kind === "node") {
      if (node) throw lint(`${where}: a second node tag (the file's node is ${node.id})`);
      const attrs = parseTagAttributes(match[2], where, "node", ["id", "title", "parents", "when"], lint);
      const id = attrs.get("id");
      if (id === undefined) throw lint(`${where}: node tag lacks 'id'`);
      if (!NODE_ID_RE.test(id)) throw lint(`${where}: bad node id '${id}'`);
      if (!attrs.has("title")) throw lint(`${where}: node ${id} has no title`);
      if (!attrs.has("when")) throw lint(`${where}: node ${id} has no when line`);
      node = {
        id,
        title: attrs.get("title")!,
        when: attrs.get("when")!,
        parents: uniqueList(attrs.get("parents"), where, "parents"),
        edges: [],
        rules: [],
        path,
        line: i + 1,
      };
      continue;
    }
    if (!node) throw lint(`${where}: a node file must open with its node tag`);
    if (kind === "edge") {
      const attrs = parseTagAttributes(match[2], where, "edge", ["to", "weight"], lint);
      const to = attrs.get("to");
      const weight = attrs.get("weight");
      if (to === undefined) throw lint(`${where}: edge tag lacks 'to'`);
      if (weight === undefined) throw lint(`${where}: edge tag lacks 'weight'`);
      if (!WEIGHT_RE.test(weight) || Number(weight) > 1) throw lint(`${where}: edge weight '${weight}' is not a number from 0 to 1`);
      if (node.edges.some((e) => e.to === to)) throw lint(`${where}: a second edge to ${to}`);
      node.edges.push({ to, weight: Number(weight), where });
      continue;
    }
    const attrs = parseTagAttributes(
      match[2],
      where,
      "rule",
      ["id", "when", "overrides", "reason", "replaces", "provenance", "provisional"],
      lint
    );
    const id = attrs.get("id");
    if (id === undefined) throw lint(`${where}: rule tag lacks 'id'`);
    if (!RULE_ID_RE.test(id)) throw lint(`${where}: bad rule id '${id}'`);
    if (attrs.has("provisional")) throw lint(`${where}: rule ${id} is provisional; provisional rules live only in the out-of-bounds log`);
    const rule: DagRule = {
      id,
      node: node.id,
      when: parseWhen(attrs.get("when"), where, lint),
      overrides: attrs.get("overrides") ?? null,
      reason: attrs.get("reason") ?? null,
      replaces: uniqueList(attrs.get("replaces"), where, "replaces"),
      provenance: attrs.get("provenance") ?? null,
      path,
      line: i + 1,
      start: 0,
      end: 0,
      text: "",
    };
    node.rules.push(rule);
    current = { rule, body: [] };
    spans.push(current);
  }
  if (!node) throw lint(`${path}: no node tag`);

  for (const { rule, body } of spans) {
    const filled = body.filter((i) => lines[i].trim() !== "");
    if (filled.length === 0) throw lint(`${path}:${rule.line}: rule ${rule.id} has no text`);
    const first = filled[0];
    const last = filled[filled.length - 1];
    rule.start = first + 1;
    rule.end = last + 1;
    rule.text = lines.slice(first, last + 1).join("\n");
  }
  return node;
}

/** The skill's node files, by tree-relative path, in sorted order. */
function nodePaths(skill: string): string[] {
  const dir = `${skill}/rules/nodes`;
  let entries: ReturnType<typeof skillSourceList>["entries"];
  try {
    entries = skillSourceList(dir).entries;
  } catch (err) {
    if (err instanceof DataServerError && err.code === "not_found") throw lint(`${dir}: no node files`);
    throw err;
  }
  // A node file is the only source of its rules, so a stray entry is refused, never skipped.
  const stray = entries.find((e) => e.type !== "file" || !e.path.endsWith(".md"));
  if (stray) throw lint(`${dir}: '${stray.path}' is not a node file (only .md files belong here)`);
  const paths = entries.map((e) => e.path).sort();
  if (paths.length === 0) throw lint(`${dir}: no node files`);
  return paths;
}

/** Every proper ancestor of each node, through any parent. Assumes no cycle. */
function ancestorsOf(byId: Map<string, DagNode>): Map<string, Set<string>> {
  const memo = new Map<string, Set<string>>();
  const walk = (id: string): Set<string> => {
    const known = memo.get(id);
    if (known) return known;
    const found = new Set<string>();
    for (const parent of byId.get(id)!.parents) {
      found.add(parent);
      for (const a of walk(parent)) found.add(a);
    }
    memo.set(id, found);
    return found;
  };
  for (const id of byId.keys()) walk(id);
  return memo;
}

function lintDag(
  skill: string,
  nodes: DagNode[]
): { byId: Map<string, DagNode>; rules: Map<string, DagRule>; facts: Map<string, string[]> } {
  const byId = new Map<string, DagNode>();
  for (const node of nodes) {
    const prior = byId.get(node.id);
    if (prior) throw lint(`${node.path}:${node.line}: duplicate node id ${node.id} (also ${prior.path}:${prior.line})`);
    byId.set(node.id, node);
  }
  const rules = new Map<string, DagRule>();
  for (const node of nodes) {
    for (const rule of node.rules) {
      const prior = rules.get(rule.id);
      if (prior) throw lint(`${rule.path}:${rule.line}: duplicate rule id ${rule.id} (also ${prior.path}:${prior.line})`);
      rules.set(rule.id, rule);
    }
  }

  // The map: one root, named for the skill, and parent links mirrored one-to-one by move edges.
  if (!byId.has(skill)) throw lint(`${skill}/rules/nodes: no root node '${skill}'`);
  for (const node of nodes) {
    const where = `${node.path}:${node.line}`;
    if (node.id !== skill && !node.id.startsWith(`${skill}/`)) throw lint(`${where}: node ${node.id} is outside the ${skill} map`);
    if (node.id === skill && node.parents.length > 0) throw lint(`${where}: the root node ${skill} takes no parents`);
    for (const parent of node.parents) {
      const from = byId.get(parent);
      if (!from) throw lint(`${where}: node ${node.id} names a missing parent '${parent}'`);
      if (!from.edges.some((e) => e.to === node.id)) throw lint(`${where}: parent ${parent} has no move edge to ${node.id}`);
    }
  }
  for (const node of nodes) {
    for (const edge of node.edges) {
      const to = byId.get(edge.to);
      if (!to) throw lint(`${edge.where}: edge to a missing node '${edge.to}'`);
      if (!to.parents.includes(node.id)) throw lint(`${edge.where}: edge to ${edge.to}, which does not name ${node.id} as a parent`);
    }
  }

  const state = new Map<string, "open" | "done">();
  const visit = (id: string, trail: string[], where: string): void => {
    const seen = state.get(id);
    if (seen === "done") return;
    if (seen === "open") throw lint(`${where}: move edge cycle: ${[...trail, id].join(" -> ")}`);
    state.set(id, "open");
    for (const edge of byId.get(id)!.edges) visit(edge.to, [...trail, id], edge.where);
    state.set(id, "done");
  };
  for (const node of nodes) visit(node.id, [], `${node.path}:${node.line}`);

  const reached = new Set<string>([skill]);
  const queue = [skill];
  while (queue.length > 0) {
    for (const edge of byId.get(queue.shift()!)!.edges) {
      if (!reached.has(edge.to)) {
        reached.add(edge.to);
        queue.push(edge.to);
      }
    }
  }
  for (const node of nodes) {
    if (!reached.has(node.id)) throw lint(`${node.path}:${node.line}: node ${node.id} has no path from the root`);
  }

  // Rules: the vocabulary and atom ids come from the pilot's SKILL.md and tagged references.
  const pilot = loadSkill(skill);
  const atomIds = new Set(pilot.atoms.map((a) => a.id));
  for (const rule of rules.values()) {
    const where = `${rule.path}:${rule.line} (${rule.id})`;
    for (const { fact, values } of rule.when) {
      const allowed = pilot.facts.get(fact);
      if (!allowed) throw lint(`${where}: fact '${fact}' is not in the vocabulary`);
      for (const value of values) {
        if (!allowed.includes(value)) throw lint(`${where}: '${value}' is not a value of fact '${fact}'`);
      }
    }
    for (const atom of rule.replaces) {
      if (!atomIds.has(atom)) throw lint(`${where}: replaces a missing atom '${atom}'`);
    }
    if (rule.overrides === null && rule.reason !== null) throw lint(`${where}: a reason with no override`);
    if (rule.overrides === null) continue;
    if (rule.overrides === rule.id) throw lint(`${where}: a rule cannot override itself`);
    if (!rules.has(rule.overrides)) throw lint(`${where}: overrides a missing rule '${rule.overrides}'`);
    if (rule.reason === null) throw lint(`${where}: override of ${rule.overrides} has no reason`);
  }

  const overrideState = new Map<string, "open" | "done">();
  const follow = (id: string, trail: string[]): void => {
    const seen = overrideState.get(id);
    if (seen === "done") return;
    const rule = rules.get(id)!;
    if (seen === "open") throw lint(`${rule.path}:${rule.line}: override cycle: ${[...trail, id].join(" -> ")}`);
    overrideState.set(id, "open");
    if (rule.overrides !== null) follow(rule.overrides, [...trail, id]);
    overrideState.set(id, "done");
  };
  for (const id of rules.keys()) follow(id, []);

  const ancestors = ancestorsOf(byId);
  for (const rule of rules.values()) {
    if (rule.overrides === null) continue;
    const target = rules.get(rule.overrides)!;
    if (target.node === rule.node) throw lint(`${rule.path}:${rule.line} (${rule.id}): overrides ${target.id} on its own node; an override targets a rule on an ancestor`);
    if (!ancestors.get(rule.node)!.has(target.node)) {
      throw lint(`${rule.path}:${rule.line} (${rule.id}): overrides ${target.id} on ${target.node}, which is not an ancestor of ${rule.node}`);
    }
  }
  return { byId, rules, facts: pilot.facts };
}

/** Read and lint a skill's node files. Throws `rules_dag_lint` on any lint failure. */
export function loadRulesDag(skill: string): RulesDag {
  if (typeof skill !== "string" || !SKILL_RE.test(skill)) {
    throw new ValidationError(`skill must be a skill folder name such as "draft", not ${JSON.stringify(skill)}`);
  }
  const nodes: DagNode[] = [];
  const files: Array<{ path: string; sha256: string }> = [];
  for (const treePath of nodePaths(skill)) {
    const read = skillSourceRead(treePath);
    const path = treePath.slice(skill.length + 1);
    nodes.push(parseNodeFile(path, read.content));
    files.push({ path, sha256: read.sha256 });
  }
  const { byId, rules, facts } = lintDag(skill, nodes);
  return { skill, nodes, byId, rules, files, facts };
}

export interface ComposedRule {
  rule: DagRule;
  /** Facts the rule's `when` tests that the caller did not supply, in condition order. */
  conditional: string[];
}

/** A rule on the path left out of the composition: overridden (`by`), or its `when` failed (`failed`). */
export interface DroppedRule {
  rule: DagRule;
  by: DagRule | null;
  failed: Condition | null;
}

export interface Composition {
  /** Node ids, root first. */
  path: string[];
  rules: ComposedRule[];
  dropped: DroppedRule[];
  unknownFacts: string[];
}

/** A path is node ids from the root, each a move-edge child of the one before. */
function checkPath(dag: RulesDag, path: unknown): string[] {
  if (!Array.isArray(path) || path.length === 0 || path.some((id) => typeof id !== "string")) {
    throw new ValidationError(`path must be a list of node ids from the root, such as ["${dag.skill}", "${dag.skill}/job"]`);
  }
  if (path[0] !== dag.skill) throw new ValidationError(`path must start at the root node '${dag.skill}', not '${path[0]}'`);
  for (let i = 1; i < path.length; i++) {
    const from = dag.byId.get(path[i - 1])!;
    if (from.edges.some((e) => e.to === path[i])) continue;
    const what = dag.byId.has(path[i]) ? `${from.id} has no move edge to ${path[i]}` : `path names an unknown node '${path[i]}'`;
    throw new ValidationError(`${what}; the children of ${from.id} are: ${from.edges.map((e) => e.to).join(", ") || "none"}`);
  }
  return path as string[];
}

/**
 * The rules in force at a path (spec §4.3). Every rule on every node of the path is collected, root
 * first, then in file order. A rule whose `when` a supplied fact fails is dropped; one testing a fact
 * nobody supplied is kept with `conditional`. An unconditional rule on the path drops the rule it
 * overrides, even when it is itself overridden, so a chain leaves only its last rule. A conditional
 * rule overrides nothing, and a rule off the path is never collected, so it overrides nothing either.
 */
export function composeRules(dag: RulesDag, path: unknown, facts?: Record<string, unknown>): Composition {
  const steps = checkPath(dag, path);
  const { known, unknown } = normalizeFacts(facts, dag.facts);
  const seen = steps
    .flatMap((id) => dag.byId.get(id)!.rules)
    .map((rule) => {
      const conditional: string[] = [];
      let failed: Condition | null = null;
      for (const cond of rule.when) {
        const value = known.get(cond.fact);
        if (value === undefined) {
          if (!conditional.includes(cond.fact)) conditional.push(cond.fact);
        } else if (failed === null && !cond.values.includes(value)) {
          failed = cond;
        }
      }
      return { rule, conditional, failed };
    });
  const overriders = seen
    .filter((s) => s.failed === null && s.conditional.length === 0 && s.rule.overrides !== null)
    .map((s) => s.rule);
  const rules: ComposedRule[] = [];
  const dropped: DroppedRule[] = [];
  for (const { rule, conditional, failed } of seen) {
    const by = overriders.filter((o) => o.overrides === rule.id);
    if (failed !== null) dropped.push({ rule, by: null, failed });
    else if (by.length > 0) for (const o of by) dropped.push({ rule, by: o, failed: null });
    else rules.push({ rule, conditional });
  }
  return { path: steps, rules, dropped, unknownFacts: unknown };
}

export function xmlAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

export function xmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/]]>/g, "]]&gt;");
}

export interface RenderOptions {
  /** Attributes written on `<rules>` after `position`, in order. */
  attrs?: Array<[string, string]>;
  /** The path a sideways move left, written on `<position>` (spec §4.4). */
  left?: string[];
  /** Lines after `<position>`. */
  head?: string[];
  /** Lines before the closing tag (the audit's sections). */
  extra?: string[];
}

/**
 * The composition as XML (spec §4.4). Rule text is escaped but never indented, since an indent
 * would change its markdown. `<likely_next>` lists every move edge out of the position, heaviest
 * first, ties in file order.
 */
export function renderRules(dag: RulesDag, composed: Composition, options: RenderOptions = {}): string {
  const position = composed.path[composed.path.length - 1];
  const attrs = (options.attrs ?? []).map(([name, value]) => ` ${name}="${xmlAttr(value)}"`).join("");
  const left = options.left ? ` left="${xmlAttr(options.left.join(" "))}"` : "";
  const lines = [
    `<rules position="${xmlAttr(position)}"${attrs}>`,
    `  <position path="${xmlAttr(composed.path.join(" "))}"${left}/>`,
    ...(options.head ?? []),
  ];
  if (composed.unknownFacts.length > 0) lines.push(`  <unknown_facts names="${xmlAttr(composed.unknownFacts.join(" "))}"/>`);
  for (const { rule, conditional } of composed.rules) {
    const on = conditional.length > 0 ? ` conditional_on="${xmlAttr(conditional.join(" "))}"` : "";
    lines.push(`  <rule id="${xmlAttr(rule.id)}" node="${xmlAttr(rule.node)}"${on}>`, xmlText(rule.text), "  </rule>");
  }
  const next = [...dag.byId.get(position)!.edges].sort((a, b) => b.weight - a.weight);
  if (next.length > 0) {
    lines.push("  <likely_next>");
    for (const edge of next) {
      lines.push(`    <node id="${xmlAttr(edge.to)}" weight="${edge.weight}" when="${xmlAttr(dag.byId.get(edge.to)!.when)}"/>`);
    }
    lines.push("  </likely_next>");
  }
  return [...lines, ...(options.extra ?? []), "</rules>"].join("\n");
}

/** An audit section, written as one empty tag when it has no lines. */
function section(open: string, close: string, empty: string, items: string[]): string[] {
  return items.length === 0 ? [empty] : [open, ...items, close];
}

function overrideLine(rule: DagRule, withTarget: boolean): string {
  const target = withTarget ? ` target="${xmlAttr(rule.overrides!)}"` : "";
  return `    <override by="${xmlAttr(rule.id)}" node="${xmlAttr(rule.node)}"${target} reason="${xmlAttr(rule.reason!)}"/>`;
}

/**
 * `rules__at`: the rules in force at `path`, given the facts the caller knows, as XML. Read-only:
 * it takes no session, stores nothing and logs nothing (spec §4.8).
 */
export function rulesAt(skill: string, path: unknown, facts?: Record<string, unknown>): string {
  const dag = loadRulesDag(skill);
  return renderRules(dag, composeRules(dag, path, facts));
}

/**
 * `rules__audit` (spec §4.9): the same composition, plus `<omitted>` (every rule on the path left out,
 * with what overrode it and the edge's reason, or the condition a supplied fact failed),
 * `<root_overrides>` (every override edge in the map that targets a rule on the root node, spec §7)
 * and, given `rule_id`, `<incoming>` (every override edge in the map that targets that rule).
 */
export function rulesAudit(skill: string, path: unknown, ruleId?: string, facts?: Record<string, unknown>): string {
  const dag = loadRulesDag(skill);
  const composed = composeRules(dag, path, facts);
  const target = ruleId === undefined ? undefined : dag.rules.get(ruleId);
  if (ruleId !== undefined && !target) throw new ValidationError(`rule_id '${ruleId}' names no rule in the ${skill} map`);
  const all = [...dag.rules.values()];
  const omitted = composed.dropped.map(({ rule, by, failed }) => {
    const cause = by
      ? `by="${xmlAttr(by.id)}" reason="${xmlAttr(by.reason!)}"`
      : `failed="${xmlAttr(`${failed!.fact}:${failed!.values.join("|")}`)}"`;
    return `    <dropped id="${xmlAttr(rule.id)}" node="${xmlAttr(rule.node)}" ${cause}/>`;
  });
  const rootOverrides = all
    .filter((r) => r.overrides !== null && dag.rules.get(r.overrides)!.node === skill)
    .map((r) => overrideLine(r, true));
  const extra = [
    ...section("  <omitted>", "  </omitted>", "  <omitted/>", omitted),
    ...section("  <root_overrides>", "  </root_overrides>", "  <root_overrides/>", rootOverrides),
  ];
  if (target) {
    const head = `<incoming rule="${xmlAttr(target.id)}" node="${xmlAttr(target.node)}"`;
    const incoming = all.filter((r) => r.overrides === target.id).map((r) => overrideLine(r, false));
    extra.push(...section(`  ${head}>`, "  </incoming>", `  ${head}/>`, incoming));
  }
  return renderRules(dag, composed, { extra });
}
