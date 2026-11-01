// The Legal Research page's Case Briefs tab (legal-research-page.ts), and drafting_forms__board_card's
// `briefs` lane, which prints the same list from the same reader: each case the board's Writings rely
// on, whether it is briefed, requested or not briefed, then each brief or request for a case they do
// not rely on.
//
// Relied on: a case authority, not killed, behind a statement of law in use on one of the board's
// Writings, as the Propositions tab reads "in use" (research-propositions.ts), its proposition not omitted.
// One case is one row: authorities are per proceeding and de-duplicated by exact citation, so rows are
// folded by the citation (citationKey), and an authority with none stands alone.
//
// A brief is a file of one case (`<date> case brief <style of cause>, <citation>.md`), and every file of a
// case is on its one row, latest first. A file belongs to the case its brief job's authority names; with
// none, to the case its name's neutral citation names, else a case with no neutral citation whose citation
// text its name holds, else the one case of its style of cause (caseOfFile).
// Briefed: one of the case's brief files is on disk. A recorded answer gone from disk stays on its row,
// marked, and is no brief: a new request can be made.
// Requested: not briefed, and a live brief job (title `Brief the case: `) scoped to an authority of the case
// on any board of the board's proceedings: there is one per case per proceeding, which
// drafting_data__create_job's guard holds. A board with no Writing names no proceeding, so reads them all.
// Everything shown is recorded, and only names and dates are read from disk. A brief's text is never read.

import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { rows } from "../query-rows.js";
import { hasColumn } from "../schema-capabilities.js";
import { baseName, dateOf, isCaseBriefFile, lawDirOf, modified, scanLawFolder, titleOf, versionOf } from "./legal-memos.js";
import { BRIEF_JOB_PREFIX, citationKey, neutralKey, squashed } from "./brief-job.js";
import { liveTicketClause, ticketAnswersHeld } from "./query.js";

export type BriefStatus = "briefed" | "requested" | "not_briefed";

export interface CaseBriefVersion {
  /** Its place among the case's files, oldest first, never below the ` vN` in its own name. */
  version: number;
  /** Its date: from its name, else when its job last saved it, else its file's. */
  date: string | null;
  /** Its path from `6. LAW`. */
  file: string;
  /** Its file URL, which the page links to. */
  url: string;
  /** False when a job recorded the file but it is not in the law folder now. */
  on_disk: boolean;
}

/** The case's latest version, with the others. */
export interface CaseBriefFile extends CaseBriefVersion {
  /** The other versions' numbers, ascending. */
  earlier: number[];
  /** The other versions, latest first. */
  earlier_files: CaseBriefVersion[];
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
  proceeding_id: number;
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
    `SELECT t.id, t.proceeding_id, t.title, t.status, t.rejected_at, a.id AS authority_id, a.style_of_cause_or_title, a.citation
     FROM tickets t
     LEFT JOIN ticket_scope s ON s.ticket_id = t.id AND s.entity = 'authorities'
     LEFT JOIN authorities a ON a.id = s.entity_id
     WHERE t.title LIKE '${BRIEF_JOB_PREFIX}%'${liveTicketClause(dbPath, "t")}
     ORDER BY t.id`
  );
}

/** One case's fold key: its citation's, else its authority's id, else a job's or brief's own name. */
function foldKey(citation: string | null, authorityId: number | null, name: string): string {
  return citationKey(citation) ?? (authorityId !== null ? `id:${authorityId}` : `name:${name.toLowerCase()}`);
}

/** Where a citation opens after the style of cause: a neutral or CanLII citation, a bracketed or
 * parenthesised year, or a volume. A numbered company in the style (`0123456 BC Ltd`) is none of these. */
const CITATION_IN_NAME = /,\s+((?:\d{4} (?:[A-Z]{2,}|CanLII)|[[(]\d{4}[\])]|\d{1,3} [A-Z]).*)$/;

/** A brief file's own name of its case: what follows `case brief `, as its style of cause and citation. */
function briefCase(file: string): { whole: string; style: string; citation: string | null } {
  const whole = titleOf(file).replace(/^case brief\s+/i, "");
  const m = CITATION_IN_NAME.exec(whole);
  return m === null ? { whole, style: whole, citation: null } : { whole, style: whole.slice(0, m.index), citation: m[1] };
}

interface KnownCase {
  key: string;
  style: string | null;
  citation: string | null;
}

