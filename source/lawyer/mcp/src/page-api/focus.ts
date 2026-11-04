// The Arguments page's focus: which card a session last pointed the open page at
// (drafting_forms__focus_view_page). One small JSON file per filing in `page-focus/` beside
// probanda.json, never the database and never listener memory, because the session that writes it
// is often not the process that holds the listener's port (server.ts). The page asks the listener
// for it every few seconds and moves to the card when the record's id is new. A session never learns
// from here whether the page moved.

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { configPath } from "../config-path.js";
import { writeTextAtomic } from "../file-lock.js";

export const FOCUS_SECTIONS = ["submissions", "counter", "rebuttals", "killed"] as const;
export type FocusSection = (typeof FOCUS_SECTIONS)[number];

export interface FocusRecord {
  /** New on every write, so the page acts once per request. */
  id: string;
  section: FocusSection;
  /** The card's number in its section, 1..N, as the page tags it. */
  number: number;
  at: string;
}

function focusPath(dbPath: string, filingId: number, env: NodeJS.ProcessEnv): string {
  const name = createHash("sha256").update(`${dbPath}\n${filingId}`).digest("hex").slice(0, 32);
  return join(dirname(configPath(env)), "page-focus", `${name}.json`);
}

export function writeFocus(dbPath: string, filingId: number, section: FocusSection, number: number, env: NodeJS.ProcessEnv = process.env): FocusRecord {
  const record: FocusRecord = { id: randomUUID(), section, number, at: new Date().toISOString() };
  const path = focusPath(dbPath, filingId, env);
  mkdirSync(dirname(path), { recursive: true });
  writeTextAtomic(path, JSON.stringify(record));
  return record;
}

/** The newest record across a page's filings (a merged board's page has several), or null. */
export function readFocus(dbPath: string, filingIds: number[], env: NodeJS.ProcessEnv = process.env): FocusRecord | null {
  let newest: FocusRecord | null = null;
  for (const id of filingIds) {
    const path = focusPath(dbPath, id, env);
    if (!existsSync(path)) continue;
    const record = JSON.parse(readFileSync(path, "utf-8")) as FocusRecord;
    if (newest === null || record.at > newest.at) newest = record;
  }
  return newest;
}
