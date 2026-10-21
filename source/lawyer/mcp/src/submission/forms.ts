// drafting_forms__render / drafting_forms__bootstrap (build ticket
// #297, design doc 291 §5-§6). Orchestrates the per-document renderers in
// data/forms/*, writes markdown mockups beside the matter's submission
// database, and archives the previous copy only when db_meta.revision has
// moved (design doc 291 §5's "always render, never detect" rule -- no
// revision-CAS input parameter here, per issue #302's "no stale-mockup
// guard" decision).
//
// Output location (#324, keyed by filing id since #1317): <dirname(db_path)>/
// mockups/Filing <id>/, archive copies in an archive/ folder beside them -- i.e. inside the
// matter's matter-data folder (for a new or relocated matter, the matter's own
// 0. CASE DATA; docs/ADRs/0013-per-matter-case-data-inside-the-matter-folder.md),
// not the draft folders. They are written and reached host-side through these
// tools, and a session never reads them itself, which is why render returns
// the markdown inline. Deterministic from db_path alone, so the canonical
// location takes no output-root parameter.
// This canonical copy is unaffected by ADR 0008 (docs/adr/0008-mockup-
// presentation-copy-relocated-to-draft-folder.md), which only relocates the
// disposable presentation copy into the mount -- and by ADR 0012 (#466), under
// which render's optional presentation_dir writes that copy itself.
//
// Client Name / Client no / Matter no in the frontmatter (issue #299's
// ratified YAML) have no backing column anywhere in the submission schema
// -- only proceedings.matter_reference exists, as one free-text field. Both
// tools accept them as optional caller-supplied parameters (the calling
// skill knows this from practice-data / matter context, the same way it
// already resolves db_path); when omitted, matter_reference stands in for
// all three so the tools still work standalone.
//
// session_token (ADR 0009, ticket-driven /draft sessions): the
// opaque identity a consuming skill uses as tickets.locked_by -- the only
// identity a session can offer the database for "who holds this ticket."
// No Cowork/CC session id reaches this server, so the server cannot derive
// one; it MINTS one instead. drafting_forms__bootstrap mints a fresh
// random token per call (newSessionToken() below) and returns it alongside
// bootstrapped_at, the session's own start stamp on the same wall clock
// tickets.locked_at is written on. drafting_forms__render mints nothing:
// it ECHOES back the session_token it was given. So one session sees one
// stable identity across its bootstrap and every later render, while two
// sessions sharing one server process get different ones.
//
// This replaced a per-process token, `${process.pid}-${module load time}`,
// which was per-session only where the host spawns one server per session.
// Under Cowork the Electron main process spawns one litigation-mcp.js at app
// start and shares it across every session on the machine (#586,
// docs/infra/mcp-server-lifetime-investigation.md), so two concurrent
// sessions received byte-identical tokens -- observed live twice (#609).
// How many server processes a host spawns is never load-bearing: do not
// derive identity from the process again.
//
// No server-side code ever compares this value; the whole contract is what
// /drafting-data's jobs.md tells the model to do with it.

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";

import { buildStampStatus, type BuildStampStatus } from "../build-stamp.js";
import { submissionDataQuery } from "./backend.js";
import { currentSchemaVersion } from "./migrate.js";
import { bundleNextStep, renderableSchemaVersion, type SchemaSourceStatus, schemaSourceStatus } from "./schema-ceiling.js";
import {
  freshManifest,
  legacyMockupDirs,
  mockupDir,
  mockupDirForRender,
  mockupsRoot,
  readManifest,
  renderState,
  sha256,
  writeManifest,
  type RenderManifest,
  type RenderState,
  type RenderStamp,
} from "./render-manifest.js";
import { orderByRecency, orderFilings, type Orderable } from "./filing-order.js";
import { backgroundJobStatus, startRenderJob, writeStatusFile, type BackgroundJob } from "./render-job.js";
import {
  fetchAllFilingsForProceeding,
  fetchAllProceedings,
  fetchHearingDate,
  fetchLatestActivity,
  fetchParties,
  fetchPreFilingProceedings,
  fetchSentParties,
  fetchProceeding,
  fetchRevision,
  isJobOnlyBoard,
  requireForum,
  type FilingRow,
  type PartyRow,
  type ProceedingRow,
} from "./forms/query.js";
import { CITATION_MISSING, fetchReviewState, renderWitnessStatements, type RenderContext } from "./forms/render-vaniac-submissions.js";
import { composeFiller, resolveTypeFile } from "./forms/filler-registry.js";
import { citedStates, scalarValue, storedLayout, type CitedState, type StoredLayout } from "./forms/layout-snapshot.js";
import { confirmationGate, renderGeneral, type ChangedSinceSnapshot } from "./forms/render-general.js";
import { currencyLabel, type CurrencyWithheld, type ProseFormatHit } from "./forms/projections.js";
import { deriveLifecycle, type LifecycleState } from "./forms/lifecycle.js";
import type { RankedFiling } from "./forms/render-matter-board.js";
import { deadlineCriteria, type MatterDates } from "./matter-dates.js";
import type { MatterTodos } from "./matter-todos.js";
import {
  DATES_NOT_READ,
  pagePathFor,
  persistedTodos,
  recordPagesState,
  refuseForeignMatterPages,
  renderBoardSummary,
  TODOS_NOT_READ,
  writeMatterPages,
  type BoardMove,
  type PagesWritten,
} from "./matter-pages.js";
import { ASSOCIATE_JUDGE_UNDETERMINED_LINE } from "./forms/render-notice-of-application.js";
import { renderForm32FiledFace } from "./forms/render-form32-filed-face.js";
import { TEMPLATE_NOT_CHOSEN, UNRECOGNIZED_TEMPLATE_KEY } from "./forms/render-requisition.js";
import { recordReserveInventory, renderWrittenArguments } from "./forms/render-companions.js";
import { buildPreFilingBoardData, buildWorkBoardData, RESERVE_INVENTORY_DOC, UNATTENDED_TOKEN_PREFIX, WORKBOARD_DATA_FILE, type WorkBoardData } from "./forms/render-work-board.js";
import { renderBccaBookFiledFace } from "./forms/emit-bcca-book.js";
import { renderBccaFactumFiledFace } from "./forms/emit-bcca-factum.js";
import { renderForm33FiledFace } from "./forms/render-form33-filed-face.js";
import { fetchUnplacedFacts, refuseUnplacedFacts } from "./forms/unplaced-facts.js";
import { publishFileName, publishSidecar, type PublishWarning } from "./publish-sidecar.js";
import { renderAffidavitFiledFace } from "./forms/emit-affidavit.js";
import { fetchAffidavits } from "./forms/render-bcsc-affidavit.js";
import { typeLabel, withSubject, witnessStatementLabel, type WritingLabel } from "./forms/writing-label.js";
import { toFiledFace } from "./forms/filed-face.js";
import { legendNotes, withLegend } from "./forms/legend.js";
import { gapMarker, MOCKUP_ONLY_TAG } from "./forms/markers.js";
import { draftingParties, withLeadLines, withPartiesDriftLines, type DraftingParties, type PartiesDrift, type PartiesDriftRow } from "./parties-drift.js";
import { formCurrency, KIND_FORM_KEYS, type FormCurrency } from "./form-currency.js";
import type { KnowledgeSeams } from "../knowledge/tree.js";
import { noteUpDue, stampDoc } from "./forms/proposal-inventory.js";
import { scanUntrackedCitations } from "./forms/citation-scan.js";
import { DataServerError, ValidationError } from "../errors.js";
import { runPreFilingChecks, type PreFilingChecksResult } from "./pre-filing/index.js";
import { confineCaseDataFolder, writeSubstanceFile } from "./substance-file.js";

export type RenderMode = "mockup" | "filed";

export interface ClientContext {
  clientName?: string;
  clientNo?: string;
  matterNo?: string;
  /** The matter's description from practice data's matter lookup, for board_summary's header and
   * the mockup header's `Matter Description:`. */
  matterDescription?: string;
}

interface DocumentOutput {
  documentType: string;
  fileName: string;
  markdown: string;
  /** The Job Board Writings strip's short label and `title` text; stored in the manifest. */
  label: WritingLabel;
  /** A general Writing only: the parts it printed with no content, which the filed render refuses on. */
  unwritten?: string[];
  /** A general Writing only: the clause lines it tagged `[currency: ...]`, which the filed render refuses on. */
  currency_withheld?: CurrencyWithheld[];
  /** A general Writing only: the prose lines breaking a refused format rule, which the filed render refuses on. */
  prose_format?: ProseFormatHit[];
}

function sanitizeForPath(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim();
}

/**
 * What is actually on disk for one filing, now that bootstrap renders nothing (#584): the
 * advocacy mockups its manifest lists and that still exist, plus a Job Board an older render left
 * beside them (#1365 D1: left in place and listed). A filing never rendered reports none, and its
 * `render_state` says `never`. Existence only -- no mockup is opened, so a OneDrive placeholder
 * costs nothing here.
 */
function existingMockupPaths(baseDir: string): string[] {
  const manifest = readManifest(baseDir);
  const paths = (manifest?.files ?? []).map((f) => join(baseDir, f.file_name)).filter((p) => existsSync(p));
  // A filing rendered before the Job Board rename (#869) still has its board under the old name.
  const board = [join(baseDir, "Job Board.html"), join(baseDir, "Work Board.html")].find((p) => existsSync(p));
  if (board) paths.push(board);
  return paths;
}

/** Per-phase durations in ms, on every render and bootstrap response and logged by dispatch
 * (2026-09-14 board-first bootstrap brief §0, #579). Later optimisations are measured against them. */
export type PhaseTimings = { phase: string; ms: number }[];

function elapsedMs(start: number): number {
  return Math.round((performance.now() - start) * 10) / 10;
}

export function timed<T>(timings: PhaseTimings, phase: string, fn: () => T): T {
  const start = performance.now();
  const value = fn();
  timings.push({ phase, ms: elapsedMs(start) });
  return value;
}

/** Appends the call's whole duration as `total`, so untimed work shows as the gap. */
function withTotal(timings: PhaseTimings, start: number): PhaseTimings {
  timings.push({ phase: "total", ms: elapsedMs(start) });
  return timings;
}

// Local wall-clock, deliberately not UTC (#383): every practitioner-facing
// date in the pipeline follows the practitioner's calendar, including the
// admission-ladder "today" and bench-line dates derived from ctx.rendered.
export function nowStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Ticket-driven sessions (ADR 0009) need an opaque identity for
// tickets.locked_by, and no Cowork/CC session id reaches the model -- so the
// server mints one. Fresh random bytes, called exactly once per
// drafting_forms__bootstrap: uniqueness comes from the entropy, never from
// anything about the host, the process or the clock. That is what makes two
// sessions sharing one server process distinguishable, and what makes a token
// unreproducible -- a restarted server can never regenerate one it once
// issued, so it cannot silently re-acquire an old lock string (#609).
//
// Do NOT derive this from process.pid, module load time, or any other property
// of the server process: how many processes a host spawns is not load-bearing
// and was already wrong once (#586, #609).
//
// An unattended run (Goal card design §5.4) asks for a token of its own class, so the Job Board
// can tell its lock from an attended session's without a new column.
function newSessionToken(unattended: boolean): string {
  return `${unattended ? UNATTENDED_TOKEN_PREFIX : "sess-"}${randomBytes(9).toString("hex")}`;
}

