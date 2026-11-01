// The Legal Research page's Case Briefs tab (legal-research-page.ts), and drafting_forms__board_card's
// `briefs` lane, which prints the same list from the same reader: each case the board's Writings rely
// on, whether it is briefed, requested or not briefed, then each brief or request for a case they do
// not rely on.
//
// Relied on: a case authority, not killed, behind a statement of law in use on one of the board's
// Writings, as the Propositions tab reads "in use" (research-propositions.ts), its proposition not omitted.
// One case is one row: authorities are per proceeding and de-duplicated by exact citation, so rows are
// folded by the neutral citation inside the citation, and an authority with none stands alone.
//
// Briefed: a case brief file (`<date> case brief <style of cause>, <citation>.md`, every saved version
// the same brief) naming the case's neutral citation, or saved by a brief job scoped to its authority.
// Requested: no brief yet, and a live brief job (title `Brief the case: `) scoped to its authority, on any
// board: there is one per case per proceeding. Everything shown is recorded, and only names and dates
// are read from disk. A brief's text is never read.

import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { rows } from "../query-rows.js";
import { hasColumn } from "../schema-capabilities.js";
import { baseName, dateOf, isCaseBriefFile, lawDirOf, modified, scanLawFolder, titleOf, versionOf } from "./legal-memos.js";
import { liveTicketClause, ticketAnswersHeld } from "./query.js";

/** The fixed title that marks a case brief job. A note-up job scopes authorities too. */
export const BRIEF_JOB_PREFIX = "Brief the case: ";

export type BriefStatus = "briefed" | "requested" | "not_briefed";

export interface CaseBriefFile {
  /** The current version's date: from its name, else its file's. */
  date: string | null;
  version: number;
  /** The other versions' numbers, ascending. */
  earlier: number[];
  /** The current version's path from `6. LAW`. */
  file: string;
  /** The current version's file URL, which the page links to. */
  url: string;
  /** False when a job recorded the file but it is not in the law folder now. */
  on_disk: boolean;
}

export interface CaseBriefRow {
  /** The style of cause, or a brief's or job's own name when no authority row names the case. */
  title: string;
  citation: string | null;
  status: BriefStatus;
  /** Whether one of the board's Writings relies on the case. */
  relied_on: boolean;
  /** The live brief jobs naming the case. */
  jobs: { id: number; title: string }[];
  brief: CaseBriefFile | null;
}

export interface CaseBriefsData {
  /** The relied-on cases by style of cause, then the rest, newest brief first. */
  cases: CaseBriefRow[];
}

const NEUTRAL_IN_TEXT = /\b(\d{4}) ([A-Z]{2,}[A-Za-z]*) (\d+)\b/;

/** A text's neutral citation, as its fold key, or null when it holds none. */
export function neutralKey(text: string | null): string | null {
  const m = text === null ? null : NEUTRAL_IN_TEXT.exec(text);
  return m === null ? null : `${m[1]} ${m[2]} ${m[3]}`.toLowerCase();
}

interface ReliedRow {
  id: number;
  style_of_cause_or_title: string;
  citation: string | null;
}

/** The case authorities behind a statement in use on these Writings. */
function reliedOn(dbPath: string, filingIds: number[]): ReliedRow[] {
  if (filingIds.length === 0) return [];
  const inIds = `(${filingIds.map(() => "?").join(", ")})`;
  const notOmitted = hasColumn(dbPath, "law_assertions", "killed_on") ? "AND (la.id IS NULL OR la.killed_on IS NULL)" : "";
  return rows<ReliedRow>(
    dbPath,
    `SELECT DISTINCT a.id, a.style_of_cause_or_title, a.citation
     FROM statements_of_law sl
     JOIN authorities a ON a.id = sl.authority_id
     LEFT JOIN law_assertions la ON la.id = sl.law_assertion_id
     WHERE a.kind = 'case' AND a.killed_on IS NULL ${notOmitted}
       AND (sl.id IN (SELECT statement_id FROM filing_law WHERE filing_id IN ${inIds})
         OR sl.id IN (SELECT r.excerpt_id FROM order_sought_requires r JOIN filing_orders fo ON fo.order_sought_id = r.order_sought_id WHERE fo.filing_id IN ${inIds})
         OR sl.law_assertion_id IN (SELECT r.law_assertion_id FROM order_sought_requires r JOIN filing_orders fo ON fo.order_sought_id = r.order_sought_id WHERE fo.filing_id IN ${inIds})
         OR sl.law_assertion_id IN (
           SELECT sbl.law_assertion_id FROM submission_law sbl
           JOIN submissions s ON s.id = sbl.submission_id AND s.killed_on IS NULL
           JOIN filing_submissions fs ON fs.submission_id = s.id
           WHERE fs.filing_id IN ${inIds}))
     ORDER BY a.style_of_cause_or_title, a.id`,
    [...filingIds, ...filingIds, ...filingIds, ...filingIds]
  );
}

interface BriefJob {
  id: number;
  title: string;
  status: string;
  rejected_at: string | null;
  authority_id: number | null;
  style_of_cause_or_title: string | null;
  citation: string | null;
}

