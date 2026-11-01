// Skill rules: the working rules a skill's own markdown gives for one
// operation (planning/1. Design/2026-10-08_contextual-rule-injection-spec.md).
//
// A skill marks its markdown with atom tags, each an HTML comment on its own
// line: `<!-- atom id=draft.x ops=dispatch when=job_held:false defeats=draft.y -->`.
// An atom runs from its tag to the next tag or the end of the file. SKILL.md
// holds one vocabulary block, between `<!-- atom-vocabulary -->` and
// `<!-- /atom-vocabulary -->`, naming the operations and the facts with their
// values, so the enum is kept in one place.
//
// The markdown is the only source. Every call reads SKILL.md and each
// `references/*.md` carrying a tag through skill-source.ts, which resolves its
// roots lazily per call, never at module load. Nothing is generated or cached.
//
// Fail closed: a tag lint failure throws, an unsupplied fact never drops an
// atom (it comes back marked `conditional_on`), and an unknown operation is
// reported with the valid ones rather than guessed at. The output carries no
// timestamp and a fixed key order, so the same input gives the same bytes.

import { DataServerError, ValidationError } from "../errors.js";
import { loadRulesDag } from "./rules-dag.js";
import { skillSourceList, skillSourceRead } from "./skill-source.js";

const VOCAB_OPEN = "<!-- atom-vocabulary -->";
const VOCAB_CLOSE = "<!-- /atom-vocabulary -->";
const TAG_PREFIX = "<!-- atom";
const TAG_RE = /^<!-- atom (.+) -->$/;
const NAME_RE = /^[a-z][a-z0-9_]*$/;
const ID_RE = /^[a-z0-9][a-z0-9._-]*$/;
const SKILL_RE = /^[a-z0-9][a-z0-9-]*$/;
const HEADING_RE = /^#{1,6}(\s|$)/;
const STAMP_RE = /^(<!-- litigation v\S+ -->|> \*\*Installed copy\.\*\* |> \*\*HTML pages\.\*\* )/;
const NO_MATCH_NOTE = "no specific rule matched";

export interface Condition {
  fact: string;
  values: string[];
}

export interface Atom {
  id: string;
  ops: string[];
  when: Condition[];
  defeats: string[];
  path: string;
  start: number;
  end: number;
  text: string;
}

export interface ParsedFile {
  path: string;
  sha256: string;
  linesTotal: number;
  unmapped: Array<{ line: number; text: string }>;
  atoms: Atom[];
  vocab: Array<{ where: string; line: string }> | null;
}

export interface Skill {
  files: ParsedFile[];
  atoms: Atom[];
  ops: string[];
  facts: Map<string, string[]>;
}

export interface SkillRule {
  id: string;
  source: string;
  text: string;
  conditional_on?: string[];
}

export interface SkillRulesResult {
  skill: string;
  operation: string;
  matched: boolean;
  always_on: string[];
  rules: SkillRule[];
  /** Atoms that would have been served but a node rule `replaces` (rules-DAG spec §5). */
  replaced?: string[];
  note?: string;
  valid_operations?: string[];
  unknown_facts?: string[];
  sources: Array<{ path: string; sha256: string }>;
}

export interface SkillRulesCoverage {
  skill: string;
  files: Array<{
    path: string;
    sha256: string;
    lines_total: number;
    lines_unmapped: number;
    unmapped: Array<{ line: number; text: string }>;
  }>;
}

function lint(message: string): DataServerError {
  return new DataServerError(message, "skill_rules_lint");
}

function isSpecial(ops: string[]): boolean {
  return ops.length === 1 && (ops[0] === "always" || ops[0] === "none");
}

/**
 * A tag's `key=value` attributes, separated by whitespace. A value with spaces
 * is double-quoted (`title="Release a job"`); a quoted value runs to the next
 * `"`, which must end the attribute, and holds no `"` of its own. `fail` builds
 * the caller's lint error, so each tag kind keeps its own error code.
 */
