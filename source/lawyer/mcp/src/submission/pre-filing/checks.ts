// The pre-filing consistency checks (issue #615): pure functions over extracted
// document text and the filing's Evidence Index rows. No I/O, no model call,
// deterministic output -- the same inputs always yield the same findings in
// the same order. The authoritative check list, pass conditions and severities
// are source/skills/drafting-data/references/pre-filing-checks.md; this file
// implements it and never edits any document (decision D4).

import type { ExtractedDocument } from "./extract.js";

export type CheckId = "C1" | "C2" | "C3" | "C4" | "C5" | "C6";
export type CheckStatus = "pass" | "fail" | "n/a";

export interface Finding {
  /** The document the offending text came from (file name). */
  document: string;
  /** 1-based page within that document; DOCX bodies are one page. */
  page: number;
  /** The offending text, quoted verbatim (the whole line it sits on). */
  quote: string;
  /** What is wrong, in one sentence, without the quote. */
  problem: string;
  /** The conflicting value or document where there is one. */
  conflict?: string;
  severity: "high" | "normal";
}

export interface CheckResult {
  id: CheckId;
  title: string;
  status: CheckStatus;
  findings: Finding[];
  note?: string;
}

export interface IndexRow {
  exhibit_number: number;
  document_id: number;
  label: string;
  file_path: string | null;
  /** True where the drafter listed this exhibit rather than shipping it: material already before
   * the forum from an earlier round (#712, provenance='already_in_court_file'). Its number is the
   * one the earlier round gave it, and its file is deliberately absent from this package. */
  already_delivered: boolean;
}

/** The exhibit-file naming the package uses: "Exhibit N - <description>.<ext>". */
export const EXHIBIT_FILE_RE = /^Exhibit (\d+)\b/i;

/** "Exhibit 5", "Ex. 5", "Exhibits 3 and 4", "Exhibits 13 to 16", "Exhibits 1, 2 and 3" --
 * optionally preceded by a party qualifier, "the Respondent's Exhibit 4".
 *
 * The qualifier is captured, not merely tolerated (#712). A qualified citation is the OTHER
 * side's exhibit: cited by their number, never renumbered into ours and never copied into our
 * package, so C1 must not go looking for it here. Without the capture, the old pattern matched
 * "Exhibit 4" inside "the Respondent's Exhibit 4" and demanded our own Exhibit 4 file -- turning
 * the settled cross-party citation form into a fresh false failure.
 *
 * Reading the qualifier as decisive is sound only because the firm's convention makes it so:
 * our own exhibits are always cited unqualified (the firm's VanIAC citation convention, recorded
 * by `/draft`); without it, "the Claimant's Exhibit 4" written about our own exhibit while we act for
 * the Claimant would slip the check. */
const EXHIBIT_REF_RE =
  /((?:the[ \t]+)?(?:claimant|respondent|applicant|petitioner|plaintiff|defendant|appellant)(?:['’]s|s['’])[ \t]+)?\bEx(?:hibit|\.)s?[ \t\r\n]+(\d+)((?:[ \t]*(?:,|and|&|to|–|-)[ \t]*\d+)*)/gi;

export function sortFindings(findings: Finding[]): Finding[] {
  return findings.sort((a, b) => a.document.localeCompare(b.document) || a.page - b.page || a.quote.localeCompare(b.quote));
}

