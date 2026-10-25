// ---------------------------------------------------------------------------------------------
// The state sidecar (R4): what board_changed and board_moves compare against, and the last to-dos.
// ---------------------------------------------------------------------------------------------

import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { DataServerError } from "../errors.js";
import type { Category, WorkBoardData, WorkBoardTicket } from "./forms/render-work-board.js";
import type { MatterTodos } from "./matter-todos.js";
import { recordsDir, sha256 } from "./render-manifest.js";
import { writeStatusFile } from "./render-job.js";

export const PAGES_STATE_FILE = "matter-pages-state.json";

/** What the Litigation Strategy draws when its caller read no to-dos: a direct call, never a tool entry point. */
export const TODOS_NOT_READ: MatterTodos = { note: "This matter's to-dos were not read." };

export interface BoardMove {
  id: number;
  title: string;
  from: Category | null;
  to: Category | null;
}

interface SectionState {
  key: string;
  tickets: Pick<WorkBoardTicket, "id" | "title" | "category">[];
}

interface PagesState {
  todos?: MatterTodos;
  sections: Record<string, SectionState>;
  /** Each session's own last-reported sections, by session token, in first-render order. */
  sessions?: Record<string, { sections: Record<string, SectionState> }>;
}

/** The most sessions the state file keeps a snapshot for; the one whose first render came earliest drops first. */
const MAX_SESSIONS = 20;

function statePath(dbPath: string): string {
  return join(recordsDir(dbPath), PAGES_STATE_FILE);
}

function isTodos(value: unknown): value is MatterTodos {
  if (typeof value !== "object" || value === null) return false;
  const todos = value as Record<string, unknown>;
  return Array.isArray(todos.rows) || typeof todos.note === "string";
}

function isSectionState(value: unknown): value is SectionState {
  if (typeof value !== "object" || value === null) return false;
  const section = value as Record<string, unknown>;
  return typeof section.key === "string" && Array.isArray(section.tickets);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The state file, or an empty one when it is missing or malformed: every section then reads as never
 * reported. A file without `sessions`, or with a malformed one, reads as having no session's snapshot. */
function readPagesState(dbPath: string): PagesState {
  try {
    const parsed = JSON.parse(readFileSync(statePath(dbPath), "utf-8")) as Record<string, unknown>;
    const sections = parsed.sections;
    if (!isRecord(sections)) return { sections: {} };
    return {
      ...(isTodos(parsed.todos) ? { todos: parsed.todos } : {}),
      sections: sections as Record<string, SectionState>,
      ...(isRecord(parsed.sessions) ? { sessions: parsed.sessions as PagesState["sessions"] } : {}),
    };
  } catch {
    return { sections: {} };
  }
}

/** One session's recorded sections, or none when it has no well-formed entry. */
function sessionSections(state: PagesState, token: string): Record<string, SectionState> {
  const entry = state.sessions?.[token] as unknown;
  return isRecord(entry) && isRecord(entry.sections) ? (entry.sections as Record<string, SectionState>) : {};
}

/** The to-dos the last call that read the registry recorded, for the background job's Litigation Strategy. */
export function persistedTodos(dbPath: string): MatterTodos {
  return readPagesState(dbPath).todos ?? TODOS_NOT_READ;
}

/** Board data compared without meta.rendered, the one field every render changes. */
function boardDataKey(data: unknown): string | undefined {
  if (data === undefined) return undefined;
  const { meta, ...rest } = JSON.parse(JSON.stringify(data)) as { meta?: Record<string, unknown> };
  const { rendered: _rendered, ...stable } = meta ?? {};
  return JSON.stringify({ ...rest, meta: stable });
}

/** #1035: the jobs that appeared, went, or changed column since the section last reported, in the
 * new board's order then the gone jobs', so a session names only a move the server compared. */
function boardMovesOf(prior: { tickets: Pick<WorkBoardTicket, "id" | "title" | "category">[] }, next: WorkBoardData): BoardMove[] {
  const before = new Map(prior.tickets.map((t) => [t.id, t]));
  const after = new Set(next.tickets.map((t) => t.id));
  const moves: BoardMove[] = [];
  for (const t of next.tickets) {
    const from = before.get(t.id)?.category ?? null;
    if (from !== t.category) moves.push({ id: t.id, title: t.title, from, to: t.category });
  }
  for (const t of before.values()) if (!after.has(t.id)) moves.push({ id: t.id, title: t.title, from: t.category, to: null });
  return moves;
}

/**
 * Records the to-dos a call read (never the not-read placeholder) and, for a foreground render that
 * wrote the pages, the section it rendered. Returns that section's board_changed -- true when no
 * section was recorded for it or the recorded one differs apart from meta.rendered -- and, when one
 * was recorded, board_moves against it. With a session token the comparison is against that
 * session's own last report of the section, or the shared one before its first, so another session's
 * render between two of this session's never hides a move from it.
 */
export function recordPagesState(
  dbPath: string,
  todos: MatterTodos,
  section?: WorkBoardData,
  sessionToken?: string
): { board_changed: boolean; board_moves?: BoardMove[] } | undefined {
  if (todos === TODOS_NOT_READ && section === undefined) return undefined;
  const state = readPagesState(dbPath);
  let change: { board_changed: boolean; board_moves?: BoardMove[] } | undefined;
  if (section !== undefined) {
    const id = section.meta.filing_id === null ? `proceeding:${section.meta.proceeding_id}` : `filing:${section.meta.filing_id}`;
    const own = sessionToken ? sessionSections(state, sessionToken) : {};
    const stored = isSectionState(own[id]) ? own[id] : isSectionState(state.sections[id]) ? state.sections[id] : undefined;
    const key = sha256(boardDataKey(section) as string);
    change = { board_changed: stored?.key !== key, ...(stored ? { board_moves: boardMovesOf(stored, section) } : {}) };
    const recorded = { key, tickets: section.tickets.map(({ id: ticketId, title, category }) => ({ id: ticketId, title, category })) };
    state.sections[id] = recorded;
    if (sessionToken) {
      const sessions = state.sessions ?? {};
      // An existing token keeps its place, so the order stays that of each session's first render.
      sessions[sessionToken] = { sections: { ...own, [id]: recorded } };
      const tokens = Object.keys(sessions);
      for (const token of tokens.slice(0, Math.max(0, tokens.length - MAX_SESSIONS))) delete sessions[token];
      state.sessions = sessions;
    }
  }
  const next: PagesState = {
    ...(todos !== TODOS_NOT_READ ? { todos } : state.todos ? { todos: state.todos } : {}),
    sections: state.sections,
    ...(state.sessions ? { sessions: state.sessions } : {}),
  };
  mkdirSync(recordsDir(dbPath), { recursive: true });
  const code = writeStatusFile(statePath(dbPath), JSON.stringify(next, null, 2) + "\n");
  if (code !== null) throw new DataServerError(`could not write ${statePath(dbPath)}: ${code}`);
  return change;
}
