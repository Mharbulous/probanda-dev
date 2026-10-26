// Rules position: where a session stands on its skill's map of rule nodes, kept in the matter's
// drafting database (Engineering/1. Spec/2026-10-09_rules-dag-spec.md §4.4-§4.8, schema v73).
//
// `rules__move` and `rules__branch` store the path, read the facts the drafting database holds,
// log each rule whose text they send, and return the composition at the new position as XML
// (rules-dag.ts). No position row exists before a session's first move.
//
// Rules already sent are not resent. Each block is a delta against the rules the branch's last
// block left in force (`in_force`): a rule new to it, or whose `conditional_on` changed, is sent
// whole; one no longer in force is named in `<withdrawn>`; one still in force is named in `<kept>`.
// A session's first move, a sideways jump, a takeover and a stay (a move to the current node, the
// resume) send the whole path instead. Root rules are never sent and never in force here: they live
// in SKILL.md, which the session already holds (spec §4.4).
//
// Out of bounds (spec §4.6): an MCP tool cannot spawn an agent, so entering the out-of-bounds node
// returns an `<improvise>` instruction to spawn rules-improviser, and `rules__provisional` records
// the rules it wrote, with the turn's summary, on the visit. They are served once, tagged
// provisional, and never enter the serve log or a takeover. An in-bounds move that ends more than
// one edge from the current path (never a first move or a takeover) returns a `<reorient>`
// instruction to spawn rules-reorienter in the background.
//
// The position is written first and must succeed. The serve log is written after it, and a failure
// there comes back as `<log_error>`, never thrown, so the log never blocks serving rules.

import { DataServerError, ValidationError } from "../errors.js";
import { submissionDataWriteAll, type WriteStatement } from "../submission/backend.js";
import { composeRules, loadRulesDag, renderRules, xmlAttr, xmlText, type ComposedRule, type Composition, type RulesDag } from "./rules-dag.js";
import { normalizeFacts } from "./skill-rules.js";
import { rows } from "../submission/query-rows.js";

const POSITION_SCHEMA_VERSION = 73;
const NOW = "strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime')";
const MAIN = "main";
/** Facts read from the drafting database at every call, never taken from the caller. */
const DB_FACTS = ["job_held", "job_steps"];
/** Facts supplied once and kept with the position. Any other supplied fact holds for one call. */
const SESSION_FACTS = ["unattended", "host"];

/** Rule ids in force, each with the facts it is conditional on, in composition order. */
type InForce = Array<[string, string[]]>;

interface Position {
  branch: string;
  path: string[];
  sessionFacts: Record<string, string>;
  inForce: InForce;
}

interface Served {
  sent: ComposedRule[];
  kept: string[];
  withdrawn: string[];
  inForce: InForce;
}

export interface MoveArgs {
  db_path: string;
  session_token: string;
  /** A node id, "up", "takeover" or "out_of_bounds". */
  to: string;
  facts?: Record<string, unknown>;
}

export interface ProvisionalArgs {
  db_path: string;
  session_token: string;
  turn_summary: string;
  rules: unknown;
}

export interface BranchArgs {
  db_path: string;
  session_token: string;
  action: string;
  label: string;
}

function checkArgs(tool: string, dbPath: unknown, token: unknown): void {
  if (typeof dbPath !== "string" || dbPath.trim() === "") throw new ValidationError(`${tool}.db_path must be the matter's drafting database`);
  if (typeof token !== "string" || token.trim() === "") {
    throw new ValidationError(`${tool}.session_token must be the session_token open_session or bootstrap returned`, "invalid_session_token");
  }
}

export function assertSchema(tool: string, dbPath: string): void {
  const [row] = rows<{ value: string }>(dbPath, "SELECT value FROM db_meta WHERE key = 'schema_version'");
  const version = row === undefined ? 0 : Number(row.value);
  if (version < POSITION_SCHEMA_VERSION) {
    throw new DataServerError(
      `${tool}: the drafting database ${dbPath} is at schema version ${version}, and the rules position needs version ` +
        `${POSITION_SCHEMA_VERSION}. Run drafting_data__migrate on it first.`,
      "schema_behind"
    );
  }
}

