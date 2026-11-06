// drafting_forms__open_session (#591, decided in #590): one session-entry call from a matter
// folder. It replaces the hops a session used to pay before bootstrap -- proving the folder,
// reading probanda.json for db_path, the migrate round trip and the matter lookup -- each of which
// also cost a model turn (#580: Path A 106 s, 83% model gap).
//
// The probanda.json convention is /drafting-data's (its SKILL.md Configuration stays the
// documented owner); this is its executable form. The resolver is READ-ONLY on purpose: it never
// heals, rewrites or moves anything. case/backend.ts's resolve_pointer does all three, so it is
// not reused here -- a missing or legacy pointer is refused and handed to /matter-data.
//
// Unlike drafting_forms__bootstrap, which stays a pure gate and still refuses on
// migration_required (#351), this call migrates on its own initiative (#590 decision 2): the
// migrate is the same separate spawn under the data lock with the #353 copy-aside backup, so the
// safeguard is unchanged -- only the round trip goes.

import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { inOneCall } from "../call-memo.js";
import { moveSeedsOnce, type SeedsLeft, type SeedsMove } from "../loose-threads/migrate.js";
import { releaseLapsedLocks } from "./forms/job-activity.js";
import type { PracticeStore } from "../practice/store.js";
import { DataServerError, ValidationError } from "../errors.js";
import { caseDataRootFromDbPath, findDraftDir, resolveDbPath, validateMatterRoot } from "../files/matter-root.js";
import { resolveCaseDataRoot } from "../practice/backend.js";
import { matter_lookup } from "../tools/practice/reads.js";
import { courtFileAffidavits, type CourtFileAffidavit } from "./court-file-affidavits.js";
import {
  type BootstrapResult,
  type ClientContext,
  nowStamp,
  type PhaseTimings,
  type RenderedDocument,
  resolveDraftDir,
  submissionFormsBootstrap,
  submissionFormsRender,
  submissionFormsRenderProceedingBoard,
} from "./forms.js";
import { type FormCurrency } from "./form-currency.js";
import { MATTER_BOARD_FILE } from "./forms/matter-board-shell.js";
import { fetchRevision } from "./forms/query.js";
import { type MatterDates, readMatterDates } from "./matter-dates.js";
import { type BoardMove, DATES_NOT_READ, pagePathFor, type PagesWritten, recordPagesState, writeMatterPages } from "./matter-pages.js";
import { type MatterTodos, readMatterTodos } from "./matter-todos.js";
import { submissionDataMigrate } from "./migrate.js";
import { counselOffers, matterPartiesDrift, type CounselOffer, type PartiesDriftRow } from "./parties-drift.js";

// The matter folder's leading token, e.g. "L8212" from "L8212 Northfield v. Brightwater" -- the same
// pattern case/backend.ts's parse_folder_name uses, except that a trailing separator is left out
// of the token (#1087: "L42- Whistler lawsuit" is matter L42).
const MATTER_TOKEN = /^\s*((?:\d+\.)?[A-Za-z]?\d+(?:[A-Za-z0-9.-]*[A-Za-z0-9])?)[.-]*\s+/;

/** The matter number at the start of a matter folder's name, or null when it has none. */
export function matterToken(matterRoot: string): string | null {
  return MATTER_TOKEN.exec(basename(matterRoot))?.[1] ?? null;
}