function lineAround(text: string, offset: number): string {
  const start = text.lastIndexOf("\n", offset - 1) + 1;
  const endIdx = text.indexOf("\n", offset);
  const end = endIdx === -1 ? text.length : endIdx;
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

interface ExhibitReference {
  document: string;
  page: number;
  number: number;
  quote: string;
  /** The citation carried a party qualifier, so it names the other side's exhibit (#712). */
  qualified: boolean;
}

/** Every exhibit number a document cites, with its line and page. A range "13 to 16" expands. */
export function extractExhibitReferences(doc: ExtractedDocument): ExhibitReference[] {
  const refs: ExhibitReference[] = [];
  (doc.text_by_page ?? []).forEach((text, i) => {
    for (const m of text.matchAll(EXHIBIT_REF_RE)) {
      const quote = lineAround(text, m.index ?? 0);
      const qualified = Boolean(m[1]);
      const first = Number(m[2]);
      const numbers = [first];
      const tail = m[3] ?? "";
      const isRange = /\bto\b|–|-/.test(tail) && !/,|and|&/.test(tail);
      const rest = [...tail.matchAll(/\d+/g)].map((x) => Number(x[0]));
      if (isRange && rest.length === 1 && rest[0] > first) {
        for (let n = first + 1; n <= rest[0]; n++) numbers.push(n);
      } else {
        numbers.push(...rest);
      }
      for (const n of numbers) refs.push({ document: doc.file_name, page: i + 1, number: n, quote, qualified });
    }
  });
  return refs;
}

/** C1: every cited exhibit number exists in the Index and as a file; every Index row has a
 * file; every exhibit file has an Index row. Files whose names begin "Exhibit N" are the
 * exhibits; every other document in the package is scanned for citations.
 *
 * Rounds (#712). Exhibit numbers now run across the proceeding, so a responsive round may cite
 * an exhibit first produced in an earlier one. Three consequences, each a rule below:
 *
 * - A **qualified** citation ("the Respondent's Exhibit 4") names the other side's exhibit and is
 *   skipped outright: it is not in our Index and not in our package, by design.
 * - An exhibit **already delivered** with an earlier round (provenance='already_in_court_file')
 *   keeps its original number and carries an Index row, but its file is deliberately absent. It
 *   must therefore not be reported missing -- that was the false failure this closes -- and an
 *   `Exhibit N - …` file for it in the package is itself a finding, because the settled
 *   convention cites such an exhibit instead of re-shipping it.
 * - A number that belongs to the proceeding but has no row in *this* filing's Index is a real
 *   defect with its own wording: the drafter cited an earlier round's exhibit without listing it.
 *   `proceedingNumbers` supplies that knowledge; an empty map degrades this to the old behaviour.
 */
export function checkExhibitNumbering(
  docs: ExtractedDocument[],
  index: IndexRow[],
  proceedingNumbers: Map<number, number> = new Map()
): CheckResult {
  const findings: Finding[] = [];
  const indexByNumber = new Map(index.map((r) => [r.exhibit_number, r]));
  const numbersInProceeding = new Set<number>(proceedingNumbers.values());
  const filesByNumber = new Map<number, string>();
  for (const d of docs) {
    const m = EXHIBIT_FILE_RE.exec(d.file_name);
    if (m) filesByNumber.set(Number(m[1]), d.file_name);
  }
  const citing = docs.filter((d) => !EXHIBIT_FILE_RE.test(d.file_name) && d.text_by_page);
  const seen = new Set<string>();
  for (const doc of citing) {
    for (const ref of extractExhibitReferences(doc)) {
      // The other side's exhibit, cited by their number (#712): not ours to index or ship.
      if (ref.qualified) continue;
      const key = `${ref.document}|${ref.page}|${ref.number}|${ref.quote}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const row = indexByNumber.get(ref.number);
      const file = filesByNumber.get(ref.number);
      const inEarlierRound = !row && numbersInProceeding.has(ref.number);
      if (!row) {
        findings.push({
          document: ref.document,
          page: ref.page,
          quote: ref.quote,
          problem: inEarlierRound
            ? `cites Exhibit ${ref.number}, an exhibit of an earlier round in this proceeding, but this filing's Index of Exhibits has no row for it`
            : `cites Exhibit ${ref.number}, which is not in the Index of Exhibits`,
          conflict: inEarlierRound
            ? "an exhibit relied on from an earlier round is cited by its original number and listed in this filing's Index, marked as already before the forum -- it is the Index row that is missing, not the exhibit"
            : index.length === 0
              ? "the Index has no rows"
              : `the Index runs Ex. 1 to Ex. ${Math.max(...index.map((r) => r.exhibit_number))}`,
          severity: "normal",
        });
      }
      // An already-delivered exhibit has no file here on purpose -- reporting it missing was the
      // false failure #712 closes. Only an exhibit this round actually ships needs a file.
      // inEarlierRound is suppressed for the same reason and one more: the defect there is the
      // missing Index row, already reported above, and its file is not supposed to be here either,
      // so a second finding would point the drafter at the wrong fix.
      if (!file && !row?.already_delivered && !inEarlierRound) {
        findings.push({
          document: ref.document,
          page: ref.page,
          quote: ref.quote,
          problem: `cites Exhibit ${ref.number}, and no "Exhibit ${ref.number} - …" file is in the package folder`,
          conflict: row ? `Index: Ex. ${row.exhibit_number} — ${row.label}` : undefined,
          severity: "normal",
        });
      }
    }
  }
  for (const row of index) {
    if (row.already_delivered) {
      // The settled convention cites an earlier round's exhibit rather than re-shipping it, so a
      // file for one in this package contradicts its own Index row.
      if (filesByNumber.has(row.exhibit_number)) {
        findings.push({
          document: filesByNumber.get(row.exhibit_number)!,
          page: 1,
          quote: `Ex. ${row.exhibit_number} — ${row.label}`,
          problem: `Ex. ${row.exhibit_number} is listed as already before the forum, but an "Exhibit ${row.exhibit_number} - …" file is in this package folder`,
          conflict: "an exhibit already delivered with an earlier round is cited by its number, not shipped again",
          severity: "normal",
        });
      }
      continue;
    }
    if (!filesByNumber.has(row.exhibit_number)) {
      findings.push({
        document: "Index of Exhibits",
        page: 1,
        quote: `Ex. ${row.exhibit_number} — ${row.label}`,
        problem: `Index row Ex. ${row.exhibit_number} has no "Exhibit ${row.exhibit_number} - …" file in the package folder`,
        conflict: row.file_path ? `documents.file_path: ${row.file_path}` : undefined,
        severity: "normal",
      });
    }
  }
  for (const [n, file] of [...filesByNumber.entries()].sort((a, b) => a[0] - b[0])) {
    if (!indexByNumber.has(n)) {
      findings.push({
        document: file,
        page: 1,
        quote: file,
        problem: `exhibit file numbered ${n} has no row in the Index of Exhibits`,
        severity: "normal",
      });
    }
  }
  return {
    id: "C1",
    title: "Exhibit numbering cross-check",
    status: findings.length === 0 ? "pass" : "fail",
    findings: sortFindings(findings),
    note: `${index.length} Index rows, ${filesByNumber.size} exhibit files, ${citing.length} citing documents scanned`,
  };
}

