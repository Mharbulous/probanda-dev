// C3-C5 of the pre-filing consistency gate (issue #624): pure functions over
// extracted document text and values the orchestrator reads from the submission
// database. Every comparison is anchored to a database value -- text alone cannot
// say that two different numbers were meant to be the same fact. Same contract,
// ordering and determinism as checks.ts; the authoritative rules are
// source/skills/drafting-data/references/pre-filing-checks.md.

import type { ExtractedDocument } from "./extract.js";
import { EXHIBIT_FILE_RE, extractExhibitReferences, looksSigned, sortFindings, type CheckResult, type Finding } from "./checks.js";

/** A figure the database fixes: an Index row's document date, or an order sought's amount. */
export interface DateAnchor {
  exhibit_number: number;
  label: string;
  /** ISO YYYY-MM-DD. */
  document_date: string;
}

export interface AmountAnchor {
  order_sought_id: number;
  wording: string;
  amount: number;
}

export interface PartyAnchors {
  file_number: string | null;
  party_names: string[];
}

export interface InstrumentRow {
  label: string;
  instrument: string;
  deponent: string | null;
}

/** Documents this party authored: every readable non-exhibit file. Exhibits are evidence copies and are never judged. */
function authored(docs: ExtractedDocument[]): ExtractedDocument[] {
  return docs.filter((d) => d.text_by_page && !EXHIBIT_FILE_RE.test(d.file_name));
}

function lines(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Same length, and exactly one digit changed or two neighbouring digits swapped. */
export function isOneDigitTypo(a: string, b: string): boolean {
  if (a.length !== b.length || a === b) return false;
  const diff = [...a].flatMap((c, i) => (c === b[i] ? [] : [i]));
  if (diff.length === 1) return true;
  const [i, j] = diff;
  return diff.length === 2 && j === i + 1 && a[i] === b[j] && a[j] === b[i];
}

// ---------------------------------------------------------------- C3 figures

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH = "(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?";
/** Full dates only -- "January 5, 2024", "5 January 2024", "2024-01-05". A bare year or number is never a date. */
const DATE_RE = new RegExp(
  `\\b${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b|\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH}\\s*,?\\s+(\\d{4})\\b|\\b(\\d{4})-(\\d{2})-(\\d{2})\\b`,
  "g"
);
/** A dollar amount: "$150,000", "$ 150000.00". */
const MONEY_RE = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{2}))?(?![\d,]*\d)/g;

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** Every full date in a line, as its raw text and ISO form. */
export function extractDates(line: string): { raw: string; iso: string }[] {
  const out: { raw: string; iso: string }[] = [];
  for (const m of line.matchAll(DATE_RE)) {
    const [y, mo, d] = m[1]
      ? [Number(m[3]), MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, Number(m[2])]
      : m[5]
        ? [Number(m[6]), MONTHS.indexOf(m[5].slice(0, 3).toLowerCase()) + 1, Number(m[4])]
        : [Number(m[7]), Number(m[8]), Number(m[9])];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) out.push({ raw: m[0], iso: iso(y, mo, d) });
  }
  return out;
}

const cents = (whole: string, fraction?: string) => Number(whole.replace(/,/g, "")) * 100 + Number(fraction ?? 0);
const dollars = (c: number) => `$${String(Math.floor(c / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${String(c % 100).padStart(2, "0")}`;

/** The line contains the label as whole words, ignoring case and spacing. */
const mentions = (line: string, label: string) => new RegExp(`(?<![a-z0-9])${esc(norm(label))}(?![a-z0-9])`).test(norm(line));

/** Exactly one of year, month and day differs. */
function isNearDate(a: string, b: string): boolean {
  return a.split("-").filter((part, i) => part !== b.split("-")[i]).length === 1;
}

/** C3: a figure the database fixes must read the same wherever the package states it. An amount is
 * flagged when it is a one-digit typo of an order sought's amount, to the cent. A date is compared with
 * an Index row's document date only on a line that cites that exhibit or contains its Index label, and is
 * flagged when it misses by exactly one of day, month or year and no date on the line matches. */
