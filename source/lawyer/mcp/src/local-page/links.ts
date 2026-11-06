// Link records: a page URL carries a short id, and the target it stands for (a matter folder and a
// run, say) is kept in `page-links/<id>.json` beside probanda.json. No client folder name reaches a
// URL or the browser's history, and every process on the device, before or after a restart,
// resolves the same link from disk.
//
// The id is the first 24 bytes of HMAC-SHA256(device secret, "link\n" + kind + "\n" + target),
// base64url (32 characters). Resolving recomputes it from the record's own kind and target, so a
// record planted or edited by hand is refused.

import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { configPath } from "../config-path.js";
import { deviceHmac, sameText } from "./token.js";

const LINKS_DIR = "page-links";
const ID_RE = /^[A-Za-z0-9_-]{32}$/;
/** A record older than this is swept. */
const MAX_AGE_MS = 30 * 24 * 3600 * 1000;

interface LinkRecord {
  kind: string;
  target: string;
  created_at: string;
}

function linksDir(env: NodeJS.ProcessEnv): string {
  return join(dirname(configPath(env)), LINKS_DIR);
}

function linkId(kind: string, target: string, env: NodeJS.ProcessEnv): string {
  return deviceHmac(`link\n${kind}\n${target}`, env).subarray(0, 24).toString("base64url");
}

/** Writes the record for `target` and returns its id. The same kind and target always give the same id. */
export function deviceLink(kind: string, target: string, env: NodeJS.ProcessEnv): string {
  const id = linkId(kind, target, env);
  const dir = linksDir(env);
  mkdirSync(dir, { recursive: true });
  const record: LinkRecord = { kind, target, created_at: new Date().toISOString() };
  const path = join(dir, `${id}.json`);
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(record));
  renameSync(temp, path);
  return id;
}

function readRecord(path: string): LinkRecord | null {
  try {
    const record = JSON.parse(readFileSync(path, "utf-8")) as Partial<LinkRecord> | null;
    return typeof record?.kind === "string" && typeof record.target === "string" ? (record as LinkRecord) : null;
  } catch {
    return null;
  }
}

/** The target of a link of this kind, or null: no such record, another kind, or a record the device did not write. */
export function resolveLink(kind: string, id: string, env: NodeJS.ProcessEnv): string | null {
  if (!ID_RE.test(id)) return null;
  const record = readRecord(join(linksDir(env), `${id}.json`));
  if (!record || record.kind !== kind) return null;
  return sameText(id, linkId(kind, record.target, env)) ? record.target : null;
}

/** Each record file's path, or none when no link was ever written. */
function recordPaths(env: NodeJS.ProcessEnv): string[] {
  const dir = linksDir(env);
  try {
    return readdirSync(dir).filter((name) => name.endsWith(".json")).map((name) => join(dir, name));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

function remove(path: string): void {
  try {
    unlinkSync(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

/** Deletes every link of this kind whose target `match` accepts, so those links stop resolving. */
export function dropLinks(kind: string, match: (target: string) => boolean, env: NodeJS.ProcessEnv): void {
  for (const path of recordPaths(env)) {
    const record = readRecord(path);
    if (record?.kind === kind && match(record.target)) remove(path);
  }
}

/** Deletes every record last written more than 30 days ago. */
export function sweepLinks(env: NodeJS.ProcessEnv, now: number = Date.now()): void {
  for (const path of recordPaths(env)) {
    let written: number;
    try {
      written = statSync(path).mtimeMs;
    } catch {
      continue;
    }
    if (now - written > MAX_AGE_MS) remove(path);
  }
}
