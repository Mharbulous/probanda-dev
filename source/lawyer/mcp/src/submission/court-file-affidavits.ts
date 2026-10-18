// Affidavit status reconciled against the court file (spec 2026-10-09
// affidavit-status-court-file-reconciliation). Read-only: it lists the matter's court-file folder
// and reads the drafting database, and writes nothing. Recording a court-file date stays an
// ordinary /drafting-data write, made only on the practitioner's yes.
//
// The check reads file names only, under /file-naming's convention
// (`YYYY-MM-DD AFF<n> <deponent code> ... <status marker>`): no OCR, no file content. An unfiled
// court document is dated by its signing, a filed one by its court stamp, so only a SIGNED,
// AFFIRMED or SWORN name gives a made date; a FILED name gives the status alone.

import { readdirSync } from "node:fs";
import { join } from "node:path";

import { submissionDataQuery } from "./backend.js";

const STATUSES = ["SIGNED", "AFFIRMED", "SWORN", "FILED", "UNFILED", "UNSIGNED", "UNSWORN"] as const;
export type CourtFileStatus = (typeof STATUSES)[number];

/** The markers whose name date is the made date. */
const MADE: ReadonlySet<CourtFileStatus> = new Set(["SIGNED", "AFFIRMED", "SWORN"]);
/** The markers that show the affidavit was executed. */
const EXECUTED: ReadonlySet<CourtFileStatus> = new Set(["SIGNED", "AFFIRMED", "SWORN", "FILED"]);
/** Same-date tie-break: the furthest-along status wins. */
const RANK: Record<CourtFileStatus, number> = { FILED: 3, SIGNED: 2, AFFIRMED: 2, SWORN: 2, UNFILED: 1, UNSIGNED: 0, UNSWORN: 0 };

const AFFIDAVIT_NAME = /^(\d{4}-\d{2}-\d{2}) AFF#?(\d+)(?: of)? (\S+)(.*)\.(?:pdf|docx?)$/i;

export interface CourtFileName {
  file_name: string;
  date: string;
  number: string;
  deponent_code: string;
  status: CourtFileStatus | null;
}

/** A court-file name that names an affidavit by number, or null. The status is the last marker in the name. */
export function parseAffidavitName(fileName: string): CourtFileName | null {
  const m = AFFIDAVIT_NAME.exec(fileName);
  if (m === null) return null;
  const markers = m[4]
    .toUpperCase()
    .split(/\s+/)
    .filter((t): t is CourtFileStatus => (STATUSES as readonly string[]).includes(t));
  return { file_name: fileName, date: m[1], number: m[2], deponent_code: m[3], status: markers.length > 0 ? markers[markers.length - 1] : null };
}

/** /file-naming's individual token: last name plus the first given name's initial ("Jane Smith" -> "SmithJ"). */
export function deponentCode(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => w !== "");
  if (words.length === 0) return "";
  if (words.length === 1) return words[0];
  return `${words[words.length - 1]}${words[0][0].toUpperCase()}`;
}

/** The proceeding's court-file folder: the one "COURT FILE" folder, or with several the one naming its file number. */
export function courtFileFolder(matterRoot: string, fileNumber: string | null): { path: string } | { note: string } {
  let names: string[];
  try {
    names = readdirSync(matterRoot, { withFileTypes: true })
      .filter((e) => (e.isDirectory() || e.isSymbolicLink()) && /COURT FILE/i.test(e.name))
      .map((e) => e.name)
      .sort();
  } catch (err) {
    return { note: `the matter folder could not be listed (${(err as NodeJS.ErrnoException).code ?? "error"})` };
  }
  if (names.length === 0) return { note: "the matter has no COURT FILE folder" };
  if (names.length === 1) return { path: join(matterRoot, names[0]) };
  const fitting = fileNumber ? names.filter((n) => n.toUpperCase().includes(fileNumber.toUpperCase())) : [];
  if (fitting.length === 1) return { path: join(matterRoot, fitting[0]) };
  return { note: `no single COURT FILE folder names this proceeding's file number (${names.map((n) => `"${n}"`).join(", ")})` };
}