/** Brackets that are legitimate legal text, not placeholders. Kept explicit and short;
 * documented in pre-filing-checks.md. */
const BRACKET_SUPPRESS: RegExp[] = [
  /^\[(?:\.\.\.|…)\]$/, // omission
  /^\[sic\]$/i,
  /^\[emphasis (?:added|in original)\]$/i,
  /^\[citation omitted\]$/i,
  /^\[in chambers\]$/i,
  /^\[\d{4}\]$/, // neutral/report citation year
  /^\[(?:paras?|pp?)\.?\s*\d[\d,\s–-]*\]$/i, // pinpoint
  /^\[[A-Z]\]$/, // schedule/exhibit letter
  /^\[\d+\]$/, // a bare paragraph number, e.g. "[12]" in a quoted judgment
];

const PLACEHOLDER_WORDS = /\b(?:TBD|TBC|WIP|DATE|NAME|AMOUNT|INSERT|PLACEHOLDER|TO BE (?:CONFIRMED|INSERTED|DETERMINED|ADDED|FILLED))\b/i;

/** True when a bracketed run reads as unresolved template text. */
export function isPlaceholder(bracket: string, preceded: string): boolean {
  if (/\$$/.test(preceded)) return true; // "$[______]", "$[123456]" -- a dollar sign outside the bracket is always a slot
  if (BRACKET_SUPPRESS.some((re) => re.test(bracket))) return false;
  const inner = bracket.slice(1, -1);
  if (/^[\s_.\-]*$/.test(inner)) return true; // "[___]", "[ ]"
  if (/_{2,}/.test(inner)) return true;
  if (PLACEHOLDER_WORDS.test(inner)) return true;
  if (/^[A-Z][A-Z ]{1,30}$/.test(inner)) return true; // "[DATE]", "[CLIENT NAME]"
  return false;
}