/** Every brief job not deleted, with the authority its scope names. */
function briefJobs(dbPath: string): BriefJob[] {
  return rows<BriefJob>(
    dbPath,
    `SELECT t.id, t.title, t.status, t.rejected_at, a.id AS authority_id, a.style_of_cause_or_title, a.citation
     FROM tickets t
     LEFT JOIN ticket_scope s ON s.ticket_id = t.id AND s.entity = 'authorities'
     LEFT JOIN authorities a ON a.id = s.entity_id
     WHERE t.title LIKE '${BRIEF_JOB_PREFIX}%'${liveTicketClause(dbPath, "t")}
     ORDER BY t.id`
  );
}

/** One case's fold key: its neutral citation, else its authority's id, else a job's or brief's own name. */
function foldKey(citation: string | null, authorityId: number | null, name: string): string {
  return neutralKey(citation) ?? (authorityId !== null ? `id:${authorityId}` : `name:${name.toLowerCase()}`);
}

/** The case's name in a brief file's title: what follows `case brief `, less a trailing citation. */
function briefCaseName(file: string): string {
  return titleOf(file).replace(/^case brief\s+/i, "");
}

/**
 * The tab's data for one board's Writings. `matterDir` is the matter folder holding `6. LAW`.
 */
export function buildCaseBriefsData(dbPath: string, filingIds: number[], matterDir: string): CaseBriefsData {
  const lawDir = lawDirOf(matterDir);
  const onDisk = new Map(scanLawFolder(lawDir, isCaseBriefFile).map((f) => [f.file.toLowerCase(), f]));
  const jobs = briefJobs(dbPath);
  const answers = ticketAnswersHeld(dbPath)
    ? rows<{ ticket_id: number; file_path: string; saved_at: string }>(dbPath, `SELECT ta.ticket_id, ta.file_path, ta.saved_at FROM ticket_answers ta JOIN tickets t ON t.id = ta.ticket_id WHERE t.title LIKE '${BRIEF_JOB_PREFIX}%'${liveTicketClause(dbPath, "t")}`)
    : [];

  const cases = new Map<string, CaseBriefRow>();
  const row = (key: string, title: string, citation: string | null, relied: boolean): CaseBriefRow => {
    const found = cases.get(key);
    if (found !== undefined) {
      if (relied) found.relied_on = true;
      return found;
    }
    const made: CaseBriefRow = { title, citation, status: "not_briefed", relied_on: relied, jobs: [], brief: null };
    cases.set(key, made);
    return made;
  };
  for (const a of reliedOn(dbPath, filingIds)) row(foldKey(a.citation, a.id, a.style_of_cause_or_title), a.style_of_cause_or_title, a.citation, true);

  // Each brief's versions, by the case its job's authority or its own name names.
  const jobOf = new Map(jobs.map((j) => [j.id, j]));
  const versions = new Map<string, { key: string; files: Map<number, string>; savedAt: string | null }>();
  const addFile = (file: string, caseKey: string, savedAt: string | null) => {
    const { key, version } = versionOf(file);
    const entry = versions.get(key) ?? { key: caseKey, files: new Map<number, string>(), savedAt: null };
    if (!entry.files.has(version)) entry.files.set(version, file);
    if (savedAt !== null && (entry.savedAt === null || savedAt > entry.savedAt)) entry.savedAt = savedAt;
    versions.set(key, entry);
  };
  for (const a of answers) {
    const job = jobOf.get(a.ticket_id);
    const name = baseName(a.file_path);
    addFile(a.file_path, neutralKey(name) ?? (job === undefined ? `name:${name.toLowerCase()}` : foldKey(job.citation, job.authority_id, job.title)), a.saved_at);
  }
  for (const f of onDisk.values()) {
    const { key } = versionOf(f.file);
    const name = baseName(f.file);
    addFile(f.file, versions.get(key)?.key ?? neutralKey(name) ?? `name:${briefCaseName(f.file).toLowerCase()}`, null);
  }

  for (const entry of versions.values()) {
    const numbers = [...entry.files.keys()].sort((a, b) => a - b);
    const version = numbers[numbers.length - 1];
    const file = entry.files.get(version) as string;
    const segments = file.split(/[\\/]/);
    const path = join(matterDir, ...segments);
    const found = onDisk.get(file.toLowerCase());
    const mtime = found !== undefined ? found.mtime : modified(path);
    const brief: CaseBriefFile = {
      date: dateOf(file, entry.savedAt, mtime),
      version,
      earlier: numbers.slice(0, -1),
      file,
      url: pathToFileURL(path).href,
      on_disk: found !== undefined || mtime !== null,
    };
    const target = row(entry.key, briefCaseName(file), null, false);
    if (target.brief === null || (brief.date ?? "") > (target.brief.date ?? "")) target.brief = brief;
  }

  for (const j of jobs) {
    if ((j.status !== "queued" && j.status !== "wip") || j.rejected_at !== null) continue;
    const target = row(foldKey(j.citation, j.authority_id, j.title), j.style_of_cause_or_title ?? j.title.slice(BRIEF_JOB_PREFIX.length), j.citation, false);
    target.jobs.push({ id: j.id, title: j.title });
  }

  const all = [...cases.values()];
  for (const c of all) c.status = c.brief !== null ? "briefed" : c.jobs.length > 0 ? "requested" : "not_briefed";
  const relied = all.filter((c) => c.relied_on);
  const rest = all.filter((c) => !c.relied_on).sort((a, b) => (b.brief?.date ?? "").localeCompare(a.brief?.date ?? "") || a.title.localeCompare(b.title));
  return { cases: [...relied, ...rest] };
}
