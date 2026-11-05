// The tools of the timekeeper plugin's `timecamp` server
// (docs/Specs/2026-10-15_timecamp-api-connector-spec.md): configure_credential
// and status, four reads (tasks, entries, activities) and update_entry, the one
// write, which is the call /timecamping already made for an approved
// write-back. No tool creates or deletes a TimeCamp entry. No tool takes,
// returns or logs the token.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";

import { ValidationError } from "../errors.js";
import type { ToolDefinition } from "../schema-gen.js";
import { toolReply, type ToolReply } from "../tool-list.js";
import { validateToolInput } from "../validate.js";
import { apiRequest, missingTokenReason, persistToken, TimeCampError, type TokenState } from "./client.js";
import { serveTokenPage } from "./page.js";

type Args = Record<string, unknown>;
type Row = Record<string, unknown>;

const DATE = "^\\d{4}-\\d{2}-\\d{2}$";
const TIME = "^([01]\\d|2[0-3]):[0-5]\\d$";
const PRINTABLE = /^[^\x00-\x1F\x7F]+$/;

const STOP_RULE =
  "If status reports usable: false, stop and tell the practitioner its reason. Never open the TimeCamp web app instead.";
const OUT_FILE_RULE = "With out_file, writes the rows as a JSON array to that new file instead and returns only the count and totals.";
const OUT_FILE_INPUT = { type: "string", description: "Absolute path of a file that does not exist yet." };

