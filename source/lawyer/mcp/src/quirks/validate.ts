// What a practice quirk may say, checked before anything is written.
//
// A quirk is data about the practice. It is a `rule` (the practitioner's instruction) or `knowledge`
// (context that directs nothing). The checks below are tripwires, not proofs: the guarantees are that
// the practitioner reads every rule (hooks/quirk-gate.py) and that sessions place every verification,
// approval and privilege rule above any entry. A refusal is a guiding question and never states a
// rule (Commandment 6); it never repeats the text it caught.

import { ValidationError } from "../errors.js";

export const TITLE_MAX = 100;
export const BODY_MAX = 1000;
export const MAX_AREAS = 3;
export const SEED_AREAS = ["email", "files", "billing", "court", "staff", "tools"];

export type QuirkType = "rule" | "knowledge";

const AREA = /^[a-z][a-z0-9]{1,19}$/;

// A label that names a credential, then a value that looks like one: a digit, mixed case or a symbol.
const CREDENTIAL_LABEL =
  /\b(?:password|passcode|passphrase|pwd|secret|api[ _-]?key|token|pin)\b["']?\s*(?:is|are|[:=])\s*["']?(\S+)/gi;
// Shapes that are credentials whatever surrounds them.
const CREDENTIAL_SHAPES: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i,
  /\b(?:sk|pk|ghp|gho|ghs|xox[abp]|AKIA)[-_A-Za-z0-9]{12,}/,
  // Apple's app-specific password: four groups of four letters.
  /\b[a-z]{4}-[a-z]{4}-[a-z]{4}-[a-z]{4}\b/i,
  // A long run of letters of both cases and digits, with no separator a word or address would have.
  /(?<![@\w.])(?=[A-Za-z0-9+/_-]*\d)(?=[A-Za-z0-9+/_-]*[a-z])(?=[A-Za-z0-9+/_-]*[A-Z])[A-Za-z0-9+/_-]{24,}(?![\w@.])/,
];

const SKIP_VERBS = "skip|ignore|bypass|disable|waive|override|suspend|circumvent|turn off|no need to|need not|don'?t need to|without";
const SAFEGUARDS =
  "approval|approve|verification|verify|verifying|privilege|privileged|safeguard|confirmation|confirm|/show-me|review|sign-?off|permission|the gate|hook";
const LOOSENING: RegExp[] = [
  new RegExp(`\\b(?:${SKIP_VERBS})\\b(?:\\s+\\S+){0,4}?\\s+(?:${SAFEGUARDS})`, "i"),
  /\b(?:do not|don'?t|never|stop)\s+(?:ask|asking|check|checking|confirm|confirming|verify|verifying)\b/i,
  /\b(?:auto-?approve|automatically approve|pre-?approved|standing approval)\b/i,
];

// Knowledge directs nothing, so a body or title that opens like an instruction is a rule in disguise.
const RULE_SHAPED = /^\s*(?:never|always|do not|don'?t|must(?: not)?|only)\b/i;

function valueLooksSecret(raw: string): boolean {
  const value = raw.replace(/[.,;:)\]}"'`]+$/, "");
  if (value.length < 6) return false;
  return /\d/.test(value) || (/[a-z]/.test(value) && /[A-Z]/.test(value)) || /[!@#$%^&*]/.test(value);
}

function holdsCredential(text: string): boolean {
  for (const match of text.matchAll(CREDENTIAL_LABEL)) if (valueLooksSecret(match[1])) return true;
  return CREDENTIAL_SHAPES.some((shape) => shape.test(text));
}

function text(raw: unknown, name: string, max: number): string {
  if (typeof raw !== "string" || raw.trim() === "") throw new ValidationError(`${name} must be a non-empty string`);
  const value = raw.trim();
  if (value.length > max) {
    throw new ValidationError(
      `${name} is ${value.length} characters; the cap is ${max}. Nothing was written. ` +
        `Could the ${name} say less, or could part of it be its own entry?`,
      "too_long"
    );
  }
  if (/[\r\n]/.test(value)) {
    throw new ValidationError(
      `${name} runs over more than one line. Nothing was written. Could it be one paragraph about one issue, ` +
        "with any other issue in its own entry?",
      "not_one_paragraph"
    );
  }
  return value;
}

function areas(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_AREAS) {
    throw new ValidationError(
      `areas must be a list of one to ${MAX_AREAS} one-word tags, such as ${SEED_AREAS.join(", ")}`
    );
  }
  const tags = raw.map((tag) => (typeof tag === "string" ? tag.trim().toLowerCase() : ""));
  const bad = tags.find((tag) => !AREA.test(tag));
  if (bad !== undefined) {
    throw new ValidationError(
      "each area must be one lowercase word of 2 to 20 letters or digits that starts with a letter. " +
        "Nothing was written. Which single word names where this applies?",
      "bad_area"
    );
  }
  return [...new Set(tags)];
}

export interface CheckedEntry {
  type: QuirkType;
  areas: string[];
  title: string;
  body: string;
}

/** The entry as it will be saved, or a ValidationError with a guiding question. Nothing is written on a refusal. */
export function checkEntry(args: Record<string, unknown>): CheckedEntry {
  if (args.type !== "rule" && args.type !== "knowledge") {
    throw new ValidationError(`type must be "rule" or "knowledge"`);
  }
  const type: QuirkType = args.type;
  const title = text(args.title, "title", TITLE_MAX);
  const body = text(args.body, "body", BODY_MAX);
  const tags = areas(args.areas);
  const whole = `${title}\n${body}`;
  if (holdsCredential(whole)) {
    throw new ValidationError(
      "Nothing was written. Could the entry say where the credential is kept, or that one exists, without its value?",
      "credential"
    );
  }
  if (LOOSENING.some((pattern) => pattern.test(whole))) {
    throw new ValidationError(
      "Nothing was written. Could the entry describe how the practice is set up without saying when to skip a check?",
      "loosens_safeguard"
    );
  }
  if (type === "knowledge" && (RULE_SHAPED.test(title) || RULE_SHAPED.test(body))) {
    throw new ValidationError(
      "Nothing was written. This knowledge opens like an instruction: is it a rule, or could it state the fact " +
        "behind the instruction?",
      "reads_as_rule"
    );
  }
  return { type, areas: tags, title, body };
}