/** A bracket may wrap across a line break in extracted PDF text; 200 chars bounds a runaway match. */
const BRACKET_RE = /\[[^\[\]]{0,200}\]/g;

/** Signed-document detection: the file name says so, or an e-signature audit page is appended. */
export function looksSigned(doc: ExtractedDocument): boolean {
  if (/\bsigned\b/i.test(doc.file_name)) return true;
  const text = (doc.text_by_page ?? []).join("\n");
  return /Final Audit Report|Status:[ \t]*Signed|Document e-signed by|Agreement completed|Signature Certificate|DocuSign/i.test(text);
}

/** C2: no bracketed template text survives in any document this party authored. Exhibit files
 * are evidence copies of documents as they exist (a filed pleading's own "[ ]" checkboxes, for
 * instance) and are never scanned: nothing in them is template text this party could resolve. */
export function checkPlaceholders(docs: ExtractedDocument[]): CheckResult {
  const findings: Finding[] = [];
  let scanned = 0;
  for (const doc of docs) {
    if (!doc.text_by_page || EXHIBIT_FILE_RE.test(doc.file_name)) continue;
    scanned++;
    const signed = looksSigned(doc);
    doc.text_by_page.forEach((text, i) => {
      const seen = new Set<string>();
      for (const m of text.matchAll(BRACKET_RE)) {
        const preceded = text.slice(Math.max(0, (m.index ?? 0) - 1), m.index ?? 0);
        const bracket = m[0].replace(/\s+/g, " ");
        if (!isPlaceholder(bracket, preceded)) continue;
        const quote = lineAround(text, m.index ?? 0);
        const key = `${quote}|${bracket}`;
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push({
          document: doc.file_name,
          page: i + 1,
          quote,
          problem: `unresolved placeholder ${bracket}${signed ? " in a signed document" : ""}`,
          severity: signed ? "high" : "normal",
        });
      }
    });
  }
  return {
    id: "C2",
    title: "Unresolved-placeholder scan",
    status: findings.length === 0 ? "pass" : "fail",
    findings: sortFindings(findings),
    note: `${scanned} documents scanned`,
  };
}

/** C6: every exhibit file opens with a page count above zero. */
export function checkExhibitFiles(docs: ExtractedDocument[]): CheckResult & { files: { file: string; pages: number | null }[] } {
  const findings: Finding[] = [];
  const files: { file: string; pages: number | null }[] = [];
  for (const d of docs) {
    if (!EXHIBIT_FILE_RE.test(d.file_name)) continue;
    files.push({ file: d.file_name, pages: d.pages });
    if (d.error) {
      findings.push({ document: d.file_name, page: 1, quote: d.file_name, problem: `could not be opened: ${d.error}`, severity: "normal" });
    } else if (d.kind === "other") {
      findings.push({ document: d.file_name, page: 1, quote: d.file_name, problem: "is not a PDF or DOCX", severity: "normal" });
    } else if (!d.pages || d.pages <= 0) {
      findings.push({ document: d.file_name, page: 1, quote: d.file_name, problem: "opened but has no pages", severity: "normal" });
    }
  }
  return {
    id: "C6",
    title: "Exhibit file sanity",
    status: findings.length === 0 ? "pass" : "fail",
    findings: sortFindings(findings),
    files,
    note: `${files.length} exhibit files`,
  };
}
