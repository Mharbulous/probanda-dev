// matter_data__ingest_result (ingest orchestrator spec §2.1): writes one document's extracted
// results, staged by its extractors (#76), so no extraction output and no SQL passes through the main
// session (C1, #191). It generalizes matter_data__ingest_authority: each contract has a converter in
// /matter-data's references/scripts/ that checks the staged results against the contract and returns
// fixed statements, and they run through matter_data__execute's own path (backend.ts): the case lock,
// staging, triggers, one transaction with a savepoint per exhibit, and the evidence.sql dump. This
// wrapper holds no SQL and no table name.
//
// Party names are resolved here, by matter_data__resolve_participant's logic, because converters open
// no database (§2.2). A name that does not resolve becomes an ask, answered on the repeated call.

import { existsSync, readFileSync, unlinkSync } from "node:fs";

import { ValidationError } from "../errors.js";
import { caseDataExecuteStatements, type CaseStatement, type CaseStatementGroup } from "./backend.js";
import { runCaseScript } from "./case-script.js";
import { affidavitRun, CONTRACT_VERSION, recordAckLine, recordWrite, runForWrite } from "./ingest-run.js";
import { proceduralHistoryAppend } from "./procedural-history.js";
import { resolveParticipant } from "./resolve-participant.js";
import { stagedResultPath } from "./stage-result.js";

/** The contracts built in stage D2 (§11), each with its converter module. */
const CONVERTERS: Record<string, string> = {
  facts: "ingest_facts",
  affidavit_body: "ingest_affidavit",
  affidavit_exhibits: "ingest_affidavit",
  sought_orders: "ingest_sought_orders",
  privileged: "ingest_privileged",
};
const LATER = ["caselaw", "provision", "efiling_statement", "register_only"];
const COUNTS = ["facts", "positions", "relief", "links", "exhibits"] as const;
/** The output cap (est., spec §1.5, §2.1). */
export const RESULT_CAP = 600;

export interface IngestResultArgs {
  matter_root: string;
  run_id: string;
  document: { file_path: string; file_hash: string; store: "main" | "privileged" };
  contract: string;
  result_ids: string[];
  answers?: { privilege?: string; category?: string; proceeding_id?: number; participants?: Record<string, number> };
}

type Ask = { kind: string; ref: string; say: string };
type Planned = (CaseStatement & { count?: string; value_as?: string }) | (CaseStatementGroup & { statements: Array<CaseStatement & { count?: string }> });
type Plan =
  | { problems: string[] }
  | { asks: Ask[] }
  | {
      params: Record<string, unknown>;
      statements: Planned[];
      post: string[];
      asks: Ask[];
      report: string[];
      title: string | null;
      date?: string | null;
      failed?: boolean;
    };

export interface IngestResultOutput {
  outcome: "written" | "already_written" | "refused";
  /** Internal, for the orchestrator only (§9 G5): why a call was refused. */
  refused?: string;
  source_id?: number | null;
  counts?: Record<(typeof COUNTS)[number], number>;
  items?: Array<{ ref: string; outcome: "failed"; reason: string }>;
  ask: Ask[];
  post?: Array<{ pass: string; ref: string }>;
  report: string[];
}

// The fixed templates of what the practitioner may be shown (G5).
const SAY_REFUSED: Record<string, string> = {
  waiting: "This part will be recorded once the rest of its document is in.",
  store_change: "This document is already recorded in a different place, so it was not recorded again. It needs a decision on where it belongs.",
  race: "Another copy of this document was recorded at the same moment. It will be checked again.",
  invalid: "The reading of this document could not be used and will be read again.",
};

const refused = (code: string, extra: Partial<IngestResultOutput> = {}): IngestResultOutput => ({
  outcome: "refused",
  refused: code,
  ask: [],
  report: SAY_REFUSED[code] ? [SAY_REFUSED[code]] : [],
  ...extra,
});

