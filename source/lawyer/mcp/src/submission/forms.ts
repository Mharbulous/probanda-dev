// drafting_forms__render / drafting_forms__bootstrap (build ticket
// #297, design doc 291 §5-§6). Orchestrates the per-document renderers in
// data/forms/*, writes markdown mockups into the Writing's own folder in the
// matter's 0. DRAFT folder, and archives the previous copy only when
// db_meta.revision has moved (design doc 291 §5's "always render, never detect"
// rule -- no revision-CAS input parameter here, per issue #302's "no
// stale-mockup guard" decision).
//
// Output location (spec 2026-10-22 §9): <matter>\0. DRAFT\<document name>\, one
// folder per Writing named after the document (writing-folder.ts), archive copies
// in an archive\ folder inside it. That one file is the mockup: no second copy is
// kept beside the database, which holds only the databases. The 0. DRAFT folder is
// the one beside the matter's own 0. CASE DATA folder holding db_path (ADR 0013),
// so the location takes no output-root parameter. The render manifests and the
// pages' state file are in 0. DRAFT\Drafting records\. Render still returns the
// markdown inline, so a session reads a mockup through this tool, never from disk.
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
//
// The code lives in forms/, one module per concern; this file re-exports the tools' public surface.

export { readExistingRevision } from "./writing-folder.js";
export { resolveDraftDir } from "./render-manifest.js";
export type { RenderMode, ClientContext } from "./forms/render-context.js";
export { buildContext } from "./forms/render-context.js";
export type { PhaseTimings } from "./forms/timings.js";
export { timed, nowStamp } from "./forms/timings.js";
export type { PartiesDriftRefusal } from "./forms/writing-parties.js";
export type { RenderedDocument, RenderResult } from "./forms/render-result.js";
export { submissionFormsRender } from "./forms/render.js";
export type { ProceedingBoardResult } from "./forms/proceeding-board.js";
export { submissionFormsRenderProceedingBoard } from "./forms/proceeding-board.js";
export type { PublishOptions, EmitForm32Result, EmitForm32Refusal, EmitForm33Result, EmitForm33Refusal } from "./forms/emit-bcsc-forms.js";
export { submissionFormsEmitForm32, submissionFormsEmitForm33 } from "./forms/emit-bcsc-forms.js";
export type { EmitAffidavitResult } from "./forms/emit-supporting-affidavit.js";
export { submissionFormsEmitAffidavit } from "./forms/emit-supporting-affidavit.js";
export type { EmitBccaBookResult, EmitBccaBookRefusal } from "./forms/emit-bcca.js";
export { submissionFormsEmitBccaBook, submissionFormsEmitBccaFactum } from "./forms/emit-bcca.js";
export type { PreFilingCheckResult, PreFilingCheckRefusal } from "./forms/pre-filing-check.js";
export { submissionFormsPreFilingCheck } from "./forms/pre-filing-check.js";
export { fetchFilingById, readSchemaVersion } from "./forms/filing-reads.js";
export type { BootstrapResult } from "./forms/bootstrap-result.js";
export type { Ranked } from "./forms/rank-filings.js";
export { rankFilings } from "./forms/rank-filings.js";
export { submissionFormsBootstrap } from "./forms/bootstrap.js";
export { startBootstrapJob } from "./forms/bootstrap-job.js";