export function parseTagAttributes(
  body: string,
  where: string,
  tag: string,
  allowed: string[],
  fail: (message: string) => DataServerError
): Map<string, string> {
  const attrs = new Map<string, string>();
  let i = 0;
  while (i < body.length) {
    if (/\s/.test(body[i])) {
      i++;
      continue;
    }
    let j = i;
    while (j < body.length && body[j] !== "=" && !/\s/.test(body[j])) j++;
    if (body[j] !== "=") throw fail(`${where}: ${tag} tag attribute without '=': ${body.slice(i, j)}`);
    const key = body.slice(i, j);
    let value: string;
    if (body[j + 1] === '"') {
      const close = body.indexOf('"', j + 2);
      if (close === -1) throw fail(`${where}: ${tag} tag '${key}' has an unclosed quote`);
      if (close + 1 < body.length && !/\s/.test(body[close + 1])) throw fail(`${where}: ${tag} tag '${key}' has text after its closing quote`);
      value = body.slice(j + 2, close);
      // A markdown renderer would end the comment at the value's `-->`.
      if (value.includes("--")) throw fail(`${where}: ${tag} tag '${key}' holds '--' inside its quotes`);
      i = close + 1;
    } else {
      let k = j + 1;
      while (k < body.length && !/\s/.test(body[k])) k++;
      value = body.slice(j + 1, k);
      i = k;
    }
    if (!allowed.includes(key)) throw fail(`${where}: unknown ${tag} tag attribute '${key}'`);
    if (attrs.has(key)) throw fail(`${where}: ${tag} tag repeats '${key}'`);
    if (value === "") throw fail(`${where}: ${tag} tag '${key}' is empty`);
    attrs.set(key, value);
  }
  return attrs;
}

/** A `when` attribute: a comma list of `fact:value` conditions, `fact:a|b` accepting either. */
export function parseWhen(raw: string | undefined, where: string, fail: (message: string) => DataServerError): Condition[] {
  const when: Condition[] = [];
  for (const cond of (raw ?? "").split(",").filter((c) => c !== "")) {
    const colon = cond.indexOf(":");
    if (colon === -1) throw fail(`${where}: when condition '${cond}' is not fact:value`);
    when.push({ fact: cond.slice(0, colon), values: cond.slice(colon + 1).split("|") });
  }
  return when;
}

function parseTag(raw: string, where: string): Omit<Atom, "path" | "start" | "end" | "text"> {
  const match = TAG_RE.exec(raw);
  if (!match) throw lint(`${where}: malformed atom tag: ${raw}`);
  const attrs = parseTagAttributes(match[1], where, "atom", ["id", "ops", "when", "defeats"], lint);
  const id = attrs.get("id");
  const opsRaw = attrs.get("ops");
  if (id === undefined) throw lint(`${where}: atom tag lacks 'id'`);
  if (opsRaw === undefined) throw lint(`${where}: atom tag lacks 'ops'`);
  if (!ID_RE.test(id)) throw lint(`${where}: bad atom id '${id}'`);
  const ops = opsRaw.split(",");
  if ((ops.includes("always") || ops.includes("none")) && ops.length > 1) {
    throw lint(`${where}: 'always' and 'none' stand alone in ops`);
  }
  const when = parseWhen(attrs.get("when"), where, lint);
  const defeats = (attrs.get("defeats") ?? "").split(",").filter((d) => d !== "");
  return { id, ops, when, defeats };
}

