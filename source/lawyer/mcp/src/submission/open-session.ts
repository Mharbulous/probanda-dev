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

import { existsSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { readIngestCoverage, type IngestCoverage } from "../case/ingest-coverage.js";
import type { PracticeStore } from "../practice/store.js";
import { DataServerError, ValidationError } from "../errors.js";
import { caseDataRootFromDbPath, findDraftDir, resolveDbPath, validateMatterRoot } from "../files/matter-root.js";
import { resolveCaseDataRoot } from "../practice/backend.js";
import { matter_lookup } from "../tools/practice/reads.js";
import { courtFileAffidavits, type CourtFileAffidavit } from "./court-file-affidavits.js";
import {
  type BootstrapResult,
  type ClientContext,
  fetchFilingById,
  nowStamp,
  type PhaseTimings,
  type RenderedDocument,
  resolveDraftDir,
  submissionFormsBootstrap,
  submissionFormsRender,
  submissionFormsRenderProceedingBoard,
} from "./forms.js";
import { formCurrency, KIND_FORM_KEYS, type FormCurrency } from "./form-currency.js";
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
  /** Present only when this call migrated the database before bootstrapping. `backup` is the
   * #353 copy-aside the migrate wrote beside the database, or null if none appeared. */
  migrated?: { from: number | null; to: number; backup: string | null };
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
  /** Present only when matter_root has no `0. DRAFT*` folder, so neither the Litigation Strategy nor any Job Board page was written (#651, #1365). */
  matter_board_note?: string;
  /** With a draft folder: the Job Board page of the filing or proceeding opened, or the one the
   * refused opening tried to open; null when there was nothing to open (ADR 0033, 2026-10-05
   * amendment). Absent when the opened filing is retired, which has no page. */
  job_board_path?: string | null;
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
  /** Read-only: the files in the folders the opened filing declares as its ingest inputs
   * (`opened.ingest_inputs.folders`) the case database does not yet hold, and, when a correspondence
   * folder is among them, the newest dated correspondence it does (/matter-data design-decisions #60).
   * `to_ingest` names those files and `records` says, one entry per `to_ingest` path, why each is not
   * held: its verdict, its source, and the source it may be another version of. `folders` names the
   * folder patterns it covered and `checked_at` when it ran, so the input check can stand on it
   * (/draft job-session.md). Checked only when that filing has a Ready job. `not_applicable` and `unavailable` mean the check
   * did not run, never that the folders are ingested. The session reports it in the fast open's
   * closing line (/draft). */
  ingest_coverage: IngestCoverage;
  /** Present when the opened filing's kind has a court form as its venue document (form-currency.ts
   * KIND_FORM_KEYS): that form's currency (ADR 0038). The session says a non-null warning verbatim (/draft). */
  form_currency?: FormCurrency;
  /** Present when this call opened a filing: each affidavit it relies on, reconciled against the
   * court-file folder's names (court-file-affidavits.ts), its match or none found, and a `mismatch`
   * when the court file and drafting data disagree. Read-only. The session states what this found,
   * never an affidavit's status from drafting data alone (/draft). */
  court_file_affidavits?: CourtFileAffidavit[];
  /** The fast open (/draft section 7), present when this call opened a board: with a draft folder and
   * no refusal, `filing_id`, or the first live filing, or the first pre-filing proceeding, opened by
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
    /** The opened filing's declared input folders and its Ready jobs, present only when its stored
     * layout declares `ingest_inputs`. A session reads the folders from here for the pre-claim input
     * check (/draft job-session.md) and never from the database. */
    ingest_inputs?: { folders: string[]; ready_jobs: number[] };
  };
  /** Present when that opening render refused: its code and message. The matter's pages are still written. */
  open_refused?: { code: string; message: string };
}

type Opening = Pick<
  OpenSessionResult,
  "opened" | "open_refused" | "matter_board_path" | "job_board_path" | "job_board_paths" | "view_page_paths" | "moved_to_trash" | "trash_skipped"
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
 * are written as bootstrap wrote them.
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
  // A Job Board with no Writing is never the default: it opens only when filing_id names it.
  const target = filingId ?? listed.filings.find((f) => f.retired_on === undefined && !f.job_board_only)?.filing_id;
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
        job_board_path: board.path,
        ...(written.pages ? { job_board_paths: written.pages.job_board_paths, view_page_paths: written.pages.view_page_paths } : {}),
        ...trashReport(rendered),
      };
    }
    if (proceedingId !== undefined) {
      const rendered = submissionFormsRenderProceedingBoard(dbPath, proceedingId, client, undefined, listed.session_token, draftDir, todos, dates);
      phases(rendered.timings);
      return {
        opened: { proceeding_id: proceedingId, revision: rendered.revision, rendered_at: rendered.rendered_at, board_summary: rendered.board_summary },
        matter_board_path: rendered.matter_board_path,
        job_board_path: rendered.job_board_path,
        job_board_paths: rendered.job_board_paths,
        view_page_paths: rendered.view_page_paths,
        ...trashReport(rendered),
      };
    }
  } catch (err) {
    if (!(err instanceof DataServerError)) throw err;
    refused = { code: err.code, message: err.message };
  }
  const pages = writeMatterPages(dbPath, draftDir, client, nowStamp(), fetchRevision(dbPath), todos, dates, timings);
  recordPagesState(dbPath, todos);
  return {
    ...(refused ? { open_refused: refused } : {}),
    matter_board_path: pages.matter_board_path,
    // The page of the filing or proceeding the refused opening tried to open; null with nothing to open.
    job_board_path: pagePathFor(pages, { filing_id: target ?? null, proceeding_id: proceedingId }) ?? null,
    job_board_paths: pages.job_board_paths,
    view_page_paths: pages.view_page_paths,
    ...trashReport(pages),
  };
}