function readPositions(dbPath: string, token: string): Map<string, Position> {
  const found = rows<{ branch: string; path: string; session_facts: string; in_force: string }>(
    dbPath,
    "SELECT branch, path, session_facts, in_force FROM session_position WHERE session_token = ? ORDER BY branch",
    [token]
  );
  return new Map(
    found.map((r) => [
      r.branch,
      { branch: r.branch, path: r.path.split(" "), sessionFacts: JSON.parse(r.session_facts), inForce: JSON.parse(r.in_force) },
    ])
  );
}

/** The job this session holds: a ticket in progress under its token, or null. */
function heldJob(dbPath: string, token: string): number | null {
  const [row] = rows<{ id: number }>(dbPath, "SELECT id FROM tickets WHERE locked_by = ? AND status = 'wip' ORDER BY id LIMIT 1", [token]);
  return row === undefined ? null : row.id;
}

/** `job_held`, and `job_steps` for a held job with steps, where the skill's vocabulary names them. */
function databaseFacts(dag: RulesDag, dbPath: string, job: number | null): Record<string, string> {
  const facts: Record<string, string> = {};
  if (dag.facts.has("job_held")) facts.job_held = job === null ? "false" : "true";
  if (job !== null && dag.facts.has("job_steps")) {
    const [{ n }] = rows<{ n: number }>(dbPath, "SELECT COUNT(*) AS n FROM ticket_steps WHERE ticket_id = ?", [job]);
    // With no steps the fact is left unknown, so its rules come back conditional on it.
    if (n === 1) facts.job_steps = "one";
    else if (n > 1) facts.job_steps = "many";
  }
  return facts;
}

/** The session facts after this call, and the facts that hold for this call only. */
function splitFacts(
  tool: string,
  dag: RulesDag,
  stored: Record<string, string>,
  supplied: Record<string, unknown> | undefined
): { session: Record<string, string>; turn: Record<string, unknown> } {
  const given = supplied ?? {};
  for (const key of DB_FACTS) {
    if (Object.hasOwn(given, key)) throw new ValidationError(`${tool}: facts.${key} is read from the drafting database at every call; leave it out`);
  }
  const { known } = normalizeFacts(given, dag.facts);
  const session = { ...stored };
  for (const key of SESSION_FACTS) {
    const value = known.get(key);
    if (value !== undefined) session[key] = value;
  }
  const turn = Object.fromEntries(Object.entries(given).filter(([key]) => !SESSION_FACTS.includes(key)));
  return { session: Object.fromEntries(Object.entries(session).sort(([a], [b]) => (a < b ? -1 : 1))), turn };
}

/** The longest prefix of a stored path that is still a path on the map, which may have changed. */
function livePrefix(dag: RulesDag, path: string[]): string[] {
  let i = 1;
  while (i < path.length && dag.byId.get(path[i - 1])!.edges.some((e) => e.to === path[i])) i++;
  return path.slice(0, i);
}

/** A node's children, heaviest edge first, ties in file order, as `<likely_next>` lists them. */
function children(dag: RulesDag, id: string): string[] {
  return [...dag.byId.get(id)!.edges].sort((a, b) => b.weight - a.weight).map((e) => e.to);
}

/** The shortest move-edge route from `from` down to `to`, without `from`, heavier edges first on a tie. */
function route(dag: RulesDag, from: string, to: string): string[] | null {
  if (from === to) return [];
  const parent = new Map<string, string>();
  const queue = [from];
  while (queue.length > 0) {
    const at = queue.shift()!;
    for (const child of children(dag, at)) {
      if (parent.has(child)) continue;
      parent.set(child, at);
      if (child === to) {
        const found = [child];
        for (let step = at; step !== from; step = parent.get(step)!) found.unshift(step);
        return found;
      }
      queue.push(child);
    }
  }
  return null;
}

/**
 * The path a move to `to` takes: the current path kept down to its deepest node from which `to`
 * can be reached, then the shortest route down. The root reaches every node (a lint), so a node
 * reached from nowhere lower is reached from the root.
 */
function pathTo(dag: RulesDag, current: string[], to: string): string[] {
  for (let i = current.length - 1; i > 0; i--) {
    const down = route(dag, current[i], to);
    if (down !== null) return [...current.slice(0, i + 1), ...down];
  }
  return [current[0], ...route(dag, current[0], to)!];
}