/** Parse one file into atoms, its coverage, and (SKILL.md only) its vocabulary lines. */
function parseFile(path: string, content: string, sha256: string, isSkill: boolean): ParsedFile {
  let lines = content.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines = lines.slice(0, -1);
  lines = lines.map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));

  const exempt = new Array<boolean>(lines.length).fill(false);
  const owned = new Array<boolean>(lines.length).fill(false);
  const spans = new Map<Atom, number[]>();
  const atoms: Atom[] = [];
  const vocab: Array<{ where: string; line: string }> = [];
  let inVocab = false;
  let vocabSeen = false;
  let current: Atom | null = null;

  if (lines[0] === "---") {
    const close = lines.indexOf("---", 1);
    if (close !== -1) {
      for (let i = 0; i <= close; i++) exempt[i] = true;
      // An installed SKILL.md carries the packager's stamped preamble right
      // after its front matter (check_plugin_skill_md.py preamble_lines()).
      for (let i = close + 1; i < lines.length && (lines[i] === "" || STAMP_RE.test(lines[i])); i++) exempt[i] = true;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    if (exempt[i]) continue;
    const where = `${path}:${i + 1}`;
    const trimmed = lines[i].trimEnd();
    if (trimmed === VOCAB_OPEN) {
      if (!isSkill) throw lint(`${where}: the vocabulary block belongs in SKILL.md only`);
      if (vocabSeen) throw lint(`${where}: a second vocabulary block`);
      vocabSeen = inVocab = true;
      current = null;
      exempt[i] = true;
    } else if (trimmed === VOCAB_CLOSE) {
      if (!inVocab) throw lint(`${where}: vocabulary close without an open`);
      inVocab = false;
      exempt[i] = true;
    } else if (inVocab) {
      vocab.push({ where, line: lines[i] });
      exempt[i] = true;
    } else if (trimmed.startsWith(TAG_PREFIX)) {
      current = { ...parseTag(trimmed, where), path, start: 0, end: 0, text: "" };
      atoms.push(current);
      spans.set(current, []);
      exempt[i] = true;
    } else if (current) {
      spans.get(current)!.push(i);
      owned[i] = true;
    }
  }
  if (inVocab) throw lint(`${path}: the vocabulary block is never closed`);
  if (isSkill && !vocabSeen) throw lint(`${path}: no vocabulary block`);

  for (const atom of atoms) {
    const body = spans.get(atom)!.filter((i) => lines[i].trim() !== "");
    if (body.length === 0) throw lint(`${path}: atom ${atom.id} has no text`);
    const first = body[0];
    const last = body[body.length - 1];
    atom.start = first + 1;
    atom.end = last + 1;
    atom.text = lines.slice(first, last + 1).join("\n");
  }

  const unmapped: Array<{ line: number; text: string }> = [];
  lines.forEach((line, i) => {
    if (exempt[i] || line.trim() === "" || HEADING_RE.test(line)) return;
    if (i < 2 && (line.startsWith("Read when:") || line.startsWith("Assumes"))) return;
    if (!owned[i]) unmapped.push({ line: i + 1, text: line });
  });

  return { path, sha256, linesTotal: lines.length, unmapped, atoms, vocab: isSkill ? vocab : null };
}