export interface OpenSessionResult extends BootstrapResult {
  /** The matter folder as proven host-side (realpath). */
  matter_root: string;
  /** #689: the matter's one 0. DRAFT folder, absent when there is none. Passed to every later
   * drafting_forms__render, under which the server rewrites the matter's pages. */
  draft_dir?: string;
  /** Present only when this call created or migrated the database before bootstrapping: `from` 0 is a
   * database it created. `backup` is the
   * #353 copy-aside the migrate wrote beside the database, or null if none appeared. `warnings`
   * carries the migrate's own warnings (a stale lock it broke, an older backup it could not
   * remove), present only when there is one. */
  migrated?: { from: number | null; to: number; backup: string | null; warnings?: string[] };
  /** Present only when this call moved the matter's loose threads to their own store: how many, and
   * the copy-aside of the database taken first; or, when `seeds` holds rows after that one move, how many. */
  loose_threads_moved?: SeedsMove | SeedsLeft;
  /** The folded-in practice_data__matter_lookup (#590 decision 3). Never fatal: `found: false`
   * carries a one-line `note`. The client_* fields are the identity bootstrap used -- a caller's
   * own value wins over the lookup's -- and are what later drafting_forms__render calls pass. */
  matter_lookup: {
    matt_num: string | null;
    found: boolean;
    note?: string;
    client_name?: string;
    client_no?: string;
    matter_no?: string;
  };
  /** Present only when a precondition leaves a write path unusable for the whole session; the
   * session states each member and takes no job, while read-only work goes on (/draft section 6).
   * `practice_config_unreachable`: the case data root resolves neither from the per-user
   * probanda.json nor from this matter's `0. CASE DATA` folder, so drafting_data__create_writing,
   * which resolves it the same way, would fail. Never set for a matter the practice database
   * simply does not list; that stays in matter_lookup. */
  blocking?: { code: string; message: string; remedy: string }[];
  /** Present only when matter_root has no `0. DRAFT*` folder, so neither the Litigation Strategy nor any Work Board page was written (#651, #1365). */
  matter_board_note?: string;
  /** With a draft folder: the Work Board page of the filing or proceeding opened, or the one the
   * refused opening tried to open; null when there was nothing to open (ADR 0033, 2026-10-05
   * amendment). Absent when the opened filing is retired, which has no page. */
  milestone_path?: string | null;
  /** Party/counsel drift across every proceeding (party/counsel SSOT): each party row that is
   * unlinked from case data, linked to a party not of record, or whose counsel and address for
   * service could not be read from case data. The session presents each for the practitioner to
   * confirm (/draft). Empty when every party's counsel is read from case data. */
  parties_drift: PartiesDriftRow[];
  /** Present when a proceeding's parties could not be read from case data, saying why. */
  parties_drift_note?: string;
  /** Present when this call's migrate refused the hop that drops the submission copy of counsel
   * (code counsel_not_reconciled): its message, naming each counsel offer and drift row. The database
   * stays behind at v42, which is still listed and rendered as current (forms.ts
   * MIN_READABLE_SCHEMA_VERSION), and counsel_offers and parties_drift carry the rows to decide (/draft). */
  migration_refused?: string;
  /** Present when non-empty: each value a party row still holds in the submission copy of counsel
   * and the address for service that case data does not hold (counselOffers). The session offers
   * each back to the practitioner, to apply, discard or hold (/draft). */
  counsel_offers?: CounselOffer[];
  /** Present when the opened filing's kind has a court form as its venue document (form-currency.ts
   * KIND_FORM_KEYS): that form's currency (ADR 0038). The session says a non-null warning verbatim (/draft). */
  form_currency?: FormCurrency;
  /** Present when this call opened a filing: each affidavit it relies on, reconciled against the
   * court-file folder's names (court-file-affidavits.ts), its match or none found, and a `mismatch`
   * when the court file and drafting data disagree. Read-only. The session states what this found,
   * never an affidavit's status from drafting data alone (/draft). */
  court_file_affidavits?: CourtFileAffidavit[];
  /** The fast open (/draft section 7), present when this call opened a board: with a draft folder and
   * no refusal, `filing_id`, or the first live filing with a board, or the first pre-filing proceeding, opened by
   * the render a session would call with draft_dir, which wrote the matter's pages once. */
  opened?: {
    filing_id?: number;
    proceeding_id?: number;
    revision?: number;
    rendered_at?: string;
    board_summary: string;
    board_changed?: boolean;
    board_moves?: BoardMove[];
    filing_retired?: true;
    note?: string;
    /** The opened filing's declared input document types and its Ready jobs, present only when its
     * stored layout declares `ingest_inputs`. A session reads the types from here for the pre-claim
     * input check (/draft job-session.md) and never from the database. */
    ingest_inputs?: { types: string[]; ready_jobs: number[] };
  };
  /** Present when that opening render refused: its code and message. The matter's pages are still written. */
  open_refused?: { code: string; message: string };
}

type Opening = Pick<
  OpenSessionResult,
  "opened" | "open_refused" | "matter_board_path" | "milestone_path" | "milestone_paths" | "view_page_paths" | "loose_threads_path" | "moved_to_trash" | "trash_skipped" | "form_currency"
