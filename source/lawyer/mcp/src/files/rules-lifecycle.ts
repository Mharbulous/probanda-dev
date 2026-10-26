// Rules lifecycle: how far each node rule has come, read off the serve log in the matter's drafting
// database (Engineering/1. Spec/2026-10-09_rules-dag-spec.md §4.8, plan phase 4).
//
// A rule is `migrated` once it is on its node, and `verified` once two distinct session tokens were
// served it from that node: a session after the one that migrated it. A rule on the root node is
// `root`, because root rules are never served (they live in SKILL.md). Servings are counted on the
// rule's current node only, so a rule moved to another node starts again. A log row naming a rule
// that is not on that node in the map now is listed under `<off_map>`, never dropped. Read-only.

import { ValidationError } from "../errors.js";
import { loadRulesDag, xmlAttr } from "./rules-dag.js";
import { assertSchema } from "./rules-position.js";
import { rows } from "../submission/query-rows.js";

const DATE_RE = /^\d{4}-\d\d-\d\d$/;

interface ServedRow {
  rule_id: string;
  node: string;
  sessions: number;
  served: number;
  first_served: string;
  last_served: string;
}

interface VisitRow {
  id: number;
  from_path: string;
  turn_summary: string | null;
  provisional_rules: string | null;
  visited_at: string;
}

const skillOf = (id: string): string => id.split(/[/ ]/)[0];
const counts = (r: ServedRow): string =>
  ` sessions="${r.sessions}" served="${r.served}" first_served="${xmlAttr(r.first_served)}" last_served="${xmlAttr(r.last_served)}"`;

/**
 * `rules__lifecycle({db_path, since?})`: every rule on each map the log names, grouped by skill (a
 * node id's first segment), with its stage and servings, then the log's off-map rows and the
 * out-of-bounds visits, those since `since` (YYYY-MM-DD) when given.
 */
export function rulesLifecycle(dbPath: string, since?: string): string {
  const tool = "rules__lifecycle";
  if (typeof dbPath !== "string" || dbPath.trim() === "") throw new ValidationError(`${tool}.db_path must be the matter's drafting database`);
  if (since !== undefined && (!DATE_RE.test(since) || Number.isNaN(Date.parse(since)))) throw new ValidationError(`${tool}.since must be a date, YYYY-MM-DD, not ${JSON.stringify(since)}`);
  assertSchema(tool, dbPath);

  const served = rows<ServedRow>(
    dbPath,
    "SELECT rule_id, node, COUNT(DISTINCT session_token) AS sessions, COUNT(*) AS served, MIN(served_at) AS first_served, " +
      "MAX(served_at) AS last_served FROM rule_served GROUP BY rule_id, node ORDER BY rule_id, node"
  );
  const visits = rows<VisitRow>(
    dbPath,
    "SELECT id, from_path, turn_summary, provisional_rules, visited_at FROM out_of_bounds_visit WHERE visited_at >= ? ORDER BY id",
    [since ?? ""]
  );
  const skills = [...new Set([...served.map((r) => skillOf(r.node)), ...visits.map((v) => skillOf(v.from_path))])].sort();

  const lines = [since === undefined ? "<lifecycle>" : `<lifecycle since="${since}">`];
  for (const skill of skills) {
    const dag = loadRulesDag(skill);
    const log = new Map(served.filter((r) => skillOf(r.node) === skill).map((r) => [`${r.rule_id} ${r.node}`, r]));
    const tally = { root: 0, migrated: 0, verified: 0 };
    const ruleLines: string[] = [];
    for (const node of dag.nodes) {
      for (const rule of node.rules) {
        const row = log.get(`${rule.id} ${rule.node}`);
        log.delete(`${rule.id} ${rule.node}`);
        const stage = rule.node === skill ? "root" : (row?.sessions ?? 0) >= 2 ? "verified" : "migrated";
        tally[stage]++;
        const replaces = rule.replaces.length > 0 ? ` replaces="${xmlAttr(rule.replaces.join(" "))}"` : "";
        const servings = row === undefined ? ` sessions="0" served="0"` : counts(row);
        ruleLines.push(`    <rule id="${xmlAttr(rule.id)}" node="${xmlAttr(rule.node)}" stage="${stage}"${servings}${replaces}/>`);
      }
    }
    lines.push(`  <skill name="${xmlAttr(skill)}" root="${tally.root}" migrated="${tally.migrated}" verified="${tally.verified}">`, ...ruleLines);
    const offMap = [...log.values()].map((r) => `      <served rule_id="${xmlAttr(r.rule_id)}" node="${xmlAttr(r.node)}"${counts(r)}/>`);
    lines.push(...(offMap.length === 0 ? ["    <off_map/>"] : ["    <off_map>", ...offMap, "    </off_map>"]));
    const visitLines = visits
      .filter((v) => skillOf(v.from_path) === skill)
      .map((v) => {
        const summary = v.turn_summary === null ? "" : ` summary="${xmlAttr(v.turn_summary)}"`;
        const improvised = v.provisional_rules === null ? "" : ` rules="${JSON.parse(v.provisional_rules).length}"`;
        return `      <visit id="${v.id}" from_path="${xmlAttr(v.from_path)}" visited_at="${xmlAttr(v.visited_at)}"${summary}${improvised}/>`;
      });
    lines.push(...(visitLines.length === 0 ? ["    <out_of_bounds/>"] : ["    <out_of_bounds>", ...visitLines, "    </out_of_bounds>"]));
    lines.push("  </skill>");
  }
  return [...lines, "</lifecycle>"].join("\n");
}