export function checkFigureConsistency(docs: ExtractedDocument[], dates: DateAnchor[], amounts: AmountAnchor[]): CheckResult {
  const findings: Finding[] = [];
  const amountCents = amounts.map((a) => ({ ...a, cents: Math.round(a.amount * 100) }));
  const scanned = authored(docs);
  for (const doc of scanned) {
    const severity = looksSigned(doc) ? "high" : "normal";
    doc.text_by_page!.forEach((text, i) => {
      for (const line of new Set(lines(text))) {
        for (const m of line.matchAll(MONEY_RE)) {
          const c = cents(m[1], m[2]);
          if (amountCents.some((a) => a.cents === c)) continue;
          for (const a of amountCents.filter((x) => isOneDigitTypo(String(c), String(x.cents)))) {
            findings.push({
              document: doc.file_name,
              page: i + 1,
              quote: line,
              problem: `amount ${dollars(c)} is one digit off the order sought's ${dollars(a.cents)}`,
              conflict: `order_sought #${a.order_sought_id}: ${a.wording}`,
              severity,
            });
          }
        }
        const found = extractDates(line);
        if (found.length === 0) continue;
        const cited = new Set(extractExhibitReferences({ path: "", file_name: "", kind: "other", pages: 1, text_by_page: [line] }).map((r) => r.number));
        for (const anchor of dates) {
          if (!cited.has(anchor.exhibit_number) && !mentions(line, anchor.label)) continue;
          if (found.some((d) => d.iso === anchor.document_date)) continue;
          for (const d of found.filter((x) => isNearDate(x.iso, anchor.document_date))) {
            findings.push({
              document: doc.file_name,
              page: i + 1,
              quote: line,
              problem: `date ${d.raw} differs from Ex. ${anchor.exhibit_number}'s document date ${anchor.document_date}`,
              conflict: `Ex. ${anchor.exhibit_number} — ${anchor.label} (document_date ${anchor.document_date})`,
              severity,
            });
          }
        }
      }
    });
  }
  return {
    id: "C3",
    title: "Cross-document figure consistency",
    status: findings.length === 0 ? "pass" : "fail",
    findings: sortFindings(findings),
    note: `${dates.length} dated Index rows and ${amounts.length} order amounts checked across ${scanned.length} documents`,
  };
}

// ---------------------------------------------------------------- C4 names

const SUFFIXES = [["ltd", "limited"], ["inc", "incorporated"], ["corp", "corporation"], ["co", "company"]];

/** A search that finds a party name's variants: company suffix spelled either way, optional periods, and
 * a word of four or more letters may drop its last letter ("Holding" for "Holdings"). */
function nameSearch(name: string): RegExp {
  const words = name.trim().split(/\s+/).map((w) => {
    const bare = w.replace(/\.$/, "");
    const suffix = SUFFIXES.find((s) => s.includes(bare.toLowerCase()));
    if (suffix) return `(?:${suffix.join("|")})\\.?`;
    const body = bare.length >= 4 ? `${esc(bare.slice(0, -1))}(?:${esc(bare.slice(-1))})?` : esc(bare);
    return `${body}\\.?`;
  });
  return new RegExp(`(?<![A-Za-z])${words.join("\\s+")}(?![A-Za-z])`, "gi");
}

/** The file number's shape: its letters as written, each digit any digit, separators optional. */
function fileNumberSearch(fileNumber: string): RegExp {
  const body = [...fileNumber].map((c) => (/\d/.test(c) ? "\\d" : /[-\s./]/.test(c) ? "[-\\s./]?" : esc(c))).join("");
  return new RegExp(`(?<![A-Za-z0-9])${body}(?![A-Za-z0-9])`, "gi");
}

/** A trailing period is read as sentence punctuation, not styling. */
const nameKey = (s: string) => norm(s).replace(/\.$/, "");
const digits = (s: string) => s.replace(/\D/g, "");

/** C4: every party name and the file number must be spelled and styled as the database records them,
 * compared after collapsing whitespace and case. A found variant is reported raw. A file-number-shaped
 * token counts as a variant when its digits match or are one digit off; any other is a different number. */
export function checkPartyNames(docs: ExtractedDocument[], anchors: PartyAnchors): CheckResult {
  const findings: Finding[] = [];
  const scanned = authored(docs);
  const names = anchors.party_names.map((name) => ({ name, re: nameSearch(name) }));
  const fileRe = anchors.file_number ? fileNumberSearch(anchors.file_number) : null;
  for (const doc of scanned) {
    const severity = looksSigned(doc) ? "high" : "normal";
    doc.text_by_page!.forEach((text, i) => {
      for (const line of new Set(lines(text))) {
        for (const { name, re } of names) {
          for (const m of line.matchAll(re)) {
            if (nameKey(m[0]) === nameKey(name)) continue;
            findings.push({ document: doc.file_name, page: i + 1, quote: line, problem: `party name styled "${m[0]}"`, conflict: `parties.name "${name}"`, severity });
          }
        }
        if (!fileRe) continue;
        const want = anchors.file_number!;
        for (const m of line.matchAll(fileRe)) {
          if (norm(m[0]) === norm(want)) continue;
          if (digits(m[0]) !== digits(want) && !isOneDigitTypo(digits(m[0]), digits(want))) continue;
          findings.push({ document: doc.file_name, page: i + 1, quote: line, problem: `file number styled "${m[0]}"`, conflict: `proceedings.file_number "${want}"`, severity });
        }
      }
    });
  }
  return {
    id: "C4",
    title: "Party name and style-of-cause consistency",
    status: findings.length === 0 ? "pass" : "fail",
    findings: sortFindings(findings),
    note: `${anchors.party_names.length} party names and ${anchors.file_number ? "the" : "no"} file number checked across ${scanned.length} documents`,
  };
}