>;

function trashReport(written: Pick<PagesWritten, "moved_to_trash" | "trash_skipped">): Pick<Opening, "moved_to_trash" | "trash_skipped"> {
  return {
    ...(written.moved_to_trash ? { moved_to_trash: written.moved_to_trash } : {}),
    ...(written.trash_skipped ? { trash_skipped: written.trash_skipped } : {}),
  };
}

/**
 * Opens one board under the draft folder by the very render a session would call with draft_dir, so
 * every safeguard of that render runs. A refusal is reported, not thrown: the session still needs its
 * db_path, filing list and token to recover with (/draft section 11). With nothing opened, the pages
 * are written as bootstrap wrote them. Every page but the view pages is written here; the background
 * job writes the view pages first (forms/bootstrap-job.ts), since none is presented at the opening.
 */
function openBoard(
  dbPath: string,
  draftDir: string,
  client: ClientContext,
  todos: MatterTodos,
  dates: MatterDates,
  listed: BootstrapResult,
  filingId: number | undefined,
  timings: PhaseTimings
): Opening {
  // A Work Board with no Writing and a research Writing are never the default: each opens only when filing_id names it.
  const target = filingId ?? listed.filings.find((f) => f.retired_on === undefined && !f.milestone_only && !f.research_writing)?.filing_id;
  const proceedingId = target === undefined ? listed.pre_filing_proceedings?.[0]?.proceeding_id : undefined;
  const phases = (rendered: PhaseTimings) => {
    for (const t of rendered) timings.push({ phase: `open: ${t.phase}`, ms: t.ms });
  };
  let refused: Opening["open_refused"];
  try {
    if (target !== undefined) {
      const written: { pages?: PagesWritten } = {};
      const rendered = submissionFormsRender(dbPath, target, client, "mockup", ["Work_board"], undefined, undefined, undefined, listed.session_token, draftDir, todos, dates, (pages) => {
        written.pages = pages;
      });
      phases(rendered.timings);
      const board = rendered.documents.find((d) => d.document_type === "Work_board") as RenderedDocument;
      return {
        opened: {
          filing_id: rendered.filing_id,
          ...(rendered.revision !== undefined ? { revision: rendered.revision } : {}),
          ...(rendered.rendered_at !== undefined ? { rendered_at: rendered.rendered_at } : {}),
          board_summary: board.board_summary as string,
          ...(board.board_changed !== undefined ? { board_changed: board.board_changed } : {}),
          ...(board.board_moves !== undefined ? { board_moves: board.board_moves } : {}),
          ...(rendered.filing_retired ? { filing_retired: true as const, note: rendered.note } : {}),
          ...(board.ingest_inputs ? { ingest_inputs: board.ingest_inputs } : {}),
        },
        matter_board_path: join(draftDir, MATTER_BOARD_FILE),
        milestone_path: board.path,
        ...(written.pages ? { milestone_paths: written.pages.milestone_paths, view_page_paths: written.pages.view_page_paths, loose_threads_path: written.pages.loose_threads_path } : {}),
        // ADR 0038: the render read the opened filing's form currency; it is not read twice.
        ...(rendered.form_currency ? { form_currency: rendered.form_currency } : {}),
        ...trashReport(rendered),
      };
    }
    if (proceedingId !== undefined) {
      const rendered = submissionFormsRenderProceedingBoard(dbPath, proceedingId, client, undefined, listed.session_token, draftDir, todos, dates, false);
      phases(rendered.timings);
      return {
        opened: { proceeding_id: proceedingId, revision: rendered.revision, rendered_at: rendered.rendered_at, board_summary: rendered.board_summary },
        matter_board_path: rendered.matter_board_path,
        milestone_path: rendered.milestone_path,
        milestone_paths: rendered.milestone_paths,
        view_page_paths: rendered.view_page_paths,
        loose_threads_path: rendered.loose_threads_path,
        ...trashReport(rendered),
      };
    }
  } catch (err) {
    if (!(err instanceof DataServerError)) throw err;
    refused = { code: err.code, message: err.message };
  }
  const pages = writeMatterPages(dbPath, draftDir, client, nowStamp(), fetchRevision(dbPath), todos, dates, timings, { views: false });
  recordPagesState(dbPath, todos);
  return {
    ...(refused ? { open_refused: refused } : {}),
    matter_board_path: pages.matter_board_path,
    // The page of the filing or proceeding the refused opening tried to open; null with nothing to open.
    milestone_path: pagePathFor(pages, { filing_id: target ?? null, proceeding_id: proceedingId }) ?? null,
    milestone_paths: pages.milestone_paths,
    view_page_paths: pages.view_page_paths,
    loose_threads_path: pages.loose_threads_path,
    ...trashReport(pages),
  };
}