/** Whether a name holds this citation's text, its case and spacing aside, and not as part of a longer number. */
function holdsCitation(name: string, citation: string): boolean {
  const text = squashed(citation).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<!\\d)${text}(?!\\d)`).test(squashed(name));
}

/** The known case a brief file names, or null: its neutral citation, else a case with no neutral citation
 * whose citation text it holds, else the one case of its style of cause. A style never joins a citation to a
 * different neutral citation, which is another decision of that name. */
function caseOfFile(file: string, known: KnownCase[]): string | null {
  const { whole, style, citation } = briefCase(file);
  const neutral = neutralKey(whole);
  if (neutral !== null && known.some((c) => c.key === neutral)) return neutral;
  const cited = known.find((c) => c.citation !== null && neutralKey(c.citation) === null && holdsCitation(whole, c.citation));
  if (cited !== undefined) return cited.key;
  const styled = known.filter((c) => c.style !== null && squashed(c.style) === squashed(style) && (neutralKey(c.citation) === null || citation === null));
  const keys = new Set(styled.map((c) => c.key));
  return keys.size === 1 ? styled[0].key : null;
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
  const relied = reliedOn(dbPath, filingIds);
  for (const a of relied) row(foldKey(a.citation, a.id, a.style_of_cause_or_title), a.style_of_cause_or_title, a.citation, true);
  const known: KnownCase[] = [
    ...relied.map((a) => ({ key: foldKey(a.citation, a.id, a.style_of_cause_or_title), style: a.style_of_cause_or_title, citation: a.citation })),
    ...jobs.filter((j) => j.authority_id !== null).map((j) => ({ key: foldKey(j.citation, j.authority_id, j.title), style: j.style_of_cause_or_title, citation: j.citation })),
  ];

  // Each case's files. A job's answer sits on its authority's case, and every ` vN` of a file on that file's case.
  const jobOf = new Map(jobs.map((j) => [j.id, j]));
  const files = new Map<string, Map<string, { file: string; savedAt: string | null }>>();
  const caseOfStem = new Map<string, string>();
  const addFile = (file: string, caseKey: string, savedAt: string | null) => {
    caseOfStem.set(versionOf(file).key, caseKey);
    const own = files.get(caseKey) ?? new Map<string, { file: string; savedAt: string | null }>();
    const entry = own.get(file.toLowerCase()) ?? { file, savedAt: null };
    if (savedAt !== null && (entry.savedAt === null || savedAt > entry.savedAt)) entry.savedAt = savedAt;
    own.set(file.toLowerCase(), entry);
    files.set(caseKey, own);
  };
  const ownKey = (file: string) => neutralKey(briefCase(file).whole) ?? `name:${squashed(briefCase(file).whole)}`;
  for (const a of answers) {
    if (!isCaseBriefFile(baseName(a.file_path))) continue;
    const job = jobOf.get(a.ticket_id) as BriefJob;
    const key = job.authority_id !== null ? foldKey(job.citation, job.authority_id, job.title) : (caseOfFile(a.file_path, known) ?? neutralKey(briefCase(a.file_path).whole) ?? foldKey(job.citation, null, job.title));
    addFile(a.file_path, key, a.saved_at);
  }
  for (const f of onDisk.values()) {
    addFile(f.file, caseOfStem.get(versionOf(f.file).key) ?? caseOfFile(f.file, known) ?? ownKey(f.file), null);
  }

  for (const [caseKey, own] of files) {
    const versions = [...own.values()]
      .map(({ file, savedAt }) => {
        const path = join(matterDir, ...file.split(/[\\/]/));
        const found = onDisk.get(file.toLowerCase());
        const mtime = found !== undefined ? found.mtime : modified(path);
        const { key, version } = versionOf(file);
        return { key, own: version, date: dateOf(file, savedAt, mtime), file, url: pathToFileURL(path).href, on_disk: found !== undefined || mtime !== null };
      })
      .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || a.key.localeCompare(b.key) || a.own - b.own);
    let last = 0;
    const numbered: CaseBriefVersion[] = versions.map(({ date, file, url, on_disk, own: number }) => {
      last = Math.max(last + 1, number);
      return { version: last, date, file, url, on_disk };
    });
    const current = numbered[numbered.length - 1];
    const older = numbered.slice(0, -1);
    const { style, citation } = briefCase(current.file);
    const target = row(caseKey, style, citation, false);
    if (target.citation === null) target.citation = citation;
    target.brief = { ...current, earlier: older.map((v) => v.version), earlier_files: [...older].reverse() };
  }

  const proceedings =
    filingIds.length === 0 ? null : new Set(rows<{ proceeding_id: number }>(dbPath, `SELECT proceeding_id FROM filings WHERE id IN (${filingIds.map(() => "?").join(", ")})`, filingIds).map((r) => r.proceeding_id));
  for (const j of jobs) {
    if ((j.status !== "queued" && j.status !== "wip") || j.rejected_at !== null) continue;
    if (proceedings !== null && !proceedings.has(j.proceeding_id)) continue;
    const target = row(foldKey(j.citation, j.authority_id, j.title), j.style_of_cause_or_title ?? j.title.slice(BRIEF_JOB_PREFIX.length), j.citation, false);
    target.jobs.push({ id: j.id, title: j.title });
  }

  const all = [...cases.values()];
  const held = (b: CaseBriefFile) => b.on_disk || b.earlier_files.some((v) => v.on_disk);
  for (const c of all) c.status = c.brief !== null && held(c.brief) ? "briefed" : c.jobs.length > 0 ? "requested" : "not_briefed";
  const reliedRows = all.filter((c) => c.relied_on);
  const rest = all.filter((c) => !c.relied_on).sort((a, b) => (b.brief?.date ?? "").localeCompare(a.brief?.date ?? "") || a.title.localeCompare(b.title));
  return { cases: [...reliedRows, ...rest] };
}