// ---------------------------------------------------------------- C5 execution

/** looksSigned's audit-page markers, less "DocuSign", which stamps every page's envelope header. */
const AUDIT_PAGE_RE = /Final Audit Report|Signature Certificate|Certificate Of Completion|Document e-signed by|Agreement completed/i;
/** The first word after "Status:", even when the value wraps to the next line or has text after it. */
const AUDIT_STATUS_RE = /Status:[ \t\r\n]*([A-Za-z]+)/gi; // not ":\s" -- the bundle scanner reads colon-backslash as a host path
/** A signer label with an unfilled slot after its colon: "Name: [NAME]". A rule of underscores is not
 * read as blank -- it survives in the extracted text under a real signature. */
const BLANK_SIGNER_RE = /\b(?:Signed|Signature|Sworn|Affirmed|Name|Per)\b[^:\n[]{0,20}:[ \t]*\[[^\]]*\]/i;

/** C5: every document that purports to be signed shows a completed execution block. In scope: every
 * non-exhibit document looksSigned() reports, plus the package file for each witness statement or
 * affidavit the filing records (its name begins with the document's label). The last page before any
 * audit page must carry a full date, no blank signer line, and the deponent's name where the database
 * has one; an audit page's status must read Completed or Signed. */
export function checkExecution(docs: ExtractedDocument[], instruments: InstrumentRow[]): CheckResult {
  const findings: Finding[] = [];
  const candidates = docs.filter((d) => !EXHIBIT_FILE_RE.test(d.file_name));
  const stem = (d: ExtractedDocument) => norm(d.file_name.replace(/\.[^.]+$/, ""));
  const deponentOf = new Map<ExtractedDocument, string | null>();
  for (const row of instruments) {
    // A word break must follow the label, so "Affidavit #1" never claims "Affidavit #10 …".
    const doc = candidates.find((d) => stem(d).startsWith(norm(row.label)) && !/[a-z0-9]/.test(stem(d)[norm(row.label).length] ?? ""));
    if (doc) {
      deponentOf.set(doc, row.deponent);
    } else {
      findings.push({
        document: row.label,
        page: 1,
        quote: row.label,
        problem: `the filing records this ${row.instrument}, but no package file name begins with its label`,
        severity: "high",
      });
    }
  }
  const inScope = candidates.filter((d) => deponentOf.has(d) || (d.text_by_page && looksSigned(d)));
  for (const doc of inScope) {
    const push = (page: number, quote: string, problem: string) => findings.push({ document: doc.file_name, page, quote, problem, severity: "high" });
    if (!doc.text_by_page) {
      push(1, doc.file_name, `could not be read: ${doc.error ?? "not a PDF or DOCX"}`);
      continue;
    }
    const pages = doc.text_by_page.map((text, i) => ({ text, page: i + 1 }));
    const audit = pages.filter((x) => AUDIT_PAGE_RE.test(x.text));
    const statuses = audit.flatMap((p) => [...p.text.matchAll(AUDIT_STATUS_RE)].map((m) => ({ page: p.page, quote: m[0].replace(/\s+/g, " "), value: m[1] })));
    for (const s of statuses.filter((x) => !/^(completed|signed)$/i.test(x.value))) {
      push(s.page, s.quote, `e-signature audit status is "${s.value}", not completed or signed`);
    }
    // An audit report's later pages may omit Status:, so only a report with none at all fails.
    if (audit.length > 0 && statuses.length === 0) push(audit[0].page, lines(audit[0].text)[0] ?? doc.file_name, "e-signature audit page shows no signing status");
    const body = pages.filter((x) => !AUDIT_PAGE_RE.test(x.text));
    const last = body[body.length - 1];
    const lastLines = last ? lines(last.text) : [];
    if (!last || lastLines.length === 0) {
      push(last?.page ?? 1, doc.file_name, "the last page has no extractable text, so its execution block cannot be read");
      continue;
    }
    const tail = lastLines[lastLines.length - 1];
    const blank = lastLines.find((l) => BLANK_SIGNER_RE.test(l));
    if (blank) push(last.page, blank, "signer line is blank");
    if (!lastLines.some((l) => extractDates(l).length > 0)) push(last.page, lastLines.find((l) => /\bdate/i.test(l)) ?? tail, "no execution date on the last page");
    const deponent = deponentOf.get(doc);
    if (deponent && !norm(last.text).includes(norm(deponent))) push(last.page, tail, `deponent ${deponent} is not named on the last page`);
  }
  return {
    id: "C5",
    title: "Execution completeness",
    status: findings.length === 0 ? "pass" : "fail",
    findings: sortFindings(findings),
    note: `${inScope.length} documents purport to be signed; ${instruments.length} recorded witness statements or affidavits`,
  };
}