function elapsedMs(start: number): number {
  return Math.round((performance.now() - start) * 10) / 10;
}

export async function lookUpMatter(
  root: string,
  practiceDb: PracticeStore,
  client: ClientContext
): Promise<{ lookup: OpenSessionResult["matter_lookup"]; client: ClientContext }> {
  const token = matterToken(root);
  if (token === null) {
    return {
      lookup: { matt_num: null, found: false, note: `No matter number at the start of the folder name "${basename(root)}"; client identity not looked up.` },
      client,
    };
  }
  let rows: Record<string, unknown>[];
  try {
    rows = (await matter_lookup(practiceDb, { matt_num: token })).rows;
  } catch (err) {
    return { lookup: { matt_num: token, found: false, note: `Matter lookup for ${token} failed: ${(err as Error).message}` }, client };
  }
  if (rows.length !== 1) {
    const why = rows.length === 0 ? "found no matter" : `found ${rows.length} matters`;
    return { lookup: { matt_num: token, found: false, note: `Matter lookup for ${token} ${why}; client identity not filled in.` }, client };
  }
  const row = rows[0];
  const text = (v: unknown) => (v === null || v === undefined || v === "" ? undefined : String(v));
  const resolved: ClientContext = {
    clientName: client.clientName ?? text(row.client_name),
    clientNo: client.clientNo ?? text(row.client_num),
    matterNo: client.matterNo ?? text(row.matt_num),
    matterDescription: client.matterDescription ?? text(row.description),
  };
  return {
    lookup: {
      matt_num: token,
      found: true,
      ...(resolved.clientName !== undefined ? { client_name: resolved.clientName } : {}),
      ...(resolved.clientNo !== undefined ? { client_no: resolved.clientNo } : {}),
      ...(resolved.matterNo !== undefined ? { matter_no: resolved.matterNo } : {}),
    },
    client: resolved,
  };
}

/** open_session's matter folder: `matter_root`, or the folder of the one matter linked to the claude.ai
 * Project `project_id`. No such matter, several, or one with no `matter_root` refuses, naming the rows,
 * so the session asks and never picks (/work procedure.md). */
export async function matterRootFor(args: { matter_root?: string; project_id?: string }, practiceDb: PracticeStore): Promise<string> {
  if ((args.matter_root === undefined) === (args.project_id === undefined)) {
    throw new ValidationError("open_session takes exactly one of matter_root and project_id");
  }
  if (args.matter_root !== undefined) return args.matter_root;
  const rows = (await matter_lookup(practiceDb, { project_id: args.project_id })).rows;
  if (rows.length === 1 && typeof rows[0].matter_root === "string") return rows[0].matter_root;
  const named = rows.map((row) => ({ matt_num: row.matt_num, matter_root: row.matter_root ?? null, ...(row.matter_root_error ? { matter_root_error: row.matter_root_error } : {}) }));
  const why = rows.length === 0 ? "no matter is linked to it" : rows.length > 1 ? `${rows.length} matters are linked to it` : "its matter has no matter_root";
  throw new DataServerError(`Project ${args.project_id}: ${why}. Nothing was opened.`, "project_unresolved", { rows: named });
}

// The one repair path is /practice-data's (spec 2026-10-06_practice-db-config-repair): this names it, never a second one.
const PRACTICE_CONFIG_REMEDY =
  "Repair through /practice-data: practice_data__config_status (with this matter_root) reports what is missing and any " +
  "candidate root, and practice_data__config_set_root sets case_data_root only on the practitioner's yes; then call " +
  "drafting_forms__open_session again. open_session never writes probanda.json.";