/** The party names a result carries in the fields §2.2 resolves to party ids. */
function partyNames(contract: string, result: Record<string, unknown>): string[] {
  const names: unknown[] = [];
  const each = (key: string, fields: string[]) => {
    for (const row of (Array.isArray(result[key]) ? result[key] : []) as Array<Record<string, unknown>>) {
      for (const f of fields) names.push(row?.[f]);
    }
  };
  if (contract === "facts") {
    each("fact_positions", ["party_name"]);
    each("relief_items", ["seeking_party_name", "against_party_name"]);
    each("relief_positions", ["party_name"]);
    names.push((result.document as Record<string, unknown> | undefined)?.author_or_filing_party);
  }
  if (contract === "privileged") each("client_instructions", ["party_name"]);
  return [...new Set(names.filter((n): n is string => typeof n === "string" && n.trim() !== ""))];
}

/** A name resolves when exactly one party matches it exactly. Anything else stays unresolved. */
function resolveParties(matterRoot: string, names: string[], answered: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of names) {
    if (typeof answered[name] === "number") {
      out[name] = answered[name];
      continue;
    }
    const r = resolveParticipant(matterRoot, name);
    if (r.status !== "ok") continue;
    const parties = r.matches.filter((m) => m.role === "party" && m.match === "exact");
    if (parties.length === 1) out[name] = parties[0].id;
  }
  return out;
}

function fit(out: IngestResultOutput): IngestResultOutput {
  // Report lines are the first thing dropped to keep the reply within its cap.
  while (Buffer.byteLength(JSON.stringify(out)) > RESULT_CAP && out.report.length > 1) out.report.pop();
  return out;
}

