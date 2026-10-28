import type { ToolDefinition } from "./shared.js";

function formsPrefixed(name: string): string {
  return `drafting_forms__${name}`;
}

// Deterministic mockup rendering surface (build ticket #297, issue 291 §6).
// SQL and rendering logic live in data/forms/* -- this backend never embeds
// a query, a table name, or a column name either (same boundary as
// drafting_data__*, just for the render surface). render writes each
// Writing's markdown mockups into its own folder in the matter's 0. DRAFT
// (spec 2026-10-22), and render and bootstrap move an older build's case-data
// mockups tree there once; emit_form32 (issue #392) returns markdown for the caller to write,
// and writes it itself only given case_data_folder (#1267, ADR 0025).
// bcsc_form_harness runs publish-bcsc-form's harness host-side (ADR 0025), and publish_general,
// publish_bcca_factum and publish_vaniac_package run their subskills' fills host-side (ADR 0026),
// and assemble_general runs assemble-general's binder host-side (ADR 0027), and draft_harness runs
// /draft's steps host-side (ADR 0031). None writes to the database.
export function submissionFormsToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: formsPrefixed("form_currency"),
      description:
        "Read-only, facts only (ADR 0038): whether an enactment change on record amends one BC Supreme Court form " +
        "that its shipped template, emitter and type file are not recorded as conformed to. form_key is the form's key " +
        "from its /publish identity file (e.g. form-32, form-33, form-17). Reads the record of enactment changes the " +
        "plugin ships and the form's identity file, as of today's local date. Returns form_key, form_number, today, " +
        "identity_file (null when none ships), conformed_to, unconformed (each change in force naming the form and not " +
        "conformed: amending_reg, amending_oic, commencement_date, enactment), warning (one sentence to say verbatim, " +
        "or null) and update_doc (the repo-session checklist that conforms a form). It never says whether a change " +
        "affects a filing, and its commencement date is not a deadline.",
      inputSchema: {
        type: "object",
        properties: {
          form_key: { type: "string" },
        },
        required: ["form_key"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    {
      name: formsPrefixed("render"),
      description:
        "Render one filing's document(s) to markdown. render_mode 'mockup' (default) writes each mockup into the " +
        "Writing's own folder in the matter's 0. DRAFT folder, the one beside the 0. CASE DATA folder holding db_path: " +
        "one folder per Writing named after the document (its title), each mockup named after its document (a Writing " +
        "on a stock type is named by its title), the only copy. A folder recorded for the Writing is kept on a retitle; " +
        "a name another Writing holds gets ` (2)` after it. A matter with no 0. DRAFT folder there is refused " +
        "(draft_dir_missing). It archives the previous copy into the folder's archive on a revision change, never " +
        "overwrites a file it did not write (no render revision stamp), and returns each document's markdown inline " +
        "alongside its path (issue 337) -- a session " +
        "never reads the mockup file itself, so this is the only way to read its work markers. With draft_dir " +
        "or presentation_dir, markdown returns only for the documents named in documents; every other document " +
        "carries markdown_chars, its length, in its place, so to read a document's work markers name its " +
        "document_type in documents. Each mockup " +
        "ends with a Legend section explaining each symbol printed on it, never on the filed face; beside a " +
        "document's markdown, symbol_notes lists the notes written for the model on those symbols, one string " +
        "each, when there are any -- they are written to no file. render_mode " +
        "'filed' (issue 359) writes nothing to disk and returns each document's markdown with every human-side " +
        "element stripped (work markers, Held in reserve, source traces, HTML comments) -- the filed face. 'filed' " +
        "responses carry no path, only file_name; the caller decides where it lands. Always renders -- no expected-" +
        "revision guard (issue 302). A database ahead of the installed bundle's schema (issue 352) refuses instead: " +
        "empty documents, bundle_outdated true, and a note to rebuild/reinstall the plugin. A drafting filing's party " +
        "counsel and address for service are read live from case data through case_party_id: each party they cannot " +
        "be read for prints none, gets a mockup-only line and a parties_drift row, and 'filed' refuses with " +
        "parties_drift_gate_failed while any stands; a sent filing renders the party rows it printed. On a successful mockup-" +
        "mode render, the response also carries rendered_at (issue 548), the exact YYYY-MM-DD HH:mm stamp this " +
        "render printed on its documents' Rendered lines; when nothing changed since the last render, the advocacy " +
        "files are reused and rendered_at is the minute they were last rendered. A mockup render of a Writing whose Proposed " +
        "lane holds a note-up Proposal that no live job holds and the practitioner has not shelved also carries note_up_due, " +
        "those keys in the lane's order: the session writes them into the Writing's one `Note up all cited authorities` " +
        "job, or adds them to it (/drafting-data jobs-create.md §3k). Optional session_token (ADR 0009, issue 609) is the " +
        "caller's own session identity, issued by drafting_forms__bootstrap: pass it on every mockup render of a " +
        "job-driven session and the response ECHOES it back, so the session keeps one identity for " +
        "tickets.locked_by across bootstrap and every render. This tool mints nothing and compares nothing -- omit " +
        "it and the response simply carries no session_token. The Milestone (document_type Work_board) is no file " +
        "of the filing's: only when documents names Work_board does its entry carry board_summary in place of " +
        "markdown (a retired filing's entry always carries it), the board on this filing's Milestone page (on a merged " +
        "board, the whole board, whichever of its Writings rendered) as " +
        "a short fixed-grammar summary: `# Milestone — Matter <matter no> <matter description> · Client <client " +
        "name> (<client no>) · Rev <n>`, `To Do: <the description of the open to-do linked to this filing>` (or " +
        "`none linked`, or why the to-dos were not read), `Goal: <description> (<status>)` (the board's statement of " +
        "goals, drafting_data__set_board_goal: its description and confirmed, inferred, declined, none or " +
        "needs_consolidation, the last followed by `, <n> statements to combine` on a merged board that has no one goal yet; the " +
        "statement itself is board_card's goals lane), `Unmet completion criteria:` with one line per unmet or " +
        "pending criterion in board order, as board_card's criteria lane prints it without the items (`Unmet " +
        "completion criteria: none` when every criterion is met), and `Met " +
        "completion criteria: <ids>` (or `none`); a section with no criteria to list prints `State: <state>[ — " +
        "<text>]` in place of both lists. The lanes with their jobs, tags and counts, the lapsed keys, each job's " +
        "detail, the criterion items, the Proposed and shelved lines and the loose threads come from " +
        "drafting_forms__board_card. Those two are the only board content a session reads; a " +
        "session never reads a matter page (shared/html-pages.md). Optional documents narrows the " +
        "RESPONSE to the named document_type values (e.g. [\"Work_board\"]) -- every document is still rendered and " +
        "still written to disk, so this trims only what crosses the token cap; an unrecognised name is an error " +
        "naming the types this filing has. Optional appeal_deadline (YYYY-MM-DD, schema v17) is the caller's own " +
        "docket-clerk lookup for this proceeding -- no deadline is ever stored in the submission database. " +
        "Supplying it is what lets the Milestone derive the appeal-period-expired state and show the ready-to-" +
        "retire notice; omitting it simply leaves that state underived. A filing already retired refuses mockup " +
        "mode outright: filing_retired true, nothing rendered, nothing written, and a note naming the recovery " +
        "remedy. Optional draft_dir (issue 689, mockup mode only, never with presentation_dir) is the matter's 0. DRAFT " +
        "folder as open_session returned it, refused unless it is the one beside db_path's case data. With it each " +
        "advocacy document comes back with path and markdown_chars but no markdown, and documents changes meaning: it " +
        "names which documents ALSO return markdown (the board: board_summary) inline, rather than narrowing the list. " +
        "Under draft_dir the server also rewrites the matter's pages in that folder: Litigation Strategy.html (issue 585) " +
        "at its top, with the matter's open to-dos read from " +
        "practice data by matter_no (ADR 0021), and one Milestone page per board section (ADR 0033, 2026-10-05 " +
        "amendments), a merged board's page drawing every board merged into it as one board (drafting_data__merge_milestones): " +
        "`Milestone.html` in the Writing's own folder for a board of a Writing, and at the folder's top " +
        "`Milestone - proceeding <id>.html` per pre-filing proceeding and `Milestone <id>.html` per Milestone with no Writing; " +
        "a job with no filing_id is on every Writing's " +
        "page in its proceeding. The same write puts each view page (ADR 0033, 2026-10-07 amendment) beside its board's " +
        "page, `<page name>.html` in a Writing's folder, and the response carries view_page_paths " +
        "[{name, filing_id, path}]. The board's entry then carries path, this filing's own page, and file_name its " +
        "name; a retired filing has no page and its entry no path. Each page is written atomically " +
        "(temp file, then rename) and only over a file carrying its page's marker: one without it is refused before " +
        "any page is written. A page write moves the old page files this server wrote (a " +
        "retired filing's page, a proceeding's once it has a filing, the old single Milestone.html, " +
        "per-filing boards, numbered copies, older names) into the matter's TRASH, reported as moved_to_trash " +
        "[{from, to}], and any it could not move as trash_skipped [{path, error}]. The board's entry also carries board_changed: false when " +
        "this filing's section matches, apart from its Rendered minute, the one the last such render recorded in " +
        "matter-pages-state.json in the draft folder's Drafting records folder, true otherwise. Revision cannot tell this, since writing a job " +
        "or a shelving moves no revision. When a section was recorded, the entry also carries board_moves: each job " +
        "added (from null), removed (to null) or moved to another board column since it, as {id, title, from, to}; " +
        "empty when no job moved. " +
        "With no folder recorded for the Writing, the server finds it by its title, with or without a leading " +
        "YYYY-MM-DD; an older build's `<code> <title>` folder is renamed to the title when it holds only files this " +
        "renderer wrote, else kept, and the response carries writing_folder_rename {from, to} for the practitioner to " +
        "rename it through file-manager. Two or more candidates are refused (code presentation_dir_ambiguous) before " +
        "anything is written, naming each. Optional presentation_dir (issue 466, ADR 0012, mockup mode only) then names " +
        "the Writing's folder: directly under that 0. DRAFT folder, named for the filing's title with or without a " +
        "leading YYYY-MM-DD -- anything else is refused; it otherwise acts as draft_dir does. A render or bootstrap that " +
        "finds an older build's mockups folder beside the database first moves it into 0. DRAFT, each Writing's mockups " +
        "and archive into its folder and the manifests into the Drafting records folder, and reports each folder moved " +
        "as mockups_moved [{from, to}]. " +
        "A successful mockup render also carries background_job, the background render job's status (see " +
        "drafting_forms__bootstrap). " +
        "Pass proceeding_id instead of filing_id (ADR 0018) for a proceeding with no filing, as bootstrap lists in " +
        "pre_filing_proceedings: only that proceeding's Milestone section is built, from its jobs and loose threads, with no " +
        "filing, lifecycle or Proposals, and returned as board_summary, its State saying why there is no filing. " +
        "No mockup is written; given draft_dir the matter's pages are rewritten, the proceeding's " +
        "section on its own Milestone - proceeding <id>.html, and milestone_path (that page), milestone_paths " +
        "(every Milestone page, [{filing_id, proceeding_id, path}] in page order) and matter_board_path returned. " +
        "It takes only client fields, " +
        "session_token and draft_dir, and refuses a proceeding that has a filing. " +
        "A filing_id that names a Milestone with no Writing (drafting_data__create_milestone) renders its board alone: " +
        "milestone_only true and one Work_board entry carrying board_summary, whose State reads Open or Closed, with " +
        "no mockup written; draft_dir rewrites the matter's pages, its own " +
        "`Milestone <id>.html` among them and no view page for it, and render_mode 'filed' or presentation_dir is " +
        "refused with milestone_only. " +
        "Every response also carries timings: per-phase durations in ms, for profiling only.",
      inputSchema: {
        type: "object",
        properties: {
          db_path: { type: "string" },
          filing_id: { type: "number" },
          proceeding_id: { type: "number" },
          client_name: { type: "string" },
          client_no: { type: "string" },
          matter_no: { type: "string" },
          render_mode: { type: "string", enum: ["mockup", "filed"] },
          documents: { type: "array", items: { type: "string" } },
          appeal_deadline: { type: "string" },
          presentation_dir: { type: "string" },
          session_token: { type: "string" },
          draft_dir: { type: "string" },
        },
        required: ["db_path"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    {
      name: formsPrefixed("board_card"),
      description:
        "Read-only: what one Milestone section holds beyond the short board_summary, and what its cards hold when " +
        "opened. On a merged board (drafting_data__merge_milestones) the card reads the whole board as its page draws " +
        "it, by its survivor's id, each job line naming its Writing after its title; a board merged into another is " +
        "refused (board_merged, naming the survivor), unless that survivor is retired. " +
        "A General Job (a job with no Writing, filing_id NULL, drawn on every Writing's board in its proceeding) ends its " +
        "job line ` · general`, after any tags, in every lane and in jobs; a Writing Job's line carries no such tag, and " +
        "neither does any job on a proceeding_id card, where every job has no Writing. " +
        "Pass exactly one of filing_id and proceeding_id (a proceeding with no filing; one that has a filing is " +
        "refused, as drafting_forms__render refuses it), and at least one selector: jobs (job ids on this section), " +
        "lanes (any of goals, criteria, live, proposed, completed, rejected, loose_threads, attached, court_file; goal is accepted as the criteria " +
        "lane's former name; attached needs draft_dir, the matter's 0. DRAFT folder session entry returned, and court_file needs " +
        "draft_dir and filing_id), key (a Proposal key) or loose_threads_from_jobs (job " +
        "ids: the loose_threads lane with only the loose threads those jobs surfaced, under `## Loose Threads (k of n from Job #N)`). " +
        "A job id not on the section, an unknown lane, criteria or proposed on a proceeding with no filing, an empty " +
        "loose_threads_from_jobs, or no selector at all is an " +
        "error. The section is built as the matter pages build it, from the inventory the filing's last render " +
        "saved and the current job and shelving rows, so it reads what the session's latest render read. " +
        "Returns { filing_id or proceeding_id, revision, rendered_at, card }. card is fixed-grammar text in this " +
        "order: each job asked for, in board order, as its live-lane line without the tags, then " +
        "`  kind: <kind> · priority: <N>` (with ` · locked: <locked_at> · holder: <tag> · last activity: <stamp>` on an In " +
        "Progress job, the last activity being the latest of its lock, its done steps, the loose threads " +
        "captured from it, the answers saved for it and the sources to get added to it or closed on it), then `  intent:`, `  keys:` with each held " +
        "key's stored item and what derives now (`(now: <glyph> \"<item>\")` or `(now: dead)`), " +
        "`  scope: … · waits on: … · either-or: …`, `  steps:` when it has steps, each `<ordinal> <glyph> <text>` joined by " +
        "` · `, the glyph ☑ done (followed by ` (<done_at>)`), ☐ open, ↻ to be retried, ☒ cancelled or ⏸ deferred (each " +
        "followed by ` (\"<the practitioner's words>\")`), or `⏳ until <HH:MM>` waiting, the minute the process is next " +
        "checked and never a deadline; a waiting step whose minute has passed prints ☐, `  loose threads:` with each open loose thread " +
        "captured from it (`loose thread <id>: \"<idea>\" (<created>)`) and `  answers:` with each answer saved for it " +
        "(`<path from 6. LAW> (<saved_at>)`) and `  sources to get:` with the count got then each source still open " +
        "(`☐ <kind>: <label>`) or closed not retrieved (`☒ <kind>: <label> (not retrieved: <reason>)`), which are the job's " +
        "own record and never steps of its plan, each when it has any, and on a completed job `  completed: " +
        "<completed_at>`, on a shelved one `  shelved: <rejected_at>`; a superseded job its line then `  superseded " +
        "by: … · reason: …`. Then each lane asked for: goals, the board's statement of goals " +
        "(drafting_data__set_board_goal) as `## Goal (<confirmed|inferred|declined|none|needs_consolidation>)`, its " +
        "description on the next line, then the statement verbatim, line breaks and indentation kept, when there is " +
        "one, on every kind of board, and, only while needs_consolidation, each earlier statement of a merged board as " +
        "`### To combine <n> (<status>)` and its text, to propose one combined goal from; " +
        "criteria, the `🎯 Completion criteria: <state>[ — <text>]` " +
        "line and each criterion in board order as `- <glyph> <id>: <text>[ (after …)][ (counts)][ — items]`, the " +
        "counts being `(unmet <u>, met <m>, total <t>)` on a criterion read off the mockup's markers, where met " +
        "counts the items the practitioner shelved or suppressed (🤫) and total the items still flagged, shelved or suppressed, since an item " +
        "fixed no longer carries a marker, and `(<n> open)` on the gate while a step or a job is open, and the items " +
        "separated by `; `, items with the same text printed once where the first stands as `<item> ×<n> (at <row>, …)`, " +
        "each row being the Proposal key or `<glyph>:<table>:<id>` it was flagged on; live, " +
        "`## <lane> (n)` for Ready, In Progress, Bring Forward, Blocked and Superseded, " +
        "each job as the page's collapsed card text then its tags (`eligible:` and `dispatch:` on a Ready job, " +
        "`idle …` on an In Progress one, measured to this call's rendered_at, `BF <date>` on a Bring Forward one, the " +
        "day its work may start and never a deadline), `dispatch choice: …` after Ready, " +
        "the counts of Completed and Shelved between Blocked and Superseded, then the counts of Loose Threads and " +
        "Proposed (a filing's only), then `🧹 lapsed keys: …` when any; proposed, `## Proposed (n)` and each Proposal as `- <glyph> <title>` " +
        "and `  key: … · item: … · lane: …`, then, on a note-up of a statute, regulation or rule, `  step <n>: " +
        "<text>` per provision the filing cites or `  steps: none`; completed, `## Completed (n)` and each completed job's line; " +
        "rejected, `## Shelved (n jobs, m proposals)`, each shelved job's line, then each shelved " +
        "Proposal's lines; loose_threads, `## Loose Threads (n)` and each `- loose thread <id>: \"<idea>\" (<surfaced_by>[; " +
        "from …])` line, the ranked by rank then id, then the unranked by id (loose_threads_from_jobs the same), each " +
        "ending ` · rank <N> · <group label>[ · job: \"<job description>\"] · <reason>` or ` · unranked`; attached, `## Attached (n)` and each draft " +
        "attached to the board (a client letter's or a reply's file, ADR 0042) as `- attachment <id> · <registry code, " +
        "else client letter|reply> · <stored path>`, then ` · code check failed (<why>)` when the name gate could not run, " +
        "then ` · no Writing: shown on this proceeding's lowest-id " +
        "live Writing's board` on a row with no Writing (such a row shows on that one board only), then ` · missing`, " +
        "` · not in the draft folder`, ` · unreadable (<error code>)`, or ` · modified <YYYY-MM-DD>` and on a client letter " +
        "` · review: <its first line after \"Counsel's review: \">` (`no review line` when none), the rest of that file " +
        "never read, then ` · pending: #<id>, …` (the proceeding's Ready, In Progress, Bring Forward and Blocked jobs whose " +
        "scope names `board_attachments:<id>`) or ` · pending: none`; court_file, `## Court File (n)` and each affidavit " +
        "the filing relies on, matched by number and deponent code against the file names in the matter's COURT FILE " +
        "folder (with several, the one naming the proceeding's file number), as `- <label> · court file: <file name>` or " +
        "` · court file: none found[ (<note>)]`, then ` · mismatch: court file shows <status> <date>; drafting data shows " +
        "<unsworn|made <date>>` when they disagree; only file names are read. Then key: the live " +
        "job holding it, printed as a job above, else the Proposal with that key under its lane's heading, else " +
        "`(no job or Proposal carries <key>)`. On a Milestone with no Writing (drafting_data__create_milestone) the " +
        "criteria, proposed and court_file lanes print nothing and the live lane has no Proposed count. " +
        "Writes nothing, moves no revision and writes no page.",
      inputSchema: {
        type: "object",
        properties: {
          db_path: { type: "string" },
          filing_id: { type: "number" },
          proceeding_id: { type: "number" },
          client_name: { type: "string" },
          client_no: { type: "string" },
          matter_no: { type: "string" },
          jobs: { type: "array", items: { type: "number" } },
          lanes: { type: "array", items: { type: "string", enum: ["goals", "criteria", "live", "goal", "proposed", "completed", "rejected", "loose_threads", "attached", "court_file"] } },
          key: { type: "string" },
          loose_threads_from_jobs: { type: "array", items: { type: "number" } },
          draft_dir: { type: "string" },
        },
        required: ["db_path"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    {
      name: formsPrefixed("bootstrap"),
      description:
        "Session entry for every submissions skill: checks the database's schema version and lists every filing " +
        "with its title, lifecycle, render_state and whatever mockup paths are already on disk. Renders nothing and " +
        "returns no markdown -- call drafting_forms__render on the one filing the practitioner confirms, to read " +
        "its content and write its mockups. filings comes back in the order to present them in; present that order " +
        "as given. render_state is 'fresh' (the mockups on disk are what a render now would produce), 'stale' (they " +
        "are not) or 'never' (none have been rendered yet); it is absent on a retired filing, which is listed with " +
        "no paths. Before listing it moves an older build's mockups folder beside the database into the matter's " +
        "0. DRAFT, as drafting_forms__render describes (mockups_moved). A Milestone with no Writing (drafting_data__create_milestone) is listed among filings with " +
        "milestone_only true, no paths and no render_state: it is not a Writing, has a Milestone page and no view " +
        "page, and the background job never renders it. Every response reports both schema_version and current_schema_version; if the database is behind " +
        "schema version 42, the oldest this runtime reads, migration_required is true and the response carries no " +
        "filings at all (issue 351) -- call " +
        "drafting_data__migrate on the same db_path, then call this again. If instead the database is ahead of the " +
        "installed bundle (issue 352), bundle_outdated is true and the remedy is the opposite -- never " +
        "drafting_data__migrate; the note names the next step for its case: fully restart the app when the plugin " +
        "installed on disk is a newer build than the one running, otherwise run /lawyer:suggestion naming the note, then " +
        "fully restart the app once a plugin update arrives. Every response also reports build_stamp and current_build_stamp; " +
        "server_outdated is true when they differ, and build_note names the remedy (issue 452). Every response also " +
        "carries schema_target_version (what the migration source would apply), bundle_schema_version (what this " +
        "bundle was built against, null when unbundled) and schema_source_ahead, with schema_note when they diverge " +
        "or COCLERK_SUBMISSION_ALLOW_UNBUILT_SCHEMA is set (issue 812). When a migration is due but would exceed " +
        "bundle_schema_version, migration_withheld is true, migration_required is false, nothing is migrated and " +
        "note says so. On success it also " +
        "carries session_token (ADR 0009, issue 609) -- a FRESH random identity minted for THIS session on every " +
        "bootstrap call, which a job-driven /draft session uses as tickets.locked_by and passes to " +
        "every later drafting_forms__render so it keeps one identity throughout. It is deliberately not derived " +
        "from the server process: under Cowork one server is shared by every session on the machine, so a " +
        "process-derived token could not tell two sessions apart. Optional unattended true (an unattended /draft run, " +
        "which the practitioner launched and left) mints the token as sess-unattended-<hex> instead of sess-<hex>, so " +
        "the Milestone shows a job that run holds as in progress with nobody present. Also on success: bootstrapped_at, this session's " +
        "own start stamp (YYYY-MM-DD HH:mm, the same wall clock tickets.locked_at uses) -- a wip job whose " +
        "locked_at precedes it was locked before this session existed and belongs to another session whatever its " +
        "locked_by says (see /drafting-data's jobs.md section 1). And " +
        "legacy_workboard_artifact_url -- the hosted Work Board URL this matter still records, or null, whose " +
        "one-time cleanup /draft step 2 offers. Optional draft_dir (issue 585) is the absolute host path " +
        "of the matter's 0. DRAFT folder itself: bootstrap then also writes the matter's pages at its top and " +
        "returns their paths -- Litigation Strategy.html (matter_board_path), one self-contained page leading with the " +
        "matter's open to-dos, read from practice data by matter_no (ADR 0021), then one line per filing and per " +
        "proceeding with no filing (ADR 0018), and one Milestone page per live Writing and per proceeding with no " +
        "Writing, a merged board's page drawing every board merged into it as one board (ADR 0033, 2026-10-05 amendments; " +
        "drafting_data__merge_milestones): `Milestone.html` in the Writing's own folder for a board of a Writing, " +
        "and at the folder's top `Milestone - proceeding <id>.html` and `Milestone <id>.html` (a Milestone with no " +
        "Writing); a job with no filing_id is on every Writing's " +
        "page in its proceeding. milestone_paths lists them, [{filing_id, proceeding_id, path}] in page order, " +
        "filing_id null on a proceeding's page; bootstrap returns no milestone_path. Beside them it writes each view " +
        "page (ADR 0033, 2026-10-07 amendment), `<page name>.html` beside its board's page, and returns " +
        "view_page_paths [{name, filing_id, path}], null without draft_dir. A session never reads a page " +
        "(shared/html-pages.md): the board's content comes from a render naming Work_board. On success " +
        "pre_filing_proceedings lists those proceedings, [{ proceeding_id, forum }] with forum null while not yet " +
        "chosen -- render one with drafting_forms__render's proceeding_id. " +
        "Without draft_dir no page is written and matter_board_path and milestone_paths are null. A draft_dir " +
        "that is not the 0. DRAFT folder beside db_path's case data, or lies in a privileged or disclosed tree, is refused, and so is " +
        "an existing Litigation Strategy.html or Milestone page that does not carry its page's marker, before any page is " +
        "written. Each page is written atomically (temp file, then rename); a page write moves the old page files " +
        "this server wrote (a retired filing's page, a proceeding's once it has a filing, the old " +
        "single Milestone.html, per-filing boards, numbered copies, older names such as Matter Board.html) into the " +
        "matter's TRASH, reported as moved_to_trash [{from, to}], and any it could not move as trash_skipped " +
        "[{path, error}]. On success bootstrap also starts a background job " +
        "(issue 589) that renders every listed filing whose render_state is not fresh, one at a time, and rewrites " +
        "the matter's pages after each, when client_name, " +
        "client_no and matter_no were all given, and returns background_job: its status (state running, done, " +
        "stalled, aborted or idle; queued, done and failed filing ids; joined true when another job already held " +
        "the matter). Nothing waits on it, and the filing picker can be answered at once. timings carries " +
        "per-phase durations in ms, for profiling.",
      inputSchema: {
        type: "object",
        properties: {
          db_path: { type: "string" },
          client_name: { type: "string" },
          client_no: { type: "string" },
          matter_no: { type: "string" },
          draft_dir: { type: "string" },
          unattended: { type: "boolean" },
        },
        required: ["db_path"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    {
      name: formsPrefixed("open_session"),
      description:
        "Session entry from a matter folder, in one call (issue 591): proves matter_root live host-side, reads its " +
        "probanda.json for case_data_dir and derives db_path (<case_data_dir>\\submission.sqlite), looks the matter up " +
        "in practice data by the folder name's leading token, migrates the database if it is behind, and bootstraps. " +
        "Returns everything drafting_forms__bootstrap returns, plus matter_root, db_path and matter_lookup -- pass that " +
        "db_path, and matter_lookup's client_name/client_no/matter_no, to every later drafting_forms__* call. " +
        "probanda.json is read only, never rewritten: a missing, unreadable or legacy pointer refuses (code " +
        "pointer_unusable, or invalid_root when the folder or probanda.json is absent) and names /matter-data as the " +
        "repair; so does a pointer whose case_data_dir's parent folder does not exist on this device (one written " +
        "under another profile or drive). A database behind the current schema is migrated here, with the same copy-aside backup as " +
        "drafting_data__migrate, and the response carries migrated {from, to, backup}; bundle_outdated and" +
        "server_outdated are reported exactly as bootstrap reports them. A failed or empty matter lookup is never " +
        "fatal: matter_lookup.found is false with a one-line note, and a caller-supplied client_name/client_no/" +
        "matter_no always wins over the lookup's. When the case data root resolves neither from the per-user " +
        "probanda.json nor from the firm's 0. CASE DATA folder beside the matter folder, so drafting_data__create_writing would fail, the " +
        "response carries blocking [{code: practice_config_unreachable, message, remedy}], the remedy naming " +
        "practice_data__config_status and practice_data__config_set_root: the session states it and takes no job, " +
        "and read-only work goes on; nothing is written. No submission database at db_path refuses -- creating one is " +
        "drafting_data__migrate's job. It finds matter_root's one 0. DRAFT folder itself (issue 651); with that folder " +
        "it opens filing_id, or the first live filing that is not a Milestone with no Writing (one opens only when " +
        "filing_id names it), or the first pre-filing proceeding, as drafting_forms__render " +
        "with draft_dir would (mockups and the matter's pages written once), returning that board as opened " +
        "(board_summary, the short summary drafting_forms__render describes, board_changed, board_moves, " +
        "filing_retired) with matter_board_path, milestone_path (the opened filing's or proceeding's own Milestone " +
        "page; absent for a retired filing, which has none), milestone_paths (every Milestone page, as bootstrap " +
        "describes) and view_page_paths (every view page, as bootstrap describes; none is presented at the fast " +
        "open), so no " +
        "separate render is needed to open a session; with nothing to open, or when that render refused (open_refused " +
        "with its code and message), the matter's pages are still written, milestone_path is the page of the filing " +
        "or proceeding the refused render tried to open, or null with nothing to open. It " +
        "returns the folder as draft_dir (issue 689) for " +
        "every later drafting_forms__render; with no such folder nothing is opened, matter_board_path and " +
        "milestone_paths are null and " +
        "matter_board_note says why, and two or more refuse with code draft_dir_ambiguous. A session never reads " +
        "a page (shared/html-pages.md). " +
        "Like bootstrap it starts the background render job and returns background_job, and passes optional unattended " +
        "to bootstrap, which then mints an unattended-class session_token. It returns parties_drift: every party row " +
        "unlinked from case data, linked to a party not of record, or whose counsel could not be read from case data, " +
        "with parties_drift_note saying why when it could not be read; present each to the " +
        "practitioner (/draft). When a party row still holds a counsel or address-for-service value that case data " +
        "does not hold, it returns counsel_offers, one row per party and field (kind offer), or per party when the " +
        "party is unlinked, not of record or unchecked; offer each back to the practitioner to apply, discard or " +
        "hold (/draft). When its migrate is refused counsel_not_reconciled it goes on at schema version 42 without " +
        "migrating, lists the filings as usual, and returns migration_refused with the refusal beside those rows. " +
        "It returns ingest_coverage, read-only: the files not yet in the case database in the folders the " +
        "practitioner's folder map (practice_data__folder_map) gives the document types the opened filing's type " +
        "declares as its ingest inputs (opened.ingest_inputs.types), checked only when that filing has a Ready job; " +
        "status not_applicable or unavailable means the check did not run, and with no folder map it is unavailable, " +
        "saying so: offer the practitioner setup. Beside to_ingest, the paths, it returns " +
        "records, one {path, verdict, source_id, possible_version_of} per to_ingest path in the same order: " +
        "verdict none is a file with no usable record, partial a partly ingested one and failed a failed one; " +
        "source_id is the matter-data source behind the verdict, and possible_version_of the source that file may " +
        "be another version of; each is null when there is none. With status ok it also returns folders, every " +
        "folder pattern the check covered, and checked_at, when it ran (UTC); name the folders checked from " +
        "folders, never from opened.ingest_inputs alone. " +
        "When it opened a filing it returns court_file_affidavits, read-only: each affidavit the filing relies on, " +
        "matched by number and deponent code against the file names in the folder the practitioner's folder map gives court filings, with its " +
        "court_file match (file_name, date, status) or null for none found, court_file_made_on (the newest SIGNED, " +
        "AFFIRMED or SWORN name's date), and mismatch, the one board item's text when the court file and drafting " +
        "data disagree, else null. " +
        "Every response carries timings.",
      inputSchema: {
        type: "object",
        properties: {
          matter_root: { type: "string" },
          client_name: { type: "string" },
          client_no: { type: "string" },
          matter_no: { type: "string" },
          unattended: { type: "boolean" },
          filing_id: { type: "integer" },
        },
        required: ["matter_root"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    {
      name: formsPrefixed("emit_form32"),
      description:
        "Emit the strict-grammar Form 32 filed face (issue #392) for one notice_of_application filing, per " +
        ".claude/skills/publish/subskills/publish-bcsc-form/references/assembly-input-contract.md (SSOT) -- the input " +
        "publish-bcsc-form's " +
        "asm32 operation hard-validates and fills into the court-ready .docx. Writes nothing to disk; returns " +
        "{ file_name: 'form-32.md', markdown, warnings }; a lenient emit's warnings also name each Part 2 fact with no " +
        "court record, whose evidence reference names no document. The caller writes the markdown to the matter's substance folder " +
        "({matter-data folder}/bcsc-form-substance/form-32.md) and then invokes /publish with publish-bcsc-form and " +
        "the explicit asm32 token -- this tool never writes there itself, because the contract gives the emitter the " +
        "content and the caller the file's placement. Exception (ADR 0025): given optional case_data_folder, the absolute " +
        "host path of the matter's matter-data folder (the folder holding db_path; anything else is refused), the server " +
        "also writes the markdown to <case_data_folder>\\bcsc-form-substance\\form-32.md itself, creating only that " +
        "subfolder, and returns written_path -- use it in Cowork, where the session's own write lands in its sandbox. On a drafting filing with party drift it refuses as render's filed mode does (parties_drift_gate_failed). Refuses on a filing that isn't notice_of_application, on an empty Part 2 " +
        "with no pure-law decision of counsel recorded (filings.pure_law_on, schema v49), when Part 2 facts and that " +
        "decision coexist, and on a database ahead of the installed bundle's schema (bundle_outdated true, same as render/bootstrap). " +
        "Every call also returns the publish sidecar asm32 reads for the caption and the NOT FINAL cover page " +
        "(publish_file_name 'form-32-publish.json', publish_json, and publish_path when case_data_folder wrote it beside " +
        "form-32.md) and warnings: [{kind: missing_datum | unmet_criterion | other, field_or_id, message}], the cover's " +
        "lines, the filing's unmet completion criteria and open gate steps among them. lenient: true (the publish route) " +
        "never refuses for missing data: an undetermined associate judge, a NULL proposed hearing, time estimate or " +
        "courthouse, an empty Part 2 with no pure-law decision, no deployed order, a missing citation and an unplaced fact " +
        "each print a placeholder or are left out, and come back as warnings. It still refuses on party drift, on Part 2 " +
        "facts together with a pure-law decision, and on bundle_outdated. cover_notes: lines the session adds to the cover, " +
        "such as the practitioner's words asking for the document.",
      inputSchema: {
        type: "object",
        properties: {
          db_path: { type: "string" },
          filing_id: { type: "number" },
          case_data_folder: { type: "string" },
          lenient: { type: "boolean" },
          cover_notes: { type: "array", items: { type: "string" } },
        },
        required: ["db_path", "filing_id"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    {
      name: formsPrefixed("emit_bcca_book"),
      description:
        "Emit the response-book and Book of Authorities data for one bcca_stay_response or bcca_factum filing, per " +
        ".claude/skills/publish/subskills/publish-bcca-book/references/bcca-book-contract.md (SSOT) -- /publish " +
        "with publish-bcca-book fills this into the court-ready Word documents: four for a stay response (the Response " +
        "Book's cover page and table of contents, the Book of Authorities' cover page and table of contents), and for a " +
        "factum the two Book of Authorities documents alone, since a factum has no response-book half. " +
        "Writes nothing to disk; returns { file_name: 'bcca-book.md', markdown }. The caller writes the markdown " +
        "to the filing's substance folder ({matter-data folder}/bcca-book-substance/bcca-book.md for a stay " +
        "response, .../bcca-factum-substance/bcca-book.md for a factum) and " +
        "then invokes /publish with publish-bcca-book -- this tool never writes there itself, because the contract gives " +
        "the emitter the content and the caller the file's placement. On a drafting filing with party drift it refuses as render's filed mode does (parties_drift_gate_failed). Refuses on a filing that is neither bcca_stay_response nor bcca_factum, on missing " +
        "cover-critical data (file_number, registry, an Appellant/Respondent party pair, fewer than two party " +
        "groups, or no party flagged as the client -- naming the specific field), and on a database ahead of the " +
        "installed bundle's schema (bundle_outdated true, same as render/bootstrap/emit_form32/emit_form33).",
      inputSchema: {
        type: "object",
        properties: {
          db_path: { type: "string" },
          filing_id: { type: "number" },
        },
        required: ["db_path", "filing_id"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    {
      name: formsPrefixed("emit_bcca_factum"),
      description:
        "Emit the respondent's factum filed face for one bcca_factum filing, per " +
        ".claude/skills/publish/subskills/publish-bcca-factum/references/bcca-factum-contract.md (SSOT) -- /publish " +
        "with publish-bcca-factum fills it into the court's respondent's factum template. dated_on " +
        "(YYYY-MM-DD) is the date the factum is dated; it is never stored. Writes nothing to disk; returns " +
        "{ file_name: 'bcca-factum.md', markdown }. The caller writes the markdown to " +
        "{matter-data folder}/bcca-factum-substance/bcca-factum.md and then invokes /publish with publish-bcca-factum. " +
        "On a drafting filing with party drift it refuses as render's filed mode does (parties_drift_gate_failed). Refuses on a filing that isn't bcca_factum, on missing content (file_number, an Appellant/Respondent " +
        "party pair, the client party, chronology, opening statement, place of signing, Part 1, a deployed " +
        "submission, an order sought, a citation, or an enactment excerpt -- naming it), and on a database ahead " +
        "of the installed bundle's schema (bundle_outdated true).",
      inputSchema: {
        type: "object",
        properties: {
          db_path: { type: "string" },
          filing_id: { type: "number" },
          dated_on: { type: "string" },
        },
        required: ["db_path", "filing_id", "dated_on"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    {
      name: formsPrefixed("emit_form33"),
      description:
        "Emit the strict-grammar Form 33 filed face (issue #386) for one application_response filing, per " +
        ".claude/skills/publish/subskills/publish-bcsc-form/references/assembly-input-contract.md (SSOT) -- the input " +
        "publish-bcsc-form's " +
        "asm33 operation hard-validates and fills into the court-ready .docx. Writes nothing to disk; returns " +
        "{ file_name: 'form-33.md', markdown }. The caller writes the markdown to the matter's substance folder " +
        "({matter-data folder}/bcsc-form-substance/form-33.md) and then invokes /publish with publish-bcsc-form and " +
        "the explicit asm33 token -- this tool never writes there itself, because the contract gives the emitter the " +
        "content and the caller the file's placement. Exception (ADR 0025): given optional case_data_folder, the absolute " +
        "host path of the matter's matter-data folder (the folder holding db_path; anything else is refused), the server " +
        "also writes the markdown to <case_data_folder>\\bcsc-form-substance\\form-33.md itself, creating only that " +
        "subfolder, and returns written_path -- use it in Cowork, where the session's own write lands in its sandbox. On a drafting filing with party drift it refuses as render's filed mode does (parties_drift_gate_failed). Refuses on a filing that isn't application_response, on any opposing order " +
        "with no position taken, on an empty Part 4 with no pure-law decision of counsel recorded (filings.pure_law_on, " +
        "schema v49), when Part 4 facts and that decision coexist, and on a database ahead of the installed bundle's schema (bundle_outdated true, " +
        "same as render/bootstrap/emit_form32). Returns the publish sidecar ('form-33-publish.json') and warnings as " +
        "emit_form32 does, and takes the same lenient and cover_notes: lenient, a served notice with no date, an order " +
        "with no position (left out), no time estimate, a missing citation, an empty Part 4 with no pure-law decision and " +
        "an unplaced fact become warnings. It still refuses with no served notice resolved or no position taken at all.",
      inputSchema: {
        type: "object",
        properties: {
          db_path: { type: "string" },
          filing_id: { type: "number" },
          case_data_folder: { type: "string" },
          lenient: { type: "boolean" },
          cover_notes: { type: "array", items: { type: "string" } },
        },
        required: ["db_path", "filing_id"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    {
      name: formsPrefixed("emit_affidavit"),
      description:
        "Emit the filed face of one supporting affidavit (#1487) that a notice_of_application or application_response " +
        "lists under role 'affidavit': frontmatter with the deponent, affidavit_number and the exhibit list (letter, " +
        "label, file_path), then the numbered paragraphs with each exhibit printed as **Exhibit \"A\"**, lettered " +
        "exactly as the affidavit's mockup letters it. publish-bcsc-form's Form 109 fill reads it. Writes nothing to " +
        "disk; returns { file_name: 'affidavit-<document_id>.md', markdown, revision }. Exception (ADR 0025): given " +
        "optional case_data_folder, the absolute host path of the matter's matter-data folder (the folder holding " +
        "db_path; anything else is refused), the server also writes the markdown to " +
        "<case_data_folder>\\bcsc-form-substance\\affidavit-<document_id>.md itself, creating only that subfolder, and " +
        "returns written_path -- use it in Cowork. On a drafting filing with party drift it refuses as render's filed " +
        "mode does (parties_drift_gate_failed). Refuses on any 🧩 the affidavit's mockup shows (an unlinked " +
        "paragraph, an exhibit no linked statement tenders, a tendered exhibit no affidavit in the proceeding " +
        "attaches, no deponent, no paragraphs), on a NULL affidavit_number, on a document that is not an affidavit " +
        "the filing lists, on a filing of another kind, and on a database ahead of the installed bundle's schema " +
        "(bundle_outdated true, same as emit_form32). An unsworn affidavit emits.",
      inputSchema: {
        type: "object",
        properties: {
          db_path: { type: "string" },
          filing_id: { type: "number" },
          document_id: { type: "number" },
          case_data_folder: { type: "string" },
        },
        required: ["db_path", "filing_id", "document_id"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    {
      name: formsPrefixed("bcsc_form_harness"),
      description:
        "Run one publish-bcsc-form harness command on the host (issue #1267, ADR 0025), for a Cowork session, whose " +
        "sandbox cannot reach the matter or matter-data folders. Returns the harness's own JSON output unchanged " +
        "(an action such as spawn_subagent, ask_user, retry, oow, missing_template, manual_edits, halt or done, or for list the " +
        "session array); drive it exactly as publish-bcsc-form's shuttle protocol drives the harness's CLI. " +
        "matter_root is the absolute matter folder (it must hold the matter pointer probanda.json, or the legacy coclerk.json). The server derives the matter-data " +
        "folder from probanda.json's case_data_dir (it must exist), keeps session state in " +
        "<matter-data folder>\\form-sessions, and passes the harness only paths it resolved itself. command and its " +
        "fields: list; init (user_request, and exactly one of writing_folder -- a package's one folder name, created " +
        "under the matter's 0. DRAFT folder -- or out_name -- an individual form's bare file name stem, no extension, " +
        "composed under the firm's naming convention and written at the top of that folder; and edits_reviewed: true " +
        "once the practitioner has seen a manual_edits report, so the fill writes the new copy anyway); classify and step " +
        "(harness_session, result_json); resume and abandon (harness_session); reset (harness_session, " +
        "new_request); clarify (harness_session, answer); rewind (harness_session, target_step_id). Refuses, with code " +
        "path_out_of_scope, a writing_folder, out_name or harness_session that is not one name or resolves outside the matter " +
        "or its form-sessions folder, and a session whose stored matter or matter-data folder is not this matter's " +
        "(abandon still clears it), and at an asm32/asm33 locate step a result_json whose form32_path, " +
        "form33_path or context_path is not inside the matter-data folder. Refuses the new-template operation (code new_template_refused), which writes " +
        "into the plugin's own folder. Each call has a 55 s budget; a step killed by it (a Word or LibreOffice " +
        "render) fails with code python_timeout and a message saying how to resume.",
      inputSchema: {
        type: "object",
        properties: {
          matter_root: { type: "string" },
          command: { type: "string", enum: ["list", "init", "classify", "step", "resume", "abandon", "reset", "clarify", "rewind"] },
          harness_session: { type: "string" },
          user_request: { type: "string" },
          writing_folder: { type: "string" },
          out_name: { type: "string" },
          edits_reviewed: { type: "boolean" },
          result_json: { type: "string" },
          new_request: { type: "string" },
          answer: { type: "string" },
          target_step_id: { type: "string" },
        },
        required: ["matter_root", "command"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    {
      name: formsPrefixed("publish_general"),
      description:
        "publish-general's Cowork route (issue #1268, ADR 0026): renders a general Writing's .docx on the host, since a " +
        "Cowork sandbox cannot reach the matter or matter-data folders. A Code-tab session runs fill_general.py in its own " +
        "shell instead. The server renders the filing's filed face, reads format_path (the venue's format.md knowledge path) " +
        "and, for a letterhead Writing, the firm profile itself; writes filed.json, format.json, profile.json, and letter.json " +
        "and tokens.json when given, to <matter-data folder>\\publish-general\\; then runs fill_general.py, which writes " +
        "<output_name>.docx at the top of the matter's one 0. DRAFT folder (never created), and returns its JSON line " +
        "unchanged (success, or error and detail). output_name is a bare file name stem, no extension, that the caller " +
        "composed under the firm's naming convention; a taken name gets the next \" vN\", reported as versioned_from, and " +
        "nothing is ever overwritten. letter is render_letterhead.py's payload and tokens the header/footer token values, " +
        "as publish-general composes them. matter_root is the absolute matter folder (it must hold the matter pointer probanda.json, or the legacy coclerk.json); the " +
        "matter-data folder is the one its case_data_dir names and must hold db_path. Refuses, code path_out_of_scope, an " +
        "output_name that is a path and any path resolving elsewhere. A render refusal (e.g. confirmation_gate_failed) or a " +
        "bespoke renderer comes back as { success: false, error, detail } and nothing is written or run. " +
        "55 s budget (code python_timeout).",
      inputSchema: {
        type: "object",
        properties: {
          matter_root: { type: "string" },
          db_path: { type: "string" },
          filing_id: { type: "number" },
          output_name: { type: "string" },
          format_path: { type: "string" },
          letter: { type: "object" },
          tokens: { type: "object" },
        },
        required: ["matter_root", "db_path", "filing_id", "output_name", "format_path"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    {
      name: formsPrefixed("draft_harness"),
      description:
        "/draft's host steps (issue #1453, ADR 0031), for a Cowork session, whose sandbox cannot reach the matter folder or " +
        "Outlook: one step per call, named by step, with that step's arguments. matter_root is the absolute matter folder (it " +
        "must hold the matter pointer probanda.json, or the legacy coclerk.json); write_email opens a database only to read recipients (below). step write_email is the only route for any outgoing email, in " +
        "/draft or not (skills/shared/email.md): never a mail send tool. It (output_name, subject, and to or a recipient source; optional body, folder, " +
        "cc, attachments) writes an unsent Outlook draft, <output_name>.eml with X-Unsent: 1, which Outlook opens as a new " +
        "message ready to send; nothing is sent. It goes at the top of the matter's one 0. DRAFT folder (never created), or " +
        "in folder, one folder name under it, created when absent. For an email that belongs to no matter, omit matter_root: " +
        "the draft goes under <case_data_root>\\_practice\\drafts (or folder under it), created when absent, and every " +
        "attachment must be absolute. output_name is a bare file name stem, no extension, that " +
        "the caller composed under the firm's naming convention; a taken name gets the next \" vN\", reported as " +
        "versioned_from, and nothing is ever overwritten. to (at least one) and cc are address strings, \"Name <a@b>\" or " +
        "\"a@b\". Instead of to, the step can address the email itself from case data, so no address is typed: " +
        "to_service_list: true (optional proceeding_id) is counsel of record for every party on the proceeding's service " +
        "list, read live from case data as the mockup reads it, the client's side and the forum's own addressees left out; " +
        "with no proceeding_id it is counsel across all the matter's proceedings, and the result's addressed.note says so. " +
        "filing_id is that saved Writing's own to and cc recipients; one with a bcc recipient is refused (bcc_unsupported), " +
        "because the step writes no Bcc. Either needs matter_root and db_path (the matter's drafting database), and to " +
        "with either is refused. Each lawyer is addressed once. Case data holds each lawyer's email as one value that may " +
        "list several addresses (split on ; and ,) with no role per address, so the first address goes in To and the rest " +
        "(a paralegal, an assistant) in Cc; a cc recipient's all go in Cc. The firm's cc_on_counsel_email people (firm " +
        "profile roster keys) are added to Cc, the sender left out. cc, when given, is added after them. A recipient with " +
        "no email (withdrawn counsel, a party not linked to case data) is never guessed: it is listed in " +
        "addressed.not_addressed with the reason, to tell the practitioner; when no To address is left the step refuses " +
        "(no_recipients) and writes nothing. body is plain text, and omitted or empty writes a blank draft; attachments are any host files, absolute or relative to the matter folder. From is " +
        "this machine's person in the firm roster, its name and email: with no person set, or no email on its entry, the " +
        "step refuses with { success: false, error: from_unresolved } and writes nothing; set them with " +
        "practice_data__upsert_firm_profile. The signature is the roster person's template, <case_data_root>\\_practice\\firm\\" +
        "email-signatures\\<key>.htm, when present, else Outlook's own default new-message signature for that address on " +
        "this PC, with its images inline; with neither, a plain-text draft with signature null and signature_note saying " +
        "why. body is the message only, with no closing and no name: while a signature applies, a body whose last lines " +
        "repeat the roster closing or name is refused (signoff_duplicates_signature) and nothing is written. Returns the " +
        "script's JSON line, with addressed {to, cc, not_addressed, note?} added when a recipient source was used: success with path, signature, signature_source (template, outlook or null) and " +
        "attachments [{name, size}], or error and detail (attachment_unresolved names every attachment it cannot find, " +
        "before anything is written; bad_address; signature_image_missing; signature_registry_error; " +
        "signoff_duplicates_signature). It " +
        "returns no file content. Refuses, code path_out_of_scope, an output_name or folder that is a path or resolves " +
        "elsewhere through a link; draft_dir_missing or draft_dir_ambiguous for a matter with no 0. DRAFT folder or two; " +
        "and any other step. 55 s budget (code python_timeout). " +
        "step scrutiny_review (ADR 0036; db_path, the drafting database in the matter's matter-data folder, and statement_id; " +
        "optional context_paras, paragraph numbers the practitioner names for the context extract, which when omitted are " +
        "derived from the finding's para/paras numbers less the pinpoint and returned as context_paras_derived, any the " +
        "highlight script cannot find dropped and returned as context_paras_not_found; source_path, a file the practitioner named; " +
        "proposed {authority_id?, pinpoint?, span? {start, end}}) assembles a \"Review scrutiny finding: \" job's review in one " +
        "call, reading the database without writing it: the statement and finding, with the answer file the finding names " +
        "(when it names none, the finding is written beside the extracts as plain text, \"3 finding - ....txt\", and its " +
        "path returned as finding.file); " +
        "the authority's own file, found by its recorded path, else a hash search of 6. LAW then the matter, else source_path, " +
        "and converted to PDF by Word into %LOCALAPPDATA%\\Coclerk\\scrutiny-review; verbatim, the word-level check of the " +
        "stored excerpt; and two highlighted extracts, each a PDF and a PNG per page, \"1 cited - ...\" and \"2 context - ...\", " +
        "written into 0. DRAFT\\Scrutiny review\\statement <id>\\ (created when absent; only this step's own files are " +
        "replaced, and any other file there is left as it is and listed in foreign_files), with proposed adding the same for a proposed authority, pinpoint or excerpt span, and " +
        "model_only.proposed_excerpt, the span's text for the gatekeeper write and never for chat. It never returns the " +
        "stored excerpt, and refuses with { success: false, error, detail, partial? }: statement_not_found, " +
        "proposed_authority_not_found, no_excerpt, authority_ambiguous, source_unresolved (partial: statement, finding, and " +
        "the paths tried and folders searched), converter_missing, conversion_failed, highlight_failed, " +
        "budget_exceeded (the conversion is cached: call again).",
      inputSchema: {
        type: "object",
        properties: {
          step: { type: "string", enum: ["write_email", "scrutiny_review"] },
          matter_root: { type: "string" },
          output_name: { type: "string" },
          folder: { type: "string" },
          to: { type: "array", items: { type: "string" } },
          cc: { type: "array", items: { type: "string" } },
          to_service_list: { type: "boolean" },
          proceeding_id: { type: "number" },
          filing_id: { type: "number" },
          subject: { type: "string" },
          body: { type: "string" },
          attachments: { type: "array", items: { type: "string" } },
          db_path: { type: "string" },
          statement_id: { type: "number" },
          context_paras: { type: "array", items: { type: "number" } },
          source_path: { type: "string" },
          proposed: {
            type: "object",
            properties: {
              authority_id: { type: "number" },
              pinpoint: { type: "string" },
              span: {
                type: "object",
                properties: { start: { type: "string" }, end: { type: "string" } },
                required: ["start", "end"],
                additionalProperties: false,
              },
            },
            additionalProperties: false,
          },
        },
        required: ["step"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    {
      name: formsPrefixed("read_message"),
      description:
        "/draft's reply route (references/reply.md): reads one Outlook .msg or .eml in a matter, with its highlights. " +
        "Read-only. matter_root is the absolute matter folder (it must hold the matter pointer probanda.json, or the legacy coclerk.json). Give exactly one of path (the " +
        "message, relative to the matter folder or absolute inside it) or from (a case-insensitive part of the sender's name " +
        "or address: every .msg and .eml in the matter is scanned, and the newest by sent time is read, with up to five " +
        "other_candidates {path, from, to, cc, subject, sent}). Returns path (matter-relative), from, to, cc, subject, sent " +
        "(ISO UTC, null when the message carries no time), body (plain text, at most 100,000 characters, body_truncated " +
        "when cut), attachments [{name, size}], highlights [{text, colour}] verbatim in document order with the colour " +
        "named as Word's highlighter names it (yellow, bright green, turquoise...; else #rrggbb), and highlight_source " +
        "(html, rtf or none: a plain-text-only message carries no highlights). A date or response time in the body is " +
        "message content, never a drafting input (shared/deadline-isolation.md). Never reads a 0. DRAFT (when scanning), " +
        "TRASH, 0. CASE DATA, privileged or disclosed folder, or a link leading out of the matter. Refuses: " +
        "path_out_of_scope, not_found, unsupported_extension (not .msg or .eml), not_a_message, no_match.",
      inputSchema: {
        type: "object",
        properties: {
          matter_root: { type: "string" },
          path: { type: "string" },
          from: { type: "string" },
        },
        required: ["matter_root"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    {
      name: formsPrefixed("reply_draft"),
      description:
        "/draft's reply route (references/reply.md, ADR 0040): a reply to the tribunal or counsel is a plain markdown file " +
        "at the top of the matter's one 0. DRAFT folder, never a Writing. matter_root is the absolute matter folder (it " +
        "must hold the matter pointer probanda.json, or the legacy coclerk.json). step save (name, text) writes text as <name>.md, or at the next free \" vN\" when taken, " +
        "and returns { success, path, version }; name is the bare stem the caller composed under the firm's naming " +
        "grammar, \"YYYY-MM-DD CODE Recipient re Subject\" (e.g. ET), with no extension and no \" vN\". step export_docx " +
        "(path, a saved .md at the top of that folder, by file name or absolute path) writes <same stem>.docx beside it, " +
        "or the next free \" vN\" (reported as versioned_from), and returns { success, path, source }: Calibri 11, no " +
        "letterhead, **bold** (a run-in heading when it opens a paragraph), *italic* or _italic_, \"> \" quotations " +
        "indented both sides, \"- \" and \"1. \" lists, line breaks kept; it pastes into Outlook with that formatting. " +
        "Nothing is ever overwritten and nothing is sent. Refuses: path_out_of_scope (a name or path that is a path, or " +
        "resolves outside the draft folder), draft_dir_missing, draft_dir_ambiguous, and any other step.",
      inputSchema: {
        type: "object",
        properties: {
          step: { type: "string", enum: ["save", "export_docx"] },
          matter_root: { type: "string" },
          name: { type: "string" },
          text: { type: "string" },
          path: { type: "string" },
        },
        required: ["step", "matter_root"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    {
      name: formsPrefixed("publish_bcca_factum"),
      description:
        "publish-bcca-factum's Cowork route (issue #1268, ADR 0026): renders a bcca_factum filing's .docx on the host, since " +
        "a Cowork sandbox cannot reach the matter or matter-data folders. A Code-tab session runs fill_factum.py in its own " +
        "shell instead. The server calls the factum emitter with dated_on (YYYY-MM-DD) itself, writes bcca-factum.md " +
        "verbatim to <matter-data folder>\\bcca-factum-substance\\, runs fill_factum.py --validate and then the fill, which " +
        "writes <output_name>.docx at the top of the matter's one 0. DRAFT folder (never created), and returns the JSON line " +
        "of the first run that refuses, else the fill's, unchanged. output_name is a bare file name stem, no extension, that " +
        "the caller composed under the firm's naming convention; a taken name gets the next \" vN\", reported as " +
        "versioned_from, and nothing is ever overwritten. matter_root and db_path are confined as for publish_general, and " +
        "an output_name that is a path is refused (code path_out_of_scope). An emitter refusal " +
        "(bundle_outdated) comes back as { success: false, error, detail }; a missing-content refusal is this tool's error. " +
        "55 s budget (code python_timeout).",
      inputSchema: {
        type: "object",
        properties: {
          matter_root: { type: "string" },
          db_path: { type: "string" },
          filing_id: { type: "number" },
          output_name: { type: "string" },
          dated_on: { type: "string" },
        },
        required: ["matter_root", "db_path", "filing_id", "output_name", "dated_on"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    {
      name: formsPrefixed("publish_vaniac_package"),
      description:
        "publish-vaniac-package's Cowork route (issue #1268, ADR 0026): renders a VanIAC exchange package's .docx files on " +
        "the host, since a Cowork sandbox cannot reach the matter or matter-data folders. A Code-tab session runs " +
        "fill_vaniac.py in its own shell instead. writing_folder is the filing's own folder, named after it, with or " +
        "without a leading YYYY-MM-DD, under the matter's one 0. DRAFT folder. Before writing anything the server refuses " +
        "(output_exists) while its Package folder holds Index.docx or any Written Argument of the * or Witness Statement of * " +
        "file, PDFs included. It then renders the filed face, writes Written Arguments.md, Evidence Index.md and each " +
        "Witness Statement - <name>.md verbatim to <matter-data folder>\\vaniac-submissions\\<filing folder>\\, runs " +
        "fill_vaniac.py with round and one --witness per witness statement rendered, and returns its JSON line unchanged. " +
        "matter_root and db_path are confined as for publish_general (code path_out_of_scope). A render refusal comes back " +
        "as { success: false, error, detail } and nothing is written or run. 55 s budget (code python_timeout).",
      inputSchema: {
        type: "object",
        properties: {
          matter_root: { type: "string" },
          db_path: { type: "string" },
          filing_id: { type: "number" },
          writing_folder: { type: "string" },
          round: { type: "string", enum: ["opening", "response", "reply", "non-participation"] },
        },
        required: ["matter_root", "db_path", "filing_id", "writing_folder", "round"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    {
      name: formsPrefixed("assemble_general"),
      description:
        "assemble-general's Cowork route (issue #1321, ADR 0027): binds a general Writing's .docx and its enclosures into " +
        "one PDF on the host, since a Cowork sandbox has neither PyMuPDF nor Word and cannot reach the matter or matter-data " +
        "folders. A Code-tab session runs bind_general.py in its own shell instead. docx_name is the Writing's .docx and " +
        "pdf_name the PDF, each a bare file name at the top of the matter's one 0. DRAFT folder; pdf_name defaults to the " +
        ".docx name with \" UNSIGNED.pdf\". enclosures are bound in order after the Writing, each bookmarked by its label: " +
        "path is any host file (absolute, or relative to the matter folder), a PDF, .docx or image, and pages is one page " +
        "(\"4\") or a range (\"2-5\") of a PDF. The server writes enclosures.json to <matter-data folder>\\assemble-general\\, " +
        "runs bind_general.py --manifest, and returns its JSON line unchanged: success with output, page_count and bookmarks, " +
        "or error and detail (enclosure_unresolved names every enclosure it cannot bind, before anything is bound; " +
        "output_exists when pdf_name is taken, nothing is ever overwritten; docx_missing; docx_conversion_failed). It returns " +
        "no file content. matter_root is confined as for publish_general, and the matter-data folder is the one its " +
        "probanda.json names; the tool never opens the matter's database. A docx_name or pdf_name that is a " +
        "path, or resolves elsewhere through a link, is refused (code path_out_of_scope). 55 s budget (code python_timeout).",
      inputSchema: {
        type: "object",
        properties: {
          matter_root: { type: "string" },
          docx_name: { type: "string" },
          pdf_name: { type: "string" },
          enclosures: {
            type: "array",
            items: {
              type: "object",
              properties: { label: { type: "string" }, path: { type: "string" }, pages: { type: "string" } },
              required: ["label", "path"],
              additionalProperties: false,
            },
          },
        },
        required: ["matter_root", "docx_name", "enclosures"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    {
      name: formsPrefixed("pre_filing_check"),
      description:
        "The pre-filing consistency gate (issue #615): deterministic, read-only checks of one filing's assembled " +
        "package folder -- every file in package_dir (PDF via host pypdf, DOCX via zipfile; pypdf missing is a hard " +
        "error, never a pass) against each other and against the filing's own Evidence Index rows. Checks: C1 exhibit " +
        "numbering cross-check, C2 unresolved-placeholder scan (signed documents flagged high), C3 figure consistency " +
        "(amounts against the filing's orders sought, dates against its Index dates), C4 party-name and file-number " +
        "variants against the recorded parties and file number, C5 execution completeness (date, signer and e-signature audit status of every " +
        "signed document or recorded witness statement/affidavit), C6 exhibit file sanity (page count per exhibit, " +
        "package total). Returns { checks: [{ id, title, status " +
        "pass|fail|n/a, findings: [{ document, page, quote, problem, conflict?, severity }] }], index, package_total_pages, " +
        "package_files }. Each finding quotes the offending line verbatim so it can be presented per /show-me. " +
        "Writes nothing: the gate reports, a job fixes. package_dir must be an absolute folder beneath the matter's " +
        "0. DRAFT folder, never inside privileged/ or disclosed/. Refuses a retired filing and a database ahead of the " +
        "installed bundle's schema (bundle_outdated true). The authoritative check list is " +
        ".claude/skills/drafting-data/references/pre-filing-checks.md.",
      inputSchema: {
        type: "object",
        properties: {
          db_path: { type: "string" },
          filing_id: { type: "number" },
          package_dir: { type: "string" },
        },
        required: ["db_path", "filing_id", "package_dir"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
  ];
}
