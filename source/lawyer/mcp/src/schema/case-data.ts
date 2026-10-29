import { type ToolDefinition, objectSchema, SQL_PARAMS } from "./shared.js";

function caseDataPrefixed(name: string): string {
  return `matter_data__${name}`;
}

// matter-data connection-discipline surface (permission-fatigue conversion,
// handover 123B, plan D2(a)). SQL and schema stay authored inside the
// /matter-data skill; this backend holds no table or column names. `query` and
// `execute` are generic primitives; `migrate` is a runner whose migration SQL
// and upgrade functions likewise live in the skill (references/migrations.sql,
// references/scripts/), reached over PYTHONPATH and never embedded here.
// Only the /matter-data skill may call these tools -- see the per-tool description
// suffixes below for how a caller from another skill's workflow satisfies that.
export function caseDataToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: caseDataPrefixed("query"),
      description:
        "Run a read-only SELECT/WITH/PRAGMA statement against a matter's attached main+law+privileged databases. Only the /matter-data skill may call this tool -- you satisfy that by invoking it (Skill: lawyer:matter-data) and following the operation file it routes you to, which directs you to call this tool yourself, whatever skill you started in.",
      inputSchema: {
        type: "object",
        properties: {
          matter_root: { type: "string" },
          sql: { type: "string" },
          params: SQL_PARAMS,
        },
        required: ["matter_root", "sql"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    {
      name: caseDataPrefixed("execute"),
      description:
        "Run a write SQL script against a matter's attached main+law+privileged databases in a single transaction, then regenerate evidence.sql. The tool loads the cross-database FK layer itself from the /matter-data skill's references/triggers.sql on every call and refuses to write without it -- do not send it. " +
        "A non-success result (error, rejection, timeout, no response) does not prove the script did not commit: the transaction commits and the databases are committed to storage before evidence.sql is regenerated, and a rejection or give-up after dispatch never reaches the backend at all. Re-read what the script targeted with matter_data__query before any further write or retry -- see /matter-data's shared/conventions.md section 2.3. " +
        "run_id, given only inside an ingest run, must be the matter's live run (matter_data__ingest_run): otherwise the call is refused lease_lost and writes nothing; a write that carries it renews the run's heartbeat. In a run the ingest orchestrator began (begin with orchestrator true), an inline sql_script over 8 KB is refused, writing nothing: 'too long to send inline: use a generator or ingest_result'. In any other run, and without run_id, the call is unchanged. " +
        "Give sql_script or generator, never both. generator {script, args} has the server emit the script itself, so no SQL passes through the session: script supersede_draft.py with args.command emit-sql ({superseded, kept, approver, execution_status?}: one side a source_id, the other {file_path, file_hash} for a copy with no row; the server reads the pair and plans the fold itself) or rehash-sql ({old, new, file_path}). Any other script, command or pair is refused. " +
        "Only the /matter-data skill may call this tool -- you satisfy that by invoking it (Skill: lawyer:matter-data) and following the operation file it routes you to, which directs you to call this tool yourself, whatever skill you started in.",
      inputSchema: {
        type: "object",
        properties: {
          matter_root: { type: "string" },
          sql_script: { type: "string" },
          generator: {
            type: "object",
            properties: {
              script: { type: "string" },
              args: { type: "object" },
            },
            required: ["script", "args"],
            additionalProperties: false,
          },
          run_id: { type: "string" },
        },
        required: ["matter_root"],
        additionalProperties: false,
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    {
      name: caseDataPrefixed("ingest_run"),
      description:
        "One ingestion per matter at a time: the run lease and journal, kept on this computer outside the matter. " +
        "action begin (mode attended or unattended; orchestrator true only from the /ingest-orchestrator skill) starts a run and returns {ok, run_id, resumed, next, asked?, path_b?, report?: lines to relay}; pass run_id on every matter_data__execute of the run. While another run's heartbeat is under 60 minutes old it returns {ok: false, refused: run_active, run_id, say} naming that run. With orchestrator true, a run left unfinished with results still to record, however old its heartbeat, returns {ok: false, refused: run_unfinished, run_id, say} naming it to resume; any other caller takes it over and is told in report. " +
        "begin with resume (an unfinished run's run_id) takes that run over at once with a new run_id, and with orchestrator true makes it the orchestrator's run; after 60 minutes without a heartbeat a plain begin takes over too, but for run_unfinished above. The displaced holder's next call is refused lease_lost. resume naming no unfinished run is refused unknown_run. " +
        "action status returns the matter's run {active, run_id, started, heartbeat, mode, ended, next, asked?, path_b?}; with run_id it also renews the heartbeat; with run_id and ack (an extractor's failed reply line, or the ok line of a dispatch whose contract is null) it records that reply, whose ref must be one this run dispatched. action end (run_id) finishes the run and returns {ok, run_id, report?}. " +
        "action next (run_id; routes the first time each file is routed, each {file_path, file_hash, kind facts|notice_of_application|affidavit|path_b, rendering?, execution?, witness?, answers_source_id?, category?, proceeding_id?}; bridged true in a bridged session) returns {ok, routed?: the routed files' refs in order (f1, f2, ...), report?: lines to relay, dispatch: [{dispatch_id, agent, model, effort, ref, contract, stage?}] to start, each with the one-line prompt DISPATCH <dispatch_id>, write: [{ref, contract, result_ids}] acknowledged results still to write, close: [{ref, contract}] items to close with result_ids [], asked?: [{ref, contract, result_ids}] writes waiting for the practitioner's answer, never to repeat until it is given, path_b?: [{ref, file_path}] documents for the session to read itself (routed path_b, or refused path_b) until their privileged write, running, more?}. Pass a write or close line's ref to ingest_result as document.ref. A file routed again, or another file with the same bytes, keeps the first ref. The run's work is done when dispatch, write and close are empty and running is 0. At most 10 extractors run at once. A dispatch line without its stage list, and a close line, is at most 200 bytes; a write line adds about 40 bytes per result_id, and stage about 120 bytes per path. A page is at most 50 lines. " +
        "action staged (run_id, dispatch_id, paths) records a bridged session's copies of a dispatch's stage list, in its order. " +
        "Every call carrying run_id renews the heartbeat. A refusal writes nothing; relay its say to the practitioner, never the code. A call refused plugin_changed means the plugin was updated mid-run: in a run the /ingest-orchestrator skill drives, stop without end, and after a restart resume the run (status, then begin with resume); any other caller ends the run as its operation says. " +
        "Only the /matter-data skill and the /ingest-orchestrator skill may call this tool -- invoke one (Skill: lawyer:matter-data or lawyer:ingest-orchestrator) and follow it, whatever skill you started in.",
      inputSchema: {
        type: "object",
        properties: {
          matter_root: { type: "string" },
          action: { type: "string", enum: ["begin", "next", "staged", "status", "end"] },
          run_id: { type: "string" },
          resume: { type: "string" },
          mode: { type: "string", enum: ["attended", "unattended"] },
          orchestrator: { type: "boolean" },
          routes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                file_path: { type: "string" },
                file_hash: { type: "string" },
                kind: { type: "string", enum: ["facts", "notice_of_application", "affidavit", "path_b"] },
                rendering: { type: "string" },
                execution: { type: "string", enum: ["draft", "affirmed", "filed"] },
                witness: { type: "string", enum: ["fact", "expert"] },
                answers_source_id: { type: "integer" },
                category: { type: "string", enum: ["court", "correspondence", "production", "work_product", "disbursements"] },
                proceeding_id: { type: "integer" },
              },
              required: ["file_path", "file_hash", "kind"],
              additionalProperties: false,
            },
          },
          bridged: { type: "boolean" },
          ack: { type: "string" },
          dispatch_id: { type: "string" },
          paths: { type: "array", items: { type: "string" } },
        },
        required: ["matter_root", "action"],
        additionalProperties: false,
      },
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    {
      name: caseDataPrefixed("ingest_result"),
      description:
        "Write one document's extracted results from their staged result_ids, in one transaction (an affidavit's exhibits each under their own savepoint), then regenerate evidence.sql. No extraction output and no SQL pass through the session. " +
        "contract is facts, affidavit_body, affidavit_exhibits, sought_orders or privileged; document is {ref, store} for a file routed in this run (the ref of its dispatch, write, close or path_b line, as given), or {file_path (stored form), file_hash, store} for a Path B document; store is privileged only for a privileged contract answered yes; result_ids are the ids from the extractors' ok lines: one result named by its dispatch line's ref, or the result_ids of a write line, each already acknowledged (a call of several that holds an unacknowledged id is an error); [] closes an item whose extraction failed twice. answers carries the practitioner's answers to an earlier call's ask: privilege (yes, no or unclear, any case, required for privileged, whose call takes exactly one result), category, proceeding_id, participants {name as extracted: party_id, or 0 for a filing party that is none of the parties}, informants {locator: privileged source id, or 0 when it came from no document on file} for a privileged informant. " +
        "Returns at most 600 bytes: {outcome written|already_written|refused, refused?, source_id, counts {facts, positions, relief, links, exhibits}, items [{ref, outcome, reason}] for items that failed, ask [{kind, ref, say}], post [{pass, ref}] after-completion passes to run, report [lines]}. Relay report lines and ask the ask items in plain words; never show refused, reason or ref. A repeated call is safe: it returns already_written. refused waiting means call again once next lists it; path_b means read the document as Path B; set_aside, race and store_change mean set it aside for /ingest. A result that cannot be read, or belongs to another contract, file or item than its reply, is refused and its item alone read once more. dropped counts ask or items entries left out to keep the cap: a repeated call lists them. " +
        "Refuses without the live run_id (lease_lost) or after a plugin update (plugin_changed). " +
        "Only the /ingest-orchestrator skill may call this tool -- invoke it (Skill: lawyer:ingest-orchestrator) and follow it, whatever skill you started in.",
      inputSchema: {
        type: "object",
        properties: {
          matter_root: { type: "string" },
          run_id: { type: "string" },
          document: {
            type: "object",
            properties: {
              ref: { type: "string" },
              file_path: { type: "string" },
              file_hash: { type: "string" },
              store: { type: "string", enum: ["main", "privileged"] },
            },
            required: ["store"],
            additionalProperties: false,
          },
          contract: { type: "string", enum: ["facts", "affidavit_body", "affidavit_exhibits", "sought_orders", "caselaw", "provision", "efiling_statement", "register_only", "privileged"] },
          result_ids: { type: "array", items: { type: "string" } },
          answers: {
            type: "object",
            properties: {
              privilege: { type: "string", enum: ["yes", "no", "unclear"] },
              category: { type: "string", enum: ["court", "correspondence", "production", "work_product", "disbursements", "privileged", "authority"] },
              proceeding_id: { type: "integer" },
              participants: { type: "object", additionalProperties: { type: "integer" } },
              informants: { type: "object", additionalProperties: { type: "integer" } },
            },
            additionalProperties: false,
          },
        },
        required: ["matter_root", "run_id", "document", "contract", "result_ids"],
        additionalProperties: false,
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    {
      name: caseDataPrefixed("dispatch_inputs"),
      description:
        "An extraction agent's first call: the inputs stored for its dispatch (PAGE_MANIFEST or RENDERING, DOCUMENT, MATTER_CONTEXT, ANSWERED_FACTS and ANSWERED_RELIEF for a response, PASS, PAGE_RANGE and EXHIBIT_LETTER for an affidavit pass, ITEMS and CONTRACT). dispatch_id is the id in the agent's prompt line DISPATCH <dispatch_id>. Read-only. " +
        "Only an extraction agent dispatched with DISPATCH <dispatch_id> may call this tool.",
      inputSchema: objectSchema([{ name: "dispatch_id", type: "str" }], ["dispatch_id"]),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    {
      name: caseDataPrefixed("resolve_participant"),
      description:
        "Resolve a name, surname or file-name code (e.g. SmithJ) to the matter's participants it could mean -- parties, counsel, witnesses, experts and tribunal members -- each with every name, alias and file code on record (search_terms). Exact matches first; a surname within two edits is returned as match 'near' with its distance and is never an identity. Read-only. Only the /matter-data skill may call this tool -- you satisfy that by invoking it (Skill: lawyer:matter-data) and following its operations/participants.md, which directs you to call this tool yourself, whatever skill you started in.",
      inputSchema: objectSchema([
        { name: "matter_root", type: "str" },
        { name: "name", type: "str" },
      ], ["matter_root", "name"]),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    {
      name: caseDataPrefixed("stage_result"),
      description:
        "Hand an extractor's result to the host: result is exactly the JSON object of the extractor's output contract. Stores it on this computer, outside any matter, and returns {result_id, bytes}: the id to reply with, and the byte count of what was stored. Writes no other file and reads no matter. " +
        "Only an extraction agent whose dispatch tells it to stage its result may call this tool.",
      inputSchema: {
        type: "object",
        properties: { result: { type: "object" } },
        required: ["result"],
        additionalProperties: false,
      },
      annotations: { openWorldHint: false },
    },
    {
      name: caseDataPrefixed("ingest_authority"),
      description:
        "Write one extracted legal authority from the extractor's staged result: the authority row, its concepts, any determined-by stub concepts, the concept links and the criteria, in one transaction, then regenerate evidence.sql. result_id is the id matter_data__stage_result returned to the extractor; file_path is the authority's file relative to the matter root and file_hash its SHA-256; bundled_pages is given only for an entry of a bundled book of authorities (e.g. '12-34'). " +
        "Returns ok true with authority_id, counts per table (inserted, skipped), stubs (each stub concept created) and the result's own treats_prior, which this tool does not write. Returns ok false with problems, and writes nothing, when the result fails a check or the file_hash is already registered under another citation. Re-running it on the same file inserts nothing. Never sets last_verified_at. " +
        "A non-success result other than ok false does not prove nothing committed: re-read with matter_data__query before any retry, as for matter_data__execute. " +
        "Only the /matter-data skill may call this tool -- you satisfy that by invoking it (Skill: lawyer:matter-data) and following its operations/ingest-extract.md Path D, which directs you to call this tool yourself, whatever skill you started in.",
      inputSchema: objectSchema([
        { name: "matter_root", type: "str" },
        { name: "result_id", type: "str" },
        { name: "file_path", type: "str" },
        { name: "file_hash", type: "str" },
        { name: "bundled_pages", type: "str" },
      ], ["matter_root", "result_id", "file_path", "file_hash"]),
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    {
      name: caseDataPrefixed("relocate_source"),
      description:
        "After a file was moved or renamed, re-point every stored record of it (all three stores, found by its hash) so it names where the file now is: /matter-data's operations/relocate-source.md as one call. hash is the lowercase hex SHA-256 of the file's bytes; store is the store ingest-status reported for it (main, privileged or law); old_path and new_path are where the file was and is, in stored form (relative to the matter root, backslash separators). The matter folder it checks for a twin copy is matter_root on this host. Moves no file. " +
        "Returns {outcome, stored_path, rows, reason}: outcome relocated (written, then confirmed by a fresh read), already_current (nothing to write), or failed with reason no_rows, twin_at_stored_path (both write nothing) or write_not_confirmed (with rows_now, as read after the write). rows are {store, id, was, action}, action moved, already or left. Running it twice is safe. " +
        "/housekeeping's apply step calls it directly with an approved row's values. Any other caller goes through the /matter-data skill -- invoke it (Skill: lawyer:matter-data) and follow its operations/relocate-source.md, which directs you to call this tool yourself, whatever skill you started in.",
      inputSchema: {
        type: "object",
        properties: {
          matter_root: { type: "string" },
          hash: { type: "string" },
          store: { type: "string", enum: ["main", "privileged", "law"] },
          old_path: { type: "string" },
          new_path: { type: "string" },
        },
        required: ["matter_root", "hash", "store", "old_path", "new_path"],
        additionalProperties: false,
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    {
      name: caseDataPrefixed("housekeeping_log"),
      description:
        "Write the /housekeeping review log: /matter-data's operations/housekeeping-log.md modes record and retry, one call and one transaction per batch, then regenerate evidence.sql. " +
        "mode record takes entries, each {file_name, file_hash, folder_type, outcome}: outcome renamed, manual_review or not_ingested records a settled verdict (folder_type required); outcome ingest_failed records a failed ingest and also takes reason (one sentence) and failure_class (deterministic or extractor), folder_type null for a root file, and sets whether the next run retries it by the operation's counting rule. Returns {ok, mode, recorded}. " +
        "mode retry takes hashes, the failed files to try reading again next run. Returns {ok, mode, updated, unmatched}, unmatched naming each hash with no remembered failure. " +
        "Entries that break those rules return {ok: false, problems} and write nothing. A non-success result other than ok false does not prove nothing committed: re-read before any retry, as for matter_data__execute. " +
        "/housekeeping's apply step calls it directly with an approved row's values. Any other caller goes through the /matter-data skill -- invoke it (Skill: lawyer:matter-data) and follow its operations/housekeeping-log.md, which directs you to call this tool yourself, whatever skill you started in.",
      inputSchema: {
        type: "object",
        properties: {
          matter_root: { type: "string" },
          mode: { type: "string", enum: ["record", "retry"] },
          entries: { type: "array", items: { type: "object" } },
          hashes: { type: "array", items: { type: "string" } },
        },
        required: ["matter_root", "mode"],
        additionalProperties: false,
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    {
      name: caseDataPrefixed("migrate"),
      description:
        "Upgrade a matter's case databases to the current schema. Two-phase and gated: " +
        "mode 'plan' dry-runs the whole migration chain on temp copies and returns a " +
        "plan_token plus the exact user_confirmation string the practitioner must approve; " +
        "mode 'apply' requires that plan_token and that confirmation, takes a host-local " +
        "backup, and commits all three databases together or none. mode 'restore' reverts " +
        "to a backup set; mode 'backups' lists them. This is the only tool that bypasses " +
        "the schema-version guard, and the only one that may run against an out-of-date " +
        "database. Run plan first, always. Only the /matter-data skill may call this tool " +
        "-- invoke it (Skill: lawyer:matter-data) and follow its operations/migrate.md, " +
        "which runs this tool through the migration-runner subagent rather than inline.",
      inputSchema: objectSchema([
        { name: "matter_root", type: "str" },
        { name: "mode", type: "str" },
        { name: "plan_token", type: "str" },
        { name: "user_confirmation", type: "str" },
        { name: "backup_id", type: "str" },
      ], ["matter_root", "mode"]),
      // destructive for every mode, including plan: pointer resolution rewrites
      // probanda.json and may move binaries out of the legacy `9. AI` folder.
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    {
      name: caseDataPrefixed("relocate"),
      description:
        "Move a matter's case data from the firm-level `0. CASE DATA\\<matter_id> <short_name>` folder into the matter's own " +
        "`0. CASE DATA` folder (ADR 0013). mode 'plan' lists the files, their sizes and the target and writes nothing. " +
        "mode 'apply' copies both pointer files aside (probanda.json.bak-<ts>, coclerk.json.bak-<ts>), copies the whole " +
        "folder into a staging folder in the matter, checks every file's sha256 and, for each .sqlite, integrity_check, " +
        "per-table row counts and user_version against its source, and only then renames the staging folder to " +
        "`0. CASE DATA` and rewrites both pointer files. It deletes nothing: the old folder is left for the practitioner " +
        "to delete. On any failure the pointer is unchanged and the staging folder stays, named in the error with the " +
        "check that failed. Refused when the case data is already in the matter folder, when the current folder has no " +
        "main.sqlite, or when the matter's `0. CASE DATA` exists and is not empty. After an apply, re-run " +
        "drafting_forms__open_session and re-plan any migration. Only the /matter-data skill may call this tool -- " +
        "invoke it (Skill: lawyer:matter-data) and follow its operations/relocate.md.",
      inputSchema: objectSchema([
        { name: "matter_root", type: "str" },
        { name: "mode", type: "str" },
      ], ["matter_root", "mode"]),
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    {
      name: caseDataPrefixed("procedural_history_append"),
      description:
        "The only way to write a matter's ProceduralHistory.md (shared/procedural-history.md), at the top of matter_root. " +
        "With date (YYYY-MM-DD, the event's date) and line (what happened, one line), it adds the bullet `- <line>` under the " +
        "`## <date>` heading, creating the file, and the heading in newest-first order, when missing; source_path (the source " +
        "file, relative to the matter folder) appends it in backticks, or told_on (YYYY-MM-DD) appends `(the practitioner, " +
        "<told_on>)` for an event the practitioner told the session. Refused, writing nothing: the same bullet already under " +
        "that heading (duplicate_entry); a line holding a date later than its heading (date_after_heading) -- record the " +
        "event without the date it sets. Optional replaces, the full text of one existing entry, removes it first: the " +
        "correction path, used only where case data contradicts the entry. With neither date nor line it stamps the file " +
        "alone (the currency check's 'no'). Every call rewrites last_updated from this host's own clock, local time with " +
        "its UTC offset. Asks nothing; never announce it. Returns {ok, path, last_updated, created, added, heading_created, " +
        "replaced}. Called by /draft and /matter-data at the writes shared/procedural-history.md names, and by any session " +
        "recording an event the practitioner told it.",
      inputSchema: objectSchema([
        { name: "matter_root", type: "str" },
        { name: "date", type: "str" },
        { name: "line", type: "str" },
        { name: "source_path", type: "str" },
        { name: "told_on", type: "str" },
        { name: "replaces", type: "str" },
      ], ["matter_root"]),
      annotations: { destructiveHint: false, openWorldHint: false },
    },
  ];
}