/** The case data root resolved exactly as drafting_data__create_writing resolves it (dispatch.ts):
 * the per-user probanda.json, else this matter's `0. CASE DATA` folder. A failure is the session's
 * one blocking precondition, reported at entry instead of at the first Writing. Writes nothing. */
function practiceConfigBlocking(dbPath: string): NonNullable<OpenSessionResult["blocking"]> {
  try {
    resolveCaseDataRoot(process.env, () => caseDataRootFromDbPath(dbPath, process.env));
    return [];
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    return [{ code: "practice_config_unreachable", message: err.message, remedy: PRACTICE_CONFIG_REMEDY }];
  }
}

/** The #353 copy-aside files beside the database (`submission.sqlite.bak-*`). */
function backups(dbPath: string): Set<string> {
  const dir = dirname(dbPath);
  const prefix = `${basename(dbPath)}.bak-`;
  return new Set(existsSync(dir) ? readdirSync(dir).filter((name) => name.startsWith(prefix)) : []);
}

/** A first entry on a matter with no drafting database creates it at the path its pointer derives, by
 * the one migration path (a fresh create has nothing to back up, #353). Only the matter's own folder
 * may be made: a folder elsewhere that is missing means the pointer is stale, so that is refused. */
async function createDatabase(root: string, dbPath: string): Promise<NonNullable<OpenSessionResult["migrated"]>> {
  const folder = dirname(dbPath);
  if (!existsSync(folder)) {
    if (dirname(folder).toLowerCase() !== root.toLowerCase()) {
      throw new DataServerError(`The matter-data folder this matter's pointer names does not exist: ${folder}. Nothing was created. Run /matter-data on this matter to initialize or repair it.`, "case_data_missing");
    }
    mkdirSync(folder);
  }
  const done = await submissionDataMigrate(dbPath);
  return { from: 0, to: done.schema_version as number, backup: null, ...(Array.isArray(done.warnings) && done.warnings.length > 0 ? { warnings: done.warnings as string[] } : {}) };
}

/** Session entry. One practice snapshot and one parties-of-record read per proceeding serve the
 * whole call, however many of its parts read them (call-memo.ts). */
export const submissionFormsOpenSession = (...args: Parameters<typeof openSession>): ReturnType<typeof openSession> => inOneCall(() => openSession(...args));

