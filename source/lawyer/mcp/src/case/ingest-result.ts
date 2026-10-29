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

import { readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import { ValidationError } from "../errors.js";
import { resolveCaseDataRoot } from "../practice/matter-data-root.js";
import { caseDataExecuteStatements, type CaseStatement, type CaseStatementGroup } from "./backend.js";
import { runCaseScript } from "./case-script.js";
import {
  affidavitRun, checkRun, CONTRACT_VERSION, outsideMatter, recordRefusal, recordWrite, runForWrite, storedForm,
  type Refusal,
} from "./ingest-run.js";
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
/** The contracts whose `result_ids: []` closes an item whose extraction failed twice (R4). */
const CLOSABLE = ["facts", "affidavit_body", "affidavit_exhibits", "sought_orders"];
const COUNTS = ["facts", "positions", "relief", "links", "exhibits"] as const;
/** The output cap (est., spec §1.5, §2.1). */
export const RESULT_CAP = 600;

export interface IngestResultArgs {
  matter_root: string;
  run_id: string;
  /** A routed file is named by its `ref` (R9); a Path B document by its path and hash. */
  document: { ref?: string; file_path?: string; file_hash?: string; store: "main" | "privileged" };
  contract: string;
  result_ids: string[];
  answers?: {
    privilege?: string;
    category?: string;
    proceeding_id?: number;
    participants?: Record<string, number>;
    informants?: Record<string, number>;
  };
}

type Ask = { kind: string; ref: string; say: string };
/** `ask`: each row the statement returns is an ask item {kind, ref, say} (K-M3). */
type Single = CaseStatement & { count?: string; value_as?: string; ask?: boolean };
type Planned = Single | (CaseStatementGroup & { statements: Array<CaseStatement & { count?: string }> });
type Plan =
  | { problems: string[] }
  | { blocked: string; asks?: Ask[]; report?: string[] }
  | { asks: Ask[] }
  | {
      params: Record<string, unknown>;
      statements: Planned[];
      post: string[];
      /** The unattended markers written in place of passes (ingest-unattended.md Substitutions). */
      markers?: string[];
      asks: Ask[];
      report: string[];
      title: string | null;
      date?: string | null;
      failed?: boolean;
      other_title?: string | null;
      /** Exhibit letters whose result failed its contract: recorded for review, read once more. */
      invalid?: string[];
      /** Exhibit letters written pending a privilege decision. */
      pending?: string[];
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
  /** How many ask or items entries were left out to keep the cap; a repeated call lists them. */
  dropped?: number;
}

// The fixed templates of what the practitioner may be shown (G5).
const SAY_REFUSED: Record<string, string> = {
  waiting: "This part will be recorded once the rest of its document is in.",
  store_change: "This document is already recorded in a different place, so it was not recorded again. It will be checked on its own once the run ends.",
  race: "Another copy of this document was recorded at the same moment, so this reading was not recorded. It will be checked on its own once the run ends.",
  invalid: "The reading of this document could not be used and will be read again.",
  path_b: "This document may be privileged, so nothing was recorded from its reading. It will be read here instead, once its privilege is decided.",
  set_aside: "This document is a legal authority, so it was not recorded in this run. It will be ingested on its own once the run ends.",
  refused: "This document could not be recorded, so nothing from its reading was kept.",
};

const refused = (code: string, extra: Partial<IngestResultOutput> = {}): IngestResultOutput => ({
  outcome: "refused",
  refused: code,
  ask: [],
  report: SAY_REFUSED[code] ? [SAY_REFUSED[code]] : [],
  ...extra,
});

/** Thrown inside the case lock when the run's lease is gone (R8), so nothing is written. */
class LeaseGone extends Error {
  constructor(readonly refusal: Refusal) {
    super(refusal.say);
  }
}

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

/** The firm's own name, so the delivery check fires only on a letter the firm sent (K-M9): firm_name
 *  alone, from the firm profile's firm.json (firm-profile.ts), so no other part of the profile can
 *  fail the write (N-2). With no case data root, no firm.json or no readable name it is null, and the
 *  converter says once that the delivery check could not run (N14). */
function firmName(env: NodeJS.ProcessEnv): string | null {
  try {
    const firm = JSON.parse(readFileSync(join(resolveCaseDataRoot(env), "_practice", "firm", "firm.json"), "utf-8")) as { firm_name?: unknown } | null;
    return typeof firm?.firm_name === "string" && firm.firm_name !== "" ? firm.firm_name : null;
  } catch (err) {
    if (err instanceof ValidationError || err instanceof SyntaxError || (err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/** Whether a result carries a flag of this kind (spec §6.2). */
const flagged = (doc: Record<string, unknown>, kind: string) =>
  Array.isArray(doc.flags) && (doc.flags as Array<{ kind?: unknown } | null>).some((f) => f?.kind === kind);

/** Keeps the reply within its cap (S-m4): report lines go first, then ask items, then items. */
function fit(out: IngestResultOutput): IngestResultOutput {
  const size = () => Buffer.byteLength(JSON.stringify(out));
  let dropped = 0;
  while (size() > RESULT_CAP && out.report.length > 1) out.report.pop();
  while (size() > RESULT_CAP && out.ask.length > 1) {
    out.ask.pop();
    dropped += 1;
    out.dropped = dropped;
  }
  while (size() > RESULT_CAP && (out.items?.length ?? 0) > 1) {
    out.items?.pop();
    dropped += 1;
    out.dropped = dropped;
  }
  return out;
}

/** Deletes staged results this server holds no longer: privileged wording, and an exhibit's held
 *  back for a privilege decision, never wait out the 7-day window (G4). */
function dropStaged(paths: string[]): void {
  for (const path of paths) {
    try {
      unlinkSync(path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err; // already gone
    }
  }
}

/** A staged result, or null when it is gone (expired, R10) or not JSON. */
function readStaged(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT" || err instanceof SyntaxError) return null;
    throw err;
  }
}

export async function ingestResult(args: IngestResultArgs, env: NodeJS.ProcessEnv = process.env): Promise<IngestResultOutput> {
  const module = CONVERTERS[args.contract];
  if (!module) {
    if (LATER.includes(args.contract)) throw new ValidationError(`contract ${args.contract} is not built yet; use its existing path`);
    throw new ValidationError(`contract must be one of ${[...Object.keys(CONVERTERS), ...LATER].join(", ")}`);
  }
  if (!Array.isArray(args.result_ids)) throw new ValidationError("result_ids must be a list");
  // Privileged wording leaves staging once it is written, or refused for a reason no repeat of the
  // call can clear (N5). It stays on an error, an open question, a lost lease, a plugin update and a
  // result not found, so the corrected or repeated call, or the resumed run, finds it (R6, R7, N-3).
  const privileged = args.contract === "privileged" ? args.result_ids.map((id) => stagedResultPath(id, env)) : [];
  const dropAlso: string[] = [];
  let drop = false;
  try {
    const out = await checkAndWrite(args, env, dropAlso);
    drop = out.outcome !== "refused" || DEFINITE.includes(String(out.refused));
    return out;
  } finally {
    dropStaged([...(drop ? privileged : []), ...dropAlso]);
  }
}

/** Refusals no repeat of the same call can clear: a result to read again, or a document set aside. */
const DEFINITE = ["invalid", "contract_mismatch", "contract_version", "race", "store_change", "path_b", "set_aside", "unresolved", "refused"];

type Staged = { result_id: string; path: string; ref: string; doc: Record<string, unknown> };

async function checkAndWrite(args: IngestResultArgs, env: NodeJS.ProcessEnv, dropAlso: string[]): Promise<IngestResultOutput> {
  if (new Set(args.result_ids).size !== args.result_ids.length) throw new ValidationError("result_ids must not repeat an id");
  if (args.result_ids.length === 0 && !CLOSABLE.includes(args.contract)) throw new ValidationError(`contract ${args.contract} needs result_ids`);
  const document = args.document ?? ({} as IngestResultArgs["document"]);
  const privileged = args.contract === "privileged";
  const privilegedStore = privileged && args.answers?.privilege === "yes";
  if (document.store !== (privilegedStore ? "privileged" : "main")) {
    throw new ValidationError(`document.store must be ${privilegedStore ? "privileged" : "main"} for this contract and answer`);
  }
  const run = await runForWrite(args.matter_root, args.run_id, document, args.contract, args.result_ids, env);
  if ("refused" in run) return { outcome: "refused", refused: run.refused, ask: [], report: [run.say] };
  if (args.contract.startsWith("affidavit_") && !run.route) throw new ValidationError("an affidavit is written only for a file routed in this run");
  // The stored form the run recorded, or the one the server derives (S-m7): never a host path.
  const filePath = run.route?.file_path ?? storedForm(String(document.file_path ?? ""), args.matter_root);
  const fileHash = run.route?.file_hash ?? String(document.file_hash ?? "");
  if (filePath === "" || outsideMatter(filePath)) throw new ValidationError("document.file_path must be a file inside the matter folder");
  if (!/^[0-9a-f]{64}$/.test(fileHash)) throw new ValidationError("document.file_hash must be the file's SHA-256");

  const results: Staged[] = [];
  // Each reply, journaled under its item before any check below (S-M4).
  const acks: Array<{ ref: string; result_id: string }> = [];
  const bad: string[] = [];
  let reason: string | null = null;
  for (const id of args.result_ids) {
    // The item a result answers is the reply's: the ok line journaled for it, or the call's own ref
    // when that names an item dispatched under this contract (N-4). A call with neither (a Path B
    // object, or a caller that names the file by its path and hash) takes the staged ref.
    const replyRef = run.acked[id] ?? (args.result_ids.length === 1 ? run.itemRef : null) ?? undefined;
    const path = stagedResultPath(id, env);
    const doc = readStaged(path);
    if (doc === null) {
      // A repeat of a write that landed and then let its staged result go (R6, N-11).
      if (run.written.includes(id)) continue;
      if (!privileged && replyRef !== undefined) acks.push({ ref: replyRef, result_id: id });
      bad.push(id);
      reason ??= "unknown_result"; // expired (R10), never staged, or unreadable
      continue;
    }
    const stagedRef = typeof doc.ref === "string" ? doc.ref : "";
    const ref = privileged ? stagedRef : replyRef ?? stagedRef;
    // A routed file's results carry its refs (f3, f3:so, f3:B): one of another file's is a mismatch,
    // and so is a staged ref other than the reply's item. A Path B object names its file only by its
    // path and hash, a routed file's included (N1).
    const sameFile = run.route === null || ref.split(":")[0] === run.route.ref;
    if (!privileged && run.route && sameFile) acks.push({ ref, result_id: id });
    if ((!privileged && (!sameFile || ref !== stagedRef)) || doc.contract !== args.contract) {
      bad.push(id);
      reason ??= "contract_mismatch";
    } else if (doc.contract_version !== CONTRACT_VERSION) {
      bad.push(id);
      reason ??= "contract_version";
    }
    results.push({ result_id: id, path, ref, doc });
  }
  if (reason !== null) {
    // Each bad result's item is read once more (R4), never left acknowledged and unwritten; the
    // call's other results stay acknowledged and are listed to write again (N-9).
    if (!privileged) await recordRefusal(args.matter_root, args.run_id, acks, bad, reason, env);
    return refused(reason);
  }
  // Every result already written, and its staged copy gone: the repeat finds the write (R6, N-11).
  if (args.result_ids.length > 0 && results.length === 0) return { outcome: "already_written", ask: [], report: [] };
  return write(args, env, run, filePath, fileHash, results, dropAlso);
}

async function write(
  args: IngestResultArgs,
  env: NodeJS.ProcessEnv,
  run: Exclude<Awaited<ReturnType<typeof runForWrite>>, Refusal>,
  filePath: string,
  fileHash: string,
  results: Staged[],
  dropAlso: string[],
): Promise<IngestResultOutput> {
  const fileRef = run.route?.ref ?? "";
  const exhibits = args.contract === "affidavit_exhibits"
    ? await affidavitRun(args.matter_root, fileRef, results.map((r) => r.ref), env)
    : null;

  const names = results.flatMap((r) => partyNames(args.contract, r.doc));
  const participants = resolveParties(args.matter_root, names, args.answers?.participants ?? {});
  const plan = runCaseScript<Plan>(CONVERTERS[args.contract], "plan", {
    contract: args.contract,
    mode: run.mode,
    file_path: filePath,
    file_hash: fileHash,
    results: results.map(({ result_id, path, ref }) => ({ result_id, path, ref })),
    answers: args.answers ?? {},
    participants,
    route: run.route,
    exhibits,
    answered: run.answered,
    // Read only where the delivery check can fire: an attended document with a letter flag (N-2).
    firm_name: run.mode === "attended" && results.some((r) => flagged(r.doc, "outgoing_letter")) ? firmName(env) : null,
  }, env);

  // A Path B object names no dispatched item, so it journals no reply (N1).
  const acks = args.contract === "privileged" || !run.route ? [] : results.map((r) => ({ ref: r.ref, result_id: r.result_id }));
  // A close names its item by the file's ref, and a Notice of Application's orders by `<ref>:so` (N2).
  const refs = [...new Set([
    fileRef || results[0]?.ref || fileHash,
    ...(args.contract === "sought_orders" && fileRef ? [`${fileRef}:so`] : []),
    ...results.map((r) => r.ref),
  ])];
  const record = (write: Record<string, unknown>, failures: Array<{ ref: string; reason: string }> = []) =>
    recordWrite(args.matter_root, args.run_id, acks, { refs, contract: args.contract, ...write }, env, failures);
  /** R5: a result that cannot be used is a failed extraction, read once more; after a second
   *  failure `next` closes it, and that close reports it. */
  const reread = async (reason: string) => {
    const closed = await record({ result_ids: args.result_ids, outcome: "refused", reason: "invalid" }, results.map((r) => ({ ref: r.ref, reason: "invalid" })));
    const out = refused("invalid", { items: [{ ref: results[0]?.ref ?? "", outcome: "failed", reason: reason.slice(0, 160) }] });
    if (closed.length > 0) out.report = [];
    return fit(out);
  };
  if ("problems" in plan) return reread(plan.problems[0]);
  if ("blocked" in plan) {
    // A document for Path B or for /ingest, or one a repeat cannot fix: not listed again (S-m8).
    await record({ result_ids: args.result_ids, outcome: "refused", reason: plan.blocked });
    // The reading of a document that may be privileged leaves staging now; Path B reads it again (N18).
    if (plan.blocked === "path_b") dropAlso.push(...results.map((r) => r.path));
    const out = refused(plan.blocked, { ask: plan.asks ?? [] });
    out.report.push(...(plan.report ?? []));
    return fit(out);
  }
  if (!("statements" in plan)) {
    await record({ result_ids: args.result_ids, outcome: "refused", reason: "needs_answer" });
    return fit({ outcome: "refused", refused: "needs_answer", ask: plan.asks, report: [] });
  }

  let done;
  try {
    done = await caseDataExecuteStatements(args.matter_root, plan.statements, plan.params, env, async () => {
      const gone = await checkRun(args.matter_root, args.run_id, env);
      if (gone) throw new LeaseGone(gone);
    });
  } catch (err) {
    if (err instanceof LeaseGone) return { outcome: "refused", refused: err.refusal.refused, ask: [], report: [err.refusal.say] };
    if (/duplicate top-level source file_hash/.test((err as Error).message)) {
      await record({ result_ids: args.result_ids, outcome: "refused", reason: "race" });
      return fit(refused("race"));
    }
    throw err;
  }
  if (!done.ok) {
    const first = String(done.refused[0] ?? "");
    const code = first.split(":")[0];
    // An answered fact gone from the pleading it answers: a fresh reading takes the new list (N7).
    if (code === "answered") return reread(first);
    await record({ result_ids: args.result_ids, outcome: "refused", reason: code });
    return fit(refused(SAY_REFUSED[code] ? code : "refused", { items: [{ ref: refs[0], outcome: "failed", reason: first.slice(0, 160) }] }));
  }

  const counts = Object.fromEntries(COUNTS.map((k) => [k, 0])) as Record<(typeof COUNTS)[number], number>;
  const named: Record<string, unknown> = {};
  const asks = [...plan.asks];
  let i = 0;
  const tally = (s: Single) => {
    const r = done.results[i++];
    if (s.count && s.count in counts) counts[s.count as keyof typeof counts] += r.rowcount;
    if (s.value_as) named[s.value_as] = r.rows[0] ? Object.values(r.rows[0])[0] : null;
    if (s.ask) asks.push(...(r.rows as Ask[]));
  };
  for (const s of plan.statements) {
    if ("ref" in s && "statements" in s) s.statements.forEach(tally);
    else tally(s as Single);
  }
  // An exhibit rolled back to its savepoint (a constraint) or failing its contract is recorded for
  // review by its fallback row, is not counted as written, and is read once more (S-M1, R4).
  const badLetters = [
    ...done.failed.map((f) => f.ref).filter((ref) => !ref.startsWith("fallback ")),
    ...(plan.invalid ?? []),
  ];
  const letterOf = (ref: string) => ref.split(":").pop() as string;
  const failures = results
    .filter((r) => badLetters.includes(letterOf(r.ref)))
    .map((r) => ({ ref: r.ref, reason: done.failed.some((f) => f.ref === letterOf(r.ref)) ? "constraint" : "invalid" }));
  const failedIds = new Set(results.filter((r) => failures.some((f) => f.ref === r.ref)).map((r) => r.result_id));

  const inserted = COUNTS.reduce((n, k) => n + counts[k], 0);
  // A repeat finds its row already there and adds nothing (R6); an affidavit's status change counts,
  // and so does an exhibit recorded for review (N12).
  const unchanged = args.contract !== "affidavit_exhibits" || named.final === named.prior;
  const outcome = named.prior != null && inserted === 0 && unchanged && failures.length === 0 ? "already_written" : "written";
  const sourceId = (named.source_id as number | null) ?? null;

  // The write has landed. A journal that misses it surfaces as an error (N14): the repeated call
  // finds the write already there (R6) and journals it then.
  const closedNow = await record({
    result_ids: args.result_ids.filter((id) => !failedIds.has(id)), outcome,
    ...(args.result_ids.length === 0 ? { closed: true } : {}),
    ...(args.contract === "affidavit_exhibits" ? { closing: exhibits?.closing === true && failures.length === 0 } : {}),
    // Pass 1's exhibit list, so the exhibits are planned from the journal alone (N9).
    ...(args.contract === "affidavit_body" ? inventoryOf(results[0]?.doc) : {}),
  }, failures);

  const report = plan.report.map((line) => line.replace("{source}", String(sourceId)));
  const post: Array<{ pass: string; ref: string }> = [];
  for (const pass of plan.post) {
    if (pass === "procedural_history") {
      // §1.6: ingest_result runs the procedural history entry itself. A repeat adds it if a crash
      // came between the write and the entry (S-m9); one already there is left alone.
      if (!plan.date || !plan.title) {
        report.push("This document's entry in the procedural history was not added, because its date is not known.");
        continue;
      }
      try {
        proceduralHistoryAppend({ matter_root: args.matter_root, date: plan.date, line: plan.title, source_path: filePath });
      } catch (err) {
        if ((err as { code?: string }).code !== "duplicate_entry") report.push("This document's entry in the procedural history could not be added.");
      }
      continue;
    }
    if (pass === "other_copy") {
      if (named.other != null) post.push({ pass, ref: `${sourceId}:${named.other}` });
      continue;
    }
    post.push({ pass, ref: String(sourceId) });
  }
  // A title the other_copy flag names that matches no document on file: reported, attended or
  // unattended, never dropped silently (K-M13).
  const otherCopy = plan.post.includes("other_copy") || (plan.markers ?? []).includes("other_copy");
  if (otherCopy && named.other == null && plan.other_title) {
    report.push(`This document may be another copy of "${plan.other_title.slice(0, 80)}", which could not be matched to a document on file.`);
  }
  for (const f of failures) {
    report.push(closedNow.includes(f.ref)
      ? `Exhibit ${letterOf(f.ref)} could not be read after two attempts; it is marked for review.`
      : `Exhibit ${letterOf(f.ref)} could not be recorded as read; it is marked for review and will be read again.`);
  }
  if (plan.title && !plan.failed) {
    report.unshift(`${plan.title.slice(0, 60)}: ${counts.facts} facts, ${counts.positions} positions, ${counts.relief} relief items, ${counts.links} evidence links${counts.exhibits ? `, ${counts.exhibits} exhibits` : ""}.`);
  }
  if (plan.failed) report.unshift(`${(plan.title ?? "This document").slice(0, 60)} could not be read and is recorded as not read.`);
  dropAlso.push(...results.filter((r) => (plan.pending ?? []).includes(letterOf(r.ref))).map((r) => r.path));

  return fit({
    outcome,
    source_id: sourceId,
    counts,
    items: [
      ...done.failed.filter((f) => !f.ref.startsWith("fallback ")).map((f) => ({ ref: f.ref, outcome: "failed" as const, reason: f.reason.slice(0, 120) })),
      ...(plan.invalid ?? []).map((ref) => ({ ref, outcome: "failed" as const, reason: "invalid" })),
    ],
    // An exhibit rolled back is read again, so its question waits for that reading.
    ask: asks.filter((a) => !(args.contract === "affidavit_exhibits" && badLetters.includes(a.ref))),
    post,
    report,
  });
}

/** Pass 1's exhibit list as the body write journals it: letters and page ranges only (N9). */
function inventoryOf(doc: Record<string, unknown> | undefined): Record<string, unknown> {
  const inventory = (Array.isArray(doc?.exhibit_inventory) ? doc.exhibit_inventory : []) as Array<Record<string, unknown>>;
  return {
    inventory: inventory.map((e) => ({ letter: e?.letter ?? null, page_start: e?.page_start ?? null, page_end: e?.page_end ?? null })),
    body_page_count: doc?.body_page_count ?? null,
  };
}
