// Orchestrates the pre-filing consistency gate (issue #615): resolves and
// confines the package folder, extracts every document in it once, reads the
// filing's Evidence Index rows through the same query the renderer uses, and
// runs the checks in id order. Read-only: nothing here writes to the package,
// the matter, or the database.

import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import { ValidationError } from "../../errors.js";
import { zoneProblem } from "../../files/zones.js";
import { exhibitNumbersForFiling, fetchFilingDocuments } from "../forms/render-vaniac-submissions.js";
import type { FilingRow } from "../forms/query.js";
import { submissionDataQuery } from "../backend.js";
import { checkExhibitFiles, checkExhibitNumbering, checkPlaceholders, EXHIBIT_FILE_RE, type CheckResult, type IndexRow } from "./checks.js";
import { checkExecution, checkFigureConsistency, checkPartyNames, type AmountAnchor, type InstrumentRow } from "./consistency-checks.js";
import { extractDocuments, type ExtractedDocument } from "./extract.js";

function queryRows<T>(dbPath: string, sql: string, params: unknown[]): T[] {
  return submissionDataQuery(dbPath, sql, params).rows as unknown as T[];
}

export interface PreFilingChecksResult {
  package_dir: string;
  checks: CheckResult[];
  /** The Index of Exhibits as the renderer numbers it, beside the package file bearing that number, for the practitioner to eyeball. */
  index: { exhibit_number: number; label: string; file: string | null }[];
  /** Sum of page counts over every PDF in the package folder. */
  package_total_pages: number;
  package_files: { file: string; kind: string; pages: number | null }[];
}

/** Same confinement idea as render's presentation_dir (ADR 0012), loosened by one level: the
 * folder must lie somewhere beneath the matter's `0. DRAFT*` folder (a VanIAC package sits one
 * level below the Writing's own folder), never inside a privileged/disclosed tree, and a junction
 * must not resolve outside it. */
export function resolvePackageDir(packageDir: string): string {
  if (!isAbsolute(packageDir)) throw new ValidationError(`drafting_forms__pre_filing_check.package_dir must be an absolute path: ${packageDir}`);
  const dir = resolve(packageDir);
  const refuse = (why: string) => new ValidationError(`drafting_forms__pre_filing_check.package_dir ${dir}: ${why}`);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw refuse("it does not exist or is not a folder");
  const real = realpathSync.native(dir);
  const parts = real.split(/[\\/]/);
  if (zoneProblem("read", real)) throw refuse("it lies inside a privileged or disclosed tree, TRASH or 0. CASE DATA");
  const draftIdx = parts.findIndex((p) => /^0\. DRAFT/i.test(p));
  if (draftIdx === -1 || draftIdx === parts.length - 1) throw refuse("it must lie beneath the matter's 0. DRAFT folder");
  if (basename(real).toLowerCase() !== basename(dir).toLowerCase() || dirname(real).toLowerCase() !== realpathSync.native(dirname(dir)).toLowerCase()) {
    throw refuse("it resolves outside its 0. DRAFT folder");
  }
  return dir;
}

function listPackageFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && !e.name.startsWith("~$") && !e.name.startsWith("."))
    .map((e) => join(dir, e.name))
    .sort((a, b) => basename(a).localeCompare(basename(b)));
}

export function runPreFilingChecks(dbPath: string, filingId: number, packageDir: string): PreFilingChecksResult {
  const dir = resolvePackageDir(packageDir);
  const docs: ExtractedDocument[] = extractDocuments(listPackageFiles(dir));

  const [proceeding] = queryRows<{ id: number; file_number: string | null; kind: string }>(
    dbPath,
    `SELECT p.id, p.file_number, f.kind FROM filings f JOIN proceedings p ON p.id = f.proceeding_id WHERE f.id = ?`,
    [filingId]
  );

  // The gate must number exactly as the renderer did, or it would check a filing against numbers
  // it never printed -- so it goes through the renderer's own chooser. proceedingNumbers is passed
  // to C1 separately so it can tell an earlier round's exhibit from an unknown one; it is empty for
  // every non-VanIAC kind, which degrades C1 to its pre-#712 behaviour.
  const rows = fetchFilingDocuments(dbPath, filingId);
  const filing = { kind: proceeding?.kind as FilingRow["kind"], proceeding_id: proceeding?.id ?? -1 };
  const numbers = exhibitNumbersForFiling(dbPath, filing, rows.map((r) => r.document_id));
  const proceedingNumbers = filing.kind === "submissions_package" ? numbers : new Map<number, number>();
  const index: IndexRow[] = rows.map((r) => ({
    exhibit_number: numbers.get(r.document_id)!,
    document_id: r.document_id,
    label: r.label,
    file_path: r.file_path,
    already_delivered: r.provenance === "already_in_court_file",
  }));

  // The database values C3-C5 anchor to (issue #624).
  const dates = rows
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.document_date ?? ""))
    .map((r) => ({ exhibit_number: numbers.get(r.document_id)!, label: r.label, document_date: r.document_date! }));
  const amounts = queryRows<AmountAnchor>(
    dbPath,
    `SELECT DISTINCT os.id AS order_sought_id, os.wording, os.amount
     FROM filing_orders fo JOIN order_sought os ON os.id = fo.order_sought_id
     WHERE fo.filing_id = ? AND os.amount IS NOT NULL AND os.crossed_out_on IS NULL
     ORDER BY os.id`,
    [filingId]
  );
  const partyNames = queryRows<{ name: string }>(dbPath, `SELECT name FROM parties WHERE proceeding_id = ? ORDER BY ordinal, id`, [proceeding?.id ?? -1]).map((p) => p.name);
  const instruments = queryRows<InstrumentRow>(
    dbPath,
    `SELECT d.label, d.instrument, w.name AS deponent
     FROM filing_documents fd JOIN documents d ON d.id = fd.document_id LEFT JOIN witnesses w ON w.id = d.deponent
     WHERE fd.filing_id = ? AND d.instrument IS NOT NULL
     ORDER BY fd.ordinal, d.id`,
    [filingId]
  );

  const checks: CheckResult[] = [
    checkExhibitNumbering(docs, index, proceedingNumbers),
    checkPlaceholders(docs),
    checkFigureConsistency(docs, dates, amounts),
    checkPartyNames(docs, { file_number: proceeding?.file_number ?? null, party_names: partyNames }),
    checkExecution(docs, instruments),
    checkExhibitFiles(docs),
  ];

  const filesByNumber = new Map<number, string>();
  for (const d of docs) {
    const m = EXHIBIT_FILE_RE.exec(d.file_name);
    if (m) filesByNumber.set(Number(m[1]), d.file_name);
  }
  return {
    package_dir: dir,
    checks,
    index: index.map((r) => ({ exhibit_number: r.exhibit_number, label: r.label, file: filesByNumber.get(r.exhibit_number) ?? null })),
    package_total_pages: docs.filter((d) => d.kind === "pdf").reduce((sum, d) => sum + (d.pages ?? 0), 0),
    package_files: docs.map((d) => ({ file: d.file_name, kind: d.kind, pages: d.pages })),
  };
}