async function openSession(
  matterRoot: string,
  practiceDb: PracticeStore,
  client: ClientContext = {},
  /** Passed to bootstrap, which then mints an unattended-class session token (Goal card design §5.4). */
  unattended = false,
  /** The filing to open; omitted, the first live filing with a board, else the first pre-filing proceeding. */
  filingId?: number
): Promise<{ result: OpenSessionResult; dates: MatterDates; matterDescription?: string }> {
  const started = performance.now();
  const timings: PhaseTimings = [];
  const phase = async <T>(name: string, fn: () => T | Promise<T>): Promise<T> => {
    const start = performance.now();
    const value = await fn();
    timings.push({ phase: name, ms: elapsedMs(start) });
    return value;
  };

  const root = await phase("matter_root", () => validateMatterRoot(matterRoot));
  const dbPath = await phase("pointer", () => resolveDbPath(root));
  const blocking = await phase("practice_config", () => practiceConfigBlocking(dbPath));
  const { lookup, client: identity } = await phase("matter_lookup", () => lookUpMatter(root, practiceDb, client));
  // #585: the draft folder is confined before any other work.
  const draftDir = await phase("draft_dir", () => {
    const found = findDraftDir(root);
    return found === undefined ? undefined : resolveDraftDir(found);
  });
  // ADR 0021 D1: the Litigation Strategy's to-dos, read only when there is a page to draw them on.
  const todos = draftDir === undefined ? undefined : await phase("todos", () => readMatterTodos(practiceDb, identity.matterNo));
  // ADR 0013, 2026-10-04 amendment: the Work Board's hearing dates, read beside them. They are
  // returned beside the result, never in it, since the result is the tool response.
  const dates = draftDir === undefined ? undefined : await phase("dates", () => readMatterDates(practiceDb, identity.matterNo));

  let migrated: OpenSessionResult["migrated"] = existsSync(dbPath) ? undefined : await phase("create_database", () => createDatabase(root, dbPath));
  // Bootstrap writes no page: the opening below writes the pages, once.
  let result = submissionFormsBootstrap(dbPath, identity, undefined, undefined, undefined, unattended);
  let migrationRefused: string | undefined;
  // A database bootstrap reads (it lists filings) may still be behind the migration target.
  const behind =
    result.migration_required ||
    (!result.bundle_outdated && result.schema_version !== null && result.schema_version < result.current_schema_version);
  if (behind) {
    const before = backups(dbPath);
    let migrateWarnings: string[] = [];
    try {
      const done = await phase("migrate", () => submissionDataMigrate(dbPath));
      if (Array.isArray(done.warnings)) migrateWarnings = done.warnings as string[];
    } catch (err) {
      // The hop that drops the submission copy of counsel waits on the practitioner (party/counsel
      // SSOT): the session goes on at v42, listed and rendered as current, and returns the rows to decide.
      if (!(err instanceof DataServerError && err.code === "counsel_not_reconciled")) throw err;
      migrationRefused = err.message;
    }
    // The migrate held the data lock while writing, so a backup that appeared is its own; the
    // earliest is the copy taken before its first hop.
    const written = [...backups(dbPath)].filter((name) => !before.has(name)).sort();
    const from = result.schema_version;
    const target = result.current_schema_version;
    // A refused migrate of a database bootstrap already read leaves nothing to read again.
    if (migrationRefused === undefined || result.migration_required) {
      for (const t of result.timings) timings.push({ phase: `bootstrap (before migrate): ${t.phase}`, ms: t.ms });
      result = submissionFormsBootstrap(dbPath, identity, undefined, undefined, undefined, unattended);
    }
    const to = migrationRefused === undefined ? target : result.schema_version;
    if (to !== null && to !== from) {
      migrated = { from, to, backup: written.length > 0 ? join(dirname(dbPath), written[0]) : null };
      if (migrateWarnings.length > 0) migrated.warnings = migrateWarnings;
    }
  }
  for (const t of result.timings) timings.push({ phase: `bootstrap: ${t.phase}`, ms: t.ms });
  const refused = result.migration_required || result.bundle_outdated;
  const threadsMoved = refused ? null : await phase("loose_threads", () => moveSeedsOnce(dbPath));
  // ADR 0015, 2026-11-06 note: the opening's board and pages are drawn after lapsed locks are released. This session holds no job yet.
  if (!refused) await phase("lapsed_locks", () => releaseLapsedLocks(dbPath, undefined));
  const opening: Opening =
    draftDir === undefined || todos === undefined || dates === undefined || refused ? {} : openBoard(dbPath, draftDir, identity, todos, dates, result, filingId, timings);
  const drift = await phase("parties_drift", () => matterPartiesDrift(dbPath));
  const offers = await phase("counsel_offers", () => counselOffers(dbPath));
  const courtFile = await phase("court_file_affidavits", () =>
    opening.opened?.filing_id === undefined ? undefined : courtFileAffidavits(dbPath, opening.opened.filing_id, root)
  );
  timings.push({ phase: "total", ms: elapsedMs(started) });

  return {
    result: {
      ...result,
      ...opening,
      matter_root: root,
      ...(draftDir !== undefined ? { draft_dir: draftDir } : {}),
      db_path: dbPath,
      ...(migrated ? { migrated } : {}),
      ...(threadsMoved ? { loose_threads_moved: threadsMoved } : {}),
      ...(migrationRefused !== undefined ? { migration_refused: migrationRefused } : {}),
      ...(blocking.length > 0 ? { blocking } : {}),
      matter_lookup: lookup,
      ...(draftDir === undefined ? { matter_board_note: `${root} has no 0. DRAFT folder, so neither the Litigation Strategy nor any Work Board page was written.` } : {}),
      parties_drift: drift.rows,
      ...(drift.note !== undefined ? { parties_drift_note: drift.note } : {}),
      ...(offers.length > 0 ? { counsel_offers: offers } : {}),
      ...(courtFile !== undefined ? { court_file_affidavits: courtFile } : {}),
      timings,
    },
    dates: dates ?? DATES_NOT_READ,
    // The mockup header's Matter Description, for the background job's renders; never in the response.
    matterDescription: identity.matterDescription,
  };
}
