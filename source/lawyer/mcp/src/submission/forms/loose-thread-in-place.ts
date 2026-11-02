// The Loose Threads page's cards for snipped work that keeps a record or file of its own: shelved jobs,
// killed propositions and submissions, started or unrecorded legal memos, retired unsent letters and
// closed Work Boards with no Writing. Each is read where it stays, at each write, and the page only names
// and links it, so nothing here is a copy to keep in step and no killed row leaves the working database.
// A live letter is not cut off, so it is not here, and neither is a letter that went out. An undecided
// proposition may still be used: it stays on the Legal Research page alone.

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

import { pageApiFileUrl } from "../../page-api/token.js";
import { rows } from "../query-rows.js";
import { hasColumn } from "../schema-capabilities.js";
import { writingFolders } from "../writing-folder.js";
import { buildProceedingBoard } from "./build-proceeding-board.js";
import { buildLegalMemosData } from "./legal-memos.js";
import { liveTicketClause, MILESTONE_KIND } from "./query.js";
import { LETTER_KIND } from "./render-matter-board.js";
import { killedPropositions } from "./research-propositions.js";

export type PageTab = "jobs" | "ideas" | "propositions" | "memos" | "correspondence" | "arguments" | "work_boards";

export interface InPlaceCard {
  tab: PageTab;
  /** The record it stays on: `Job #12`, `Submission #4`. A memo's is its folder under 6. LAW. */
  record: string;
  /** Its own words, read from that record at this write. */
  title: string;
  /** Why it is here: Shelved, Killed, Started, No job, Retired, Closed. */
  status: string;
  date: string | null;
  /** The link that opens its file or Work Board page, and the path behind it; null with neither. */
  url: string | null;
  path: string | null;
}

/** A Work Board page by its filing or proceeding (matter-page-groups.ts pageTargets). */
export interface BoardPage {
  filing_id: number | null;
  proceeding_id: number;
  file: string;
}

const link = (path: string | undefined): Pick<InPlaceCard, "url" | "path"> => (path === undefined ? { url: null, path: null } : { url: pageApiFileUrl(path), path });

const list = (ids: number[]) => ids.map(() => "?").join(",");

/** Every in-place card of these proceedings. With no draft folder (a store read outside a page write) memos, links and folders are left out. */
export function inPlaceCards(dbPath: string, proceedings: number[], draftDir?: string, boards: BoardPage[] = []): InPlaceCard[] {
  if (proceedings.length === 0) return [];
  const pageOf = (filingId: number | null, proceedingId: number): string | undefined => {
    const board = boards.find((b) => b.filing_id === filingId && filingId !== null) ?? boards.find((b) => b.proceeding_id === proceedingId);
    return board === undefined || draftDir === undefined ? undefined : join(draftDir, board.file);
  };
  const jobs = rows<{ id: number; title: string; rejected_at: string; filing_id: number | null; proceeding_id: number }>(
    dbPath,
    `SELECT id, title, rejected_at, filing_id, proceeding_id FROM tickets WHERE rejected_at IS NOT NULL AND proceeding_id IN (${list(proceedings)})${liveTicketClause(dbPath)} ORDER BY rejected_at DESC, id`,
    proceedings
  ).map((j): InPlaceCard => ({ tab: "jobs", record: `Job #${j.id}`, title: j.title, status: "Shelved", date: j.rejected_at.slice(0, 10), ...link(pageOf(j.filing_id, j.proceeding_id)) }));

  const propositions = killedPropositions(dbPath, proceedings).map((p): InPlaceCard => ({
    tab: "propositions",
    record: p.law_assertion_id === null ? "Statement of law" : `Proposition #${p.law_assertion_id}`,
    title: p.text ?? [p.statements[0]?.citation_title, p.statements[0]?.citation_rest].filter(Boolean).join(""),
    status: "Killed",
    date: p.killed_on,
    url: null,
    path: null,
  }));

  const memos = draftDir === undefined
    ? []
    : buildLegalMemosData(dbPath, proceedings.flatMap((p) => buildProceedingBoard(dbPath, p).tickets.map((t) => t.ticket)), dirname(draftDir))
        .memos.filter((m) => m.status === "started" || m.status === "no_job")
        .map((m): InPlaceCard => ({ tab: "memos", record: m.folder === "" ? "6. LAW" : m.folder, title: m.title, status: m.status === "started" ? "Started" : "No job", date: m.date, ...link(m.on_disk ? m.path : undefined) }));

  const filings = rows<{ id: number; kind: string; title: string; retired_on: string; retirement_reason: string | null; filed_on: string | null; sent_copy_id?: number | null }>(
    dbPath,
    `SELECT id, kind, title, retired_on, retirement_reason, filed_on${hasColumn(dbPath, "filings", "sent_copy_id") ? ", sent_copy_id" : ""} FROM filings WHERE retired_on IS NOT NULL AND proceeding_id IN (${list(proceedings)}) ORDER BY retired_on DESC, id`,
    proceedings
  );
  const folders = draftDir !== undefined && existsSync(draftDir) ? writingFolders(dbPath, draftDir) : new Map<number, { name: string }>();
  const letters = filings
    .filter((f) => LETTER_KIND.test(f.kind) && f.filed_on === null && (f.sent_copy_id ?? null) === null && f.retirement_reason !== "delivered")
    .map((f): InPlaceCard => {
      const folder = folders.get(f.id);
      return { tab: "correspondence", record: `Writing #${f.id}`, title: f.title, status: "Retired", date: f.retired_on, ...link(folder === undefined || draftDir === undefined ? undefined : join(draftDir, folder.name)) };
    });
  const closed = filings
    .filter((f) => f.kind === MILESTONE_KIND)
    .map((f): InPlaceCard => ({ tab: "work_boards", record: `Work Board #${f.id}`, title: f.title, status: "Closed", date: f.retired_on, url: null, path: null }));

  const killed = rows<{ id: number; contention: string; killed_on: string }>(
    dbPath,
    `SELECT id, contention, killed_on FROM submissions WHERE killed_on IS NOT NULL AND proceeding_id IN (${list(proceedings)}) ORDER BY killed_on DESC, id`,
    proceedings
  ).map((s): InPlaceCard => ({ tab: "arguments", record: `Submission #${s.id}`, title: s.contention, status: "Killed", date: s.killed_on, url: null, path: null }));

  return [...jobs, ...propositions, ...memos, ...letters, ...killed, ...closed];
}
