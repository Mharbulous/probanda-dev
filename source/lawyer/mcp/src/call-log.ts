// The tool-call timing log (docs/ADRs/0016-tool-call-timing-log.md): one JSON line per data-server
// tool call, written from the server's one call handler (index.ts), so where a session's time goes can
// be read off real use (scripts/call-log-summary.mjs).
//
// A record is built only from what the server itself defines: a known tool name, the clock, the
// reply's length, its error code, its phase names with file names masked, the build stamp and a hash
// of the session. It never sees a call's arguments, and reads the reply only for those fields, so no
// client or matter content can reach it.
//
// Files are `<LOCALAPPDATA or home>/Coclerk/call-log/YYYY-MM-DD.jsonl` (UTC date), local to this user
// and never under the case data root. A file older than RETENTION_DAYS is deleted, and the oldest go
// first while the folder holds more than CAP_BYTES. Each line is one append, so servers in several
// sessions share the folder safely. Every log failure is swallowed after the reply is returned: the
// log never slows or fails a call. `"timing_log": false` in probanda.json turns it off.

import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { BUILD_STAMP } from "./build-stamp.js";
import { configPath } from "./config-path.js";
import { FAULT, type ToolReply } from "./tool-list.js";

export const RETENTION_DAYS = 14;
export const CAP_BYTES = 32 * 1024 * 1024;
/** Bytes this process writes between prunes, besides one prune per UTC day. */
const PRUNE_EVERY_BYTES = 256 * 1024;
const FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;
/** A phase name or a part of one the code wrote: lower case words, never a file name. */
const CODE_TEXT = /^[a-z_ ()-]+$/;
const ERROR_CODE = /^[a-z_]{1,40}$/;

export type Outcome = "ok" | "refused" | "error";

export interface CallRecord {
  t: string;
  tool: string;
  ms: number;
  outcome: Outcome;
  code?: string;
  bytes: number;
  phases?: { phase: string; ms: number }[];
  build: string | null;
  session: string;
}

type Dispatch = (name: string, args: unknown) => Promise<ToolReply>;

export function callLogDir(env: NodeJS.ProcessEnv): string {
  return join(env.LOCALAPPDATA || homedir(), "Coclerk", "call-log");
}

function enabled(env: NodeJS.ProcessEnv): boolean {
  try {
    const path = configPath(env);
    return !existsSync(path) || (JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>).timing_log !== false;
  } catch {
    return true;
  }
}

/** `dispatch` with every call logged, or `dispatch` itself when the log is off. */
export function withCallLog(dispatch: Dispatch, toolNames: ReadonlySet<string>, env: NodeJS.ProcessEnv = process.env): Dispatch {
  if (!enabled(env)) return dispatch;
  const log = new CallLog(callLogDir(env));
  const session = createHash("sha256").update(env.CLAUDE_CODE_SESSION_ID || randomUUID()).digest("hex").slice(0, 16);
  return async (name, args) => {
    const started = new Date();
    const t0 = performance.now();
    let reply: ToolReply | undefined;
    try {
      reply = await dispatch(name, args);
      return reply;
    } finally {
      const ms = Math.round((performance.now() - t0) * 10) / 10;
      const tool = toolNames.has(name) ? name : "unknown";
      setImmediate(() => {
        try {
          log.write(callRecord(tool, started, ms, reply, session));
        } catch {
          // Never a call's problem (file header).
        }
      });
    }
  };
}

/** The record for one call. `reply` is undefined when the dispatch threw. */
export function callRecord(tool: string, started: Date, ms: number, reply: ToolReply | undefined, session: string): CallRecord {
  const text = reply?.content.map((c) => c.text).join("") ?? "";
  const record: CallRecord = { t: started.toISOString(), tool, ms, outcome: "ok", bytes: Buffer.byteLength(text, "utf-8"), build: BUILD_STAMP, session };
  if (reply === undefined || reply.isError) {
    // A refusal is a tool saying no for a reason; a fault (toolReply's FAULT) or a throw is an error.
    record.outcome = reply === undefined || FAULT in reply ? "error" : "refused";
    const code = errorCode(text);
    if (code !== undefined) record.code = code;
  } else if (text.includes('"timings"')) {
    const phases = phaseTimings(text);
    if (phases) record.phases = phases;
  }
  return record;
}

function errorCode(text: string): string | undefined {
  try {
    const code = (JSON.parse(text) as { error?: { code?: unknown } }).error?.code;
    return typeof code === "string" && ERROR_CODE.test(code) ? code : undefined;
  } catch {
    return undefined;
  }
}

/** The reply's top-level `timings`, each phase name masked by maskPhase and repeats summed. */
function phaseTimings(text: string): CallRecord["phases"] {
  let timings: unknown;
  try {
    timings = (JSON.parse(text) as { timings?: unknown }).timings;
  } catch {
    return undefined;
  }
  if (!Array.isArray(timings)) return undefined;
  const summed = new Map<string, number>();
  for (const t of timings as { phase?: unknown; ms?: unknown }[]) {
    if (typeof t?.phase !== "string" || typeof t.ms !== "number" || !Number.isFinite(t.ms)) continue;
    const phase = maskPhase(t.phase);
    summed.set(phase, Math.round(((summed.get(phase) ?? 0) + t.ms) * 10) / 10);
  }
  return summed.size ? [...summed].map(([phase, ms]) => ({ phase, ms })) : undefined;
}

/** Each `: `-separated part kept when it is code text, else cut to its first word and `*` (`write *`
 * for `write Notice.md`), or `*` alone when even that word is not code text. */
export function maskPhase(phase: string): string {
  return phase
    .split(": ")
    .map((part) => {
      if (CODE_TEXT.test(part)) return part;
      const word = part.split(" ")[0];
      return word !== part && CODE_TEXT.test(word) ? `${word} *` : "*";
    })
    .join(": ");
}

class CallLog {
  private day = "";
  private sincePrune = 0;

  constructor(private readonly dir: string) {}

  write(record: CallRecord): void {
    const day = record.t.slice(0, 10);
    if (day !== this.day || this.sincePrune >= PRUNE_EVERY_BYTES) {
      mkdirSync(this.dir, { recursive: true });
      prune(this.dir, day);
      this.day = day;
      this.sincePrune = 0;
    }
    const file = join(this.dir, `${day}.jsonl`);
    if (existsSync(file) && statSync(file).size >= CAP_BYTES) return;
    const line = JSON.stringify(record) + "\n";
    appendFileSync(file, line, "utf-8");
    this.sincePrune += line.length;
  }
}

/** Deletes files older than RETENTION_DAYS before `today`, then the oldest others (never today's)
 * while the folder holds more than `cap`. Another server may delete a file first: that is fine. */
export function prune(dir: string, today: string, cap = CAP_BYTES): void {
  const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - RETENTION_DAYS * 86_400_000).toISOString().slice(0, 10);
  const files: { name: string; day: string; size: number }[] = [];
  for (const name of readdirSync(dir)) {
    const day = FILE.exec(name)?.[1];
    if (day === undefined) continue;
    try {
      if (day < cutoff) unlinkSync(join(dir, name));
      else files.push({ name, day, size: statSync(join(dir, name)).size });
    } catch {
      // Already gone.
    }
  }
  files.sort((a, b) => a.day.localeCompare(b.day));
  let total = files.reduce((sum, f) => sum + f.size, 0);
  for (const f of files) {
    if (total <= cap || f.day >= today) break;
    try {
      unlinkSync(join(dir, f.name));
    } catch {
      // Already gone.
    }
    total -= f.size;
  }
}
