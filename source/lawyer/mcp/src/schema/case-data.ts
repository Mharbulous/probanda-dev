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
        "Only the /matter-data skill may call this tool -- you satisfy that by invoking it (Skill: lawyer:matter-data) and following the operation file it routes you to, which directs you to call this tool yourself, whatever skill you started in.",
      inputSchema: objectSchema([
        { name: "matter_root", type: "str" },
        { name: "sql_script", type: "str" },
      ], ["matter_root", "sql_script"]),
      annotations: { destructiveHint: true, openWorldHint: false },
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
      name: caseDataPrefixed("ingest_authority"),
      description:
        "Write one extracted legal authority from the extractor's result file: the authority row, its concepts, any determined-by stub concepts, the concept links and the criteria, in one transaction, then regenerate evidence.sql. result_path is the scratch file holding exactly the extractor's JSON object; file_path is the authority's file relative to the matter root and file_hash its SHA-256; bundled_pages is given only for an entry of a bundled book of authorities (e.g. '12-34'). " +
        "Returns ok true with authority_id, counts per table (inserted, skipped), stubs (each stub concept created) and the result's own treats_prior, which this tool does not write. Returns ok false with problems, and writes nothing, when the result fails a check or the file_hash is already registered under another citation. Re-running it on the same file inserts nothing. Never sets last_verified_at. " +
        "A non-success result other than ok false does not prove nothing committed: re-read with matter_data__query before any retry, as for matter_data__execute. " +
        "Only the /matter-data skill may call this tool -- you satisfy that by invoking it (Skill: lawyer:matter-data) and following its operations/ingest-extract.md Path D, which directs you to call this tool yourself, whatever skill you started in.",
      inputSchema: objectSchema([
        { name: "matter_root", type: "str" },
        { name: "result_path", type: "str" },
        { name: "file_path", type: "str" },
        { name: "file_hash", type: "str" },
        { name: "bundled_pages", type: "str" },
      ], ["matter_root", "result_path", "file_path", "file_hash"]),
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
