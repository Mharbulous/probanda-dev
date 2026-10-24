// drafting_forms__bootstrap and the session token it mints.

import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";

import { buildStampStatus } from "../../build-stamp.js";
import { currentSchemaVersion } from "../migrate.js";
import { bundleNextStep, renderableSchemaVersion, schemaSourceStatus } from "../schema-ceiling.js";
import { moveCaseDataMockups } from "../writing-folder.js";
import { orderByRecency } from "../filing-order.js";
import { fetchPreFilingProceedings, fetchRevision } from "./query.js";
import { type MatterDates } from "../matter-dates.js";
import type { MatterTodos } from "../matter-todos.js";
import { DATES_NOT_READ, recordPagesState, TODOS_NOT_READ, writeMatterPages } from "../matter-pages.js";
import { UNATTENDED_TOKEN_PREFIX } from "./render-work-board.js";
import { ValidationError } from "../../errors.js";
import { type BootstrapResult } from "./bootstrap-result.js";
import { readDbMetaValue, readSchemaVersion } from "./filing-reads.js";
import { rankFilings } from "./rank-filings.js";
import { type ClientContext } from "./render-context.js";
import { draftDirOfCaller } from "./render-dirs.js";
import { type PhaseTimings, timed, withTotal, nowStamp } from "./timings.js";

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
    throw new ValidationError(`No drafting records found at ${dbPath}. Set the matter's drafting records up first.`);
  }
  const draft = draftDir === undefined ? undefined : draftDirOfCaller(dbPath, draftDir, "drafting_forms__bootstrap.draft_dir");
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
  // An older build's case-data mockups move into 0. DRAFT before any manifest is read (spec 2026-10-22 §9).
  const moved = timed(timings, "move case-data mockups", () => moveCaseDataMockups(dbPath));
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
    ...(moved.length > 0 ? { mockups_moved: moved } : {}),
    session_token: token,
    bootstrapped_at: nowStamp(),
    legacy_workboard_artifact_url: timed(timings, "legacy_url_read", () => readDbMetaValue(dbPath, "workboard_artifact_url")),
    timings: withTotal(timings, started),
  };
}