export function timecampToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "configure_credential",
      description:
        "Start setting the TimeCamp API token on this computer. Takes no token: returns a link to a local page where " +
        "the practitioner pastes it, so it never passes through the chat. The page checks the token with TimeCamp and " +
        "saves it encrypted. When they say it is done, call status.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    {
      name: "status",
      description:
        "Whether the TimeCamp API is usable from this computer: a token is set, TimeCamp is reachable and accepts it. " +
        "Returns usable, the authenticated user, and a reason when not usable (no token, token unreadable, auth refused, " +
        "network). Call it before any other TimeCamp tool. " + STOP_RULE,
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    {
      name: "tasks",
      description:
        "TimeCamp's active (not archived) projects and tasks, each as TimeCamp returns it plus `path`, its full name path " +
        "from the top-level project. With `query`, only those whose name or path contains it (case-insensitive), such as a " +
        "matter number. Read-only. " + STOP_RULE,
      inputSchema: {
        type: "object",
        properties: { query: { type: "string", description: "Text to find in a task's name or path, e.g. L8166." } },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    {
      name: "entries",
      description:
        "TimeCamp time entries from `from` to `to` (local dates, inclusive), every user's unless filtered. task_ids also " +
        "takes in every active descendant of each task. Returns the rows as TimeCamp gives them and totals by user and by " +
        "day in TimeCamp's own seconds, with hours as seconds / 3600, never rounded. " + OUT_FILE_RULE + " Read-only. " + STOP_RULE,
      inputSchema: {
        type: "object",
        properties: {
          from: { type: "string", pattern: DATE, description: "First date, YYYY-MM-DD." },
          to: { type: "string", pattern: DATE, description: "Last date, YYYY-MM-DD." },
          task_ids: { type: "array", items: { type: "string" }, description: "Keep only entries on these tasks or their active descendants." },
          user_ids: { type: "array", items: { type: "string" }, description: "Keep only entries of these TimeCamp user ids." },
          billable: { type: "boolean", description: "true keeps billable entries only, false non-billable only." },
          out_file: OUT_FILE_INPUT,
        },
        required: ["from", "to"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    {
      name: "activities",
      description:
        "TimeCamp computer activities (applications and window titles tracked by the desktop app) for 1 to 20 dates, " +
        "with application and window_title resolved to names. Filter with entry_ids, user_ids, from_time and to_time. " +
        "Returns the rows as TimeCamp gives them and totals by entry in seconds. " + OUT_FILE_RULE + " Read-only. " + STOP_RULE,
      inputSchema: {
        type: "object",
        properties: {
          dates: { type: "array", items: { type: "string", pattern: DATE }, description: "1 to 20 dates, YYYY-MM-DD." },
          entry_ids: { type: "array", items: { type: "string" }, description: "Keep only rows carrying these entry ids; \"0\" means no entry." },
          user_ids: { type: "array", items: { type: "string" }, description: "Keep only rows of these TimeCamp user ids." },
          from_time: { type: "string", pattern: TIME, description: "Keep only rows running after this local time on each date, HH:MM." },
          to_time: { type: "string", pattern: TIME, description: "Keep only rows running before this local time on each date, HH:MM." },
          out_file: OUT_FILE_INPUT,
        },
        required: ["dates"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    {
      name: "update_entry",
      description:
        "Move one TimeCamp time entry to another task and set its note (read back as `description`). The entry's billable " +
        "flag follows the new task. Changes TimeCamp. Call it only after the practitioner has said to commit this entry's change. The answer is not the check: re-read the entry's date with entries " +
        "and compare task_id and description. " + STOP_RULE,
      inputSchema: {
        type: "object",
        properties: {
          entry_id: { type: "string", description: "The entry's id." },
          task_id: { type: "string", description: "The TimeCamp task to move it to." },
          note: { type: "string", description: "The entry's whole new note, replacing the old one." },
        },
        required: ["entry_id", "task_id", "note"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
  ];
}

let definitions: Map<string, ToolDefinition> | undefined;

export function dispatchTimecampTool(state: TokenState, name: string, rawArgs: unknown): Promise<ToolReply> {
  return toolReply(name, () => {
    definitions ??= new Map(timecampToolDefinitions().map((tool) => [tool.name, tool]));
    const definition = definitions.get(name);
    if (!definition) throw new ValidationError(`Unknown tool "${name}"`);
    return callTool(state, name, validateToolInput(definition, rawArgs));
  });
}

async function callTool(state: TokenState, name: string, args: Args): Promise<unknown> {
  if (name === "configure_credential") return configureCredential(state);
  if (name === "status") return status(state);
  const token = requireToken(state);
  if (name === "tasks") return tasks(token, args.query as string | undefined);
  if (name === "entries") return entries(token, args);
  if (name === "activities") return activities(token, args);
  if (name === "update_entry") return updateEntry(token, args);
  throw new ValidationError(`Unknown tool "${name}"`);
}

function keepIds(rows: Row[], key: string, ids: unknown): Row[] {
  if (!(ids as string[] | null | undefined)?.length) return rows;
  const keep = new Set(ids as string[]);
  return rows.filter((r) => keep.has(String(r[key])));
}

function requireToken(state: TokenState): string {
  const reason = missingTokenReason(state);
  if (reason) throw new TimeCampError(reason, "timecamp_not_configured");
  return state.token as string;
}

// --- credential ----------------------------------------------------------------------

async function configureCredential(state: TokenState): Promise<unknown> {
  const url = await serveTokenPage(async (typed) => {
    if (!typed) throw new ValidationError("paste the token");
    if (!PRINTABLE.test(typed)) throw new ValidationError("the token must hold printable characters only");
    const user = await currentUser(typed);
    state.token = typed;
    delete state.credentialError;
    try {
      await persistToken(typed);
      return { user: user.display_name ?? user.user_id ?? "this account", persisted: true };
    } catch (error) {
      const detail = (error instanceof Error ? error.message : String(error)).split("\n")[0].trim();
      return {
        user: user.display_name ?? user.user_id ?? "this account",
        persisted: false,
        warning: `the token works for this session but could not be saved, so it must be entered again after a restart: ${detail}`,
      };
    }
  });
  return {
    status: "awaiting_token",
    url,
    next:
      "Send the practitioner this link and ask them to paste the TimeCamp token on that page, never in chat. " +
      "When they say it is done, call status. The link works only on this computer, until a new link is made or the server restarts.",
  };
}

async function currentUser(token: string): Promise<{ user_id?: string; display_name?: string }> {
  const body = await apiRequest(token, "GET", "user/", new URLSearchParams({ format: "json" }));
  const user = (Array.isArray(body) ? body[0] : body) as Record<string, unknown> | undefined;
  return {
    ...(user?.user_id !== undefined ? { user_id: String(user.user_id) } : {}),
    ...(typeof user?.display_name === "string" ? { display_name: user.display_name } : {}),
  };
}

async function status(state: TokenState): Promise<unknown> {
  const reason = missingTokenReason(state);
  if (reason) return { usable: false, reason };
  try {
    return { usable: true, user: await currentUser(state.token as string) };
  } catch (error) {
    return { usable: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

// --- reads ---------------------------------------------------------------------------

type Task = Record<string, unknown> & { task_id: unknown; parent_id: unknown; name: unknown; archived: unknown };

async function allTasks(token: string): Promise<Map<string, Task>> {
  const body = await apiRequest(token, "GET", "tasks/", new URLSearchParams({ format: "json" }));
  if (!body || typeof body !== "object") throw new TimeCampError("TimeCamp's task list is not an object");
  const rows = Array.isArray(body) ? body : Object.values(body);
  return new Map((rows as Task[]).map((t) => [String(t.task_id), t]));
}

function taskPath(all: Map<string, Task>, task: Task): string {
  const names: string[] = [];
  const seen = new Set<string>();
  for (let t: Task | undefined = task; t && !seen.has(String(t.task_id)); t = all.get(String(t.parent_id))) {
    seen.add(String(t.task_id));
    names.unshift(String(t.name));
  }
  return names.join(" / ");
}

const isArchived = (t: Task): boolean => Number(t.archived) === 1;

async function tasks(token: string, query: string | undefined): Promise<unknown> {
  const all = await allTasks(token);
  const needle = query?.trim().toLowerCase();
  const out = [...all.values()]
    .filter((t) => !isArchived(t))
    .map((t) => ({ ...t, path: taskPath(all, t) }))
    .filter((t) => !needle || String(t.name).toLowerCase().includes(needle) || t.path.toLowerCase().includes(needle));
  return { count: out.length, tasks: out };
}

/** The given task ids plus every active descendant of each. */
function withDescendants(all: Map<string, Task>, ids: string[]): Set<string> {
  const keep = new Set(ids);
  let grew = true;
  while (grew) {
    grew = false;
    for (const t of all.values()) {
      const id = String(t.task_id);
      if (!keep.has(id) && !isArchived(t) && keep.has(String(t.parent_id))) {
        keep.add(id);
        grew = true;
      }
    }
  }
  return keep;
}

async function entries(token: string, args: Args): Promise<unknown> {
  const from = args.from as string;
  const to = args.to as string;
  if (from > to) throw new ValidationError("entries.from must not be after entries.to");
  const outFile = checkedOutFile("entries", args);

  const body = await apiRequest(token, "GET", "entries/", new URLSearchParams({ from, to, format: "json" }));
  if (!Array.isArray(body)) throw new TimeCampError("TimeCamp's entries answer is not a list");
  let rows = body as Row[];

  const taskIds = args.task_ids as string[] | null | undefined;
  if (taskIds?.length) {
    const keep = withDescendants(await allTasks(token), taskIds);
    rows = rows.filter((r) => keep.has(String(r.task_id)));
  }
  rows = keepIds(rows, "user_id", args.user_ids);
  if (typeof args.billable === "boolean") {
    const want = args.billable ? 1 : 0;
    rows = rows.filter((r) => Number(r.billable) === want);
  }

  const result = { from, to, count: rows.length, totals: totals(rows) };
  if (outFile === undefined) return { ...result, rows };
  await writeRowsFile("entries", outFile, rows);
  return { ...result, out_file: outFile };
}

function checkedOutFile(tool: string, args: Args): string | undefined {
  const outFile = args.out_file as string | undefined;
  if (outFile !== undefined && !isAbsolute(outFile)) throw new ValidationError(`${tool}.out_file must be an absolute path`);
  return outFile;
}

async function writeRowsFile(tool: string, outFile: string, rows: Row[]): Promise<void> {
  await mkdir(dirname(outFile), { recursive: true });
  try {
    await writeFile(outFile, JSON.stringify(rows), { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "EEXIST") {
      throw new ValidationError(`${tool}.out_file ${outFile} already exists; name a new file`);
    }
    throw error;
  }
}

function totals(rows: Row[]): unknown {
  const byUser = new Map<string, { user_id: string; user_name: unknown; seconds: number }>();
  const byDay = new Map<string, number>();
  let seconds = 0;
  for (const r of rows) {
    const s = Number(r.duration) || 0;
    seconds += s;
    const uid = String(r.user_id);
    const u = byUser.get(uid) ?? { user_id: uid, user_name: r.user_name, seconds: 0 };
    u.seconds += s;
    byUser.set(uid, u);
    byDay.set(String(r.date), (byDay.get(String(r.date)) ?? 0) + s);
  }
  return {
    seconds,
    hours: seconds / 3600,
    by_user: [...byUser.values()].map((u) => ({ ...u, hours: u.seconds / 3600 })),
    by_day: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, s]) => ({ date, seconds: s, hours: s / 3600 })),
  };
}

function timeOfDay(label: string, value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !new RegExp(TIME).test(value)) throw new ValidationError(`${label} must be a time, HH:MM`);
  return Number(value.slice(0, 2)) * 3600 + Number(value.slice(3)) * 60;
}

/** Seconds into the day that a row's end_time ("YYYY-MM-DD HH:MM:SS") falls. */
function endOfRow(row: Row): number {
  const [h, m, s] = String(row.end_time).slice(11).split(":").map(Number);
  return h * 3600 + m * 60 + s;
}

async function activities(token: string, args: Args): Promise<unknown> {
  const dates = args.dates as string[];
  if (dates.length < 1 || dates.length > 20) throw new ValidationError("activities.dates takes 1 to 20 dates");
  const from = timeOfDay("activities.from_time", args.from_time);
  const to = timeOfDay("activities.to_time", args.to_time);
  if (from !== undefined && to !== undefined && from >= to) throw new ValidationError("activities.from_time must be before activities.to_time");
  const outFile = checkedOutFile("activities", args);

  const query = new URLSearchParams();
  for (const d of dates) query.append("dates[]", d);
  query.set("include", "application,window_title");
  query.set("format", "json");
  const body = await apiRequest(token, "GET", "activity/", query);
  if (!Array.isArray(body)) throw new TimeCampError("TimeCamp's activity answer is not a list");
  let rows = keepIds(body as Row[], "entry_id", args.entry_ids);
  rows = keepIds(rows, "user_id", args.user_ids);
  // Overlap, not end-inside-window, so a row running across the window's edge is kept.
  if (from !== undefined) rows = rows.filter((r) => endOfRow(r) > from);
  if (to !== undefined) rows = rows.filter((r) => endOfRow(r) - Number(r.time_span) < to);

  const byEntry = new Map<string, number>();
  for (const r of rows) byEntry.set(String(r.entry_id), (byEntry.get(String(r.entry_id)) ?? 0) + (Number(r.time_span) || 0));
  const result = {
    dates,
    count: rows.length,
    totals: {
      seconds: [...byEntry.values()].reduce((sum, s) => sum + s, 0),
      by_entry: [...byEntry.entries()].map(([entry_id, seconds]) => ({ entry_id, seconds })),
    },
  };
  if (outFile === undefined) return { ...result, rows };
  await writeRowsFile("activities", outFile, rows);
  return { ...result, out_file: outFile };
}

// --- write ---------------------------------------------------------------------------

async function updateEntry(token: string, args: Args): Promise<unknown> {
  const sent = { id: String(args.entry_id), task_id: String(args.task_id), note: String(args.note) };
  const echo = await apiRequest(token, "PUT", "entries/", undefined, new URLSearchParams(sent));
  return {
    sent: { entry_id: sent.id, task_id: sent.task_id, note: sent.note },
    echo,
    next: "Re-read this entry's date with entries and compare task_id and description; only that confirms the write.",
  };
}