export function readExistingRevision(filePath: string): number | undefined {
  if (!existsSync(filePath)) return undefined;
  const text = readFileSync(filePath, "utf-8");
  // [ \t]*, not \s* -- "Revision:\s" bundles to the literal substring "n:\s",
  // which the bundle-contract test's host-path scanner (HOST_PATH =
  // /[A-Za-z]:\\|.../) reads as a baked Windows drive path. Not a real path;
  // just avoid a backslash escape directly after "n:" in the source regex.
  // The Job Board carries no YAML frontmatter. Its revision is the first key of its data line, a
  // line of its own inside the page since 2026-09-15 (hence the m flag) and the whole of the sibling
  // workboard-data.js the day before; a board written before the 2026-09-14 local-only design
  // carried it in its header meta line instead, which still identifies an older board as this renderer's own.
  const match =
    text.match(/^Revision:[ \t]*(\d+)/m) ?? text.match(/^window\.WORKBOARD = \{"meta":\{"revision":(\d+)/m) ?? text.match(/data-k="Rev">(\d+)</);
  return match ? Number(match[1]) : undefined;
}

/** Archives the previous copy of `filePath` under `archive/<form> @rev<N> <timestamp><ext>` only when its stamped revision differs from `currentRevision`. */
function archiveIfStale(filePath: string, formLabel: string, currentRevision: number): void {
  const existingRevision = readExistingRevision(filePath);
  if (existingRevision === undefined || existingRevision === currentRevision) return;
  archiveFile(filePath, formLabel, existingRevision);
}

function archiveFile(filePath: string, formLabel: string, revision: number): void {
  const archiveDir = join(dirname(filePath), "archive");
  mkdirSync(archiveDir, { recursive: true });
  // Two files of one type archived at one revision in one minute -- two witness statements -- would
  // share a name, and the second rename would replace the first copy, so a later one is numbered.
  const name = `${sanitizeForPath(formLabel)} @rev${revision} ${nowStamp().replace(/[: ]/g, "-")}`;
  let archivePath = join(archiveDir, `${name}${extname(filePath)}`);
  for (let n = 2; existsSync(archivePath); n++) archivePath = join(archiveDir, `${name} (${n})${extname(filePath)}`);
  renameSync(filePath, archivePath);
}

/** Archives each file the previous render's manifest listed that this render no longer writes
 * (#1339): a re-snapshot after the type's title changed, a witness removed, a companion dropped.
 * Named as archiveIfStale names a copy, with the revision that manifest stamped. Only listed files
 * move, never one outside `baseDir`. A file already gone, or locked or refused by the sync client,
 * is left in place rather than failing the render, as removeRetiredBoardFiles leaves one. The new
 * manifest does not list a file left that way, so no later render retries it: listing it would
 * make a memoisation hit serve it as one of the filing's documents. */
function archiveDroppedFiles(baseDir: string, previous: RenderManifest | null, written: ReadonlySet<string>): void {
  if (!previous) return;
  for (const file of previous.files) {
    if (written.has(file.file_name) || basename(file.file_name) !== file.file_name) continue;
    try {
      archiveFile(join(baseDir, file.file_name), file.document_type, previous.stamp.revision);
    } catch (err) {
      if (!["ENOENT", "EBUSY", "EPERM"].includes((err as NodeJS.ErrnoException).code ?? "")) throw err;
    }
  }
}

function writeDocument(baseDir: string, output: DocumentOutput, revision: number): string {
  mkdirSync(baseDir, { recursive: true });
  const filePath = join(baseDir, output.fileName);
  archiveIfStale(filePath, output.documentType, revision);
  const code = writeStatusFile(filePath, output.markdown);
  if (code) throw new DataServerError(`could not write ${filePath}: ${code}`);
  return filePath;
}

/**
 * The files the board was split into before it became one self-contained page (local-only design,
 * amended 2026-09-15): the stylesheet and behaviour script one level up, the data script beside it.
 * A render deletes any it finds in `dir` -- these fixed names only, never recursively, never inside
 * archive/ (ADR 0012's amendment). The tree is OneDrive-synced, so a file that is already gone, or
 * locked or refused by the sync client, is left for a later render rather than failing this one.
 */
const RETIRED_BOARD_FILES = ["workboard.css", "workboard.js", WORKBOARD_DATA_FILE];

function removeRetiredBoardFiles(dir: string, names: readonly string[] = RETIRED_BOARD_FILES): void {
  for (const name of names) {
    const file = join(dir, name);
    try {
      if (existsSync(file)) unlinkSync(file);
    } catch (err) {
      if (!["ENOENT", "EBUSY", "EPERM"].includes((err as NodeJS.ErrnoException).code ?? "")) throw err;
    }
  }
}

const STALE_WORKBOARD_MARKDOWN = "Work Board.md";

/** The HTML board replaces the Markdown one outright (2026-09-03 design doc §3). A matter
 * rendered by an older bundle still has the stale `Work Board.md` beside it, which no render
 * overwrites and no archive rule catches -- a renderer-owned output superseded by a rename,
 * discarded rather than relocated (ADR 0008). */
function removeStaleWorkBoardMarkdown(baseDir: string): void {
  const stale = join(baseDir, STALE_WORKBOARD_MARKDOWN);
  if (existsSync(stale)) unlinkSync(stale);
}

/** `[STALE_WORKBOARD_MARKDOWN]` when the presentation folder `dir` holds one carrying a render revision
 * stamp, as every Markdown board did, else none (#966). Unlike the store beside the database, that
 * folder is the practitioner's, so an unstamped `Work Board.md` there is theirs and is never deleted. */
function ownStaleWorkBoardMarkdown(dir: string): string[] {
  return readExistingRevision(join(dir, STALE_WORKBOARD_MARKDOWN)) !== undefined ? [STALE_WORKBOARD_MARKDOWN] : [];
}

/** A Writing's party rows and their drift. A sent Writing prints the party rows it printed when sent
 * (schema v41, party/counsel SSOT) and is never read against case data. A drafting Writing's rows
 * take counsel and the address for service live from case data, in the folder holding this database. */
function partiesFor(dbPath: string, proceeding: ProceedingRow, filing: FilingRow): DraftingParties {
  if (filing.filed_on) return { parties: fetchSentParties(dbPath, filing), drift: { rows: [] } };
  return draftingParties(dirname(dbPath), proceeding, fetchParties(dbPath, proceeding.id));
}

/** The drift and every party's matter-data values, as the render manifest's `parties_drift` records them:
 * case data's writes move no stamp input, so a counsel change there must miss the manifest. The one
 * construction shared by render, bootstrap's render_state and the background job's freshness check (#1308). */
function partiesDigest({ parties, drift }: DraftingParties): string {
  return sha256(
    JSON.stringify({
      rows: drift.rows,
      parties: parties.map((p) => [p.id, p.counsel_name, p.counsel_firm, p.counsel_email, p.counsel_phone, p.address_for_service]),
    })
  );
}

/** The drift fields a response carries: each drifted row, and why case data could not be read. */
function driftReport(drift: PartiesDrift): { parties_drift?: PartiesDriftRow[]; parties_drift_note?: string } {
  return {
    ...(drift.rows.length > 0 ? { parties_drift: drift.rows } : {}),
    ...(drift.unchecked ? { parties_drift_note: drift.unchecked.note } : {}),
  };
}

export interface PartiesDriftRefusal {
  filing_id: number;
  revision: number;
  parties_drift_gate_failed: true;
  parties_drift?: PartiesDriftRow[];
  parties_drift_note?: string;
  note: string;
}

/** The party drift gate (party/counsel SSOT), shared by the filed render and the four filed-face
 * emitters: a drafting Writing's filed face never goes out while a party's counsel or address for
 * service could not be read from case data. Null when no row drifts. */
function partiesDriftRefusal(filingId: number, revision: number, drift: PartiesDrift, tool: string): PartiesDriftRefusal | null {
  if (drift.rows.length === 0) return null;
  return {
    filing_id: filingId,
    revision,
    parties_drift_gate_failed: true,
    ...driftReport(drift),
    note:
      "Refusing to render the filed face: counsel of record and the address for service, which case data owns, could not be read for party row(s): " +
      drift.rows.map((r) => `${r.name} (${r.kind})`).join(", ") +
      ". Confirm each with the practitioner and link it to its matter-data party, or correct case data through /matter-data first " +
      `(references/filing-checklists.md §0), then call ${tool} again.`,
  };
}

export function buildContext(
  dbPath: string,
  proceeding: ProceedingRow,
  filing: FilingRow,
  /** partiesFor's rows: what every renderer reads for parties and counsel. */
  parties: PartyRow[],
  revision: number,
  client: ClientContext,
  appealDeadline?: string,
  /** The call's single clock reading (#581 §4). Every date this context derives -- the
   * `Rendered:` stamp, the lifecycle's today, the admission ladder's today -- comes from
   * this one value, so a determinism test pins it instead of normalising `Rendered:` lines. */
  now: string = nowStamp()
): RenderContext {
  const rendered = now;
  return {
    dbPath,
    proceeding: requireForum(proceeding, filing.needs_forum_parts === 1),
    parties,
    filing,
    revision,
    rendered,
    // Lifecycle (schema v17): derived here, once per render, from the filing's own dates, its
    // hearing_details row, and the caller-supplied appeal deadline -- `today` is `rendered`'s own
    // date part, so the board's state and its Rendered stamp can never disagree.
    lifecycle: deriveLifecycle(filing, fetchHearingDate(dbPath, filing.id), rendered.slice(0, 10), appealDeadline),
    clientName: client.clientName ?? proceeding.matter_reference,
    clientNo: client.clientNo ?? "",
    matterNo: client.matterNo ?? "",
    matterDescription: client.matterDescription ?? "",
    // Fresh per filing: every renderSubmissionParagraphs call site fills it, recordReserveInventory
    // reads it back. See the field's own doc comment on RenderContext.
    paragraphLedger: new Map(),
    // Fresh per filing: every emit site that prints a generating glyph appends to it, and the
    // Job Board reads it back last. See the field's own doc comment on RenderContext. The
    // filed-face emitters and the pre-filing check build a context through here too and simply
    // carry the empty array -- neither renders the board.
    inventory: [],
    // Read once per render; the forum emit sites print 🧐 from it. The filed-face emitters and the
    // pre-filing check carry it too and never read it.
    review: fetchReviewState(dbPath, proceeding.id),
  };
}

/** Greatest review_approvals.id, 0 with none -- the stamp's `approvals` field. An approval moves no
 * revision, so this is what makes a render after one miss the manifest (practitioner-review plan
 * Phase 5). */
function fetchApprovalsMark(dbPath: string): number {
  const found = submissionDataQuery(dbPath, "SELECT COALESCE(MAX(id), 0) AS mark FROM review_approvals", []).rows as unknown as { mark: number }[];
  return found[0].mark;
}

/** The render stamp (#581 §1) a render of this filing with these client fields would carry now. The one
 * construction shared by render, bootstrap's render_state and the background job's freshness check, so
 * the three cannot disagree about what "fresh" means. */
function stampFor(
  filingId: number,
  proceeding: ProceedingRow,
  client: ClientContext,
  now: string,
  revision: number,
  schemaVersion: number | null,
  buildStamp: string | null,
  approvals: number
): RenderStamp {
  return {
    filing_id: filingId,
    revision,
    approvals,
    schema_version: schemaVersion,
    build_stamp: buildStamp,
    client_name: client.clientName ?? proceeding.matter_reference,
    client_no: client.clientNo ?? "",
    matter_no: client.matterNo ?? "",
    date: now.slice(0, 10),
  };
}

/** One document's render, timed as `render <fileName>`. Every inventory entry the render records is
 * stamped with this document's documentType (Goal card design §2.2), so a criterion reads "goes to
 * the forum" off NEVER_DELIVERED_DOCS by that documentType. */
function renderDocument(
  ctx: RenderContext,
  timings: PhaseTimings,
  documentType: string,
  fileName: string,
  render: () => string,
  label: WritingLabel = typeLabel(documentType, fileName)
): DocumentOutput {
  const from = ctx.inventory.length;
  const markdown = timed(timings, `render ${fileName}`, render);
  stampDoc(ctx.inventory, from, documentType);
  return { documentType, fileName, markdown, label };
}

/** The Writing's stored layout, or null for a row with none (a seeded test row; every real database
 * is snapshotted since v30). */
function layoutFor(filing: FilingRow): StoredLayout | null {
  return filing.layout_snapshot === null ? null : storedLayout(filing);
}

/** A general Writing's stored layout, or null for a bespoke one. */
function generalLayoutFor(filing: FilingRow): StoredLayout | null {
  const stored = layoutFor(filing);
  return stored !== null && stored.layout.renderer === "general" ? stored : null;
}

/** Whether a general Writing's stored layout cites an item, whose live confirmation status tags its
 * mockup outside the render stamp: such a Writing is never served from its manifest. */
function hasLiveTags(general: StoredLayout | null): boolean {
  return general !== null && Object.keys(general.passage_hashes).length > 0;
}

/** The render state of a filing's mockups on disk, against partiesDigest's value for it. A Writing with
 * live tags is never `fresh`: the render never serves it from the manifest, so neither does the freshness check. */
function renderStateFor(baseDir: string, stamp: RenderStamp, filing: FilingRow, digest: string): RenderState {
  const state = renderState(baseDir, stamp, digest);
  return state === "fresh" && hasLiveTags(generalLayoutFor(filing)) ? "stale" : state;
}

/** The venue document(s) and the companions their type declares. A general Writing renders one
 * document from its stored layout (forms/render-general.ts), a bespoke one through the filler its
 * type file composes to (forms/filler-registry.ts), which needs the forum. */
function venueDocumentsForFiling(
  ctx: RenderContext,
  timings: PhaseTimings,
  general: StoredLayout | null,
  cited: CitedState[]
): { docs: DocumentOutput[]; companions: readonly unknown[] } {
  if (general !== null) {
    const fileName = `${sanitizeForPath(String(scalarValue(general.layout.title)))}.md`;
    let unwritten: string[] = [];
    let currencyWithheld: CurrencyWithheld[] = [];
    let proseFormat: ProseFormatHit[] = [];
    const doc = renderDocument(
      ctx,
      timings,
      "General_writing",
      fileName,
      () => {
        const rendered = renderGeneral(ctx, general, cited);
        unwritten = rendered.unwritten;
        currencyWithheld = rendered.currency_withheld;
        proseFormat = rendered.prose_format;
        return rendered.markdown;
      },
      { short: String(scalarValue(general.layout.folder_code)), long: String(scalarValue(general.layout.title)) }
    );
    return {
      docs: [{ ...doc, unwritten, currency_withheld: currencyWithheld, prose_format: proseFormat }],
      companions: (general.layout.companions as unknown[] | undefined) ?? [],
    };
  }
  const { filler, block } = composeFiller(requireForum(ctx.proceeding, true).forum, ctx.filing.kind);
  const docs = filler<DocumentOutput>(ctx, {
    document: (documentType, fileName, render, label) => renderDocument(ctx, timings, documentType, fileName, render, label),
    witnessStatements: () => {
      // One call renders every witness statement, so their entries share the one documentType.
      const from = ctx.inventory.length;
      const statements = timed(timings, "render Witness statements", () => renderWitnessStatements(ctx));
      stampDoc(ctx.inventory, from, "Witness_statement");
      return statements.map((ws) => ({
        documentType: "Witness_statement",
        fileName: `Witness Statement - ${sanitizeForPath(ws.witnessName)}.md`,
        markdown: ws.markdown,
        label: witnessStatementLabel(ws.witnessName),
      }));
    },
  });
  return { docs, companions: (block.companions as unknown[] | undefined) ?? [] };
}

/** #370/#380: Written Arguments renders as a true companion (document='written_argument') for
 * every type that declares `written-arguments` among its `companions` (shared/declared-layout.md
 * section 6); a type whose venue document is itself the written argument (VanIAC's submissions
 * package, the BCCA response book and factum) declares none. The reserve inventory is then
 * recorded for every filing, with no document. The Job
 * Board is no document of the filing's (#1365): the render builds its section from this render's
 * inventory, after these documents, and the filing's own Job Board page carries it. */
function documentsForFiling(ctx: RenderContext, timings: PhaseTimings, general: StoredLayout | null, cited: CitedState[]): DocumentOutput[] {
  // ORDER IS LOAD-BEARING: recordReserveInventory reads ctx.paragraphLedger, which the venue
  // renderers and the Written Arguments companion fill as they number their own paragraphs. It
  // must stay after both, and the venue face must stay first (first-write-wins gives it
  // priority for a submission carried by both documents). Evaluation here is eager and strictly
  // ordered, so this holds -- but nothing else enforces it.
  const { docs, companions } = venueDocumentsForFiling(ctx, timings, general, cited);
  // The venue document alone carries the Writing's subject on the Job Board's Writings strip.
  docs[0] = { ...docs[0], label: withSubject(docs[0].label, ctx.filing.title) };
  if (companions.includes("written-arguments")) {
    docs.push(renderDocument(ctx, timings, "Written_arguments", "Written Arguments.md", () => renderWrittenArguments(ctx, "written_argument")));
  }
  const from = ctx.inventory.length;
  recordReserveInventory(ctx);
  stampDoc(ctx.inventory, from, RESERVE_INVENTORY_DOC);
  return docs;
}

export interface RenderedDocument {
  document_type: string;
  /** Absent in 'filed' mode -- filed-face rendering writes nothing to disk (build #359); the caller decides where the returned markdown lands.
   * On the Job Board: this filing's Job Board page, present only when this render wrote the pages
   * and the filing is live (a retired filing has no page). */
  path?: string;
  /** The renderer's own file name (e.g. "Written Argument.md") -- present in every mode, since 'filed' mode has no path for a caller to derive it from. */
  file_name: string;
  /** Absent under presentation_dir unless this document was named in `documents` (#466). Never on the Job Board. */
  markdown?: string;
  /** Mockup mode, beside `markdown`, only when a row of the mockup's legend has a note written for
   * the model (forms/legend.ts): one string per note. Never written to any file. */
  symbol_notes?: string[];
  /** The Job Board only (#1365): this filing's section's short summary as fixed-grammar text.
   * Present only when the board was named in `documents`, and on a retired filing's refusal. */
  board_summary?: string;
  /** Present only under presentation_dir, on each copy written there (#466). Never on the Job Board. */
  presentation_path?: string;
  /** Present only under presentation_dir, on every document but the Job Board: the document's length, so a
   * caller can tell before asking for it inline whether it alone would overflow the host's tool-result cap (#466). */
  markdown_chars?: number;
  /** The Job Board only, when this render wrote the pages: false when the section this filing last
   * reported (matter-pages-state.json) matches apart from meta.rendered, true otherwise. Revision
   * cannot say this, since a job or shelving write moves no revision. */
  board_changed?: boolean;
  /** Beside board_changed whenever a section was recorded (#1035): each job added (from null),
   * removed (to null) or moved to another board column since it. Empty when no job moved. */
  board_moves?: BoardMove[];
  /** The Job Board only: true when this render wrote the matter's pages. */
  pages_written?: boolean;
  /** The Job Board only, when the filing's stored layout declares `ingest_inputs`: those folders and
   * the ids of the filing's own Ready jobs, which take /draft's input check before a claim. */
  ingest_inputs?: { folders: string[]; ready_jobs: number[] };
}

export interface RenderResult {
  filing_id: number;
  revision?: number;
  documents: RenderedDocument[];
  /** Present only on a successful mockup-mode render for which the caller supplied a
   * session_token (ADR 0009, #609) -- this render ECHOES that value back unchanged, so a session
   * keeps one stable identity across its bootstrap and every later render. Render mints nothing;
   * the token is issued once, by drafting_forms__bootstrap. A consuming skill uses it as
   * tickets.locked_by. */
  session_token?: string;
  /** Present only on a successful mockup-mode render (#548) -- ctx.rendered, the exact stamp this
   * render printed on its documents' Rendered lines, so a caller never needs a second clock read. */
  rendered_at?: string;
  schema_version?: number | null;
  current_schema_version?: number;
  /** True only when the database is ahead of the installed plugin bundle -- see submissionFormsBootstrap's #352 gate. */
  bundle_outdated?: boolean;
  /** True only on the retired-filing refusal (schema v17): mockup mode on a filing with
   * retired_on set renders no mockup and writes nothing beside the database. `documents` carries
   * the Job Board alone, with its board_summary, so the retire flow can read the state Retired,
   * and note explains what happened. A retired filing is recovered (retired_on
   * cleared) before it renders again -- rendering one would archive the mockups of a filing
   * whose work is over. */
  filing_retired?: boolean;
  /** True only on a Job Board with no Writing (forms/query.ts JOB_BOARD_KIND): mockup mode builds its
   * board and nothing else, so no mockup, manifest or presentation copy is written.
   * `documents` carries the Job Board alone, with its board_summary. A closed one also carries
   * filing_retired and a note. */
  job_board_only?: true;
  /** Present only when this render wrote the matter's pages: every view page written (ADR 0033,
   * 2026-10-07 amendment), [{name, filing_id, path}]. */
  view_page_paths?: PagesWritten["view_page_paths"];
  /** Old page files this render's page write moved into the matter's TRASH (#1365 D3). */
  moved_to_trash?: PagesWritten["moved_to_trash"];
  /** Old page files that page write could not move, and why. */
  trash_skipped?: PagesWritten["trash_skipped"];
  /** True only on the ticket 2026-08-31 filing-gate refusal: a statement of law deployed on a
   * filed-face document has no authorities.citation. Mirrors bundle_outdated's shape -- documents
   * comes back empty, note explains what to fix. */
  citation_gate_failed?: boolean;
  /** True only on the #451 filed-face refusal: a Notice of Application's associate-judge
   * jurisdiction is not yet determined, so neither Form 32 sentence may print. Same shape as
   * citation_gate_failed. */
  associate_judge_gate_failed?: boolean;
  /** True only on the #825 filed-face refusal: a Form 8 order deployed on this filing has no
   * template_key, or one outside renderTemplate's closed set, so its operative sentence would
   * deliver "(template not chosen)" or 'unrecognized template_key "..."'. Same shape as
   * citation_gate_failed. */
  template_key_gate_failed?: boolean;
  /** True only on the confirmation gate's filed-face refusal (spec §6 piece 5): a general Writing's
   * stored layout cites an item of a learned file that no roster lawyer has confirmed. Same shape
   * as citation_gate_failed, with `unconfirmed` naming each such rule_ref in block order. */
  confirmation_gate_failed?: boolean;
  unconfirmed?: string[];
  /** On a filed render of a general Writing, refused or not: each cited item whose passage differs
   * from the one its snapshot recorded. Absent when none does. */
  changed_since_snapshot?: ChangedSinceSnapshot[];
  /** True only on the unwritten gate's filed-face refusal: a general Writing's `slot:<name>`,
   * `addressee` or `sender` part has no text, or a DB-backed projection (`parties`,
   * `orders-sought`, `legal-basis`, `material-relied-on`, `form-source`) has no rows. Same shape as
   * citation_gate_failed, with `unwritten` naming each such part in block order. */
  unwritten_gate_failed?: boolean;
  unwritten?: string[];
  /** True only on the prose format gate's filed-face refusal (plan 2026-10-07 step 5): a general
   * Writing's prose line holds a bracketed template placeholder, a bare TBD/TODO/TBC, a line opening
   * `Note:` or `Draft note:`, or an emoji the symbol table does not hold (forms/prose-format.ts).
   * Same shape as citation_gate_failed, with `prose_format` naming each line in print order. */
  prose_format_gate_failed?: boolean;
  prose_format?: ProseFormatHit[];
  /** True only on the currency gate's filed-face refusal (#1181): an implied clause names the
   * statute, regulation or rule its cited statement rests on, and that authority's stored
   * statute-currency result is not `current` (null: never checked). Same shape as
   * citation_gate_failed, with `currency_withheld` naming each such clause in print order. */
  currency_gate_failed?: boolean;
  currency_withheld?: CurrencyWithheld[];
  /** True only on the party drift gate's filed-face refusal (party/counsel SSOT): a drafting
   * Writing's proceeding has a party row that is unlinked from case data, linked to a party not of
   * record, or whose counsel and address for service could not be read from case data.
   * Same shape as citation_gate_failed, with `parties_drift` naming each row. */
  parties_drift_gate_failed?: boolean;
  /** Each drifted party row (parties-drift.ts), on the gate's refusal and on a mockup render that
   * marked them. Absent when none drifts. */
  parties_drift?: PartiesDriftRow[];
  /** Why the parties' counsel could not be read from case data, when it could not; every party is
   * then a `parties_drift` row of kind `unchecked`. */
  parties_drift_note?: string;
  /** On a delivered filed render of a Writing with a stored layout: that layout, as storedLayout returns it (spec §6 piece 6). */
  stored_layout?: StoredLayout;
  /** On a mockup render of a kind whose venue document is a court form (form-currency.ts KIND_FORM_KEYS):
   * that form's currency (ADR 0038). A non-null warning also heads the venue document as a mockup-only line. */
  form_currency?: FormCurrency;
  /** On a mockup render of a Writing, only when its Proposed lane holds a note-up Proposal no live
   * job holds and the practitioner has not shelved: those keys, in the lane's order (noteUpDue). The
   * session writes them into the Writing's note-up job (`/drafting-data` jobs-create.md §3k). */
  note_up_due?: string[];
  /** Present on the bundle_outdated, citation_gate_failed, associate_judge_gate_failed,
   * template_key_gate_failed, confirmation_gate_failed, unwritten_gate_failed, prose_format_gate_failed,
   * currency_gate_failed, parties_drift_gate_failed or filing_retired refusal -- what was skipped and what to do. */
  note?: string;
  /** On every response, refusals included (#579). */
  timings: PhaseTimings;
}

/** Ticket 2026-08-31, decision 5: a filed-face document may never contain CITATION_MISSING. Scans
 * the pre-strip mockup markdown (toFiledFace runs after this, and would strip the very
 * <!-- statement_of_law_id N --> trace comment this needs to name the offending statement).
 * pushStatementLines (render-vaniac-submissions.ts) always emits the citation line immediately
 * before the markers+id-comment line, so the trace is on the same line or the next. */
function findMissingLawCitations(markdown: string): number[] {
  const ids: number[] = [];
  const lines = markdown.split("\n");
  lines.forEach((line, i) => {
    if (!line.includes(CITATION_MISSING)) return;
    for (let j = i; j <= i + 1 && j < lines.length; j++) {
      const m = lines[j].match(/<!-- statement_of_law_id (\d+) -->/);
      if (m) {
        ids.push(Number(m[1]));
        break;
      }
    }
  });
  return ids;
}

/** #825: a deployed Form 8 order whose template_key is null or outside renderTemplate's closed
 * set renders a fallback that survives the filed face's glyph strip as a grammatical, signable
 * order that orders nothing. Scans the pre-strip mockup, like findMissingLawCitations above, so
 * the <!-- order_sought_id N --> trace is still there to name the offending order. */
function findUnrenderableOrders(markdown: string): number[] {
  const ids: number[] = [];
  for (const line of markdown.split("\n")) {
    // A crossed-out order's marker opens "<!-- order crossed-out", so the order_sought_id match below skips it.
    if (!line.includes(TEMPLATE_NOT_CHOSEN) && !line.includes(UNRECOGNIZED_TEMPLATE_KEY)) continue;
    const m = line.match(/<!-- order_sought_id (\d+) -->/);
    if (m) ids.push(Number(m[1]));
  }
  return ids;
}

/** Response-only filter. Every document is still rendered, and in mockup mode still written to
 * its canonical path beside the database -- only what crosses the tool boundary shrinks, because
 * a caller checking one thing (the Job Board's ticket state, the frontmatter) otherwise pulls a
 * ~79K-character four-document payload through the token cap. Filtering the render itself would
 * leave the other canonical mockups stale at an old revision, and filtering before the filed-face
 * citation gate below would let an uncited statement through -- so this runs last, on the response
 * array alone. An unrecognised name fails loudly rather than quietly returning nothing. */
function selectDocuments<T extends { document_type: string }>(documents: T[], wanted?: string[]): T[] {
  if (!wanted || wanted.length === 0) return documents;
  // Two documents can share a type (two affidavits), so name each type once.
  const available = [...new Set(documents.map((doc) => doc.document_type))];
  const unknown = wanted.filter((name) => !available.includes(name));
  if (unknown.length > 0) {
    throw new ValidationError(
      `drafting_forms__render.documents: this filing has no ${unknown.join(", ")} (available: ${available.join(", ")})`
    );
  }
  return documents.filter((doc) => wanted.includes(doc.document_type));
}

/** #466 / ADR 0012: the caller-named presentation folder must sit directly under the matter's
 * `0. DRAFT*` folder and end with this filing's own sanitized title, so the one matter-tree write
 * this server makes cannot land anywhere else. `realpathSync.native` resolves a junction to its
 * true target (which then fails containment) and reads OneDrive placeholders as ordinary files. */
function resolvePresentationDir(presentationDir: string, filingTitle: string, styleOfCause: string | null): string {
  if (!isAbsolute(presentationDir)) {
    throw new ValidationError(`drafting_forms__render.presentation_dir must be an absolute path: ${presentationDir}`);
  }
  const dir = resolve(presentationDir);
  const refuse = (why: string) => new ValidationError(`drafting_forms__render.presentation_dir ${dir}: ${why}`);
  let parent: string;
  try {
    parent = realpathSync.native(dirname(dir));
  } catch {
    throw refuse("its parent must be the matter's existing 0. DRAFT folder, and it does not exist");
  }
  if (!/^0\. DRAFT/i.test(basename(parent))) throw refuse("its parent must be the matter's 0. DRAFT folder");
  if (parent.split(/[\\/]/).some((part) => /^(privileged|disclosed)$/i.test(part))) throw refuse("it lies inside a privileged or disclosed tree");
  const ending = ` ${sanitizeForPath(filingTitle)}`;
  // A folder made while the title still ended in the style of proceeding keeps that name (oldTitle).
  const oldEnding = styleOfCause ? ` ${sanitizeForPath(oldTitle(filingTitle, styleOfCause))}` : null;
  if (!basename(dir).endsWith(ending) && (oldEnding === null || !basename(dir).endsWith(oldEnding))) {
    throw refuse(`the folder name must end with "${ending}" (this filing's title)`);
  }
  if (existsSync(dir) && dirname(realpathSync.native(dir)).toLowerCase() !== parent.toLowerCase()) {
    throw refuse("it resolves outside its 0. DRAFT folder");
  }
  return dir;
}

/** #585 (#583 §4, ADR 0012's confinement extended): bootstrap's draft_dir (and render's, #689) must be the matter's
 * `0. DRAFT*` folder itself, existing, and outside any privileged or disclosed tree. Checked on the
 * real path, so a junction named `0. DRAFT` that leads elsewhere is refused. */
export function resolveDraftDir(draftDir: string, param = "drafting_forms__bootstrap.draft_dir"): string {
  const refuse = (why: string) => new ValidationError(`${param} ${draftDir}: ${why}`);
  if (!isAbsolute(draftDir)) throw refuse("must be an absolute path");
  const dir = resolve(draftDir);
  let real: string;
  try {
    real = realpathSync.native(dir);
  } catch {
    throw refuse("does not exist");
  }
  if (!/^0\. DRAFT/i.test(basename(real))) throw refuse("must be the matter's 0. DRAFT folder");
  if (real.split(/[\\/]/).some((part) => /^(privileged|disclosed)$/i.test(part))) throw refuse("it lies inside a privileged or disclosed tree");
  return dir;
}

/** #689: the presentation folder's name, `<code> <filing folder>`. The code is the `folder_code` the
 * filing's type file declares (shared/declared-layout.md), read from its stored layout; a row with
 * no stored layout (a seeded test row) reads it from /draft's shipped tree, which needs the forum. */
function presentationFolder(proceeding: ProceedingRow, filing: FilingRow, title = filing.title): string {
  const stored = layoutFor(filing);
  const code = stored !== null ? stored.layout.folder_code : resolveTypeFile(requireForum(proceeding, true).forum, filing.kind).block.folder_code;
  return `${code} ${sanitizeForPath(title)}`;
}

/** A Writing's title as it read while titles still ended in the style of proceeding. A presentation
 * folder made under that title keeps its name: the render uses it as it is and renames nothing. */
function oldTitle(title: string, styleOfCause: string): string {
  return `${title} - ${styleOfCause}`;
}

/** A dated presentation folder may be renamed to the undated form only if it holds at least one
 * file and only files this renderer writes: a revision-stamped copy, a retired board support file,
 * or a board file by either name an older render left there (#1365: no render writes a board there
 * any more). A fact for the caller, who does the renaming (#689). */
function renameable(dir: string): boolean {
  const entries = readdirSync(dir, { withFileTypes: true });
  const isBoard = (name: string) => name === "Job Board.html" || name === "Work Board.html";
  return (
    entries.length > 0 &&
    entries.every(
      (e) =>
        e.isFile() &&
        (isBoard(e.name) || RETIRED_BOARD_FILES.includes(e.name) || readExistingRevision(join(dir, e.name)) !== undefined)
    )
  );
}

/** #689: resolves this filing's presentation folder inside the matter's draft folder, so a
 * session never lists the folder and pattern-matches names itself. Siblings match
 * `<code> <filing folder>`, with or without a leading `YYYY-MM-DD `. None: the undated folder,
 * which the render creates. One undated: that one. One dated, or two or more: refused before any
 * write, naming each candidate and whether a dated one is renameable -- the caller renames or
 * asks, then passes presentation_dir. */
function presentationDirFromDraft(draftDir: string, proceeding: ProceedingRow, filing: FilingRow): string {
  const draft = resolveDraftDir(draftDir, "drafting_forms__render.draft_dir");
  const undated = presentationFolder(proceeding, filing);
  // Case-insensitive, as NTFS is. An undated match resolves to the canonical spelling, which
  // opens the same folder and passes resolvePresentationDir's title-ending check.
  // A folder under the old name (oldTitle) matches too, and is returned under the name it has.
  const old = proceeding.style_of_cause ? presentationFolder(proceeding, filing, oldTitle(filing.title, proceeding.style_of_cause)) : null;
  const isOld = (name: string) => old !== null && name.toLowerCase() === old.toLowerCase();
  const isUndated = (name: string) => name.toLowerCase() === undated.toLowerCase() || isOld(name);
  const matches = readdirSync(draft, { withFileTypes: true })
    .filter((e) => e.isDirectory() && (isUndated(e.name) || (/^\d{4}-\d{2}-\d{2} /.test(e.name) && isUndated(e.name.slice(11)))))
    .map((e) => e.name)
    .sort();
  if (matches.length === 1 && isOld(matches[0])) return join(draft, matches[0]);
  if (matches.length === 0 || (matches.length === 1 && isUndated(matches[0]))) return join(draft, undated);
  const candidates = matches.map((name) => {
    const path = join(draft, name);
    return isUndated(name) ? `"${path}" (undated)` : `"${path}" (dated, renameable: ${renameable(path) ? "yes" : "no"})`;
  });
  throw new ValidationError(
    `drafting_forms__render.draft_dir: ${matches.length === 1 ? "one dated" : `${matches.length}`} presentation folder` +
      `${matches.length === 1 ? "" : "s"} for "${undated}": ${candidates.join(", ")}. Nothing was written. ` +
      `Rename or choose one, then pass it as presentation_dir.`,
    matches.length === 1 ? "presentation_dir_dated" : "presentation_dir_ambiguous"
  );
}

type Projectable = Pick<RenderedDocument, "document_type" | "path" | "file_name" | "symbol_notes"> & { markdown: string };

/** The response's symbol_notes field: absent when the legend carries no note. */
function symbolNotes(notes: string[]): Pick<RenderedDocument, "symbol_notes"> {
  return notes.length > 0 ? { symbol_notes: notes } : {};
}

/** #466: writes each advocacy document's disposable presentation copy into `dir` -- a plain
 * overwrite, never archived (ADR 0008). Every target is checked before any is written, and one this
 * renderer did not write -- no render revision stamp -- is refused (AGENTS.md: never overwrite a file
 * this skill did not write). The board's retired support files in `dir` and one level up, and a
 * stamped Markdown board in `dir`, are deleted. Here `wanted` selects which documents also carry
 * their markdown inline; every document is listed. The caller has already refused an unknown name. */
function projectDocuments(dir: string, documents: Projectable[], wanted: string[] | undefined): RenderedDocument[] {
  const targets = documents.map((doc) => join(dir, doc.file_name));
  for (const target of targets) {
    if (existsSync(target) && readExistingRevision(target) === undefined) {
      throw new ValidationError(
        `drafting_forms__render.presentation_dir: refusing to overwrite ${target} -- it carries no render revision stamp, so this renderer did not write it`
      );
    }
  }
  mkdirSync(dir, { recursive: true });
  for (const doc of documents) writeFileSync(join(dir, doc.file_name), doc.markdown, "utf-8");
  removeRetiredBoardFiles(dir, [...RETIRED_BOARD_FILES, ...ownStaleWorkBoardMarkdown(dir)]);
  removeRetiredBoardFiles(dirname(dir));

  return documents.map((doc) => ({
    document_type: doc.document_type,
    ...(doc.path ? { path: doc.path } : {}),
    file_name: doc.file_name,
    presentation_path: join(dir, doc.file_name),
    markdown_chars: doc.markdown.length,
    ...(wanted?.includes(doc.document_type) ? { markdown: doc.markdown, ...symbolNotes(doc.symbol_notes ?? []) } : {}),
  }));
}

/** ADR 0013 (deadline isolation): a mockup render withholds the hearing date and time (on a Notice of
 * Application, the proposed hearing) from the markdown it returns, so neither enters a drafting session's context. The canonical mockup and its presentation
 * copy keep the real values, which makes these two sentences the one exception to "returned markdown is
 * byte-identical to the file". Anchored on the renderer-owned template sentences
 * (render-notice-of-application.ts, render-bcca-stay-response.ts), never on the date's value, which would
 * also blank a fact dated the same day. Each value is replaced on its own, and a blank or gap marker stays
 * visible so a missing required field is still seen. Applied after every copy is written and measured. */
const HEARING_WITHHELD = "[withheld from drafting context]";
const NOA_HEARING = /^(The applicant proposes that the matter will be heard on )(.*?)(\.)$/m;
const BCCA_HEARING = /^(THIS IS A RESPONSE TO the stay application .*, returnable )(.*?)(?: at (.*?))?\.$/m;

function withholdHearing<T extends { markdown?: string }>(doc: T): T {
  if (doc.markdown === undefined) return doc;
  const unlessBlank = (value: string, blank: string) => (value === blank ? value : HEARING_WITHHELD);
  const markdown = doc.markdown
    .replace(NOA_HEARING, (_m, head: string, proposed: string, tail: string) => `${head}${unlessBlank(proposed, "________________")}${tail}`)
    .replace(BCCA_HEARING, (_m, head: string, date: string, time: string | undefined) =>
      `${head}${unlessBlank(date, gapMarker("gap"))}${time === undefined ? "" : ` at ${HEARING_WITHHELD}`}.`
    );
  return { ...doc, markdown };
}

/**
 * filing -> mockup(s) + conditional archive copy, stamped (design doc 291 §6).
 * No expected-revision parameter -- render always renders (issue #302).
 *
 * Returns each document's `markdown` alongside its path (issue #337). The
 * mockups are written outside every Cowork sandbox FUSE mount (issue #324), so
 * a session has no way to open the file it was just handed the path to; this
 * response is the only channel that crosses that boundary, since the server
 * runs host-side. Without it ADR 0005's "orient from the mockup, not from a
 * query battery" rule had no working path at all. The markdown here is for the
 * session to read work markers from -- it is not for pasting into chat, which
 * still gets the file, not its contents.
 *
 * `renderMode: 'filed'` (build #359, design #358) writes nothing to disk at
 * all -- no mockup file, no archive copy -- and returns each document's
 * markdown put through toFiledFace() (forms/filed-face.ts): the mockup minus
 * everything human-side. The caller decides
 * where a filed-face document lands (the matter's `0. DRAFT` tree); this
 * tool only ever writes beside the database, and only in 'mockup' mode.
 */
export function submissionFormsRender(
  dbPath: string,
  filingId: number,
  client: ClientContext = {},
  renderMode: RenderMode = "mockup",
  documentTypes?: string[],
  appealDeadline?: string,
  presentationDir?: string,
  /** This call's single clock reading (#581 §4), defaulting to the local wall clock. Not a
   * tool input -- dispatch never passes it; it exists so a determinism test can pin the
   * minute and the date that the stamp, the `Rendered:` line and the ladder all read. */
  now: string = nowStamp(),
  /** The caller's own session identity, issued by drafting_forms__bootstrap (#609). Echoed back
   * unchanged on a successful mockup render and used for nothing else -- this server never
   * compares it. Omitted means the response carries no session_token at all. */
  sessionToken?: string,
  /** #689: the matter's 0. DRAFT folder, from which the server resolves presentation_dir itself.
   * Never with presentation_dir. */
  draftDir?: string,
  /** The matter's open to-dos, for the Litigation Strategy a render with presentation copies rewrites. */
  todos: MatterTodos = TODOS_NOT_READ,
  /** The matter's dates, for the Job Board pages alone, and this filing's linked deadlines as its
   * section's dateless Goal criteria (ADR 0013, 2026-10-04 amendments). */
  dates: MatterDates = DATES_NOT_READ,
  /** Not a tool input: open_session's opening is handed every page this render wrote, which the
   * render's own response leaves out. */
  onPages?: (pages: PagesWritten) => void,
  /** Test seam only: the scratch skills tree the form currency check reads (ADR 0038). */
  seams: KnowledgeSeams = {}
): RenderResult {
  if (presentationDir !== undefined && renderMode !== "mockup") {
    throw new ValidationError("drafting_forms__render.presentation_dir is mockup mode only -- a filed-face render writes nothing to disk");
  }
  if (draftDir !== undefined && renderMode !== "mockup") {
    throw new ValidationError("drafting_forms__render.draft_dir is mockup mode only -- a filed-face render writes nothing to disk");
  }
  if (draftDir !== undefined && presentationDir !== undefined) {
    throw new ValidationError("drafting_forms__render takes draft_dir or presentation_dir, never both");
  }
  const timings: PhaseTimings = [];
  const started = performance.now();
  const schemaVersion = timed(timings, "schema_check", () => readSchemaVersion(dbPath));
  const currentVersion = timed(timings, "schema_target", () => renderableSchemaVersion(currentSchemaVersion()));
  if (schemaVersion !== null && schemaVersion > currentVersion) {
    return {
      filing_id: filingId,
      documents: [],
      schema_version: schemaVersion,
      current_schema_version: currentVersion,
      bundle_outdated: true,
      note:
        `This database is on schema version ${schemaVersion}; the installed plugin bundle only supports up to ${currentVersion}. ` +
        "Nothing was rendered -- rendering against a schema newer than the installed bundle can crash inside a renderer or " +
        "produce wrong output. The installed Probanda plugin bundle is older than this database -- rebuild/reinstall " +
        "the plugin so it matches, then call drafting_forms__render again.",
      timings: withTotal(timings, started),
    };
  }

  const loadStart = performance.now();
  const filing = fetchFilingById(dbPath, filingId);
  const proceeding = fetchProceeding(dbPath, filing.proceeding_id);
  // A Job Board with no Writing has no document, so no filed face and no presentation folder: only
  // its board renders, and under draft_dir the matter's pages go into that folder itself.
  const jobOnly = isJobOnlyBoard(filing);
  if (jobOnly && (renderMode !== "mockup" || presentationDir !== undefined)) {
    throw new ValidationError(
      `drafting_forms__render: filing ${filingId} is a Job Board with no Writing, so it has no ${renderMode !== "mockup" ? "filed face" : "presentation folder"}; ` +
        "render it in mockup mode, with draft_dir to rewrite the matter's pages",
      "job_board_only"
    );
  }
  const requestedDir = draftDir === undefined || jobOnly ? presentationDir : presentationDirFromDraft(draftDir, proceeding, filing);
  const projectionDir = requestedDir === undefined ? undefined : resolvePresentationDir(requestedDir, filing.title, proceeding.style_of_cause);
  const pagesDir =
    jobOnly && draftDir !== undefined ? resolveDraftDir(draftDir, "drafting_forms__render.draft_dir") : projectionDir === undefined ? undefined : dirname(projectionDir);
  const revision = fetchRevision(dbPath);
  // Read before buildContext reads the review state, so an approval landing between the two
  // makes the next render miss rather than hit a manifest stamped with the newer mark.
  const approvals = fetchApprovalsMark(dbPath);
  const loadMs = elapsedMs(loadStart);
  // Party/counsel SSOT: a drafting Writing's counsel and address for service are read live from
  // case data, through /matter-data's own script, so the filed-face refusal below rests on no caller input.
  // A retired filing's mockup render, below, prints only the board, which reads no party: it reads none.
  // Nor does a Job Board with no Writing.
  const retiredMockup = renderMode === "mockup" && Boolean(filing.retired_on);
  const { parties, drift }: DraftingParties = retiredMockup || jobOnly
    ? { parties: [], drift: { rows: [] } }
    : timed(timings, "parties_drift", () => partiesFor(dbPath, proceeding, filing));
  const contextStart = performance.now();
  const ctx = buildContext(dbPath, proceeding, filing, parties, revision, client, appealDeadline, now);
  timings.push({ phase: "load_filing", ms: loadMs + elapsedMs(contextStart) });

  // #1365: under a presentation folder the matter's pages are rewritten from database state, with
  // the section this render built for its filing, and that section is recorded so board_changed
  // compares against what this filing last reported, never against a page.
  const writePages = (section: WorkBoardData) => {
    if (!pagesDir) return undefined;
    const pages = writeMatterPages(dbPath, pagesDir, client, now, revision, todos, dates, timings, { section });
    onPages?.(pages);
    return { pages, change: recordPagesState(dbPath, todos, section, sessionToken) };
  };
  // The board's entry names this filing's own Job Board page (ADR 0033, 2026-10-05 amendment): its
  // path when this render wrote the pages, none for a retired filing, which has no page. With no
  // page written, file_name is the generic name and names no page.
  const boardDocument = (section: WorkBoardData, written: ReturnType<typeof writePages>, withSummary: boolean): RenderedDocument => {
    const path = written ? pagePathFor(written.pages, section.meta) : undefined;
    return {
      document_type: "Work_board",
      ...(path !== undefined ? { path } : {}),
      file_name: path !== undefined ? basename(path) : "Job Board.html",
      ...(withSummary ? { board_summary: renderBoardSummary(section, client, todos) } : {}),
      ...(written?.change ?? {}),
      pages_written: written !== undefined,
      ...(section.meta.ingest_inputs ? { ingest_inputs: section.meta.ingest_inputs } : {}),
    };
  };
  const trashReport = (written: ReturnType<typeof writePages>) => ({
    ...(written?.pages.moved_to_trash ? { moved_to_trash: written.pages.moved_to_trash } : {}),
    ...(written?.pages.trash_skipped ? { trash_skipped: written.pages.trash_skipped } : {}),
  });
  // The filing's linked deadlines, its section's last Goal criteria: dateless, so board_summary can carry them.
  const deadlines = deadlineCriteria(dates, filingId);

  // A Job Board with no Writing, open or closed: the board alone. documentsForFiling, the manifest
  // and finishMockup are never reached, so nothing is written beside the database or in a
  // presentation folder for it. Under draft_dir the matter's pages are rewritten, a closed board with
  // no page, as a retired filing has none.
  if (jobOnly) {
    const section = timed(timings, "board_section", () => buildWorkBoardData(ctx));
    selectDocuments([{ document_type: "Work_board" }], documentTypes); // only to refuse an unknown name
    const written = writePages(section);
    return {
      filing_id: filingId,
      revision,
      job_board_only: true,
      documents: [boardDocument(section, written, true)],
      ...(written ? { view_page_paths: written.pages.view_page_paths } : {}),
      ...trashReport(written),
      ...(filing.retired_on
        ? {
            filing_retired: true,
            note:
              `Job Board ${filingId} was closed on ${filing.retired_on}, so it has no page. ` +
              "Recover it (clear filings.retired_on and retirement_reason) before working it again.",
          }
        : {}),
      ...(sessionToken ? { session_token: sessionToken } : {}),
      rendered_at: ctx.rendered,
      timings: withTotal(timings, started),
    };
  }

  // Retired filing (schema v17): mockup mode renders no mockup and writes nothing beside the
  // database. Re-rendering a retired filing's other mockups would archive the copies of work that
  // is over, on a revision bump nobody asked for -- but the board is the one thing the retire
  // flow needs back, to confirm the state actually read Retired (its own State row derives from
  // `filing.retired_on`, already reflected in `ctx.lifecycle` above): `documents` carries its
  // board_summary. Filed mode is untouched: a filed face of a filing already delivered to the
  // forum is still a legitimate read. Under presentation_dir the matter's pages are rewritten, the
  // retired filing with no Job Board page (#1365 D1; its old one is moved to TRASH), and no
  // presentation copy is written.
  if (retiredMockup) {
    const section = timed(timings, "board_section", () => buildWorkBoardData(ctx, deadlines));
    if (projectionDir) selectDocuments([{ document_type: "Work_board" }], documentTypes);
    const written = writePages(section);
    return {
      filing_id: filingId,
      filing_retired: true,
      documents: [boardDocument(section, written, true)],
      ...(written ? { view_page_paths: written.pages.view_page_paths } : {}),
      ...trashReport(written),
      note:
        `Filing ${filingId} was retired on ${filing.retired_on}` +
        (filing.retirement_reason ? ` (${filing.retirement_reason})` : "") +
        `. Nothing was rendered and ${projectionDir ? "no mockup was" : "nothing was"} written -- a retired filing's mockups stay as they ` +
        "were at retirement. Recover the filing (clear filings.retired_on and retirement_reason) " +
        "before rendering it again.",
      timings: withTotal(timings, started),
    };
  }

  // Party/counsel drift (party/counsel SSOT): a party row whose counsel and address for service
  // could not be read from case data holds them NULL; the filed face refuses while any stands.
  const report = driftReport(drift);
  const refusal = renderMode === "filed" ? partiesDriftRefusal(filingId, revision, drift, "drafting_forms__render") : null;
  if (refusal) return { ...refusal, documents: [], timings: withTotal(timings, started) };
  const driftDigest = partiesDigest({ parties, drift });
  // ADR 0038: an enactment change on record that amends this Writing's court form, which the
  // shipped template, emitter and type file are not recorded as conformed to. Read on every render:
  // the stamp's date and build_stamp make a new day or a repackage miss the memo below.
  const formKey = KIND_FORM_KEYS[filing.kind];
  const currency = formKey === undefined ? undefined : timed(timings, "form_currency", () => formCurrency(formKey, now.slice(0, 10), seams));

  // Memoisation by stamp (#582, brief §1). A render is a pure function of the stamp's
  // inputs (#581 §1), so when none has moved and every file the manifest lists is still
  // byte-for-byte what it recorded, the advocacy documents are neither rendered nor
  // written: their paths, and their text when it is asked for, come off disk. The Job
  // Board's section is rebuilt either way -- it sits outside the stamp (#581 §2),
  // since its data reads the ticket tables, whose writes are exempt from the revision bump.
  // Keyed by filing id, so a retitle never moves it (#1317). Only a mockup render writes it, so only
  // a mockup render moves a legacy title-keyed folder there.
  const baseDir = renderMode === "mockup" ? mockupDirForRender(dbPath, filingId) : mockupDir(dbPath, filingId);
  // A general Writing whose stored layout cites an item tags its mockup from that item's live
  // confirmation status, which a firm's sidecar write changes without moving any stamp input, so
  // such a Writing is never served from the manifest. Its manifest is still written, so its
  // inventory is recorded like every other Writing's (the Sent write's pre-send hold reads it).
  const general = generalLayoutFor(filing);
  const liveTags = hasLiveTags(general);
  const stamp: RenderStamp | null =
    renderMode === "mockup"
      ? stampFor(filingId, proceeding, client, now, revision, schemaVersion, timed(timings, "build_stamp_check", () => buildStampStatus().build_stamp), approvals)
      : null;
  const hit = stamp === null || liveTags ? null : timed(timings, "stamp_check", () => freshManifest(baseDir, stamp, driftDigest));

  /** The mockup render's response, after the hit or the miss: under a presentation folder its copies
   * and the matter's pages are written, each target checked before any is; inline, every document's
   * markdown. Either way the board's summary only when the board is named in `documents`. The Job
   * Board is the last document either way. */
  const finishMockup = (documents: Projectable[], section: WorkBoardData, renderedAt: string): RenderResult => {
    const due = noteUpDue(section.proposals);
    const tail = {
      ...report,
      ...(sessionToken ? { session_token: sessionToken } : {}),
      rendered_at: renderedAt,
      ...(currency ? { form_currency: currency } : {}),
      ...(due.length > 0 ? { note_up_due: due } : {}),
    };
    if (projectionDir) {
      selectDocuments([...documents, { document_type: "Work_board" }], documentTypes); // only to refuse an unknown name
      refuseForeignMatterPages(dirname(projectionDir), dbPath);
      const projected = timed(timings, "write presentation copies", () => projectDocuments(projectionDir, documents, documentTypes));
      const written = writePages(section);
      const board = boardDocument(section, written, documentTypes?.includes("Work_board") ?? false);
      const views = written ? { view_page_paths: written.pages.view_page_paths } : {};
      return { filing_id: filingId, revision, documents: [...projected, board].map(withholdHearing), ...views, ...trashReport(written), ...tail, timings: withTotal(timings, started) };
    }
    const inline: RenderedDocument[] = [...documents, boardDocument(section, undefined, documentTypes?.includes("Work_board") ?? false)];
    return { filing_id: filingId, revision, documents: selectDocuments(inline, documentTypes).map(withholdHearing), ...tail, timings: withTotal(timings, started) };
  };

  if (hit) {
    timed(timings, "remove retired board files", () => {
      removeRetiredBoardFiles(mockupsRoot(dbPath));
      removeStaleWorkBoardMarkdown(baseDir);
    });
    // The board's section alone. Its ticket state reads only SQLite (tickets, blocks, conflicts, steps,
    // scope, ticket_proposals, proposal_rejections), and its Proposals come from the inventory
    // the render that filled this manifest saved, plus that same SQLite state -- on a miss they
    // come from the collector this call ran instead. Skipping the advocacy renderers therefore
    // cannot leave the board under-filled. A manifest written before the field existed, or with a
    // malformed one, is not a hit at all (readManifest rejects it), so there is no path here that
    // derives Proposals from a missing inventory.
    const section = timed(timings, "board_section", () => buildWorkBoardData({ ...ctx, inventory: hit.manifest.inventory }, deadlines));
    // No file holds the legend's model notes, so they are read again off each mockup's text.
    const documents: Projectable[] = hit.manifest.files.map((f) => {
      const markdown = hit.contents.get(f.file_name) as string;
      return {
        document_type: f.document_type,
        path: join(baseDir, f.file_name),
        file_name: f.file_name,
        markdown,
        ...symbolNotes(legendNotes(markdown, f.document_type)),
      };
    });
    // rendered_at is the advocacy files' own minute, read back from the manifest: this call
    // wrote none of them, so each keeps the minute it was rendered with. The board's
    // meta.rendered is this call's own minute, from ctx (#581 §3).
    return finishMockup(documents, section, hit.manifest.rendered_at);
  }

  const cited = general === null ? [] : timed(timings, "layout_status", () => citedStates(general, filing));
  const built = documentsForFiling(ctx, timings, general, cited);
  // Each drifted party's 🏷️ line goes at the head of the venue document, which documentsForFiling
  // always returns first. Only a mockup reaches here with drift: the filed render refused above.
  if (drift.rows.length > 0) built[0] = { ...built[0], markdown: withPartiesDriftLines(built[0].markdown, drift.rows) };
  // The form currency warning heads the venue document too, glyphless: rendered for the human, and
  // withheld from the forum by toFiledFace's mockup-only line strip, so the filed face needs no gate.
  if (currency?.warning) built[0] = { ...built[0], markdown: withLeadLines(built[0].markdown, [`${currency.warning} ${MOCKUP_ONLY_TAG}`]) };

  if (renderMode === "filed") {
    const deliverable = built; // every built document goes to the forum

    // Filing gate (ticket 2026-08-31, decision 5): refuse rather than deliver a document
    // containing CITATION_MISSING -- mirrors the bundle_outdated refusal shape below.
    const missing = deliverable
      .map((doc) => ({ doc, ids: findMissingLawCitations(doc.markdown) }))
      .filter((r) => r.ids.length > 0);
    if (missing.length > 0) {
      return {
        filing_id: filingId,
        revision,
        documents: [],
        citation_gate_failed: true,
        note:
          `Refusing to render the filed face: statement(s) of law with no authorities.citation would print "${CITATION_MISSING}". ` +
          missing.map((r) => `${r.doc.documentType}: statement_of_law id(s) ${r.ids.join(", ")}`).join("; ") +
          ". Add the missing citation(s), or remove those statements from this filing's deployed submissions, then call drafting_forms__render again.",
        timings: withTotal(timings, started),
      };
    }

    // #451: the mockup shows ⬜ in the jurisdiction sentence's place; the filed face never prints
    // either sentence for a value nobody confirmed.
    if (deliverable.some((doc) => doc.markdown.includes(ASSOCIATE_JUDGE_UNDETERMINED_LINE))) {
      return {
        filing_id: filingId,
        revision,
        documents: [],
        associate_judge_gate_failed: true,
        note:
          "Refusing to render the filed face: hearing_details.associate_judge is not yet determined, so neither Form 32 jurisdiction sentence can be printed. " +
          "Set it to 1 (within the jurisdiction of an associate judge) or 0 (not within), then call drafting_forms__render again.",
        timings: withTotal(timings, started),
      };
    }

    // #825: the mockup shows the ⬜/🏷️ fallback where the operative provision belongs; the filed
    // face never delivers a signable order that orders nothing. Same shape as the two gates above.
    const unrenderable = deliverable
      .map((doc) => ({ doc, ids: findUnrenderableOrders(doc.markdown) }))
      .filter((r) => r.ids.length > 0);
    if (unrenderable.length > 0) {
      return {
        filing_id: filingId,
        revision,
        documents: [],
        template_key_gate_failed: true,
        note:
          "Refusing to render the filed face: deployed order(s) with no usable order_sought.template_key would print an operative sentence that orders nothing. " +
          unrenderable.map((r) => `${r.doc.documentType}: order_sought id(s) ${r.ids.join(", ")}`).join("; ") +
          ". Set each template_key to one of renderTemplate's eight values, or remove those orders from this filing's deployed orders, then call drafting_forms__render again.",
        timings: withTotal(timings, started),
      };
    }

    // Spec §6 piece 5: a general Writing's filed face waits on the confirmation of every item its
    // stored layout cites from a learned file. A vetted file is never refused. A passage that moved
    // since the snapshot is reported either way.
    const gate = confirmationGate(cited);
    const changed = gate.changed_since_snapshot.length > 0 ? { changed_since_snapshot: gate.changed_since_snapshot } : {};
    if (gate.unconfirmed.length > 0) {
      return {
        filing_id: filingId,
        revision,
        documents: [],
        confirmation_gate_failed: true,
        unconfirmed: gate.unconfirmed,
        ...changed,
        note:
          `Refusing to render the filed face: the stored layout cites item(s) no roster lawyer has confirmed: ${gate.unconfirmed.join(", ")}. ` +
          "The mockup tags each one [unverified: ...]; confirm each through /localize at mockup review, then call drafting_forms__render again." +
          (gate.changed_since_snapshot.length > 0
            ? ` Changed since the snapshot: ${gate.changed_since_snapshot.map((c) => c.rule_ref).join(", ")}; re-snapshot the Writing, then confirm.`
            : ""),
        timings: withTotal(timings, started),
      };
    }

    // A general Writing's part with no content prints a mockup-only line the filed face drops,
    // which would deliver its heading with nothing under it; the filed render refuses instead.
    const unwritten = deliverable.flatMap((doc) => doc.unwritten ?? []);
    if (unwritten.length > 0) {
      return {
        filing_id: filingId,
        revision,
        documents: [],
        unwritten_gate_failed: true,
        unwritten,
        ...changed,
        note:
          `Refusing to render the filed face: part(s) of the stored layout have no content: ${unwritten.join(", ")}. ` +
          "The mockup shows each as a 🧩 line; write each slot's filing_prose row, or add the rows each projection reads, then call drafting_forms__render again.",
        timings: withTotal(timings, started),
      };
    }

    // Plan 2026-10-07 step 5: a general Writing's prose holds only printed wording. The mockup flags
    // a line holding anything else; the filed face would deliver it, so the filed render refuses.
    const proseFormat = deliverable.flatMap((doc) => doc.prose_format ?? []);
    if (proseFormat.length > 0) {
      return {
        filing_id: filingId,
        revision,
        documents: [],
        prose_format_gate_failed: true,
        prose_format: proseFormat,
        ...changed,
        note:
          "Refusing to render the filed face: prose line(s) hold text that is not printed wording: " +
          proseFormat.map((h) => `${h.slot} (${h.rules.join(", ")}): "${h.line}"`).join("; ") +
          ". The mockup flags each with `🧩 <!-- format: ... -->`; rewrite each line as printed wording, a blank as ________, then call drafting_forms__render again.",
        timings: withTotal(timings, started),
      };
    }

    // #1181: the mockup tags an implied clause naming an enactment whose stored statute-currency
    // result is not `current`; the filed face never prints that line, so the filed render refuses.
    // A sent Writing's filed face is what was sent, whose clauses no longer change (#1227): it
    // renders, and the mockup keeps the tag.
    const currencyWithheld = deliverable.flatMap((doc) => doc.currency_withheld ?? []);
    if (currencyWithheld.length > 0 && !filing.filed_on) {
      return {
        filing_id: filingId,
        revision,
        documents: [],
        currency_gate_failed: true,
        currency_withheld: currencyWithheld,
        ...changed,
        note:
          "Refusing to render the filed face: implied clause(s) name an enactment whose statute-currency result is not `current`: " +
          currencyWithheld.map((w) => `clause_id ${w.clause_id} (${currencyLabel(w)})`).join(", ") +
          ". Reword each clause without the enactment, or record `current` results for the enactment and its cited provision, relayed by /legal-research, through /drafting-data, then call drafting_forms__render again.",
        timings: withTotal(timings, started),
      };
    }

    // Schema v59: the mockup names a submission's fact missing from the facts Part NOT PLACED in a
    // comment, which toFiledFace strips, so a drafting Writing's filed face refuses instead.
    refuseUnplacedFacts(dbPath, filing, "drafting_forms__render");

    const documents = deliverable.map((doc) => ({
      document_type: doc.documentType,
      file_name: doc.fileName,
      markdown: toFiledFace(doc.markdown),
    }));
    // Spec §6 piece 6: publish-general receives the filed text and the stored layout in one response.
    const layout = layoutFor(filing);
    return { filing_id: filingId, revision, documents: selectDocuments(documents, documentTypes), ...changed, ...(layout ? { stored_layout: layout } : {}), timings: withTotal(timings, started) };
  }

  // The citation scan (filing-checklists.md "Citations in the text"): each citation on a document
  // that reaches the forum that no live authorities row tracks becomes a 📇 entry the noting-up
  // criterion counts, named in a mockup-only line at the head of the venue document. It runs before
  // the manifest write, so the pre-send hold reads the entries back. The filed render returned above.
  const untracked = timed(timings, "citation_scan", () =>
    scanUntrackedCitations(dbPath, ctx.proceeding.id, built, ctx.inventory)
  );
  if (untracked.length > 0) built[0] = { ...built[0], markdown: withLeadLines(built[0].markdown, untracked) };

  timed(timings, "remove retired board files", () => {
    removeRetiredBoardFiles(mockupsRoot(dbPath));
    removeStaleWorkBoardMarkdown(baseDir);
  });
  timed(timings, "archive dropped files", () => archiveDroppedFiles(baseDir, readManifest(baseDir), new Set(built.map((doc) => doc.fileName))));
  // Each mockup's last section is the legend of the symbols printed on it, scanned after the drift
  // lines above; the filed render returned before this. Its model notes go back in the response alone.
  const finished = built.map((doc) => ({ ...doc, ...withLegend(doc.markdown, doc.documentType) }));
  const documents: Projectable[] = finished.map((doc) => ({
    document_type: doc.documentType,
    path: timed(timings, `write ${doc.fileName}`, () => writeDocument(baseDir, doc, revision)),
    file_name: doc.fileName,
    markdown: doc.markdown,
    ...symbolNotes(doc.symbolNotes),
  }));
  // Records what this render produced, so the next one can skip it. The Job Board's section is
  // no file of the filing's: it is rebuilt on every call (#581 §2).
  if (stamp) {
    timed(timings, "manifest_write", () =>
      writeManifest(baseDir, {
        stamp,
        rendered_at: ctx.rendered,
        files: finished.map((doc) => ({ document_type: doc.documentType, file_name: doc.fileName, sha256: sha256(doc.markdown), label: doc.label })),
        inventory: ctx.inventory,
        parties_drift: driftDigest,
      })
    );
  }
  // Last, from every document's inventory entries (Goal card design §2.2).
  const section = timed(timings, "board_section", () => buildWorkBoardData(ctx, deadlines));
  return finishMockup(documents, section, ctx.rendered);
}

export interface ProceedingBoardResult {
  proceeding_id: number;
  revision: number;
  /** The proceeding's section of the Job Board as fixed-grammar text, as on a filing's render. */
  board_summary: string;
  /** Present only with draft_dir, which rewrites the matter's pages: this proceeding's Job Board page,
   * every Job Board page in page order, and the Litigation Strategy. */
  job_board_path?: string;
  job_board_paths?: PagesWritten["job_board_paths"];
  matter_board_path?: string;
  /** With draft_dir, every view page written: each live filing's (ADR 0033, 2026-10-07 amendment). */
  view_page_paths?: PagesWritten["view_page_paths"];
  moved_to_trash?: PagesWritten["moved_to_trash"];
  trash_skipped?: PagesWritten["trash_skipped"];
  /** True when this call wrote the matter's pages (draft_dir given). */
  pages_written: boolean;
  /** With draft_dir, as on a filing's Job Board document. */
  board_changed?: boolean;
  board_moves?: BoardMove[];
  session_token?: string;
  rendered_at: string;
  timings: PhaseTimings;
}

/**
 * drafting_forms__render with proceeding_id (ADR 0018): the Job Board section of a proceeding with
 * no filing, whose tickets and loose threads no filing's section can show. Nothing is written beside the
 * database; given draft_dir, the matter's pages are rewritten, this proceeding's section on a Job
 * Board page of its own (#1365, ADR 0033's 2026-10-05 amendment). A proceeding that has a filing is
 * refused: its tickets are on each filing's section.
 */
export function submissionFormsRenderProceedingBoard(
  dbPath: string,
  proceedingId: number,
  client: ClientContext = {},
  /** Test-only clock pin, as on submissionFormsRender. */
  now: string = nowStamp(),
  sessionToken?: string,
  draftDir?: string,
  /** The matter's open to-dos, for the Litigation Strategy a render under draft_dir rewrites. */
  todos: MatterTodos = TODOS_NOT_READ,
  /** The matter's hearing dates, for the Job Board page alone (ADR 0013, 2026-10-04 amendment). */
  dates: MatterDates = DATES_NOT_READ
): ProceedingBoardResult {
  const timings: PhaseTimings = [];
  const started = performance.now();
  const draft = draftDir === undefined ? undefined : resolveDraftDir(draftDir, "drafting_forms__render.draft_dir");
  const proceeding = fetchProceeding(dbPath, proceedingId);
  if (fetchAllFilingsForProceeding(dbPath, proceedingId).length > 0) {
    throw new ValidationError(
      `Proceeding ${proceedingId} has a filing, so its jobs are on each filing's Job Board -- render a filing_id instead`
    );
  }
  const revision = fetchRevision(dbPath);
  const section = timed(timings, "board_section", () =>
    buildPreFilingBoardData(dbPath, proceeding, {
      revision,
      matter: client.matterNo ?? "",
      client: client.clientName ?? proceeding.matter_reference,
      rendered: now,
    })
  );
  let pages: PagesWritten | undefined;
  let change: ReturnType<typeof recordPagesState>;
  if (draft !== undefined) {
    pages = writeMatterPages(dbPath, draft, client, now, revision, todos, dates, timings, { section });
    change = recordPagesState(dbPath, todos, section, sessionToken);
  }
  return {
    proceeding_id: proceedingId,
    revision,
    board_summary: renderBoardSummary(section, client, todos),
    ...(pages ?? {}),
    ...(pages !== undefined ? { job_board_path: pagePathFor(pages, section.meta) } : {}),
    pages_written: pages !== undefined,
    ...(change ?? {}),
    ...(sessionToken ? { session_token: sessionToken } : {}),
    rendered_at: now,
    timings: withTotal(timings, started),
  };
}

/** The publish route's options for the Form 32 and Form 33 emitters (spec 2026-10-09). */
export interface PublishOptions {
  /** Print a placeholder and return a warning for missing data, never refusing for it. */
  lenient?: boolean;
  /** The session's own cover lines, such as the practitioner's words asking for the document. */
  cover_notes?: string[];
}

export interface EmitForm32Result {
  filing_id: number;
  revision: number;
  file_name: string;
  markdown: string;
  /** Where the markdown was written on the host, when case_data_folder was given. */
  written_path?: string;
  /** The publish sidecar (publish-sidecar.ts): its file name, its text, and where it was written. */
  publish_file_name: string;
  publish_json: string;
  publish_path?: string;
  /** Every cover line: the emitter's missing data (each Part 2 fact with no court record among it),
   * the unmet criteria, then the session's notes. */
  warnings: PublishWarning[];
  /** Form 32's currency (ADR 0038). The markdown never carries its warning. */
  form_currency: FormCurrency;
}

/** A lenient emit's line for each fact a submission rests on that the facts Part does not hold,
 * which a strict emit refuses (refuseUnplacedFacts): the filed face leaves the fact out. */
function unplacedFactWarnings(dbPath: string, filing: FilingRow): PublishWarning[] {
  return fetchUnplacedFacts(dbPath, filing).map((u): PublishWarning => ({
    kind: "other",
    field_or_id: `fact ${u.fact_id}`,
    message: `A submission rests on a fact the facts Part does not hold, so the form leaves it out: ${JSON.stringify(u.postulate)}.`,
  }));
}

export interface EmitForm32Refusal {
  filing_id: number;
  schema_version: number | null;
  current_schema_version: number;
  bundle_outdated: true;
  note: string;
}

/**
 * The Form 32 filed-face emitter (issue #392, handoff contract #376):
 * strict-grammar form-32.md for one notice_of_application filing, per
 * .claude/skills/publish/subskills/publish-bcsc-form/references/assembly-input-contract.md
 * (SSOT). Writes nothing to disk -- mirrors submissionFormsRender's
 * renderMode:'filed' precedent: under the contract's "Division of
 * discipline" the emitter owns filed-face content and the caller owns
 * placement, so the caller (the draft skill, /draft) writes the returned
 * markdown to {matter-data folder}/bcsc-form-substance/form-32.md itself.
 * Same ahead-of-bundle schema gate as
 * submissionFormsRender -- rendering against a schema newer than the
 * installed bundle is unsafe the same way here as anywhere else.
 * Given caseDataFolder (#1267, ADR 0025), it also writes the markdown there
 * itself, host-side, because a Cowork caller's own write lands in its sandbox.
 * Beside the markdown it returns, and given caseDataFolder writes, the publish sidecar
 * form-32-publish.json, from which asm32 reads the caption and the cover (spec 2026-10-09). Lenient,
 * missing data becomes warnings; the schema gate and the party drift gate still refuse.
 */
export function submissionFormsEmitForm32(
  dbPath: string,
  filingId: number,
  caseDataFolder?: string,
  /** Test seam only: the scratch skills tree the form currency check reads (ADR 0038). */
  seams: KnowledgeSeams = {},
  publish: PublishOptions = {}
): EmitForm32Result | EmitForm32Refusal | PartiesDriftRefusal {
  const caseData = caseDataFolder === undefined ? undefined : confineCaseDataFolder(dbPath, caseDataFolder);
  const schemaVersion = readSchemaVersion(dbPath);
  // The ceiling is what THIS bundle can read, not what the working tree's engine targets
  // (#812) -- the two are the same number only until a schema hop lands unpackaged.
  const currentVersion = renderableSchemaVersion(currentSchemaVersion());
  if (schemaVersion !== null && schemaVersion > currentVersion) {
    return {
      filing_id: filingId,
      schema_version: schemaVersion,
      current_schema_version: currentVersion,
      bundle_outdated: true,
      note:
        `This database is on schema version ${schemaVersion}; the installed plugin bundle only supports up to ${currentVersion}. ` +
        "Nothing was emitted -- rendering against a schema newer than the installed bundle can crash or produce wrong output. " +
        "Rebuild/reinstall the Probanda plugin bundle so it matches, then call drafting_forms__emit_form32 again.",
    };
  }

  const filing = fetchFilingById(dbPath, filingId);
  refuseJobOnlyBoard(filing, "drafting_forms__emit_form32");
  const proceeding = fetchProceeding(dbPath, filing.proceeding_id);
  const revision = fetchRevision(dbPath);
  const { parties, drift } = partiesFor(dbPath, proceeding, filing);
  const refusal = partiesDriftRefusal(filingId, revision, drift, "drafting_forms__emit_form32");
  if (refusal) return refusal;
  const lenient = publish.lenient === true ? unplacedFactWarnings(dbPath, filing) : undefined;
  if (lenient === undefined) refuseUnplacedFacts(dbPath, filing, "drafting_forms__emit_form32");
  const ctx = buildContext(dbPath, proceeding, filing, parties, revision, {});

  const markdown = renderForm32FiledFace(ctx, lenient);
  const sidecar = publishSidecar(ctx, lenient ?? [], publish.cover_notes ?? []);
  const publishName = publishFileName("form-32.md");
  return {
    filing_id: filingId,
    revision,
    file_name: "form-32.md",
    markdown,
    ...(caseData === undefined ? {} : { written_path: writeSubstanceFile(caseData, "form-32.md", markdown) }),
    publish_file_name: publishName,
    publish_json: sidecar.json,
    ...(caseData === undefined ? {} : { publish_path: writeSubstanceFile(caseData, publishName, sidecar.json) }),
    warnings: sidecar.warnings,
    form_currency: formCurrency("form-32", nowStamp().slice(0, 10), seams),
  };
}

export interface EmitForm33Result {
  filing_id: number;
  revision: number;
  file_name: string;
  markdown: string;
  /** Where the markdown was written on the host, when case_data_folder was given. */
  written_path?: string;
  /** The publish sidecar, as on EmitForm32Result. */
  publish_file_name: string;
  publish_json: string;
  publish_path?: string;
  warnings: PublishWarning[];
  /** Form 33's currency (ADR 0038). The markdown never carries its warning. */
  form_currency: FormCurrency;
}

export interface EmitForm33Refusal {
  filing_id: number;
  schema_version: number | null;
  current_schema_version: number;
  bundle_outdated: true;
  note: string;
}

/**
 * The Form 33 filed-face emitter (issue #386, handoff contract #376):
 * strict-grammar form-33.md for one application_response filing, per
 * .claude/skills/publish/subskills/publish-bcsc-form/references/assembly-input-contract.md
 * (SSOT). Mirrors submissionFormsEmitForm32 (#392) exactly -- same
 * write-nothing-to-disk shape, same ahead-of-bundle schema gate, same
 * optional host-side write given caseDataFolder, same publish sidecar and lenient emit.
 */
export function submissionFormsEmitForm33(
  dbPath: string,
  filingId: number,
  caseDataFolder?: string,
  /** Test seam only: the scratch skills tree the form currency check reads (ADR 0038). */
  seams: KnowledgeSeams = {},
  publish: PublishOptions = {}
): EmitForm33Result | EmitForm33Refusal | PartiesDriftRefusal {
  const caseData = caseDataFolder === undefined ? undefined : confineCaseDataFolder(dbPath, caseDataFolder);
  const schemaVersion = readSchemaVersion(dbPath);
  // The ceiling is what THIS bundle can read, not what the working tree's engine targets
  // (#812) -- the two are the same number only until a schema hop lands unpackaged.
  const currentVersion = renderableSchemaVersion(currentSchemaVersion());
  if (schemaVersion !== null && schemaVersion > currentVersion) {
    return {
      filing_id: filingId,
      schema_version: schemaVersion,
      current_schema_version: currentVersion,
      bundle_outdated: true,
      note:
        `This database is on schema version ${schemaVersion}; the installed plugin bundle only supports up to ${currentVersion}. ` +
        "Nothing was emitted -- rendering against a schema newer than the installed bundle can crash or produce wrong output. " +
        "Rebuild/reinstall the Probanda plugin bundle so it matches, then call drafting_forms__emit_form33 again.",
    };
  }

  const filing = fetchFilingById(dbPath, filingId);
  refuseJobOnlyBoard(filing, "drafting_forms__emit_form33");
  const proceeding = fetchProceeding(dbPath, filing.proceeding_id);
  const revision = fetchRevision(dbPath);
  const { parties, drift } = partiesFor(dbPath, proceeding, filing);
  const refusal = partiesDriftRefusal(filingId, revision, drift, "drafting_forms__emit_form33");
  if (refusal) return refusal;
  const lenient = publish.lenient === true ? unplacedFactWarnings(dbPath, filing) : undefined;
  if (lenient === undefined) refuseUnplacedFacts(dbPath, filing, "drafting_forms__emit_form33");
  const ctx = buildContext(dbPath, proceeding, filing, parties, revision, {});

  const markdown = renderForm33FiledFace(ctx, lenient);
  const sidecar = publishSidecar(ctx, lenient ?? [], publish.cover_notes ?? []);
  const publishName = publishFileName("form-33.md");
  return {
    filing_id: filingId,
    revision,
    file_name: "form-33.md",
    markdown,
    ...(caseData === undefined ? {} : { written_path: writeSubstanceFile(caseData, "form-33.md", markdown) }),
    publish_file_name: publishName,
    publish_json: sidecar.json,
    ...(caseData === undefined ? {} : { publish_path: writeSubstanceFile(caseData, publishName, sidecar.json) }),
    warnings: sidecar.warnings,
    form_currency: formCurrency("form-33", nowStamp().slice(0, 10), seams),
  };
}

export interface EmitAffidavitResult {
  filing_id: number;
  document_id: number;
  revision: number;
  file_name: string;
  markdown: string;
  /** Where the markdown was written on the host, when case_data_folder was given. */
  written_path?: string;
}

/**
 * The supporting affidavit filed-face emitter (#1487): affidavit-<document_id>.md for one affidavit
 * a notice_of_application or application_response lists under role 'affidavit', the input of
 * publish-bcsc-form's Form 109 fill (#1488). Same ahead-of-bundle schema gate, party drift gate
 * and optional host-side write as submissionFormsEmitForm32. It refuses on every 🧩 the
 * affidavit's mockup shows (forms/emit-affidavit.ts).
 */
export function submissionFormsEmitAffidavit(dbPath: string, filingId: number, documentId: number, caseDataFolder?: string): EmitAffidavitResult | EmitForm32Refusal | PartiesDriftRefusal {
  const caseData = caseDataFolder === undefined ? undefined : confineCaseDataFolder(dbPath, caseDataFolder);
  const schemaVersion = readSchemaVersion(dbPath);
  // The ceiling is what THIS bundle can read, not what the working tree's engine targets
  // (#812) -- the two are the same number only until a schema hop lands unpackaged.
  const currentVersion = renderableSchemaVersion(currentSchemaVersion());
  if (schemaVersion !== null && schemaVersion > currentVersion) {
    return {
      filing_id: filingId,
      schema_version: schemaVersion,
      current_schema_version: currentVersion,
      bundle_outdated: true,
      note:
        `This database is on schema version ${schemaVersion}; the installed plugin bundle only supports up to ${currentVersion}. ` +
        "Nothing was emitted -- rendering against a schema newer than the installed bundle can crash or produce wrong output. " +
        "Rebuild/reinstall the Probanda plugin bundle so it matches, then call drafting_forms__emit_affidavit again.",
    };
  }

  const filing = fetchFilingById(dbPath, filingId);
  refuseJobOnlyBoard(filing, "drafting_forms__emit_affidavit");
  const proceeding = fetchProceeding(dbPath, filing.proceeding_id);
  const revision = fetchRevision(dbPath);
  const { parties, drift } = partiesFor(dbPath, proceeding, filing);
  const refusal = partiesDriftRefusal(filingId, revision, drift, "drafting_forms__emit_affidavit");
  if (refusal) return refusal;
  if (filing.kind !== "notice_of_application" && filing.kind !== "application_response") {
    throw new ValidationError(
      `Filing ${filingId} has kind "${filing.kind}" -- the affidavit emitter only handles affidavits supporting a notice_of_application or application_response.`
    );
  }
  const affidavit = fetchAffidavits(dbPath, filingId).find((a) => a.id === documentId);
  if (affidavit === undefined) {
    throw new ValidationError(`Document ${documentId} is not an affidavit instrument that filing ${filingId} lists under role 'affidavit'.`);
  }
  const ctx = buildContext(dbPath, proceeding, filing, parties, revision, {});

  const markdown = renderAffidavitFiledFace(ctx, affidavit);
  const fileName = `affidavit-${documentId}.md`;
  return {
    filing_id: filingId,
    document_id: documentId,
    revision,
    file_name: fileName,
    markdown,
    ...(caseData === undefined ? {} : { written_path: writeSubstanceFile(caseData, fileName, markdown) }),
  };
}

export interface EmitBccaBookResult {
  filing_id: number;
  revision: number;
  file_name: string;
  markdown: string;
}

export interface EmitBccaBookRefusal {
  filing_id: number;
  schema_version: number | null;
  current_schema_version: number;
  bundle_outdated: true;
  note: string;
}

/**
 * The bcca-book.md filed-face emitter: response-book and Book of Authorities cover/TOC data
 * for one bcca_stay_response filing, per
 * .claude/skills/publish/subskills/publish-bcca-book/references/bcca-book-contract.md (SSOT). Mirrors
 * submissionFormsEmitForm32/33 exactly -- same write-nothing-to-disk shape, same
 * ahead-of-bundle schema gate.
 */
export function submissionFormsEmitBccaBook(dbPath: string, filingId: number): EmitBccaBookResult | EmitBccaBookRefusal | PartiesDriftRefusal {
  const schemaVersion = readSchemaVersion(dbPath);
  // The ceiling is what THIS bundle can read, not what the working tree's engine targets
  // (#812) -- the two are the same number only until a schema hop lands unpackaged.
  const currentVersion = renderableSchemaVersion(currentSchemaVersion());
  if (schemaVersion !== null && schemaVersion > currentVersion) {
    return {
      filing_id: filingId,
      schema_version: schemaVersion,
      current_schema_version: currentVersion,
      bundle_outdated: true,
      note:
        `This database is on schema version ${schemaVersion}; the installed plugin bundle only supports up to ${currentVersion}. ` +
        "Nothing was emitted -- rendering against a schema newer than the installed bundle can crash or produce wrong output. " +
        "Rebuild/reinstall the Probanda plugin bundle so it matches, then call drafting_forms__emit_bcca_book again.",
    };
  }

  const filing = fetchFilingById(dbPath, filingId);
  refuseJobOnlyBoard(filing, "drafting_forms__emit_bcca_book");
  const proceeding = fetchProceeding(dbPath, filing.proceeding_id);
  const revision = fetchRevision(dbPath);
  const { parties, drift } = partiesFor(dbPath, proceeding, filing);
  const refusal = partiesDriftRefusal(filingId, revision, drift, "drafting_forms__emit_bcca_book");
  if (refusal) return refusal;
  const ctx = buildContext(dbPath, proceeding, filing, parties, revision, {});

  return {
    filing_id: filingId,
    revision,
    file_name: "bcca-book.md",
    markdown: renderBccaBookFiledFace(ctx),
  };
}

/**
 * The bcca-factum.md filed-face emitter (#648): one bcca_factum filing's cover, parts and
 * appendices, per .claude/skills/publish/subskills/publish-bcca-factum/references/bcca-factum-contract.md (SSOT).
 * Same shape as submissionFormsEmitBccaBook; datedOn is the factum's date, which is never stored.
 */
export function submissionFormsEmitBccaFactum(dbPath: string, filingId: number, datedOn: string): EmitBccaBookResult | EmitBccaBookRefusal | PartiesDriftRefusal {
  const schemaVersion = readSchemaVersion(dbPath);
  // The ceiling is what THIS bundle can read, not what the working tree's engine targets
  // (#812) -- the two are the same number only until a schema hop lands unpackaged.
  const currentVersion = renderableSchemaVersion(currentSchemaVersion());
  if (schemaVersion !== null && schemaVersion > currentVersion) {
    return {
      filing_id: filingId,
      schema_version: schemaVersion,
      current_schema_version: currentVersion,
      bundle_outdated: true,
      note:
        `This database is on schema version ${schemaVersion}; the installed plugin bundle only supports up to ${currentVersion}. ` +
        "Nothing was emitted. Rebuild/reinstall the Probanda plugin bundle so it matches, then call drafting_forms__emit_bcca_factum again.",
    };
  }

  const filing = fetchFilingById(dbPath, filingId);
  refuseJobOnlyBoard(filing, "drafting_forms__emit_bcca_factum");
  const proceeding = fetchProceeding(dbPath, filing.proceeding_id);
  const revision = fetchRevision(dbPath);
  const { parties, drift } = partiesFor(dbPath, proceeding, filing);
  const refusal = partiesDriftRefusal(filingId, revision, drift, "drafting_forms__emit_bcca_factum");
  if (refusal) return refusal;
  const ctx = buildContext(dbPath, proceeding, filing, parties, revision, {});

  return {
    filing_id: filingId,
    revision,
    file_name: "bcca-factum.md",
    markdown: renderBccaFactumFiledFace(ctx, datedOn),
  };
}

export interface PreFilingCheckResult extends PreFilingChecksResult {
  filing_id: number;
  revision: number;
}

export interface PreFilingCheckRefusal {
  filing_id: number;
  schema_version: number | null;
  current_schema_version: number;
  bundle_outdated: true;
  note: string;
}

/**
 * The pre-filing consistency gate (issue #615): deterministic, read-only checks of one
 * filing's assembled package folder against itself and the filing's Evidence Index rows.
 * Writes nothing anywhere (decision D4 -- the gate reports, a ticket fixes). Same
 * ahead-of-bundle schema gate as the emitters; refuses a retired filing outright.
 */
export function submissionFormsPreFilingCheck(dbPath: string, filingId: number, packageDir: string): PreFilingCheckResult | PreFilingCheckRefusal {
  const schemaVersion = readSchemaVersion(dbPath);
  // The ceiling is what THIS bundle can read, not what the working tree's engine targets
  // (#812) -- the two are the same number only until a schema hop lands unpackaged.
  const currentVersion = renderableSchemaVersion(currentSchemaVersion());
  if (schemaVersion !== null && schemaVersion > currentVersion) {
    return {
      filing_id: filingId,
      schema_version: schemaVersion,
      current_schema_version: currentVersion,
      bundle_outdated: true,
      note:
        `This database is on schema version ${schemaVersion}; the installed plugin bundle only supports up to ${currentVersion}. ` +
        "Nothing was checked -- reading against a schema newer than the installed bundle can produce wrong output. " +
        "Rebuild/reinstall the Probanda plugin bundle so it matches, then call drafting_forms__pre_filing_check again.",
    };
  }
  const filing = fetchFilingById(dbPath, filingId);
  refuseJobOnlyBoard(filing, "drafting_forms__pre_filing_check");
  if (filing.retired_on) throw new ValidationError(`Filing ${filingId} is retired (${filing.retired_on}); nothing to gate`);
  const revision = fetchRevision(dbPath);
  return { filing_id: filingId, revision, ...runPreFilingChecks(dbPath, filingId, packageDir) };
}

export function fetchFilingById(dbPath: string, filingId: number): FilingRow {
  const found = submissionDataQuery(dbPath, "SELECT * FROM filings WHERE id = ?", [filingId]).rows as unknown as FilingRow[];
  if (found.length === 0) throw new ValidationError(`No filing found with id ${filingId}`);
  return found[0];
}

/** A Job Board with no Writing has no document to emit or gate: the filed-face emitters and the
 * pre-filing check refuse it by name, before anything is read for it. */
function refuseJobOnlyBoard(filing: FilingRow, tool: string): void {
  if (isJobOnlyBoard(filing)) {
    throw new ValidationError(`${tool}: filing ${filing.id} is a Job Board with no Writing, so it has no document`, "job_board_only");
  }
}

/** Carries the build-stamp fields (issue #452) on every response, refusals included -- a server
 * running pre-rebuild code can refuse wrongly just as it can render wrongly. */
export interface BootstrapResult extends BuildStampStatus, SchemaSourceStatus {
  db_path: string;
  schema_version: number | null;
  current_schema_version: number;
  migration_required: boolean;
  /** Present only when a migration was due but withheld because it would push the database past
   * what this bundle can read (#812). `migration_required` is false alongside it, so no caller
   * attempts the migration; `note` says which versions and why. */
  migration_withheld?: boolean;
  /** True only when the database is ahead of the installed plugin bundle (issue #352) -- distinguishes this refusal from `migration_required`'s. */
  bundle_outdated: boolean;
  /** Every filing of every proceeding, **in the order to present them in** -- the array order is
   * the whole of that signal, and no field here says anything about what produced it.
   *
   * A retired filing (schema v17) is listed like any other, because recovery has to find it, but
   * reports no paths: its mockups stand as they were at retirement. `lifecycle` is present on
   * every entry; `paths` is what is on disk, since this call renders nothing (#584). */
  filings: {
    filing_id: number;
    title: string;
    paths: string[];
    lifecycle: LifecycleState;
    /** Whether this filing's mockups would need rendering (#582): `fresh` when the manifest's
     * stamp and parties digest (#1308) match what a render now would use and every file it lists
     * is present, `never` when there is no manifest, `stale` otherwise. Read from the manifest,
     * directory entries and the parties' values -- no mockup file is opened, since the tree is OneDrive-synced and reading
     * a placeholder would cost a download here (#581 §5). Absent on a retired filing, whose
     * mockups stand as they were at retirement. */
    render_state?: RenderState;
    retired_on?: string;
    retirement_reason?: string;
    /** True only on a Job Board with no Writing (forms/query.ts JOB_BOARD_KIND): listed so a session
     * can find it, never a Writing, with no paths and no render_state, since it has no mockup. */
    job_board_only?: true;
  }[];
  /** Present only on success (ADR 0018): every proceeding with no filing, in id order, with its forum
   * (null while not yet chosen). Each is a section of the Job Board, rendered from proceeding_id. */
  pre_filing_proceedings?: { proceeding_id: number; forum: ProceedingRow["forum"] }[];
  /** Present only on success (#585): the Litigation Strategy written into the caller's draft_dir, or null
   * when no draft_dir was given. A path, never the board's data (#337). */
  matter_board_path?: string | null;
  /** Present only on success (#1365, ADR 0033's 2026-10-05 amendment): every Job Board page written
   * beside the Litigation Strategy, one per live filing then one per pre-filing proceeding, in page order;
   * null on the same terms. */
  job_board_paths?: PagesWritten["job_board_paths"] | null;
  /** Present only on success: every view page written beside them, each live filing's (ADR 0033,
   * 2026-10-07 amendment), [{name, filing_id, path}]; null on the same terms. */
  view_page_paths?: PagesWritten["view_page_paths"] | null;
  /** Old page files this call's page write moved into the matter's TRASH (#1365 D3). */
  moved_to_trash?: PagesWritten["moved_to_trash"];
  /** Old page files that page write could not move, and why. */
  trash_skipped?: PagesWritten["trash_skipped"];
  /** Present only on success (ADR 0009, #609) -- a freshly minted opaque identity for THIS
   * session, unique per bootstrap call. A ticket-driven session uses it as tickets.locked_by and
   * passes it back to every later drafting_forms__render, which echoes it. Deliberately not
   * derived from the server process: under Cowork one server is shared by every session on the
   * machine (#586), so a process-derived token could not tell two sessions apart. */
  session_token?: string;
  /** Present only on success (#609) -- this session's own start stamp, local wall clock at
   * YYYY-MM-DD HH:mm: the same clock and granularity tickets.locked_at is written on and
   * RenderResult.rendered_at reports. A wip ticket whose locked_at precedes this was locked
   * before this session existed, so it is another session's, whatever its locked_by says.
   * Without it the earliest anchor a session had was its first render, leaving the
   * bootstrap-to-first-render window -- exactly when a second session is also starting up --
   * uncovered. */
  bootstrapped_at?: string;
  /** Present only on success (2026-09-14 local-only design) -- the hosted Work Board artifact URL this
   * matter still records from the retired artifact design, or null. Read from
   * db_meta.workboard_artifact_url, so a session can offer its one-time cleanup: delete the hosted
   * artifact, then clear the key. No migration clears it, since only a session can delete the artifact. */
  legacy_workboard_artifact_url?: string | null;
  /** Present on either refusal -- what was skipped and what to do. */
  note?: string;
  /** On every response (#579). Each rendered filing's own render phases follow, prefixed `filing <id>: `. */
  timings: PhaseTimings;
}

/** Generalises the single `schema_version` read below to any db_meta key -- the one SQL shape
 * already there, with `key` bound rather than inlined. `db_meta.value` is always TEXT; a caller
 * wanting a number converts it with Number() (see readSchemaVersion). */
function readDbMetaValue(dbPath: string, key: string): string | null {
  const rows = submissionDataQuery(dbPath, "SELECT value FROM db_meta WHERE key = ?", [key]).rows as unknown as {
    value: string;
  }[];
  return rows.length > 0 ? rows[0].value : null;
}

export function readSchemaVersion(dbPath: string): number | null {
  const value = readDbMetaValue(dbPath, "schema_version");
  return value === null ? null : Number(value);
}

export type Ranked = Orderable & RankedFiling & { entry: BootstrapResult["filings"][number] };

/**
 * Every filing of every proceeding, in the Litigation Strategy's order, each with its bootstrap entry
 * (#584). Shared by bootstrap and by the Litigation Strategy a render rewrites. Bootstrap re-sorts its own
 * list with orderByRecency. What produces either order stays in filing-order.ts and out of every
 * response field: the array order carries it and nothing else does.
 *
 * `now` is the call's single clock reading (#581 §4): render_state, lifecycle and the ordering all
 * date from it, so they cannot disagree across a midnight boundary mid-loop.
 */
export function rankFilings(
  dbPath: string,
  client: ClientContext,
  now: string,
  stamp: { revision: number; schemaVersion: number | null; buildStamp: string | null },
  timings: PhaseTimings
): Ranked[] {
  const listed = timed(timings, "filing_list", () =>
    fetchAllProceedings(dbPath).flatMap((proceeding) =>
      fetchAllFilingsForProceeding(dbPath, proceeding.id).map((filing) => ({ proceeding, filing }))
    )
  );

  // One activity read per proceeding, not per filing: proceeding-scoped rows count for every
  // filing in the proceeding, so the whole proceeding's answer arrives in one query.
  const activityByProceeding = new Map<number, Map<number | null, string>>();
  const activityFor = (proceedingId: number, filingId: number): string | null => {
    let byFiling = activityByProceeding.get(proceedingId);
    if (byFiling === undefined) {
      byFiling = new Map(fetchLatestActivity(dbPath, proceedingId).map((r) => [r.filing_id, r.latest]));
      activityByProceeding.set(proceedingId, byFiling);
    }
    const own = byFiling.get(filingId) ?? null;
    const shared = byFiling.get(null) ?? null;
    if (own === null) return shared;
    if (shared === null) return own;
    return own > shared ? own : shared;
  };

  // Read once for the batch, as the caller reads the revision once: an approval moves no revision.
  const approvals = fetchApprovalsMark(dbPath);
  // Every live filing's parties digest (#1308): a sent Writing's from its snapshot, a drafting
  // Writing's from case data, read once per proceeding and shared by its drafting filings.
  const digests = timed(timings, "parties_drift", () => {
    const drafting = new Map<number, string>();
    return new Map(
      listed
        .filter(({ filing }) => !filing.retired_on && !isJobOnlyBoard(filing))
        .map(({ proceeding, filing }): [number, string] => {
          if (filing.filed_on) return [filing.id, partiesDigest(partiesFor(dbPath, proceeding, filing))];
          let digest = drafting.get(proceeding.id);
          if (digest === undefined) {
            digest = partiesDigest(partiesFor(dbPath, proceeding, filing));
            drafting.set(proceeding.id, digest);
          }
          return [filing.id, digest];
        })
    );
  });
  // The legacy title-keyed folder scan (#1317), once for the whole listing and only when a filing has no id folder.
  let legacy: Map<number, string> | undefined;
  const legacyOnce = () => (legacy ??= legacyMockupDirs(dbPath));
  const ranked: Ranked[] = timed(timings, "filing_entries", () =>
    listed.map(({ proceeding, filing }) => {
      // A Job Board with no Writing has no mockup, so no folder is looked up and it answers no
      // render question. A closed one is listed as a retired filing is.
      if (isJobOnlyBoard(filing)) {
        const lifecycle = deriveLifecycle(filing, null, now.slice(0, 10));
        return {
          filing_id: filing.id,
          hearing_date: null,
          latest_activity: filing.retired_on ? null : activityFor(filing.proceeding_id, filing.id),
          retired: Boolean(filing.retired_on),
          proceeding,
          filing,
          lifecycle,
          render_state: null,
          entry: {
            filing_id: filing.id,
            title: filing.title,
            paths: [],
            lifecycle: lifecycle.state,
            ...(filing.retired_on ? { retired_on: filing.retired_on } : {}),
            ...(filing.retired_on && filing.retirement_reason ? { retirement_reason: filing.retirement_reason } : {}),
            job_board_only: true as const,
          },
        };
      }
      const baseDir = mockupDir(dbPath, filing.id, legacyOnce);
      const hearingDate = fetchHearingDate(dbPath, filing.id);
      // No appeal deadline on this path (#583 §3), so the lifecycle never reaches appeal_expired.
      const lifecycle = deriveLifecycle(filing, hearingDate, now.slice(0, 10));
      // A retired filing is listed -- recovery has to find it -- but reports no paths and no
      // render_state: its mockups stand as they were at retirement and nothing re-renders them.
      if (filing.retired_on) {
        return {
          filing_id: filing.id,
          hearing_date: hearingDate,
          latest_activity: null,
          retired: true,
          proceeding,
          filing,
          lifecycle,
          render_state: null,
          entry: {
            filing_id: filing.id,
            title: filing.title,
            paths: [],
            lifecycle: lifecycle.state,
            retired_on: filing.retired_on,
            ...(filing.retirement_reason ? { retirement_reason: filing.retirement_reason } : {}),
          },
        };
      }
      const state = renderStateFor(
        baseDir,
        stampFor(filing.id, proceeding, client, now, stamp.revision, stamp.schemaVersion, stamp.buildStamp, approvals),
        filing,
        digests.get(filing.id) as string
      );
      return {
        filing_id: filing.id,
        hearing_date: hearingDate,
        latest_activity: activityFor(filing.proceeding_id, filing.id),
        retired: false,
        proceeding,
        filing,
        lifecycle,
        render_state: state,
        entry: {
          filing_id: filing.id,
          title: filing.title,
          paths: existingMockupPaths(baseDir),
          lifecycle: lifecycle.state,
          render_state: state,
        },
      };
    })
  );

  return timed(timings, "order", () => orderFilings(ranked, now));
}

/**
 * The oldest schema version this runtime lists and renders as current; below it bootstrap
 * returns migration_required. Party/counsel SSOT: the v43 hop drops the submission copy of counsel
 * and waits on the practitioner, so a refused matter stays at v42, and the runtime reads party
 * values from case data on v42 and v43 alike. A future hop must keep v42 readable or raise this
 * minimum deliberately.
 */
const MIN_READABLE_SCHEMA_VERSION = 42;

/**
 * matter (already-resolved db_path) -> migrate check, filing list, render every
 * filing's mockups, return their paths -- session entry for every
 * submissions skill (design doc 291 §6, ADR 0005).
 *
 * The migrate check comes first and is a gate, not a note (issue #351). A
 * database behind the current schema can be missing tables the renderers read,
 * so rendering it threw a raw `no such table` from inside a renderer and the
 * caller never received the schema version it was about to act on -- which is
 * precisely what draft/SKILL.md step 2 and the *Offer what the
 * matter already knows* journey both open on. On a stale database this now
 * returns the two version numbers and `migration_required: true`, renders
 * nothing, and lists nothing: enumerating filings reads the same schema the
 * renderers do, so it is no safer than the render it replaced. Migrating is
 * left to the caller -- `drafting_data__migrate` upgrades live client data
 * with non-atomic hops and only a copy-aside backup (#353), which is not a
 * thing a session-entry call should do on its own initiative.
 *
 * The same gate runs symmetrically the other way (issue #352): a database
 * *ahead* of the installed bundle's schema is just as unsafe to render against
 * -- a frozen bundle meeting a newer schema can hit missing columns just the
 * same, or silently render wrong output. That case returns `bundle_outdated:
 * true` instead of `migration_required: true`, with a note naming the actual
 * remedy (rebuild/reinstall the plugin) rather than `drafting_data__migrate`,
 * which cannot help here.
 *
 * Deliberately returns **no markdown** (issue #337). Bootstrap renders every
 * filing of every proceeding, and a session works one of them; pulling all that
 * text in on entry would spend the tokens before the practitioner has confirmed
 * which filing they meant. So bootstrap is the cheap "here is what exists"
 * surface the practitioner confirms against, and `submissionFormsRender` on the
 * confirmed filing is where the content arrives.
 */
export function submissionFormsBootstrap(
  dbPath: string,
  client: ClientContext = {},
  /** This call's single clock reading (#581 §4), shared with every render it makes. Not a
   * tool input -- dispatch never passes it. */
  now: string = nowStamp(),
  /** The matter's 0. DRAFT folder (#585). Given, the Litigation Strategy and the Job Board pages are written
   * there; omitted, nothing is written, and matter_board_path and job_board_paths are null. Confined
   * before any other work. */
  draftDir?: string,
  /** The matter's open to-dos for the Litigation Strategy (ADR 0021 D1), read by the tool entry point
   * (readMatterTodos), or why they were not. */
  todos: MatterTodos = TODOS_NOT_READ,
  /** An unattended /draft run's entry (Goal card design §5.4): the token minted is of the unattended class. */
  unattended = false,
  /** The matter's hearing dates, for the Job Board page alone (ADR 0013, 2026-10-04 amendment). */
  dates: MatterDates = DATES_NOT_READ
): BootstrapResult {
  if (!existsSync(dbPath)) {
    throw new ValidationError(`No submission database found at ${dbPath}. Run drafting_data__migrate first.`);
  }
  const draft = draftDir === undefined ? undefined : resolveDraftDir(draftDir);
  const timings: PhaseTimings = [];
  const started = performance.now();
  const schemaVersion = timed(timings, "schema_check", () => readSchemaVersion(dbPath));
  // Two different numbers, conflated until #812: `engineTarget` is what a migration would apply
  // (the working tree's migrate_engine.py), `currentVersion` is what this bundle's renderers can
  // actually read. They agree until a schema hop lands unpackaged, which is exactly when the
  // ahead-of-bundle guard below has to fire.
  const engineTarget = timed(timings, "schema_target", () => currentSchemaVersion());
  const currentVersion = renderableSchemaVersion(engineTarget);
  const schemaSource = schemaSourceStatus(engineTarget);
  const build = timed(timings, "build_stamp_check", () => buildStampStatus());

  // Ahead-of-bundle is tested first (#812): a database can be both ahead of this bundle and
  // behind the migration source, and the half this bundle cannot read is the one that matters.
  if (schemaVersion !== null && schemaVersion > currentVersion) {
    return {
      ...build,
      ...schemaSource,
      db_path: dbPath,
      schema_version: schemaVersion,
      current_schema_version: currentVersion,
      migration_required: false,
      bundle_outdated: true,
      filings: [],
      note:
        `This database is on schema version ${schemaVersion}; the installed plugin bundle only supports up to ${currentVersion}. ` +
        "No filing was listed and nothing was rendered -- rendering against a schema newer than the installed bundle can " +
        "crash inside a renderer or produce wrong output. " + bundleNextStep("database"),
      timings: withTotal(timings, started),
    };
  }

  if (schemaVersion === null || schemaVersion < engineTarget) {
    if (engineTarget > currentVersion) {
      return {
        ...build,
        ...schemaSource,
        db_path: dbPath,
        schema_version: schemaVersion,
        current_schema_version: currentVersion,
        migration_required: false,
        migration_withheld: true,
        bundle_outdated: false,
        filings: [],
        note:
          `This database is on schema version ${schemaVersion ?? "(unstamped)"} and the migration source would take it ` +
          `to ${engineTarget}, but this plugin bundle was built against ${currentVersion} and cannot read ${engineTarget}. ` +
          "The migration was WITHHELD: the database, its recorded schema version and its backups are unchanged, and " +
          "nothing was copied aside. No filing was listed and nothing was rendered. " + bundleNextStep("source"),
        timings: withTotal(timings, started),
      };
    }
    // Behind the target but not below MIN_READABLE_SCHEMA_VERSION: listed below as current.
    if (schemaVersion === null || schemaVersion < MIN_READABLE_SCHEMA_VERSION) {
      return {
        ...build,
        ...schemaSource,
        db_path: dbPath,
        schema_version: schemaVersion,
        current_schema_version: engineTarget,
        migration_required: true,
        bundle_outdated: false,
        filings: [],
        note:
          `This database is on schema version ${schemaVersion ?? "(unstamped)"}; current is ${engineTarget}. ` +
          "No filing was listed and nothing was rendered -- an older schema can be missing tables both the " +
          "filing list and the renderers read. Call drafting_data__migrate on this db_path, then call " +
          "drafting_forms__bootstrap again.",
        timings: withTotal(timings, started),
      };
    }
  }

  // Nothing below renders an advocacy document (#584, brief D1). The critical path is SQLite
  // reads plus one manifest read per filing, so it no longer scales with document count.
  // `render_state` tells the caller which filings would need a render; step 6's own `render`
  // on the filing the practitioner chose does it, for that one filing only.
  const revision = timed(timings, "revision", () => fetchRevision(dbPath));
  const ranked = rankFilings(dbPath, client, now, { revision, schemaVersion, buildStamp: build.build_stamp }, timings);
  const filings = orderByRecency(ranked).map((r) => r.entry);

  // The matter's pages (#583 §1-§2, ADR 0021, #1365), from the same SQLite reads, in
  // orderFilings' order rather than the list's. The to-dos this call was given are recorded for the
  // background job, which cannot read practice data; no board section is, since nothing was rendered.
  const pages = draft === undefined ? undefined : writeMatterPages(dbPath, draft, client, now, revision, todos, dates, timings, { ranked });
  if (pages !== undefined) recordPagesState(dbPath, todos);

  // Where a session's identity is born (#609). Exactly one mint per bootstrap; every later
  // render echoes this value back rather than minting its own.
  const token = newSessionToken(unattended);

  return {
    ...build,
    ...schemaSource,
    db_path: dbPath,
    schema_version: schemaVersion,
    current_schema_version: engineTarget,
    migration_required: false,
    bundle_outdated: false,
    filings,
    pre_filing_proceedings: timed(timings, "pre_filing_list", () => fetchPreFilingProceedings(dbPath).map((p) => ({ proceeding_id: p.id, forum: p.forum }))),
    matter_board_path: pages?.matter_board_path ?? null,
    job_board_paths: pages?.job_board_paths ?? null,
    view_page_paths: pages?.view_page_paths ?? null,
    ...(pages?.moved_to_trash ? { moved_to_trash: pages.moved_to_trash } : {}),
    ...(pages?.trash_skipped ? { trash_skipped: pages.trash_skipped } : {}),
    session_token: token,
    bootstrapped_at: nowStamp(),
    legacy_workboard_artifact_url: timed(timings, "legacy_url_read", () => readDbMetaValue(dbPath, "workboard_artifact_url")),
    timings: withTotal(timings, started),
  };
}

/** Whether this filing's mockups on disk are what a render with these client fields would write now. */
function renderStateOf(dbPath: string, filingId: number, client: ClientContext): RenderState {
  const filing = fetchFilingById(dbPath, filingId);
  const proceeding = fetchProceeding(dbPath, filing.proceeding_id);
  const stamp = stampFor(filing.id, proceeding, client, nowStamp(), fetchRevision(dbPath), readSchemaVersion(dbPath), buildStampStatus().build_stamp, fetchApprovalsMark(dbPath));
  return renderStateFor(mockupDir(dbPath, filing.id), stamp, filing, partiesDigest(partiesFor(dbPath, proceeding, filing)));
}

/**
 * Starts the background render job (#589) for a successful bootstrap, or joins the one already
 * running. A refusal starts nothing and reports whatever job status is already recorded. Kept out of submissionFormsBootstrap so a caller that only
 * wants the listing -- a test, above all -- starts no job: the two tool entry points
 * (drafting_forms__bootstrap and open_session) call this after bootstrapping.
 *
 * The queue is every live filing bootstrap reported as not fresh, in the order it listed them, and
 * only when all three client fields were supplied (#588 §6): a stamp built from the fallbacks would
 * miss at step 6 anyway. An empty queue still starts a job, which writes `done` at once and so
 * replaces a status file a killed job left behind. After each filing it renders, the job rewrites
 * that filing's pages and the Litigation Strategy, and after the last every page bootstrap wrote
 * (#1365), so the work per filing does not grow with the matter's size, with the to-dos the last registry read recorded
 * and the hearing dates its caller read, held in this closure and never persisted (ADR 0013,
 * 2026-10-04 amendment); a page write that fails is recorded on failed[] like a render that fails.
 */
export function startBootstrapJob(result: BootstrapResult, client: ClientContext, dates: MatterDates = DATES_NOT_READ): BackgroundJob {
  const dbPath = result.db_path;
  if (result.migration_required || result.bundle_outdated) return backgroundJobStatus(dbPath);
  const complete = client.clientName !== undefined && client.clientNo !== undefined && client.matterNo !== undefined;
  // A Job Board with no Writing has no mockup to render.
  const queue = complete ? result.filings.filter((f) => !f.retired_on && !f.job_board_only && f.render_state !== "fresh").map((f) => f.filing_id) : [];
  const pages = (only?: number) =>
    writeMatterPages(dbPath, dirname(result.matter_board_path as string), client, nowStamp(), fetchRevision(dbPath), persistedTodos(dbPath), dates, [], only === undefined ? {} : { only });
  return startRenderJob({
    dbPath,
    ...(result.matter_board_path ? { draftDir: dirname(result.matter_board_path) } : {}),
    queue,
    render: (filingId) => {
      const rendered = submissionFormsRender(dbPath, filingId, client);
      if (rendered.note) throw new Error(rendered.note);
      if (result.matter_board_path) pages(filingId);
    },
    isFresh: (filingId) => renderStateOf(dbPath, filingId, client) === "fresh",
    ...(result.matter_board_path ? { settle: () => pages() } : {}),
  });
}