export async function ingestResult(args: IngestResultArgs, env: NodeJS.ProcessEnv = process.env): Promise<IngestResultOutput> {
  const module = CONVERTERS[args.contract];
  if (!module) {
    if (LATER.includes(args.contract)) throw new ValidationError(`contract ${args.contract} is not built yet; use its existing path`);
    throw new ValidationError(`contract must be one of ${[...Object.keys(CONVERTERS), ...LATER].join(", ")}`);
  }
  if (!Array.isArray(args.result_ids)) throw new ValidationError("result_ids must be a list");
  const run = await runForWrite(args.matter_root, args.run_id, args.document?.file_hash, env);
  if ("refused" in run) return { outcome: "refused", refused: run.refused, ask: [], report: [run.say] };

  const results: Array<{ result_id: string; path: string; ref: string; doc: Record<string, unknown> }> = [];
  for (const id of args.result_ids) {
    const path = stagedResultPath(id, env);
    if (!existsSync(path)) return refused("unknown_result");
    const doc = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    if (doc.contract !== args.contract) return refused("contract_mismatch");
    if (doc.contract_version !== CONTRACT_VERSION) return refused("contract_version");
    const ref = typeof doc.ref === "string" ? doc.ref : "";
    // A routed file's results carry its refs (f3, f3:so, f3:B): one of another file's is a mismatch.
    if (run.route && ref.split(":")[0] !== run.route.ref) return refused("contract_mismatch");
    results.push({ result_id: id, path, ref, doc });
  }
  if (results.length === 0 && !["facts", "affidavit_body", "affidavit_exhibits"].includes(args.contract)) {
    throw new ValidationError(`contract ${args.contract} needs result_ids`);
  }
  const fileRef = run.route?.ref ?? "";
  const exhibits = args.contract === "affidavit_exhibits"
    ? await affidavitRun(args.matter_root, fileRef, results.map((r) => r.ref), env)
    : null;

  const names = results.flatMap((r) => partyNames(args.contract, r.doc));
  const participants = resolveParties(args.matter_root, names, args.answers?.participants ?? {});
  const plan = runCaseScript<Plan>(module, "plan", {
    contract: args.contract,
    mode: run.mode,
    file_path: args.document.file_path,
    file_hash: args.document.file_hash,
    results: results.map(({ result_id, path, ref }) => ({ result_id, path, ref })),
    answers: args.answers ?? {},
    participants,
    route: run.route,
    exhibits,
  }, env);

  const acks = results.map((r) => ({ ref: r.ref, result_id: r.result_id }));
  const refs = [...new Set([fileRef || results[0]?.ref || args.document.file_hash, ...results.map((r) => r.ref)])];
  if ("problems" in plan) {
    // R5: a result invalid against its contract is treated as a failed extraction, and re-dispatched once.
    await recordWrite(args.matter_root, args.run_id, acks, { refs, contract: args.contract, result_ids: args.result_ids, outcome: "refused", reason: "invalid" }, env);
    await recordFailures(args, results.map((r) => r.ref), env);
    return refused("invalid", { items: [{ ref: results[0]?.ref ?? "", outcome: "failed", reason: plan.problems[0].slice(0, 160) }] });
  }
  if (!("statements" in plan)) {
    await recordWrite(args.matter_root, args.run_id, acks, { refs, contract: args.contract, result_ids: args.result_ids, outcome: "refused", reason: "needs_answer" }, env);
    return { outcome: "refused", refused: "needs_answer", ask: plan.asks, report: [] };
  }

  let done;
  try {
    done = await caseDataExecuteStatements(args.matter_root, plan.statements, plan.params, env);
  } catch (err) {
    if (/duplicate top-level source file_hash/.test((err as Error).message)) return refused("race");
    throw err;
  }
  if (!done.ok) {
    const first = String(done.refused[0] ?? "");
    const code = first.split(":")[0];
    await recordWrite(args.matter_root, args.run_id, acks, { refs, contract: args.contract, result_ids: args.result_ids, outcome: "refused", reason: code }, env);
    return refused(SAY_REFUSED[code] ? code : "refused", { items: [{ ref: refs[0], outcome: "failed", reason: first.slice(0, 160) }] });
  }

  const counts = Object.fromEntries(COUNTS.map((k) => [k, 0])) as Record<(typeof COUNTS)[number], number>;
  const named: Record<string, unknown> = {};
  let i = 0;
  const tally = (s: CaseStatement & { count?: string; value_as?: string }) => {
    const r = done.results[i++];
    if (s.count && s.count in counts) counts[s.count as keyof typeof counts] += r.rowcount;
    if (s.value_as) named[s.value_as] = r.rows[0] ? Object.values(r.rows[0])[0] : null;
  };
  for (const s of plan.statements) {
    if ("ref" in s && "statements" in s) s.statements.forEach(tally);
    else tally(s as CaseStatement & { count?: string; value_as?: string });
  }
  const inserted = COUNTS.reduce((n, k) => n + counts[k], 0);
  const outcome = named.prior === "complete" && inserted === 0 ? "already_written" : "written";
  const sourceId = (named.source_id as number | null) ?? null;

  const report = [...plan.report];
  const post: Array<{ pass: string; ref: string }> = [];
  for (const pass of plan.post) {
    if (pass === "procedural_history") {
      // §1.6: ingest_result runs the procedural history entry itself, once, for a new write.
      if (outcome === "written" && plan.date && plan.title) {
        try {
          proceduralHistoryAppend({ matter_root: args.matter_root, date: plan.date, line: plan.title, source_path: args.document.file_path });
        } catch {
          report.push("This document's entry in the procedural history could not be added.");
        }
      }
      continue;
    }
    if (pass === "other_copy") {
      if (named.other != null) post.push({ pass, ref: `${sourceId}:${named.other}` });
      continue;
    }
    post.push({ pass, ref: String(sourceId) });
  }
  if (plan.title && !plan.failed) {
    report.unshift(`${plan.title.slice(0, 60)}: ${counts.facts} facts, ${counts.positions} positions, ${counts.relief} relief items, ${counts.links} evidence links${counts.exhibits ? `, ${counts.exhibits} exhibits` : ""}.`);
  }
  if (plan.failed) report.unshift(`${(plan.title ?? "This document").slice(0, 60)} could not be read and is recorded as not read.`);

  await recordWrite(args.matter_root, args.run_id, acks, {
    refs, contract: args.contract, result_ids: args.result_ids, outcome,
    ...(args.contract === "affidavit_exhibits" ? { closing: exhibits?.closing === true } : {}),
  }, env);
  if (args.contract === "privileged") {
    // G4: privileged wording does not wait out the 7-day staging window once it is written.
    for (const r of results) unlinkSync(r.path);
  }
  return fit({
    outcome,
    source_id: sourceId,
    counts,
    items: done.failed.map((f) => ({ ref: f.ref, outcome: "failed" as const, reason: f.reason.slice(0, 120) })),
    ask: plan.asks,
    post,
    report,
  });
}

async function recordFailures(args: IngestResultArgs, refs: string[], env: NodeJS.ProcessEnv): Promise<void> {
  for (const ref of refs) await recordAckLine(args.matter_root, args.run_id, `failed ${ref} invalid`, env);
}
