// The research agent's per-tier coverage line, checked against its fixed shape
// (`.claude/skills/shared/research-priority.md`, "Per-tier coverage reporting") when `write_scratch`
// saves notes with `kind: "research-notes"` (planning/1. Design/2026-10-05_coverage-line-check-spec.md).
// Free text is allowed only where a `<reason>` sits. Every tier may instead read `NOT AUDITED` or
// `NOT AUDITED: <reason>` (practitioner's decision, 2026-10-05). No parenthetical qualifiers: detail
// goes in the notes below the line.

import { DataServerError } from "../errors.js";

const REASON = "\\S.*";
const NOT_AUDITED = new RegExp(`^NOT AUDITED(?:: ${REASON})?$`);

const TIERS: Array<{ label: string; form: RegExp; expected: string }> = [
  { label: "case data", form: /^audited$/, expected: "audited" },
  {
    label: "commons",
    form: /^(?:audited|unavailable|not installed)$/,
    expected: "audited / unavailable / not installed",
  },
  { label: "6. LAW", form: /^(?:audited|\d+ memos? UNREAD)$/, expected: "audited / n memos UNREAD" },
  {
    label: "Westlaw",
    form: new RegExp(`^(?:run \\(\\d+ decisions?, memo [YN]\\)|not run: ${REASON})$`),
    expected: "run (n decisions, memo Y/N) / not run: <reason>",
  },
  { label: "CanLII", form: /^(?:noted up|no key)$/, expected: "noted up / no key" },
  {
    label: "Legislation",
    form: new RegExp(`^(?:retrieved \\d+, on disk \\d+|not run: ${REASON})$`),
    expected: "retrieved n, on disk n / not run: <reason>",
  },
];

const PREFIX = "**Coverage:**";
const SHAPE = TIERS.map((t) => `${t.label}: ${t.expected}`).join(" | ");
const FIX =
  `Expected one line: ${SHAPE}. Any tier may instead read NOT AUDITED or NOT AUDITED: <reason>. ` +
  "Nothing in parentheses after a segment and nothing after the Legislation segment; detail goes in the notes below the line.";

/** Refuse `coverage_line_malformed` unless `text` holds a coverage line in the fixed shape. */
export function checkCoverageLine(text: string): void {
  const line = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.startsWith(PREFIX) || l.startsWith("case data:"));
  if (line === undefined) {
    throw new DataServerError(`no coverage line: no line starts "${PREFIX}" or "case data:". ${FIX}`, "coverage_line_malformed");
  }
  const segments = (line.startsWith(PREFIX) ? line.slice(PREFIX.length) : line).split("|").map((s) => s.trim());
  if (segments.length !== TIERS.length) {
    throw new DataServerError(
      `coverage line has ${segments.length} segments, expected ${TIERS.length}. ${FIX}`,
      "coverage_line_malformed"
    );
  }
  const faults: string[] = [];
  TIERS.forEach((tier, i) => {
    const segment = segments[i];
    const head = `${tier.label}: `;
    const value = segment.startsWith(head) ? segment.slice(head.length).trim() : undefined;
    if (value === undefined || !(tier.form.test(value) || NOT_AUDITED.test(value))) {
      faults.push(`${tier.label} segment "${segment}" must be ${head}${tier.expected}`);
    }
  });
  if (faults.length > 0) {
    throw new DataServerError(`coverage line malformed: ${faults.join("; ")}. ${FIX}`, "coverage_line_malformed");
  }
}