const isPrefix = (a: string[], b: string[]): boolean => a.length <= b.length && a.every((id, i) => b[i] === id);

/** What to send, given what the branch's last block left in force (null: send the whole path). */
function serve(composed: Composition, skill: string, prior: InForce | null): Served {
  const live = composed.rules.filter(({ rule }) => rule.node !== skill);
  const inForce: InForce = live.map(({ rule, conditional }) => [rule.id, conditional]);
  if (prior === null) return { sent: live, kept: [], withdrawn: [], inForce };
  const before = new Map(prior.map(([id, on]) => [id, on.join(" ")]));
  const same = ({ rule, conditional }: ComposedRule) => before.get(rule.id) === conditional.join(" ");
  const now = new Set(live.map(({ rule }) => rule.id));
  return {
    sent: live.filter((r) => !same(r)),
    kept: live.filter(same).map(({ rule }) => rule.id),
    withdrawn: prior.map(([id]) => id).filter((id) => !now.has(id)),
    inForce,
  };
}

/** One serve-log row per rule whose text was sent. A failure is returned, never thrown. */
async function logServed(dbPath: string, token: string, path: string[], sent: ComposedRule[], env: NodeJS.ProcessEnv): Promise<string | null> {
  if (sent.length === 0) return null;
  const statements = sent.map(({ rule }) => ({
    sql: `INSERT INTO rule_served (rule_id, node, path, session_token, served_at) VALUES (?, ?, ?, ?, ${NOW})`,
    params: [rule.id, rule.node, path.join(" "), token],
  }));
  try {
    const written = await submissionDataWriteAll(dbPath, statements, env);
    return written.ok ? null : `the serve log was not written: statement ${written.failed} changed ${written.changes} rows`;
  } catch (err) {
    return `the serve log was not written: ${err instanceof Error ? err.message : String(err)}`;
  }
}

interface BlockOptions {
  branch: string;
  job: number | null;
  full: boolean;
  left?: string[];
  head?: string[];
  warning?: string;
  logError: string | null;
}

function block(dag: RulesDag, composed: Composition, served: Served, options: BlockOptions): string {
  const attrs: Array<[string, string]> = [["branch", options.branch]];
  if (options.job !== null) attrs.push(["job", String(options.job)]);
  attrs.push(["serve", options.full ? "full" : "delta"]);
  const head = [...(options.head ?? [])];
  if (served.kept.length > 0) head.push(`  <kept ids="${xmlAttr(served.kept.join(" "))}"/>`);
  if (served.withdrawn.length > 0) head.push(`  <withdrawn ids="${xmlAttr(served.withdrawn.join(" "))}"/>`);
  const extra: string[] = [];
  if (options.warning) extra.push(`  <warning message="${xmlAttr(options.warning)}"/>`);
  if (options.logError !== null) extra.push(`  <log_error message="${xmlAttr(options.logError)}"/>`);
  return renderRules(dag, { ...composed, rules: served.sent }, { attrs, left: options.left, head, extra });
}

const UPSERT_POSITION =
  "INSERT INTO session_position (session_token, branch, path, session_facts, in_force, updated_at) " +
  `VALUES (?, ?, ?, ?, ?, ${NOW}) ON CONFLICT (session_token, branch) DO UPDATE SET path = excluded.path, ` +
  "session_facts = excluded.session_facts, in_force = excluded.in_force, updated_at = excluded.updated_at";

/** Runs right after the visit's INSERT, so `last_insert_rowid()` is the visit. */
const OUT_OF_BOUNDS_JOB_POSITION =
  `INSERT INTO job_position (job_id, last_in_bounds_path, went_out_of_bounds_to, updated_at) VALUES (?, ?, last_insert_rowid(), ${NOW}) ` +
  "ON CONFLICT (job_id) DO UPDATE SET went_out_of_bounds_to = excluded.went_out_of_bounds_to, updated_at = excluded.updated_at";

