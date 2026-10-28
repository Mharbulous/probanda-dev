// drafting_forms__render for one filing (design doc 291 §6).

import { basename, dirname, join } from "node:path";

import { buildStampStatus } from "../../build-stamp.js";
import { currentSchemaVersion } from "../migrate.js";
import { renderableSchemaVersion } from "../schema-ceiling.js";
import { freshManifest, readManifest, sha256, writeManifest, type RenderStamp } from "../render-manifest.js";
import { moveCaseDataMockups, writingFolderForRender } from "../writing-folder.js";
import { fetchProceeding, fetchRevision, isJobOnlyBoard } from "./query.js";
import { citedStates } from "./layout-snapshot.js";
import { deadlineCriteria, type MatterDates } from "../matter-dates.js";
import type { MatterTodos } from "../matter-todos.js";
import {
  boardSectionOf,
  DATES_NOT_READ,
  pagePathFor,
  recordPagesState,
  refuseForeignMatterPages,
  renderBoardSummary,
  TODOS_NOT_READ,
  writeMatterPages,
  type PagesWritten,
} from "../matter-pages.js";
import { buildWorkBoardData, type WorkBoardData } from "./render-work-board.js";
import { legendNotes, withLegend } from "./legend.js";
import { MOCKUP_ONLY_TAG } from "./markers.js";
import { withLeadLines, withPartiesDriftLines, type DraftingParties } from "../parties-drift.js";
import { formCurrency, KIND_FORM_KEYS } from "../form-currency.js";
import type { KnowledgeSeams } from "../../knowledge/tree.js";
import { noteUpDue } from "./proposal-inventory.js";
import { scanUntrackedCitations } from "./citation-scan.js";
import { ValidationError } from "../../errors.js";
import { finishFiledRender } from "./filed-gates.js";
import { fetchFilingById, readSchemaVersion } from "./filing-reads.js";
import { archiveDroppedFiles, writeDocument, removeOldBoardFiles, refuseForeignTargets } from "./mockup-files.js";
import {
  type RenderMode,
  type ClientContext,
  buildContext,
  fetchApprovalsMark,
  stampFor,
  generalLayoutFor,
  hasLiveTags,
} from "./render-context.js";
import { resolvePresentationDir, draftDirOfCaller } from "./render-dirs.js";
import { documentsForFiling } from "./render-documents.js";
import { selectDocuments, type Projectable, symbolNotes, listDocuments, withholdHearing } from "./render-response.js";
import { type RenderedDocument, type RenderResult } from "./render-result.js";
import { type PhaseTimings, elapsedMs, timed, withTotal, nowStamp } from "./timings.js";
import { partiesFor, partiesDigest, driftReport, partiesDriftRefusal } from "./writing-parties.js";

