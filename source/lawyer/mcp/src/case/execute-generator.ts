// matter_data__execute's generator (ingest orchestrator spec §2.5): the server runs an allowlisted
// SQL-emitting script from /matter-data's references/scripts and executes its output in the same call,
// so the SQL never reaches the model. A file a Cowork session writes is invisible to the host (#76),
// so a session-staged SQL file cannot work: the server must produce the SQL itself. The allowlist is
// supersede_draft.py's emit-sql and rehash-sql. For emit-sql the server first runs the operation's §4
// pair probe and fold_plan, so the plan and the notes as read reach the decision; it runs only for a
// pair one side of which has no row, where no fact needs a model's judgment. This wrapper holds no
// SQL of its own beyond the clock read of conventions §10.

import { ValidationError } from "../errors.js";
import { caseDataQuery } from "./backend.js";
import { runCaseScript } from "./case-script.js";

export interface Generator {
  script: string;
  args: Record<string, unknown>;
}

const ALLOWED: Record<string, string[]> = { "supersede_draft.py": ["emit-sql", "rehash-sql"] };

type Side = number | { file_path: string; file_hash: string };

interface FoldPlan {
  children_into: Record<string, number>;
  auto: Array<{ fact_id: number; fold_into: number }>;
  agent_required: Array<{ fact_id: number }>;
}

const supersede = <T>(request: Record<string, unknown>, env: NodeJS.ProcessEnv) =>
  runCaseScript<T>("supersede_draft", "generate", request, env);

/** The SQL script `generator` emits for the matter at `matterRoot`. */
export function generatorSql(matterRoot: string, generator: Generator, env: NodeJS.ProcessEnv = process.env): string {
  const command = generator?.args?.command;
  const allowed = Object.hasOwn(ALLOWED, generator?.script) ? ALLOWED[generator.script] : [];
  if (typeof command !== "string" || !allowed.includes(command)) {
    throw new ValidationError(`generator must be an allowlisted script and command: ${Object.entries(ALLOWED).map(([s, c]) => `${s} ${c.join(" or ")}`).join("; ")}`);
  }
  if (command === "rehash-sql") return supersede<string>(generator.args, env);

  const { superseded, kept } = generator.args as { superseded: Side; kept: Side };
  const registered = [superseded, kept].filter((s): s is number => typeof s === "number");
  if (registered.length !== 1) {
    throw new ValidationError("the generator runs only when one side of the pair has no row: name one source_id and one {file_path, file_hash}");
  }
  const probe = supersede<string>({ command: "probe" }, env);
  const rows = caseDataQuery(matterRoot, probe, [JSON.stringify(registered)]).rows;
  const id = (s: Side) => (typeof s === "number" ? s : null);
  const plan = supersede<FoldPlan>({ command: "fold-plan", rows, superseded: id(superseded), kept: id(kept) }, env);
  const notes = Object.fromEntries(rows.filter((r) => r.kind === "source" && r.id === registered[0]).map((r) => [String(r.id), r.notes]));
  const today = caseDataQuery(matterRoot, "SELECT date('now','localtime') AS today").rows[0].today;
  // A kept copy with no row has no facts, so every fact of S moves to it unless it restates an
  // earlier one (auto); a superseded copy with no row has none to place (supersede-draft.md §4).
  const facts = [...plan.auto.map((f) => ({ fact_id: f.fact_id, fold_into: f.fold_into })), ...plan.agent_required.map((f) => ({ fact_id: f.fact_id }))];
  return supersede<string>({
    command: "emit-sql",
    outcome: "superseded",
    superseded,
    kept,
    notes,
    execution_status: generator.args.execution_status ?? {},
    children_into: plan.children_into,
    facts,
    date: today,
    approver: generator.args.approver,
  }, env);
}
