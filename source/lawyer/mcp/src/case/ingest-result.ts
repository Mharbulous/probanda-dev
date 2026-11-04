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
//
// The whole call runs under the write lock, so everything the write relies on is looked up against
// the matter as it stands now, and another run cannot change it before the write lands (group locking
// spec sections 6 and 7).

import { readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import { DataServerError, ValidationError } from "../errors.js";
import { resolveCaseDataRoot } from "../practice/matter-data-root.js";
import { caseDataExecuteStatements, type CaseStatement, type CaseStatementGroup } from "./backend.js";
import { acquireIngestWriteLock, matterRevision, type CaseLock } from "./case-lock.js";
import { caseDataFolder } from "./locate.js";
import { runCaseScript } from "./case-script.js";
import {
  affidavitRun, checkRun, CONTRACT_VERSION, noteWriteWait, outsideMatter, recordRefusal, recordWrite, runForWrite, storedForm,
  type Refusal, type Route, type RouteAttachment,
} from "./ingest-run.js";
import { proceduralHistoryAppend } from "./procedural-history.js";
import { resolveParticipant } from "./resolve-participant.js";
import { stagedResultPath } from "./stage-result.js";

/** The contracts built (§11, #79), each with its converter module. `attachment` is one attachment of
 *  an email, read by the facts extractor and written as the email's child. */
const CONVERTERS: Record<string, string> = {
  facts: "ingest_facts",
  attachment: "ingest_facts",
  affidavit_body: "ingest_affidavit",
  affidavit_exhibits: "ingest_affidavit",
  sought_orders: "ingest_sought_orders",
  privileged: "ingest_privileged",
  caselaw: "ingest_authority",
  provision: "ingest_authority",
};
const LATER = ["efiling_statement", "register_only"];
/** The contracts whose `result_ids: []` closes an item whose extraction failed twice (R4). An authority's
 *  route matched by citation is closed the same way: nothing was read, and the file is recorded by reference. */
const CLOSABLE = ["facts", "attachment", "affidavit_body", "affidavit_exhibits", "sought_orders", "caselaw", "provision"];
/** The contracts written only for a file routed in this run. */
const ROUTED_ONLY = ["attachment", "caselaw", "provision", "affidavit_body", "affidavit_exhibits"];
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
    /** What became of an `other_version` ask, once supersede-draft has settled the pair. */
    other_version?: "superseded" | "not_version";
  };
}

type Ask = { kind: string; ref: string; say: string };
/** `ask`: each row the statement returns is an ask item {kind, ref, say} (K-M3). `report`: each row's
 *  first value is a fixed report line (round 5, 4). */
type Single = CaseStatement & { count?: string; value_as?: string; ask?: boolean; report?: boolean };
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
      /** The document's report line, where the count of facts and positions would mean nothing. */
      summary?: string;
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
  /** How many report lines, ask or items entries were left out to keep the cap (round 6, N3). */
  dropped?: number;
}