/** Every file name under the folder, its subfolders included. A folder that cannot be listed is skipped. */
function fileNames(dir: string): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((e) => (e.isDirectory() ? fileNames(join(dir, e.name)) : e.isFile() ? [e.name] : []));
}

export interface CourtFileAffidavit {
  document_id: number;
  label: string;
  affidavit_number: string | null;
  deponent: string | null;
  /** What drafting data records: the made date (documents.execution), null meaning unsworn. */
  recorded: { made_on: string | null };
  /** The newest court-file name matching the affidavit's number and deponent, or null: none found. */
  court_file: CourtFileName | null;
  /** The date of the newest SIGNED, AFFIRMED or SWORN match: the court file's made date. */
  court_file_made_on: string | null;
  /** Why nothing was matched, when the folder itself could not be settled or the affidavit has no number. */
  note?: string;
  /** One board item's text when the court file and drafting data disagree, else null. */
  mismatch: string | null;
}

interface RelyRow {
  document_id: number;
  label: string;
  affidavit_number: string | null;
  execution: string | null;
  deponent: string | null;
  file_number: string | null;
}

function newest(names: CourtFileName[]): CourtFileName | null {
  return [...names].sort((a, b) => b.date.localeCompare(a.date) || RANK[b.status ?? "UNSWORN"] - RANK[a.status ?? "UNSWORN"])[0] ?? null;
}

/**
 * Each affidavit the filing relies on, reconciled against the court file's names. Read-only.
 * `matterRoot` is the matter folder, the parent of its `0. DRAFT*` folder.
 */
export function courtFileAffidavits(dbPath: string, filingId: number, matterRoot: string): CourtFileAffidavit[] {
  const relied = submissionDataQuery(
    dbPath,
    `SELECT DISTINCT d.id AS document_id, d.label, d.affidavit_number, d.execution, w.name AS deponent, p.file_number
     FROM filing_documents fd
     JOIN documents d ON d.id = fd.document_id
     JOIN filings f ON f.id = fd.filing_id
     JOIN proceedings p ON p.id = f.proceeding_id
     LEFT JOIN witnesses w ON w.id = d.deponent
     WHERE fd.filing_id = ? AND (fd.role = 'affidavit' OR d.instrument = 'affidavit')
     ORDER BY fd.ordinal`,
    [filingId]
  ).rows as unknown as RelyRow[];
  if (relied.length === 0) return [];
  const folder = courtFileFolder(matterRoot, relied[0].file_number);
  const names = "path" in folder ? fileNames(folder.path).map(parseAffidavitName).filter((n): n is CourtFileName => n !== null) : [];
  return relied.map((r) => {
    const base = { document_id: r.document_id, label: r.label, affidavit_number: r.affidavit_number, deponent: r.deponent, recorded: { made_on: r.execution } };
    const number = r.affidavit_number?.match(/\d+/)?.[0];
    if (!("path" in folder) || number === undefined) {
      return { ...base, court_file: null, court_file_made_on: null, note: "path" in folder ? "drafting data records no affidavit number" : folder.note, mismatch: null };
    }
    const code = r.deponent ? deponentCode(r.deponent).toUpperCase() : null;
    const matches = names.filter((n) => String(Number(n.number)) === String(Number(number)) && (code === null || n.deponent_code.toUpperCase() === code));
    const latest = newest(matches);
    const made = newest(matches.filter((n) => n.status !== null && MADE.has(n.status)));
    const madeOn = made?.date ?? null;
    let mismatch: string | null = null;
    if (latest?.status && EXECUTED.has(latest.status) && r.execution === null) {
      mismatch = `court file shows ${latest.status.toLowerCase()} ${latest.date}; drafting data shows unsworn`;
    } else if (madeOn !== null && r.execution !== null && madeOn !== r.execution) {
      mismatch = `court file shows ${(made?.status ?? "").toLowerCase()} ${madeOn}; drafting data shows made ${r.execution}`;
    }
    return { ...base, court_file: latest, court_file_made_on: madeOn, mismatch };
  });
}

/** The made date an emitter prints when drafting data has none: the court file's, else null. The emitter warns when it uses it. */
export function courtFileMadeDate(row: CourtFileAffidavit): string | null {
  return row.recorded.made_on === null ? row.court_file_made_on : null;
}