/**
 * filing -> mockup(s) + conditional archive copy, stamped (design doc 291 §6).
 * No expected-revision parameter -- render always renders (issue #302).
 *
 * Returns each document's `markdown` alongside its path (issue #337), so a
 * session reads a mockup through this tool and never opens the file. ADR 0005's
 * "orient from the mockup, not from a query battery" rule rests on it. The
 * markdown here is for the session to read work markers from -- it is not for
 * pasting into chat, which still gets the file, not its contents.
 *
 * Mockup mode writes each document into the Writing's own folder in the matter's
 * 0. DRAFT (writing-folder.ts), the only copy, after moving an older build's
 * case-data mockups tree there once. `renderMode: 'filed'` (build #359, design
 * #358) writes nothing to disk at all -- no mockup file, no archive copy -- and
 * returns each document's markdown put through toFiledFace() (forms/filed-face.ts):
 * the mockup minus everything human-side. The caller decides where a filed-face
 * document lands.
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
  /** #689: the matter's 0. DRAFT folder, which must be the one beside the database's own case data.
   * Given, the matter's pages are rewritten and markdown comes back only for named documents. Never
   * with presentation_dir. */
  draftDir?: string,
  /** The matter's open to-dos, for the Litigation Strategy a render under draft_dir rewrites. */
  todos: MatterTodos = TODOS_NOT_READ,
  /** The matter's dates, for the Milestone pages alone, and this filing's linked deadlines as its
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
  // A Milestone with no Writing has no document, so no filed face and no Writing folder: only
  // its board renders, and under draft_dir the matter's pages go into that folder itself.
  const jobOnly = isJobOnlyBoard(filing);
  if (jobOnly && (renderMode !== "mockup" || presentationDir !== undefined)) {
    throw new ValidationError(
      `Milestone ${filingId} has no Writing, so it has no ${renderMode !== "mockup" ? "filed document" : "Writing folder"}; ` +
        "render only its board and the matter's pages",
      "milestone_only"
    );
  }
  // Both checked before anything is written. presentation_dir names the Writing's folder itself.
  const chosenDir = presentationDir === undefined ? undefined : resolvePresentationDir(dbPath, presentationDir, filing.title, proceeding.style_of_cause);
  const pagesDir = draftDir !== undefined ? draftDirOfCaller(dbPath, draftDir) : chosenDir !== undefined ? dirname(chosenDir) : undefined;
  // An older build's case-data mockups move into 0. DRAFT before any manifest is read (spec 2026-10-22 §9).
  const moved = renderMode === "mockup" ? timed(timings, "move case-data mockups", () => moveCaseDataMockups(dbPath)) : [];
  const movedReport = moved.length > 0 ? { mockups_moved: moved } : {};
  const revision = fetchRevision(dbPath);
  // Read before buildContext reads the review state, so an approval landing between the two
  // makes the next render miss rather than hit a manifest stamped with the newer mark.
  const approvals = fetchApprovalsMark(dbPath);
  const loadMs = elapsedMs(loadStart);
  // Party/counsel SSOT: a drafting Writing's counsel and address for service are read live from
  // case data, through /matter-data's own script, so the filed-face refusal below rests on no caller input.
  // A retired filing's mockup render, below, prints only the board, which reads no party: it reads none.
  // Nor does a Milestone with no Writing.
  const retiredMockup = renderMode === "mockup" && Boolean(filing.retired_on);
  const { parties, drift }: DraftingParties = retiredMockup || jobOnly
    ? { parties: [], drift: { rows: [] } }
    : timed(timings, "parties_drift", () => partiesFor(dbPath, proceeding, filing));
  const contextStart = performance.now();
  const ctx = buildContext(dbPath, proceeding, filing, parties, revision, client, appealDeadline, now);
  timings.push({ phase: "load_filing", ms: loadMs + elapsedMs(contextStart) });

  // #1365: under draft_dir or presentation_dir the matter's pages are rewritten from database state, with
  // the section this render built for its filing, and that section is recorded so board_changed
  // compares against what this filing last reported, never against a page.
  const writePages = (section: WorkBoardData) => {
    if (!pagesDir) return undefined;
    const pages = writeMatterPages(dbPath, pagesDir, client, now, revision, todos, dates, timings, { section });
    onPages?.(pages);
    return { pages, change: recordPagesState(dbPath, todos, section, sessionToken) };
  };
  // The board's entry names this filing's own Milestone page (ADR 0033, 2026-10-05 amendment): its
  // path when this render wrote the pages, none for a retired filing, which has no page. With no
  // page written, file_name is the generic name and names no page.
  const boardDocument = (section: WorkBoardData, written: ReturnType<typeof writePages>, withSummary: boolean): RenderedDocument => {
    const path = written ? pagePathFor(written.pages, section.meta) : undefined;
    return {
      document_type: "Work_board",
      ...(path !== undefined ? { path } : {}),
      file_name: path !== undefined ? basename(path) : "Milestone.html",
      // On a merged board the summary reads the whole board, as its page draws it.
      ...(withSummary ? { board_summary: renderBoardSummary(boardSectionOf(dbPath, section, client, ctx.rendered, revision, dates), client, todos) } : {}),
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

  // A Milestone with no Writing, open or closed: the board alone. documentsForFiling, the manifest
  // and finishMockup are never reached, so no mockup or manifest is written for it. Under draft_dir
  // the matter's pages are rewritten, a closed board with no page, as a retired filing has none.
  if (jobOnly) {
    const section = timed(timings, "board_section", () => buildWorkBoardData(ctx));
    selectDocuments([{ document_type: "Work_board" }], documentTypes); // only to refuse an unknown name
    const written = writePages(section);
    return {
      filing_id: filingId,
      revision,
      milestone_only: true,
      documents: [boardDocument(section, written, true)],
      ...(written ? { view_page_paths: written.pages.view_page_paths } : {}),
      ...trashReport(written),
      ...movedReport,
      ...(filing.retired_on
        ? {
            filing_retired: true,
            note:
              `Milestone ${filingId} was closed on ${filing.retired_on}, so it has no page. ` +
              "Recover it (clear filings.retired_on and retirement_reason) before working it again.",
          }
        : {}),
      ...(sessionToken ? { session_token: sessionToken } : {}),
      rendered_at: ctx.rendered,
      timings: withTotal(timings, started),
    };
  }

  // Retired filing (schema v17): mockup mode renders no mockup. Re-rendering a retired filing's other mockups would archive the copies of work that
  // is over, on a revision bump nobody asked for -- but the board is the one thing the retire
  // flow needs back, to confirm the state actually read Retired (its own State row derives from
  // `filing.retired_on`, already reflected in `ctx.lifecycle` above): `documents` carries its
  // board_summary. Filed mode is untouched: a filed face of a filing already delivered to the
  // forum is still a legitimate read. Under draft_dir the matter's pages are rewritten, the
  // retired filing with no Milestone page (#1365 D1; its old one is moved to TRASH).
  if (retiredMockup) {
    const section = timed(timings, "board_section", () => buildWorkBoardData(ctx, deadlines));
    if (pagesDir) selectDocuments([{ document_type: "Work_board" }], documentTypes);
    const written = writePages(section);
    return {
      filing_id: filingId,
      filing_retired: true,
      documents: [boardDocument(section, written, true)],
      ...(written ? { view_page_paths: written.pages.view_page_paths } : {}),
      ...trashReport(written),
      ...movedReport,
      note:
        `"${filing.title}" was retired on ${filing.retired_on}` +
        (filing.retirement_reason ? ` (${filing.retirement_reason})` : "") +
        `. Nothing was rendered and no mockup was written -- a retired Writing's mockups stay as they ` +
        "were at retirement. Recover the Writing before rendering it again.",
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
  // written: their paths, and their text when it is asked for, come off disk. The Milestone's
  // section is rebuilt either way -- it sits outside the stamp (#581 §2),
  // since its data reads the ticket tables, whose writes are exempt from the revision bump.
  // The Writing's own folder (writing-folder.ts): the one its manifest records, so a retitle never
  // moves it, or presentation_dir. Only a mockup render writes into it, so only it is resolved here.
  const folder = renderMode !== "mockup" ? undefined : chosenDir !== undefined ? { dir: chosenDir } : writingFolderForRender(dbPath, filingId, filing.title);
  const baseDir = folder?.dir as string;
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
  const fresh = stamp === null || liveTags ? null : timed(timings, "stamp_check", () => freshManifest(dbPath, filingId, stamp, driftDigest));
  // A hit serves only the folder this render writes into: presentation_dir may name another.
  const hit = fresh !== null && fresh.dir.toLowerCase() === baseDir.toLowerCase() ? fresh : null;

  /** The mockup render's response, after the hit or the miss: under draft_dir or presentation_dir the
   * matter's pages are written, each target checked before any is, and markdown comes back only for
   * named documents; otherwise every document's markdown. Either way the board's summary only when
   * the board is named in `documents`. The Milestone is the last document either way. */
  const finishMockup = (documents: Projectable[], section: WorkBoardData, renderedAt: string): RenderResult => {
    const due = noteUpDue(section.proposals);
    const tail = {
      ...report,
      ...(sessionToken ? { session_token: sessionToken } : {}),
      rendered_at: renderedAt,
      ...(currency ? { form_currency: currency } : {}),
      ...(due.length > 0 ? { note_up_due: due } : {}),
      ...movedReport,
      ...(folder?.rename ? { writing_folder_rename: folder.rename } : {}),
    };
    if (pagesDir) {
      selectDocuments([...documents, { document_type: "Work_board" }], documentTypes); // only to refuse an unknown name
      refuseForeignMatterPages(pagesDir, dbPath);
      const projected = listDocuments(documents, documentTypes);
      const written = writePages(section);
      const board = boardDocument(section, written, documentTypes?.includes("Work_board") ?? false);
      const views = written ? { view_page_paths: written.pages.view_page_paths } : {};
      return { filing_id: filingId, revision, documents: [...projected, board].map(withholdHearing), ...views, ...trashReport(written), ...tail, timings: withTotal(timings, started) };
    }
    const inline: RenderedDocument[] = [...documents, boardDocument(section, undefined, documentTypes?.includes("Work_board") ?? false)];
    return { filing_id: filingId, revision, documents: selectDocuments(inline, documentTypes).map(withholdHearing), ...tail, timings: withTotal(timings, started) };
  };

  if (hit) {
    timed(timings, "remove retired board files", () => removeOldBoardFiles(baseDir));
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
        path: join(hit.dir, f.file_name),
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

  if (renderMode === "filed") return finishFiledRender({ dbPath, filingId, revision, filing, built, cited, documentTypes, timings, started });

  // The citation scan (filing-checklists.md "Citations in the text"): each citation on a document
  // that reaches the forum that no live authorities row tracks becomes a 📇 entry the noting-up
  // criterion counts, named in a mockup-only line at the head of the venue document. It runs before
  // the manifest write, so the pre-send hold reads the entries back. The filed render returned above.
  const untracked = timed(timings, "citation_scan", () =>
    scanUntrackedCitations(dbPath, ctx.proceeding.id, built, ctx.inventory)
  );
  if (untracked.length > 0) built[0] = { ...built[0], markdown: withLeadLines(built[0].markdown, untracked) };

  refuseForeignTargets(baseDir, built.map((doc) => doc.fileName));
  timed(timings, "remove retired board files", () => removeOldBoardFiles(baseDir));
  timed(timings, "archive dropped files", () => archiveDroppedFiles(dbPath, readManifest(dbPath, filingId), built));
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
  // Records what this render produced, so the next one can skip it. The Milestone's section is
  // no file of the filing's: it is rebuilt on every call (#581 §2).
  if (stamp) {
    timed(timings, "manifest_write", () =>
      writeManifest(dbPath, filingId, {
        stamp,
        folder: basename(baseDir),
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