function parseVocabulary(rows: Array<{ where: string; line: string }>): { ops: string[]; facts: Map<string, string[]> } {
  const ops: string[] = [];
  const facts = new Map<string, string[]>();
  let mode: "Operation" | "Fact" | null = null;
  for (const { where, line } of rows) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    const cells = trimmed.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
    const head = cells[0];
    if (head === "Operation" || head === "Fact") {
      mode = head;
      continue;
    }
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
    if (mode === null) throw lint(`${where}: vocabulary row before an Operation or Fact header`);
    const names = [...head.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    if (names.length === 0) throw lint(`${where}: vocabulary row names nothing`);
    for (const name of names) {
      if (!NAME_RE.test(name) || name === "always" || name === "none") throw lint(`${where}: bad vocabulary name '${name}'`);
      if (mode === "Operation") {
        if (ops.includes(name)) throw lint(`${where}: operation '${name}' declared twice`);
        ops.push(name);
      } else {
        if (facts.has(name)) throw lint(`${where}: fact '${name}' declared twice`);
        const values = [...(cells[1] ?? "").matchAll(/`([^`]+)`/g)].map((m) => m[1]);
        if (values.length === 0) throw lint(`${where}: fact '${name}' lists no values`);
        facts.set(name, values);
      }
    }
  }
  if (ops.length === 0) throw lint("SKILL.md: the vocabulary declares no operation");
  return { ops, facts };
}

function lintAtoms(atoms: Atom[], ops: string[], facts: Map<string, string[]>): void {
  const byId = new Map<string, Atom>();
  for (const atom of atoms) {
    const prior = byId.get(atom.id);
    if (prior) throw lint(`duplicate atom id ${atom.id} (${prior.path}:${prior.start} and ${atom.path}:${atom.start})`);
    byId.set(atom.id, atom);
  }
  for (const atom of atoms) {
    const where = `${atom.path}:${atom.start} (${atom.id})`;
    const special = isSpecial(atom.ops);
    if (atom.ops[0] === "always" && atom.path !== "SKILL.md") throw lint(`${where}: an always atom must be in SKILL.md`);
    if (special && (atom.when.length > 0 || atom.defeats.length > 0)) {
      throw lint(`${where}: an always or none atom takes no when or defeats`);
    }
    if (!special) {
      for (const op of atom.ops) if (!ops.includes(op)) throw lint(`${where}: operation '${op}' is not in the vocabulary`);
    }
    for (const { fact, values } of atom.when) {
      const allowed = facts.get(fact);
      if (!allowed) throw lint(`${where}: fact '${fact}' is not in the vocabulary`);
      for (const value of values) {
        if (!allowed.includes(value)) throw lint(`${where}: '${value}' is not a value of fact '${fact}'`);
      }
    }
    for (const target of atom.defeats) {
      if (target === atom.id) throw lint(`${where}: an atom cannot defeat itself`);
      const parent = byId.get(target);
      if (!parent) throw lint(`${where}: defeats a missing atom '${target}'`);
      if (isSpecial(parent.ops)) throw lint(`${where}: defeats an always or none atom '${target}'`);
      if (!parent.ops.some((op) => atom.ops.includes(op))) {
        throw lint(`${where}: dead exception: shares no operation with '${target}'`);
      }
    }
  }
  const state = new Map<string, "open" | "done">();
  const visit = (id: string, trail: string[]): void => {
    const seen = state.get(id);
    if (seen === "done") return;
    if (seen === "open") throw lint(`defeat cycle: ${[...trail, id].join(" -> ")}`);
    state.set(id, "open");
    for (const target of byId.get(id)!.defeats) visit(target, [...trail, id]);
    state.set(id, "done");
  };
  for (const atom of atoms) visit(atom.id, []);
}

function hasTag(content: string): boolean {
  return content.split("\n").some((line) => line.trimEnd().startsWith(TAG_PREFIX));
}

/** The skill's tagged reference files, by tree-relative path, in sorted order. */
function referencePaths(skill: string): string[] {
  let entries: ReturnType<typeof skillSourceList>["entries"];
  try {
    entries = skillSourceList(`${skill}/references`).entries;
  } catch (err) {
    if (err instanceof DataServerError && err.code === "not_found") return [];
    throw err;
  }
  const prefix = `${skill}/references/`;
  return entries
    .filter((e) => e.type === "file" && e.path.startsWith(prefix) && !e.path.slice(prefix.length).includes("/") && e.path.endsWith(".md"))
    .map((e) => e.path)
    .sort();
}

export function loadSkill(skill: string): Skill {
  if (typeof skill !== "string" || !SKILL_RE.test(skill)) {
    throw new ValidationError(`skill must be a skill folder name such as "draft", not ${JSON.stringify(skill)}`);
  }
  const main = skillSourceRead(`${skill}/SKILL.md`);
  // A skill never tagged (drafting-data) serves no rules by operation: say so, not a lint failure.
  if (!main.content.includes(VOCAB_OPEN) && !hasTag(main.content)) {
    throw new ValidationError(`${skill} serves no rules by operation: read the section of its SKILL.md or reference that the calling rule names`, "not_served");
  }
  const files = [parseFile("SKILL.md", main.content, main.sha256, true)];
  for (const treePath of referencePaths(skill)) {
    const read = skillSourceRead(treePath);
    if (!hasTag(read.content)) continue;
    files.push(parseFile(treePath.slice(skill.length + 1), read.content, read.sha256, false));
  }
  const { ops, facts } = parseVocabulary(files[0].vocab ?? []);
  const atoms = files.flatMap((f) => f.atoms);
  lintAtoms(atoms, ops, facts);
  return { files, atoms, ops, facts };
}

/**
 * The atom ids the skill's node rules `replace` (rules-DAG spec §5), none if the skill has no
 * `rules/nodes/`. A node map that fails its lints fails this call too, never silently ignored.
 */
function replacedAtoms(skill: string): Set<string> {
  try {
    skillSourceList(`${skill}/rules/nodes`);
  } catch (err) {
    if (err instanceof DataServerError && err.code === "not_found") return new Set();
    throw err;
  }
  return new Set([...loadRulesDag(skill).rules.values()].flatMap((r) => r.replaces));
}

export function normalizeFacts(
  input: Record<string, unknown> | undefined,
  facts: Map<string, string[]>
): { known: Map<string, string>; unknown: string[] } {
  const known = new Map<string, string>();
  const unknown: string[] = [];
  for (const key of Object.keys(input ?? {}).sort()) {
    const raw = input![key];
    if (typeof raw !== "string" && typeof raw !== "boolean") {
      throw new ValidationError(`facts.${key} must be a string or a boolean`);
    }
    const allowed = facts.get(key);
    if (!allowed) {
      unknown.push(key);
      continue;
    }
    const value = typeof raw === "boolean" ? String(raw) : raw;
    if (!allowed.includes(value)) {
      throw new ValidationError(`facts.${key} must be one of: ${allowed.join(", ")} (got ${JSON.stringify(raw)})`);
    }
    known.set(key, value);
  }
  return { known, unknown };
}

/**
 * The rules a skill's markdown gives for one operation, given the facts the
 * caller knows. Atoms whose `ops` name the operation and whose `when` holds are
 * selected; one testing a fact the caller did not supply is returned with
 * `conditional_on`. A selected atom with no `conditional_on` removes each atom
 * it `defeats`. An atom left after that which a rule in the skill's node map
 * `replaces` is left out and named in `replaced` (rules-DAG spec §5); a node
 * map that fails its lints fails the call. Rules come in file order (SKILL.md,
 * then references sorted), then line order. `ops=always` atoms are listed by id
 * only, since their text is the SKILL.md the session already loaded.
 */
export function skillRulesApplicable(
  skill: string,
  operation: string,
  facts?: Record<string, unknown>
): SkillRulesResult {
  const loaded = loadSkill(skill);
  const { known, unknown } = normalizeFacts(facts, loaded.facts);
  const alwaysOn = loaded.atoms.filter((a) => a.ops[0] === "always").map((a) => a.id);
  // SKILL.md (home of the always-on atoms) plus each file a returned rule came from.
  const sourcesFor = (rules: SkillRule[]) =>
    loaded.files
      .filter((f) => f.path === "SKILL.md" || rules.some((r) => r.source.startsWith(`${f.path}:`)))
      .map((f) => ({ path: f.path, sha256: f.sha256 }));

  if (!loaded.ops.includes(operation)) {
    return {
      skill,
      operation,
      matched: false,
      always_on: alwaysOn,
      rules: [],
      note: NO_MATCH_NOTE,
      valid_operations: [...loaded.ops],
      ...(unknown.length > 0 ? { unknown_facts: unknown } : {}),
      sources: sourcesFor([]),
    };
  }

  const picked: Array<{ atom: Atom; conditional: string[] }> = [];
  for (const atom of loaded.atoms) {
    if (!atom.ops.includes(operation)) continue;
    const conditional: string[] = [];
    let holds = true;
    for (const { fact, values } of atom.when) {
      const value = known.get(fact);
      if (value === undefined) {
        if (!conditional.includes(fact)) conditional.push(fact);
      } else if (!values.includes(value)) {
        holds = false;
      }
    }
    if (holds) picked.push({ atom, conditional });
  }
  const defeated = new Set<string>();
  for (const { atom, conditional } of picked) {
    if (conditional.length === 0) for (const target of atom.defeats) defeated.add(target);
  }
  // A replaced atom still defeats: its edge stays a pilot edge until both ends have migrated (spec §5).
  const served = picked.filter(({ atom }) => !defeated.has(atom.id));
  const replaces = replacedAtoms(skill);
  const replaced = served.filter(({ atom }) => replaces.has(atom.id)).map(({ atom }) => atom.id);
  const rules: SkillRule[] = served
    .filter(({ atom }) => !replaces.has(atom.id))
    .map(({ atom, conditional }) => ({
      id: atom.id,
      source: `${atom.path}:${atom.start}-${atom.end}`,
      text: atom.text,
      ...(conditional.length > 0 ? { conditional_on: conditional } : {}),
    }));

  return {
    skill,
    operation,
    matched: rules.length > 0,
    always_on: alwaysOn,
    rules,
    ...(replaced.length > 0 ? { replaced } : {}),
    ...(rules.length === 0 ? { note: NO_MATCH_NOTE } : {}),
    ...(unknown.length > 0 ? { unknown_facts: unknown } : {}),
    sources: sourcesFor(rules),
  };
}

/**
 * For SKILL.md and each tagged reference file: lines total, and every
 * non-blank line outside an atom span. Front matter, `#` headings, the tag
 * lines, the vocabulary block and a line-1/2 `Read when:`/`Assumes` line are
 * exempt. Lints run first, so a broken tag set fails here too.
 */
export function skillRulesCoverage(skill: string): SkillRulesCoverage {
  const loaded = loadSkill(skill);
  return {
    skill,
    files: loaded.files.map((f) => ({
      path: f.path,
      sha256: f.sha256,
      lines_total: f.linesTotal,
      lines_unmapped: f.unmapped.length,
      unmapped: f.unmapped,
    })),
  };
}
