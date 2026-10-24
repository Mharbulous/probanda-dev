import { type ToolDefinition, objectSchema, SQL_PARAMS } from "./shared.js";

function timecampingPrefixed(name: string): string {
  return `timecamping_data__${name}`;
}

// Timecamping-data connection-discipline surface (issue #430's evidence-first
// storage layer). Same generic query/execute/migrate pattern as
// matter_data__*/drafting_data__*: SQL and schema stay authored inside the
// /timecamping-data skill; this backend holds no table or column names. Path
// resolution is server-side and fixed (a single per-practitioner file, like
// practice.db/time_pipeline.db) -- unlike matter_data__*/drafting_data__*,
// there is no matter_root/db_path parameter to pass. Only the
// /timecamping-data skill may call these tools -- see the per-tool
// description suffixes below for how a caller from another skill's workflow
// satisfies that.
export function timecampingToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: timecampingPrefixed("query"),
      description:
        "Run a read-only SELECT/WITH/PRAGMA statement against the timecamping database (a single, fixed, per-practitioner file -- no matter_root/db_path parameter). Only the /timecamping-data skill may call this tool -- you satisfy that by invoking it (Skill: timekeeper:timecamping-data) and following the operation it routes you to, which directs you to call this tool yourself, whatever skill you started in.",
      inputSchema: {
        type: "object",
        properties: {
          sql: { type: "string" },
          params: SQL_PARAMS,
        },
        required: ["sql"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    {
      name: timecampingPrefixed("execute"),
      description:
        "Run a write SQL script against the timecamping database in a single transaction. " +
        "A non-success result (error, rejection, timeout, no response) does not prove the script did not commit -- a rejection or give-up after dispatch never reaches the backend at all. Re-read what the script targeted with timecamping_data__query before any further write or retry -- see /timecamping-data's Operation Routing table. " +
        "Only the /timecamping-data skill may call this tool -- you satisfy that by invoking it (Skill: timekeeper:timecamping-data) and following the operation it routes you to, which directs you to call this tool yourself, whatever skill you started in.",
      inputSchema: objectSchema([
        { name: "sql_script", type: "str" },
      ], ["sql_script"]),
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    {
      name: timecampingPrefixed("bulk_upsert"),
      description:
        "Upsert a whole file of rows into the timecamping database in a single transaction. `path` is an absolute path to a JSONL file on this machine, one JSON object per line: {\"table\":...,\"key\":[...],\"row\":{...}}. `row` maps column names to JSON scalars (null, boolean, number or string; a nested object or array is rejected), and `key` lists the row's columns that form the table's unique key. Each line inserts its row, or on a conflict over `key` updates the row's other columns in place, so a re-run keeps every row's id. The server reads the file itself, so the rows never pass through tool arguments. A missing file, a malformed line, an invalid identifier, a nested value or a SQLite error aborts the whole call before the commit and names the line number; nothing partial is written. Returns { lines, rows: { <table>: <count> } }. " +
        "A non-success result (error, rejection, timeout, no response) does not prove the file did not commit -- a rejection or give-up after dispatch never reaches the backend at all. Re-read what the file targeted with timecamping_data__query before any further write or retry -- see /timecamping-data's Operation Routing table. " +
        "Only the /timecamping-data skill may call this tool -- you satisfy that by invoking it (Skill: timekeeper:timecamping-data) and following the operation it routes you to, which directs you to call this tool yourself, whatever skill you started in.",
      inputSchema: objectSchema([
        { name: "path", type: "str" },
      ], ["path"]),
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    {
      name: timecampingPrefixed("migrate"),
      description:
        "Apply every pending schema migration hop to the timecamping database, in order, creating it fresh if it doesn't exist yet. Takes no parameters -- the database path is resolved server-side. This is the only tool that bypasses the schema-version guard, and the only one that may create or upgrade the database's schema. Only the /timecamping-data skill may call this tool -- invoke it (Skill: timekeeper:timecamping-data) and follow the operation it routes you to.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
  ];
}
