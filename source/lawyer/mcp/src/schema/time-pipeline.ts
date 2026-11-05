import { type ToolDefinition, objectSchema } from "./shared.js";

function timePipelinePrefixed(name: string): string {
  return `time_pipeline__${name}`;
}

// Time-pipeline kv-store surface (Step 0, 2026-08-26 -- port off the retired
// cowork-db Go binary). Generic get/set/list/delete over a single
// (namespace, key) -> value table; schema and SQL stay inside
// time-pipeline/backend.ts, not the /time-pipeline-data skill, matching the
// matter_data__query/execute connection-discipline pattern.
export function timePipelineToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: timePipelinePrefixed("get"),
      description:
        "Read one value from the time-pipeline key-value store by (namespace, key). Returns { value: null } when the key is absent. Only the /time-pipeline-data skill may call this tool -- you satisfy that by invoking it (Skill: timekeeper:time-pipeline-data) and following the operation it routes you to, which directs you to call this tool yourself, whatever skill you started in.",
      inputSchema: objectSchema([
        { name: "namespace", type: "str" },
        { name: "key", type: "str" },
      ], ["namespace", "key"]),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    {
      name: timePipelinePrefixed("set"),
      description:
        "Write one value into the time-pipeline key-value store at (namespace, key), overwriting any existing value there. `value` is stored verbatim -- pass an already-JSON-encoded string for a structured value. Only the /time-pipeline-data skill may call this tool -- see time_pipeline__get for how a caller from another skill's workflow satisfies that.",
      inputSchema: objectSchema([
        { name: "namespace", type: "str" },
        { name: "key", type: "str" },
        { name: "value", type: "str" },
      ], ["namespace", "key", "value"]),
    },
    {
      name: timePipelinePrefixed("list"),
      description:
        "List every (key, value) pair in one namespace of the time-pipeline key-value store whose key starts with `prefix`, sorted by key. Omit `prefix` (or pass an empty string) to list the whole namespace. Only the /time-pipeline-data skill may call this tool.",
      inputSchema: objectSchema([
        { name: "namespace", type: "str" },
        { name: "prefix", type: "str" },
      ], ["namespace"]),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    {
      name: timePipelinePrefixed("delete"),
      description:
        "Delete one (namespace, key) entry from the time-pipeline key-value store. Returns { ok: true, deleted: false } when the key was already absent. Only the /time-pipeline-data skill may call this tool.",
      inputSchema: objectSchema([
        { name: "namespace", type: "str" },
        { name: "key", type: "str" },
      ], ["namespace", "key"]),
    },
    {
      name: timePipelinePrefixed("bulk_apply"),
      description:
        "Apply a whole file of writes to one namespace of the time-pipeline key-value store, in a single transaction. `path` is an absolute path to a JSONL file on this machine -- one JSON object per line, applied in file order. Four line types: {\"op\":\"set\",\"key\":...,\"value\":...} stores one value verbatim; {\"op\":\"delete\",\"key\":...} removes one key; {\"op\":\"delete_prefix\",\"prefix\":...} removes every key in the namespace starting with that prefix, matched literally; {\"op\":\"merge\",\"key\":...,\"add\":[...],\"drop_prefix\":...} treats the value as a JSON array of strings, drops every element starting with `drop_prefix`, appends the elements of `add` not already present, and deletes the key if nothing remains. The server reads the file itself, so a bulk import never passes through tool arguments. A missing file, a malformed line, an unknown op, or a merge target that is not a JSON array of strings aborts the whole call before the commit and names the line number -- nothing partial is written. Call it twice: first with preview true, which writes nothing and returns { lines, sets, deletes, merges, deleted_by_prefix, added, replaced, removed, file_sha256, applied: false }; then with expect holding that added, replaced, removed and file_sha256, which commits only if they still match the file and the store, and otherwise writes nothing. Only the /time-pipeline-data skill may call this tool -- see time_pipeline__get for how a caller from another skill's workflow satisfies that.",
      inputSchema: objectSchema([
        { name: "namespace", type: "str" },
        { name: "path", type: "str" },
        { name: "preview", type: "bool" },
        { name: "expect", type: "obj" },
      ], ["namespace", "path"]),
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    {
      name: timePipelinePrefixed("export"),
      description:
        "Write every (key, value) pair in one namespace of the time-pipeline key-value store whose key starts with `prefix` (matched literally; omit it or pass an empty string for the whole namespace) to a JSONL file, sorted by key. `path` is an absolute path on this machine; the server creates its parent directory and overwrites any file already there. Each line is a time_pipeline__bulk_apply set line, {\"op\":\"set\",\"key\":...,\"value\":...}, so an export re-applies as it stands. The rows go to the file, never through tool output. Returns { items, path }. Only the /time-pipeline-data skill may call this tool -- see time_pipeline__get for how a caller from another skill's workflow satisfies that.",
      inputSchema: objectSchema([
        { name: "namespace", type: "str" },
        { name: "prefix", type: "str" },
        { name: "path", type: "str" },
      ], ["namespace", "path"]),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
  ];
}
