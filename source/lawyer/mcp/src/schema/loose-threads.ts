import { type ToolDefinition } from "./shared.js";

const KINDS = ["idea", "proposition", "correspondence", "argument", "work_board"];

// A matter's loose threads, reached only through these three tools (loose-threads/tools.ts).
export function looseThreadsToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "loose_threads__capture",
      description:
        "Capture one loose thread: work, or an idea for work, that was cut off and left. `idea` is verbatim, at most five sentences, " +
        "with no options or recommendations. `surfaced_by` is one line naming what surfaced it. `origin_job` is the job this session " +
        "holds; leave it out when none is held. `filing_id` is the Writing or Work Board it came from; leave it out for the proceeding. " +
        "`kind` defaults to idea. `ref` is the file path or record id it left off at. Returns only the new thread's id. It lists no " +
        "other thread. /drafting-data jobs-run.md §8 owns when and how.",
      inputSchema: {
        type: "object",
        properties: {
          db_path: { type: "string" },
          proceeding_id: { type: "number" },
          filing_id: { type: ["number", "null"] },
          origin_job: { type: ["number", "null"] },
          surfaced_by: { type: "string" },
          idea: { type: "string" },
          kind: { type: "string", enum: KINDS },
          ref: { type: "string" },
        },
        required: ["db_path", "proceeding_id", "surfaced_by", "idea"],
        additionalProperties: false,
      },
      annotations: { openWorldHint: false },
    },
    {
      name: "loose_threads__read",
      description:
        "Read a matter's open loose threads, only for what these two modes serve. triage: every open thread with its ranking and " +
        "deferral, in the Loose Threads page's order, for an outlining session's loose-thread triage (pass kind: idea to read what is " +
        "ranked). duplicates: only the open threads of proceeding_id that restate `text`, each as {id, idea}, for the duplicate test in " +
        "/legal-research. A session working a job does not read threads here.",
      inputSchema: {
        type: "object",
        properties: {
          db_path: { type: "string" },
          mode: { type: "string", enum: ["triage", "duplicates"] },
          kind: { type: "string", enum: KINDS },
          proceeding_id: { type: "number" },
          text: { type: "string" },
        },
        required: ["db_path", "mode"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    {
      name: "loose_threads__update",
      description:
        "Change loose threads, on the terms /drafting-data jobs-run.md §8 sets. action rank: `ranks`, each {id, rank, group, job, " +
        "reason}, ideas only, in one write, returning unranked_open, the open undeferred ideas still lacking a rank or description. " +
        "correct: `id` and `job`, a ranked thread's description. defer, undefer: `id`, an open thread. discard: `ids`, kept and no " +
        "longer open. restore: `id`, a discarded thread. consume: `id` and `job_id`, the job it was outlined into. move: " +
        "`from_filing_id` and `filing_id` (null for the proceeding), a board's open threads to a live board in their proceeding. Returns updated, the ids changed; " +
        "a thread already in the state asked for is not among them. A refusal writes nothing.",
      inputSchema: {
        type: "object",
        properties: {
          db_path: { type: "string" },
          action: { type: "string", enum: ["rank", "correct", "defer", "undefer", "discard", "restore", "consume", "move"] },
          id: { type: "number" },
          ids: { type: "array", items: { type: "number" } },
          from_filing_id: { type: "number" },
          ranks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "number" },
                rank: { type: "number" },
                group: { type: "string", enum: ["decision", "tooling", "housekeeping", "research", "authority", "evidence", "other"] },
                job: { type: "string" },
                reason: { type: "string" },
              },
              required: ["id", "rank", "group", "job", "reason"],
              additionalProperties: false,
            },
          },
          job: { type: "string" },
          job_id: { type: "number" },
          filing_id: { type: ["number", "null"] },
        },
        required: ["db_path", "action"],
        additionalProperties: false,
      },
      annotations: { openWorldHint: false },
    },
  ];
}