// The fixed templates of what the practitioner may be shown (G5).
const SAY_REFUSED: Record<string, string> = {
  waiting: "This part will be recorded once the rest of its document is in.",
  store_change: "This document is already recorded in a different place, so it was not recorded again. It will be checked on its own once the run ends.",
  race: "Another copy of this document was recorded at the same moment, so this reading was not recorded. It will be checked on its own once the run ends.",
  invalid: "The reading of this document could not be used and will be read again.",
  unknown_result: "The reading of this document could not be found and will be read again.",
  path_b: "This document may be privileged, so nothing was recorded from its reading. It will be read here instead, once its privilege is decided.",
  set_aside: "This document is a legal authority, so it was not recorded in this run. It will be ingested on its own once the run ends.",
  already_held: "This document has already been recorded in another session, so it was not recorded again.",
  attachment_held: "This attachment is already on file, so it was not recorded again.",
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
  if (contract === "facts" || contract === "attachment") {
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

/** Every party a name could mean now, which an answer is checked against (group locking spec section 8). */
function candidatesFor(matterRoot: string, name: string): number[] {
  const r = resolveParticipant(matterRoot, name);
  return r.status === "ok" ? r.matches.filter((m) => m.role === "party").map((m) => m.id).sort((a, b) => a - b) : [];
}

/** What the write relies on, looked up again now: `write_recheck.py` opens the case data, as converters do not. */
type Recheck = { status: string; reason?: string; other_version: { source_id: number; title: string | null } | null; answers_source_id: number | null; proceeding_gone: number[]; parties_gone: number[]; names: Record<string, string> };

/** The firm's own name, so the delivery check fires only on a letter the firm sent (K-M9): firm_name
 *  alone, from the firm profile's firm.json (firm-profile.ts), so no other part of the profile can
 *  fail the write (N-2). With no case data root, no firm.json, one this computer cannot open now, or
 *  no readable name it is null, and the converter says once that the delivery check could not run (N14). */
function firmName(env: NodeJS.ProcessEnv): string | null {
  try {
    const firm = JSON.parse(readFileSync(join(resolveCaseDataRoot(env), "_practice", "firm", "firm.json"), "utf-8")) as { firm_name?: unknown } | null;
    return typeof firm?.firm_name === "string" && firm.firm_name !== "" ? firm.firm_name : null;
  } catch (err) {
    if (err instanceof ValidationError || err instanceof SyntaxError) return null;
    if (["ENOENT", "EACCES", "EPERM", "EBUSY"].includes(String((err as NodeJS.ErrnoException).code))) return null;
    throw err;
  }
}

/** Whether a result carries a flag of this kind (spec §6.2). */
const flagged = (doc: Record<string, unknown>, kind: string) =>
  Array.isArray(doc.flags) && (doc.flags as Array<{ kind?: unknown } | null>).some((f) => f?.kind === kind);

/** Keeps the reply within its cap (S-m4): report lines go first, then ask items, then items, each
 *  counted, so the reply says something was left out (round 6, N3). */
function fit(out: IngestResultOutput): IngestResultOutput {
  const size = () => Buffer.byteLength(JSON.stringify(out));
  let dropped = 0;
  while (size() > RESULT_CAP && out.report.length > 1) {
    out.report.pop();
    dropped += 1;
    out.dropped = dropped;
  }
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
  let lock: CaseLock;
  try {
    lock = await acquireIngestWriteLock(args.matter_root, env);
  } catch (err) {
    if ((err as DataServerError).code !== "lock_unavailable") throw err;
    // Another session is saving: the write stays queued, and `next` lists it again (spec 6.3).
    return { outcome: "refused", refused: "waiting", ask: [], report: await noteWriteWait(args.matter_root, args.run_id, args.document?.ref, args.result_ids, env) };
  }
  try {
    const out = await checkAndWrite(args, env, dropAlso, lock);
    drop = out.outcome !== "refused" || DEFINITE.includes(String(out.refused));
    return out;
  } finally {
    lock.release();
    dropStaged([...(drop ? privileged : []), ...dropAlso]);
  }
}

/** Refusals no repeat of the same call can clear: a result to read again, or a document set aside. */
const DEFINITE = ["invalid", "contract_mismatch", "contract_version", "race", "store_change", "path_b", "set_aside", "unresolved", "refused", "already_held", "attachment_held", "taken"];

type Staged = { result_id: string; path: string; ref: string; doc: Record<string, unknown> };

async function checkAndWrite(args: IngestResultArgs, env: NodeJS.ProcessEnv, dropAlso: string[], lock: CaseLock): Promise<IngestResultOutput> {
  if (new Set(args.result_ids).size !== args.result_ids.length) throw new ValidationError("result_ids must not repeat an id");
  if (args.result_ids.length === 0 && !CLOSABLE.includes(args.contract)) throw new ValidationError(`contract ${args.contract} needs result_ids`);
  const document = args.document ?? ({} as IngestResultArgs["document"]);
  const privileged = args.contract === "privileged";
  // A privileged call's shape is checked before anything else, as an error the session corrects,
  // so the wording stays staged for the corrected call (m-1). The converter reads the answer alike.
  const privilege = String(args.answers?.privilege ?? "").trim().toLowerCase();
  if (privileged && args.result_ids.length !== 1) throw new ValidationError("contract privileged takes one result");
  if (privileged && !["yes", "no", "unclear"].includes(privilege)) throw new ValidationError("answers.privilege must be yes, no or unclear");
  const privilegedStore = privileged && privilege === "yes";
  if (document.store !== (privilegedStore ? "privileged" : "main")) {
    throw new ValidationError(`document.store must be ${privilegedStore ? "privileged" : "main"} for this contract and answer`);
  }
  const run = await runForWrite(args.matter_root, args.run_id, document, args.contract, args.result_ids, env);
  if ("refused" in run) return { outcome: "refused", refused: run.refused, ask: [], report: [run.say] };
  if (ROUTED_ONLY.includes(args.contract) && !run.route) throw new ValidationError(`contract ${args.contract} is written only for a file routed in this run`);
  // The stored form the run recorded, or the one the server derives (S-m7): never a host path.
  const filePath = run.route?.file_path ?? storedForm(String(document.file_path ?? ""), args.matter_root);
  const fileHash = run.route?.file_hash ?? String(document.file_hash ?? "");
  if (filePath === "" || outsideMatter(filePath)) throw new ValidationError("document.file_path must be a file inside the matter folder");
  if (!/^[0-9a-f]{64}$/.test(fileHash)) throw new ValidationError("document.file_hash must be the file's SHA-256");

  // The item a result answers is the reply's: the ok line journaled for it, or the call's own ref
  // when that names an item dispatched under this contract (N-4). A routed file's result with
  // neither is a call to correct, never one that trusts the staged ref (m-2): a call of several
  // takes only acknowledged results, and a lone result names its dispatch line's ref. A Path B
  // object (privileged) names no dispatched item, and takes its staged ref.
  if (!privileged && run.route) {
    for (const id of args.result_ids) {
      if (run.acked[id] !== undefined) continue;
      if (args.result_ids.length > 1) {
        throw new ValidationError("a call with several result_ids takes only results already acknowledged: pass each other result alone, with its dispatch line's ref as document.ref");
      }
      if (run.itemRef === null) throw new ValidationError("document.ref must be the ref of the dispatch line whose reply gave this result");
    }
  }
  const results: Staged[] = [];
  // Each reply, journaled under its item before any check below (S-M4).
  const acks: Array<{ ref: string; result_id: string }> = [];
  // Each bad result with its own reason (N-9); the call is refused with the first.
  const bad: Array<{ id: string; reason: string }> = [];
  for (const id of args.result_ids) {
    // A repeat of the call: a result whose item failed in an earlier call, its reading already
    // dropped or to be read again, is settled there, never failed twice (round 6, N1).
    if (run.settled.includes(id)) continue;
    const replyRef = run.acked[id] ?? (args.result_ids.length === 1 ? run.itemRef : null) ?? undefined;
    const path = stagedResultPath(id, env);
    const doc = readStaged(path);
    if (doc === null) {
      // A repeat of a write that landed and then let its staged result go (R6, N-11).
      if (run.written.includes(id)) continue;
      if (!privileged && replyRef !== undefined) acks.push({ ref: replyRef, result_id: id });
      bad.push({ id, reason: "unknown_result" }); // expired (R10), never staged, or unreadable
      continue;
    }
    const stagedRef = typeof doc.ref === "string" ? doc.ref : "";
    const ref = privileged ? stagedRef : replyRef ?? stagedRef;
    // A routed file's results carry its refs (f3, f3:so, f3:B): one of another file's is a mismatch,
    // and so is a staged ref other than the reply's item, and a reply naming an item dispatched under
    // another contract (m-2). A Path B object names its file only by its path and hash, a routed
    // file's included (N1).
    const sameFile = run.route === null || ref.split(":")[0] === run.route.ref;
    const thisContract = replyRef === undefined || run.dispatched.includes(replyRef);
    if (!privileged && run.route && sameFile) acks.push({ ref, result_id: id });
    if ((!privileged && (!sameFile || ref !== stagedRef || !thisContract)) || doc.contract !== args.contract) {
      bad.push({ id, reason: "contract_mismatch" });
    } else if (doc.contract_version !== CONTRACT_VERSION) {
      bad.push({ id, reason: "contract_version" });
    }
    results.push({ result_id: id, path, ref, doc });
  }
  if (bad.length > 0) {
    // Each bad result's item is read once more (R4), never left acknowledged and unwritten; the
    // call's other results stay acknowledged and are listed to write again (N-9).
    if (!privileged) await recordRefusal(args.matter_root, args.run_id, acks, bad, env);
    return refused(bad[0].reason);
  }
  // Every result already written, and its staged copy gone: the repeat finds the write (R6, N-11).
  // One whose every result failed earlier was said then (round 6, N1).
  if (args.result_ids.length > 0 && results.length === 0) {
    return args.result_ids.some((id) => run.written.includes(id))
      ? { outcome: "already_written", ask: [], report: [] }
      : { outcome: "refused", refused: "invalid", ask: [], report: [] };
  }
  return write(args, env, run, filePath, fileHash, results, dropAlso, lock);
}

async function write(
  args: IngestResultArgs,
  env: NodeJS.ProcessEnv,
  run: Exclude<Awaited<ReturnType<typeof runForWrite>>, Refusal>,
  filePath: string,
  fileHash: string,
  results: Staged[],
  dropAlso: string[],
  lock: CaseLock,
): Promise<IngestResultOutput> {
  const fileRef = run.route?.ref ?? "";
  const attachment = args.contract === "attachment" ? attachmentOf(run.route, args.document.ref) : undefined;
  const exhibits = args.contract === "affidavit_exhibits"
    ? await affidavitRun(args.matter_root, args.run_id, fileRef, results.map((r) => r.ref), env)
    : null;

  // A close names its item by the file's ref, and a Notice of Application's orders by `<ref>:so` (N2).
  const refs = [...new Set([
    fileRef || results[0]?.ref || fileHash,
    ...(args.contract === "sought_orders" && fileRef ? [`${fileRef}:so`] : []),
    ...(attachment ? [args.document.ref as string] : []),
    ...results.map((r) => r.ref),
  ])];
  // A Path B object names no dispatched item, so it journals no reply (N1).
  const acks = args.contract === "privileged" || !run.route ? [] : results.map((r) => ({ ref: r.ref, result_id: r.result_id }));
  const record = (write: Record<string, unknown>, failures: Array<{ ref: string; reason: string }> = []) =>
    recordWrite(args.matter_root, args.run_id, acks, { refs, contract: args.contract, file_hash: fileHash, ...write }, env, failures);

  // Re-checks (group locking spec 7.2). Another run's write of these bytes should be impossible with
  // claims, but a file reached with no claim can still meet one.
  if (run.elsewhere.some((w) => w.file_hash === fileHash)) {
    await record({ result_ids: args.result_ids, outcome: "refused", reason: "already_held" });
    return fit(refused("already_held"));
  }
  const answers = { ...(args.answers ?? {}) };
  const route = run.route ? { ...run.route } : null;
  const staleAnswers: string[] = [];
  const revision = matterRevision(args.matter_root, env);
  const courtFile = route?.category === "court" || /^5\./.test(filePath);
  const firstWrite = args.contract === "facts" || args.contract === "affidavit_body";
  // The matter has moved since this run read the document, or since the question was asked.
  const moved = run.readRevision === null || run.readRevision !== revision || (run.question !== null && run.question.revision !== revision);
  let pendingOther: number | null = null;
  if (moved) {
    const chosen = Object.values(answers.participants ?? {}).filter((id) => id !== 0);
    const check = runCaseScript<Recheck>("write_recheck", "run", {
      case_data_dir: caseDataFolder(args.matter_root, env),
      matter_root: args.matter_root,
      file_path: filePath,
      file_hash: fileHash,
      answers_source_id: route?.answers_source_id ?? null,
      proceeding_ids: [route?.proceeding_id, answers.proceeding_id].filter((id) => typeof id === "number"),
      chosen_parties: chosen,
      // Only documents other runs recorded since this run began, because the gate saw the rest.
      version_source_ids: courtFile && firstWrite && answers.other_version === undefined
        ? run.elsewhere.map((w) => w.source_id).filter((id) => id !== null) : [],
    }, env);
    if (check.status !== "ok") throw new DataServerError(`the matter's case data cannot be read: ${String(check.reason)}`, "case_data_unavailable");
    if (check.other_version !== null) {
      if (run.mode === "unattended") pendingOther = check.other_version.source_id;
      else {
        // Held back, and sent to the usual choice of which copy to keep (Step 6's other_version item).
        await record({ result_ids: args.result_ids, outcome: "refused", reason: "needs_answer", revision });
        return fit({
          outcome: "refused",
          refused: "needs_answer",
          ask: [{ kind: "other_version", ref: String(check.other_version.source_id), say: `This may be another copy of "${(check.other_version.title ?? "a document on file").slice(0, 80)}", which another session has just recorded. Which copy should be kept?` }],
          report: [],
        });
      }
    }
    if (route && check.answers_source_id !== null) route.answers_source_id = check.answers_source_id;
    if (route?.proceeding_id !== undefined && check.proceeding_gone.includes(route.proceeding_id)) delete route.proceeding_id;
    if (answers.proceeding_id !== undefined && check.proceeding_gone.includes(answers.proceeding_id)) {
      delete answers.proceeding_id;
      staleAnswers.push("Since you answered, another session changed the proceeding you chose.");
    }
    // Section 8: an answer the matter has moved past is dropped, so the converter asks the question again.
    const participantsAnswered = { ...(answers.participants ?? {}) };
    for (const [name, id] of Object.entries(participantsAnswered)) {
      if (id === 0 || run.question === null) continue;
      const before = run.question.candidates[name] ?? [];
      const added = candidatesFor(args.matter_root, name).filter((candidate) => !before.includes(candidate));
      if (check.parties_gone.includes(id)) staleAnswers.push(`Since you answered, another session changed the party you chose for "${name.slice(0, 60)}".`);
      else if (added.length > 0) staleAnswers.push(`Since you answered, another session added ${added.map((a) => check.names[String(a)] ?? "a party").join(", ").slice(0, 80)}, who may be "${name.slice(0, 60)}".`);
      else continue;
      delete participantsAnswered[name];
    }
    answers.participants = participantsAnswered;
  }
  // The pair was settled through supersede-draft: a copy that ended superseded is already held.
  if (answers.other_version === "superseded") {
    await record({ result_ids: args.result_ids, outcome: "already_written" });
    return { outcome: "already_written", ask: [], report: [] };
  }

  const names = results.flatMap((r) => partyNames(args.contract, r.doc));
  const participants = resolveParties(args.matter_root, names, answers.participants ?? {});
  const plan = runCaseScript<Plan>(CONVERTERS[args.contract], "plan", {
    contract: args.contract,
    mode: run.mode,
    file_path: filePath,
    file_hash: fileHash,
    results: results.map(({ result_id, path, ref }) => ({ result_id, path, ref })),
    answers,
    participants,
    route,
    exhibits,
    ...(attachment ? { attachment: { name: attachment.name, file_hash: attachment.file_hash } } : {}),
    answered: run.answered,
    // Read only where the delivery check can fire: an attended document with a letter flag (N-2).
    firm_name: run.mode === "attended" && results.some((r) => flagged(r.doc, "outgoing_letter")) ? firmName(env) : null,
  }, env);

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
    // The revision and the candidates the question rests on, for the answer's check (section 8).
    const candidates = Object.fromEntries(plan.asks.filter((a) => a.kind === "participant").map((a) => [a.ref, candidatesFor(args.matter_root, a.ref)]));
    await record({ result_ids: args.result_ids, outcome: "refused", reason: "needs_answer", revision, candidates });
    return fit({ outcome: "refused", refused: "needs_answer", ask: plan.asks, report: staleAnswers });
  }

  let done;
  try {
    done = await caseDataExecuteStatements(args.matter_root, plan.statements, plan.params, env, async () => {
      const gone = await checkRun(args.matter_root, args.run_id, env, run.route);
      if (gone) throw new LeaseGone(gone);
    }, lock);
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
  const said: string[] = [];
  let i = 0;
  const tally = (s: Single) => {
    const r = done.results[i++];
    if (s.count && s.count in counts) counts[s.count as keyof typeof counts] += r.rowcount;
    if (s.value_as) named[s.value_as] = r.rows[0] ? Object.values(r.rows[0])[0] : null;
    if (s.ask) asks.push(...(r.rows as Ask[]));
    if (s.report) said.push(...r.rows.map((row) => String(Object.values(row)[0])));
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
  // Unattended, a version that turned up since reading gets today's marker for the attended run to settle.
  if (pendingOther !== null && sourceId !== null) {
    const marker = runCaseScript<CaseStatement>("write_recheck", "pending_marker", { source_id: sourceId, other_id: pendingOther }, env);
    await caseDataExecuteStatements(args.matter_root, [marker], {}, env, undefined, lock);
  }

  // The write has landed. A journal that misses it surfaces as an error (N14): the repeated call
  // finds the write already there (R6) and journals it then.
  const closedNow = await record({
    result_ids: args.result_ids.filter((id) => !failedIds.has(id) && !run.settled.includes(id)), outcome,
    source_id: sourceId,
    ...(args.result_ids.length === 0 ? { closed: true } : {}),
    ...(args.contract === "affidavit_exhibits" ? { closing: exhibits?.closing === true && failures.length === 0 } : {}),
    // Pass 1's exhibit list, so the exhibits are planned from the journal alone (N9).
    ...(args.contract === "affidavit_body" ? inventoryOf(results[0]?.doc) : {}),
  }, failures);

  const report = [...plan.report.map((line) => line.replace("{source}", String(sourceId))), ...said];
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
  if (plan.summary) report.unshift(plan.summary);
  else if (plan.title && !plan.failed) {
    report.unshift(`${plan.title.slice(0, 60)}: ${counts.facts} facts, ${counts.positions} positions, ${counts.relief} relief items, ${counts.links} evidence links${counts.exhibits ? `, ${counts.exhibits} exhibits` : ""}.`);
  }
  if (plan.failed && !plan.summary) report.unshift(`${(plan.title ?? "This document").slice(0, 60)} could not be read and is recorded as not read.`);
  // An exhibit rolled back is read again, so its question waits for that reading.
  const asked = asks.filter((a) => !(args.contract === "affidavit_exhibits" && badLetters.includes(a.ref)));

  const out = fit({
    outcome,
    source_id: sourceId,
    counts,
    items: [
      ...done.failed.filter((f) => !f.ref.startsWith("fallback ")).map((f) => ({ ref: f.ref, outcome: "failed" as const, reason: f.reason.slice(0, 120) })),
      ...(plan.invalid ?? []).map((ref) => ({ ref, outcome: "failed" as const, reason: "invalid" })),
    ],
    ask: asked,
    post,
    report,
  });
  if (args.contract === "affidavit_exhibits") {
    // An exhibit held pending, as its row stands after the write (m-7), is asked its privilege; its
    // reading leaves staging once this reply carries the question, rather than wait out the 7-day
    // window (G4). One the cap left out stays, so a repeat of the call asks it (round 5, 6). A
    // reading that signalled privilege and was not recorded leaves too: it is read again (round 5, 3).
    const pending = out.ask.filter((a) => a.kind === "privilege").map((a) => a.ref);
    dropAlso.push(...results.filter((r) => pending.includes(letterOf(r.ref))
      || (badLetters.includes(letterOf(r.ref)) && flagged(r.doc, "privilege_signal"))).map((r) => r.path));
  }
  // An attachment held pending: its reading leaves staging once this reply carries the question (G4).
  if (attachment && out.ask.some((a) => a.kind === "privilege")) dropAlso.push(...results.map((r) => r.path));
  return out;
}

/** The route's attachment a child ref (`f3:a2`) names. */
function attachmentOf(route: Route | null, ref: string | undefined): RouteAttachment {
  const found = /:a(\d+)$/.exec(ref ?? "");
  const attachment = found ? route?.attachments?.[Number(found[1]) - 1] : undefined;
  if (!attachment) throw new ValidationError("document.ref must name an attachment of this run's email");
  return attachment;
}

/** Pass 1's exhibit list as the body write journals it: letters and page ranges only (N9). */
function inventoryOf(doc: Record<string, unknown> | undefined): Record<string, unknown> {
  const inventory = (Array.isArray(doc?.exhibit_inventory) ? doc.exhibit_inventory : []) as Array<Record<string, unknown>>;
  return {
    inventory: inventory.map((e) => ({ letter: e?.letter ?? null, page_start: e?.page_start ?? null, page_end: e?.page_end ?? null })),
    body_page_count: doc?.body_page_count ?? null,
  };
}