const UPSERT_JOB_POSITION =
  `INSERT INTO job_position (job_id, last_in_bounds_path, went_out_of_bounds_to, updated_at) VALUES (?, ?, NULL, ${NOW}) ` +
  "ON CONFLICT (job_id) DO UPDATE SET last_in_bounds_path = excluded.last_in_bounds_path, went_out_of_bounds_to = NULL, " +
  "updated_at = excluded.updated_at";

/**
 * `rules__move` (spec §4.5): move this session's main branch to `to` and return the rules in force
 * there. `to` is a node id (a child, an ancestor, or a jump anywhere on the map), `up`, `takeover`
 * (the held job's last in-bounds path) or `out_of_bounds` (the map's `<skill>/out-of-bounds` node).
 * Edges never restrict a move: only an unknown node id is refused, naming the current node's
 * children. The skill is the first segment of the node id, or of the stored path.
 *
 * While this session holds a job, every in-bounds move records the job's path, so a session taking
 * it over resumes there (the latest in-bounds path is what spec §4.5 calls the deepest). Only the
 * job this session holds is read, and only on `takeover`, so a completed job's row is never served.
 */
export async function rulesMove(args: MoveArgs, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const tool = "rules__move";
  checkArgs(tool, args.db_path, args.session_token);
  if (typeof args.to !== "string" || args.to.trim() === "") {
    throw new ValidationError(`${tool}.to must be a node id, "up", "takeover" or "out_of_bounds"`);
  }
  const { db_path: dbPath, session_token: token, to } = args;
  assertSchema(tool, dbPath);
  const positions = readPositions(dbPath, token);
  const side = [...positions.values()].find((p) => p.branch !== MAIN);
  if (side) throw new ValidationError(`${tool}: the side branch '${side.branch}' is open; close the side branch first (rules__branch, action close)`);
  const main = positions.get(MAIN) ?? null;
  const job = heldJob(dbPath, token);

  let takeover: { path: string[]; note: string | null } | null = null;
  if (to === "takeover") {
    const jobNode = `${main === null ? "<skill>" : main.path[0]}/job`;
    if (job === null) {
      throw new ValidationError(`${tool}: this session holds no job to take over; assign it first (drafting_data__assign_job with takeover: true)`);
    }
    const [row] = rows<{ last_in_bounds_path: string; went_out_of_bounds_to: number | null }>(
      dbPath,
      "SELECT last_in_bounds_path, went_out_of_bounds_to FROM job_position WHERE job_id = ?",
      [job]
    );
    if (row === undefined) {
      throw new ValidationError(`${tool}: job ${job} has no recorded rules position (it was held before positions were recorded); rules__move to ${jobNode} instead`);
    }
    let note: string | null = null;
    if (row.went_out_of_bounds_to !== null) {
      const [visit] = rows<{ from_path: string; visited_at: string }>(dbPath, "SELECT from_path, visited_at FROM out_of_bounds_visit WHERE id = ?", [row.went_out_of_bounds_to]);
      note = `The previous holder went out of bounds from ${visit.from_path} at ${visit.visited_at}; the rules it improvised there are not served.`;
    }
    takeover = { path: row.last_in_bounds_path.split(" "), note };
  } else if (main === null && (to === "up" || to === "out_of_bounds")) {
    throw new ValidationError(`${tool}: this session has no rules position yet, so its first move names a node id, not '${to}'`);
  }

  const skill = takeover !== null ? takeover.path[0] : to === "up" || to === "out_of_bounds" ? main!.path[0] : to.split("/")[0];
  if (main !== null && main.path[0] !== skill) {
    throw new ValidationError(`${tool}: '${to}' is on the ${skill} map, but this session's position is on the ${main.path[0]} map`);
  }
  const dag = loadRulesDag(skill);
  const outOfBounds = `${skill}/out-of-bounds`;
  const current = main === null ? null : livePrefix(dag, main.path);

  let path: string[];
  if (takeover !== null) {
    if (livePrefix(dag, takeover.path).length !== takeover.path.length) {
      throw new ValidationError(`${tool}: job ${job}'s recorded position '${takeover.path.join(" ")}' is no longer a path on the ${skill} map; rules__move to ${skill}/job instead`);
    }
    path = takeover.path;
  } else if (to === "up") {
    if (current!.length === 1) throw new ValidationError(`${tool}: the position is already the root ${skill}; there is no up`);
    path = current!.slice(0, -1);
  } else {
    const target = to === "out_of_bounds" ? outOfBounds : to;
    if (!dag.byId.has(target)) {
      const at = current === null ? skill : current[current.length - 1];
      const what = to === "out_of_bounds" ? `the ${skill} map has no out-of-bounds node '${target}'` : `unknown node '${target}'`;
      throw new ValidationError(`${tool}: ${what}; the children of ${at} are: ${children(dag, at).join(", ") || "none"}`);
    }
    path = pathTo(dag, current ?? [skill], target);
  }

  const stored = main?.path ?? null;
  const stay = takeover === null && stored !== null && path.join(" ") === stored.join(" ");
  const sideways = stored !== null && !isPrefix(path, stored) && !isPrefix(stored, path);
  const trimmed = stored !== null && current!.length !== stored.length;
  const full = stored === null || trimmed || takeover !== null || stay || sideways;

  const { session, turn } = splitFacts(tool, dag, main?.sessionFacts ?? {}, args.facts);
  const composed = composeRules(dag, path, { ...turn, ...session, ...databaseFacts(dag, dbPath, job) });
  const served = serve(composed, skill, full ? null : main!.inForce);

  const pathText = path.join(" ");
  const inBounds = path[path.length - 1] !== outOfBounds;
  const entersOutOfBounds = !inBounds && (stored === null || stored[stored.length - 1] !== outOfBounds);
  const common = current === null ? 0 : current.filter((id, i) => path[i] === id).length;
  const bigJump = takeover === null && inBounds && current !== null && path.length - common > 1;
  const statements: WriteStatement[] = [
    { sql: UPSERT_POSITION, params: [token, MAIN, pathText, JSON.stringify(session), JSON.stringify(served.inForce)] },
  ];
  if (entersOutOfBounds) {
    statements.push({
      sql: `INSERT INTO out_of_bounds_visit (session_token, from_path, visited_at) VALUES (?, ?, ${NOW})`,
      params: [token, (stored ?? [skill]).join(" ")],
    });
  }
  if (job !== null && inBounds) statements.push({ sql: UPSERT_JOB_POSITION, params: [job, pathText] });
  if (job !== null && entersOutOfBounds) {
    // A job assigned and taken straight out of bounds has no row yet: the path left is its last in bounds.
    statements.push({ sql: OUT_OF_BOUNDS_JOB_POSITION, params: [job, (current ?? [skill]).join(" ")] });
  }
  const written = await submissionDataWriteAll(dbPath, statements, env);
  const logError = await logServed(dbPath, token, path, served.sent, env);

  const head: string[] = [];
  if (takeover !== null) {
    head.push(`  <takeover job="${job}"${takeover.note === null ? "" : ` note="${xmlAttr(takeover.note)}"`}/>`);
  }
  if (entersOutOfBounds) {
    const [visit] = rows<{ id: number; from_path: string }>(
      dbPath,
      "SELECT id, from_path FROM out_of_bounds_visit WHERE session_token = ? ORDER BY id DESC LIMIT 1",
      [token]
    );
    head.push(`  <improvise visit="${visit.id}" from_path="${xmlAttr(visit.from_path)}" instruction="${xmlAttr(IMPROVISE)}"/>`);
  }
  if (bigJump) head.push(`  <reorient from_path="${xmlAttr(current!.join(" "))}" instruction="${xmlAttr(REORIENT)}"/>`);
  return block(dag, composed, served, {
    branch: MAIN,
    job,
    full,
    left: sideways ? stored! : undefined,
    head,
    warning: written.warning,
    logError,
  });
}