/**
 * The ingest coverage of the folders the opened filing declares, read only when that filing has a
 * Ready job; otherwise not_applicable without spawning Python. "no board opened" covers no draft
 * folder, a refused opening, nothing to open, and a pre-filing proceeding's board, which has no filing.
 */
function openedIngestCoverage(opened: OpenSessionResult["opened"], dbPath: string, root: string): IngestCoverage {
  if (opened?.filing_id === undefined) return { status: "not_applicable", reason: "no board opened" };
  if (opened.ingest_inputs === undefined) return { status: "not_applicable", reason: "the opened filing declares no ingest inputs" };
  if (opened.ingest_inputs.ready_jobs.length === 0) return { status: "not_applicable", reason: "no Ready job on the opened filing" };
  return readIngestCoverage(dirname(dbPath), root, opened.ingest_inputs.folders);
}

/** The opened filing's form currency (ADR 0038), when its kind's venue document is a court form. */
function openedFormCurrency(opened: OpenSessionResult["opened"], dbPath: string): FormCurrency | undefined {
  if (opened?.filing_id === undefined) return undefined;
  const formKey = KIND_FORM_KEYS[fetchFilingById(dbPath, opened.filing_id).kind];
  return formKey === undefined ? undefined : formCurrency(formKey, nowStamp().slice(0, 10));
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

export async function submissionFormsOpenSession(
  matterRoot: string,
  practiceDb: PracticeStore,
  client: ClientContext = {},
  /** Passed to bootstrap, which then mints an unattended-class session token (Goal card design §5.4). */
  unattended = false,
  /** The filing to open; omitted, the first live filing, else the first pre-filing proceeding. */
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
  // ADR 0013, 2026-10-04 amendment: the Job Board's hearing dates, read beside them. They are
  // returned beside the result, never in it, since the result is the tool response.
  const dates = draftDir === undefined ? undefined : await phase("dates", () => readMatterDates(practiceDb, identity.matterNo));

  // Bootstrap writes no page: the opening below writes the pages, once.
  let result = submissionFormsBootstrap(dbPath, identity, undefined, undefined, undefined, unattended);
  let migrated: OpenSessionResult["migrated"];
  let migrationRefused: string | undefined;
  // A database bootstrap reads (it lists filings) may still be behind the migration target.
  const behind =
    result.migration_required ||
    (!result.migration_withheld && !result.bundle_outdated && result.schema_version !== null && result.schema_version < result.current_schema_version);
  if (behind) {
    const before = backups(dbPath);
    try {
      await phase("migrate", () => submissionDataMigrate(dbPath));
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
    if (to !== null && to !== from) migrated = { from, to, backup: written.length > 0 ? join(dirname(dbPath), written[0]) : null };
  }
  for (const t of result.timings) timings.push({ phase: `bootstrap: ${t.phase}`, ms: t.ms });
  const refused = result.migration_required || result.bundle_outdated || result.migration_withheld === true;
  const opening: Opening =
    draftDir === undefined || todos === undefined || dates === undefined || refused ? {} : openBoard(dbPath, draftDir, identity, todos, dates, result, filingId, timings);
  const drift = await phase("parties_drift", () => matterPartiesDrift(dbPath));
  const offers = await phase("counsel_offers", () => counselOffers(dbPath));
  const coverage = await phase("ingest_coverage", () => openedIngestCoverage(opening.opened, dbPath, root));
  const currency = await phase("form_currency", () => openedFormCurrency(opening.opened, dbPath));
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
      ...(migrationRefused !== undefined ? { migration_refused: migrationRefused } : {}),
      ...(blocking.length > 0 ? { blocking } : {}),
      matter_lookup: lookup,
      ...(draftDir === undefined ? { matter_board_note: `${root} has no 0. DRAFT folder, so neither the Litigation Strategy nor any Job Board page was written.` } : {}),
      parties_drift: drift.rows,
      ...(drift.note !== undefined ? { parties_drift_note: drift.note } : {}),
      ...(offers.length > 0 ? { counsel_offers: offers } : {}),
      ingest_coverage: coverage,
      ...(currency ? { form_currency: currency } : {}),
      ...(courtFile !== undefined ? { court_file_affidavits: courtFile } : {}),
      timings,
    },
    dates: dates ?? DATES_NOT_READ,
    // The mockup header's Matter Description, for the background job's renders; never in the response.
    matterDescription: identity.matterDescription,
  };
}