const IMPROVISE =
  "No mapped position fits this turn. Spawn the rules-improviser agent with skill, from_path and a short summary, with no " +
  "client content, of the turn and the acts you expect to take, then pass that summary and its rules array unchanged to " +
  "rules__provisional, and follow the rules it returns for this turn. If its status is not ok, record the visit with " +
  "rules: [] and your turn summary, quote its status in one line, and act on the root rules alone.";
const REORIENT =
  "This move was more than one edge from the path you were on. Spawn the rules-reorienter agent in the background with " +
  "skill, from_path, jump_path (this block's position path), a short summary of the recent turns ending with this one, " +
  "and db_path. Carry on under the rules served here. When its verdict returns: confirm, nothing; nearer, rules__move to " +
  "the last node of its path; out_of_bounds, rules__move to out_of_bounds and follow <improvise>. Ignore the verdict if " +
  "you have moved again since, or if its status is not ok.";
const PROVISIONAL_ID = /^oob\.[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PROVISIONAL_FIELDS = ["id", "door", "act", "text"];
const MAX_PROVISIONAL = 6;

/** The improviser's rules, checked field by field. Any field beyond the four is refused. */
function provisionalRules(tool: string, given: unknown): Array<Record<string, string>> {
  if (!Array.isArray(given)) throw new ValidationError(`${tool}.rules must be the rules-improviser's rules array`);
  if (given.length > MAX_PROVISIONAL) throw new ValidationError(`${tool}.rules holds ${given.length} rules; the improviser writes at most ${MAX_PROVISIONAL}`);
  const ids = new Set<string>();
  return given.map((rule, i) => {
    const at = `${tool}.rules[${i}]`;
    if (rule === null || typeof rule !== "object" || Array.isArray(rule)) throw new ValidationError(`${at} must be an object {id, door, act, text}`);
    const extra = Object.keys(rule).filter((key) => !PROVISIONAL_FIELDS.includes(key));
    if (extra.length > 0) {
      throw new ValidationError(`${at} has ${extra.join(", ")}; a provisional rule has only id, door, act and text, and carries no override edges`);
    }
    const r = rule as Record<string, unknown>;
    for (const key of PROVISIONAL_FIELDS) {
      if (typeof r[key] !== "string" || (r[key] as string).trim() === "") throw new ValidationError(`${at}.${key} must be a non-empty string`);
    }
    if (!PROVISIONAL_ID.test(r.id as string)) throw new ValidationError(`${at}.id '${r.id}' must be oob.<kebab-slug>`);
    if (ids.has(r.id as string)) throw new ValidationError(`${at}.id '${r.id}' is given twice`);
    ids.add(r.id as string);
    if (r.door !== "one-way" && r.door !== "two-way") throw new ValidationError(`${at}.door must be "one-way" or "two-way"`);
    return Object.fromEntries(PROVISIONAL_FIELDS.map((key) => [key, (r[key] as string).trim()]));
  });
}

/**
 * `rules__provisional` (spec §4.6): store the turn's summary and the rules-improviser's rules on
 * this session's latest out-of-bounds visit, once, and return them tagged provisional. The session
 * must be on the out-of-bounds node. Nothing here enters the serve log.
 */
export async function rulesProvisional(args: ProvisionalArgs, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const tool = "rules__provisional";
  checkArgs(tool, args.db_path, args.session_token);
  if (typeof args.turn_summary !== "string" || args.turn_summary.trim() === "") {
    throw new ValidationError(`${tool}.turn_summary must say in a sentence or two what the turn asked`);
  }
  const rules = provisionalRules(tool, args.rules);
  const { db_path: dbPath, session_token: token } = args;
  assertSchema(tool, dbPath);
  const main = readPositions(dbPath, token).get(MAIN);
  const at = main?.path[main.path.length - 1];
  if (main === undefined || at !== `${main.path[0]}/out-of-bounds`) {
    throw new ValidationError(`${tool}: this session's position is ${at ?? "not set"}, not out of bounds; rules__move to out_of_bounds first`);
  }
  const [visit] = rows<{ id: number; provisional_rules: string | null }>(
    dbPath,
    "SELECT id, provisional_rules FROM out_of_bounds_visit WHERE session_token = ? ORDER BY id DESC LIMIT 1",
    [token]
  );
  if (visit.provisional_rules !== null) {
    throw new ValidationError(`${tool}: visit ${visit.id} already has its provisional rules; a new set needs a new visit (leave and rules__move to out_of_bounds again)`);
  }
  const written = await submissionDataWriteAll(
    dbPath,
    [{
      sql: "UPDATE out_of_bounds_visit SET turn_summary = ?, provisional_rules = ? WHERE id = ? AND provisional_rules IS NULL",
      params: [args.turn_summary.trim(), JSON.stringify(rules), visit.id],
      expect_changes: 1,
    }],
    env
  );
  if (!written.ok) throw new DataServerError(`${tool}: visit ${visit.id} was not updated (statement ${written.failed} changed ${written.changes} rows)`, "write_failed");

  const lines = [
    `<rules position="${xmlAttr(at)}" branch="${MAIN}" serve="provisional" visit="${visit.id}">`,
    `  <position path="${xmlAttr(main.path.join(" "))}"/>`,
  ];
  if (written.warning) lines.push(`  <warning message="${xmlAttr(written.warning)}"/>`);
  for (const r of rules) {
    lines.push(
      `  <rule id="${xmlAttr(r.id)}" provisional="true" by="rules-improviser" door="${r.door}" act="${xmlAttr(r.act)}">`,
      xmlText(r.text),
      "  </rule>"
    );
  }
  return [...lines, "</rules>"].join("\n");
}

/**
 * `rules__branch` (spec §4.5): `open` starts a side branch named `label` at the map's
 * `<skill>/side` node while this session holds a job, under the deepest node of the main path
 * that reaches it; `close` ends it and returns the main branch's rules. At most one side branch is
 * open, and `rules__move` is refused until it closes. Both answer with a delta.
 */
export async function rulesBranch(args: BranchArgs, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const tool = "rules__branch";
  checkArgs(tool, args.db_path, args.session_token);
  if (args.action !== "open" && args.action !== "close") throw new ValidationError(`${tool}.action must be "open" or "close"`);
  if (typeof args.label !== "string" || args.label.trim() === "" || args.label === MAIN) {
    throw new ValidationError(`${tool}.label must name the side branch, and may not be "${MAIN}"`);
  }
  const { db_path: dbPath, session_token: token, label } = args;
  assertSchema(tool, dbPath);
  const positions = readPositions(dbPath, token);
  const main = positions.get(MAIN);
  if (main === undefined) throw new ValidationError(`${tool}: this session has no rules position yet; rules__move first`);
  const side = [...positions.values()].find((p) => p.branch !== MAIN);
  const job = heldJob(dbPath, token);
  const skill = main.path[0];
  const dag = loadRulesDag(skill);
  const current = livePrefix(dag, main.path);
  const facts = { ...main.sessionFacts, ...databaseFacts(dag, dbPath, job) };

  let path: string[];
  let composed: Composition;
  let served: Served;
  let statements: WriteStatement[];
  if (args.action === "open") {
    if (side) throw new ValidationError(`${tool}: the side branch '${side.branch}' is already open; close it first`);
    if (job === null) throw new ValidationError(`${tool}: a side branch opens only while this session holds a job; outside a job, rules__move to ${skill}/side`);
    const node = `${skill}/side`;
    if (!dag.byId.has(node)) throw new ValidationError(`${tool}: the ${skill} map has no side node '${node}'`);
    path = pathTo(dag, current, node);
    composed = composeRules(dag, path, facts);
    served = serve(composed, skill, main.inForce);
    statements = [{ sql: UPSERT_POSITION, params: [token, label, path.join(" "), JSON.stringify(main.sessionFacts), JSON.stringify(served.inForce)] }];
  } else {
    if (side === undefined || side.branch !== label) {
      throw new ValidationError(`${tool}: no side branch '${label}' is open${side ? `; the open one is '${side.branch}'` : ""}`);
    }
    path = current;
    composed = composeRules(dag, path, facts);
    served = serve(composed, skill, side.inForce);
    statements = [
      { sql: "DELETE FROM session_position WHERE session_token = ? AND branch = ?", params: [token, label] },
      {
        sql: `UPDATE session_position SET in_force = ?, updated_at = ${NOW} WHERE session_token = ? AND branch = ?`,
        params: [JSON.stringify(served.inForce), token, MAIN],
      },
    ];
  }
  const written = await submissionDataWriteAll(dbPath, statements, env);
  const logError = await logServed(dbPath, token, path, served.sent, env);
  return block(dag, composed, served, {
    branch: args.action === "open" ? label : MAIN,
    job,
    full: false,
    warning: written.warning,
    logError,
  });
}
