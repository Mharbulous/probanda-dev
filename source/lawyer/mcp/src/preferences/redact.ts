// A deterministic screen for text a person asks Probanda to keep, run before it is saved.
// The rules are copied from source/researcher/commons-mcp/src/troubleshoot/redact.ts: the
// lawyer plugin cannot import from the researcher plugin, so a change there is made here too.
// It returns the KINDS hit, never the matched text, so a refusal cannot leak what it caught.

// The only placeholders the text may hold in place of a real name.
const PLACEHOLDERS = ["<user>", "<username>", "<matter>", "<folder>"];

// What may follow a user-profile root: a placeholder, Windows' own shared
// profiles, or an environment-variable spelling of "whoever runs this".
// Compared case-insensitively, as Windows paths are.
const USER_SEGMENTS = [...PLACEHOLDERS, "public", "default", "%username%", "$env:username"];

// What may follow `Litigation - Documents\`: the matter-data root (the tree's own
// structure) or a placeholder. After `0. CASE DATA\` only a placeholder may.
const DOCUMENTS_SEGMENTS = ["0. case data", ...PLACEHOLDERS];

const EMAIL = /([A-Za-z0-9._%+-]+)@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// Addresses that identify nobody: SSH remotes (git@github.com:owner/repo) and
// no-reply senders.
const SERVICE_LOCAL_PARTS = new Set(["git", "noreply", "no-reply"]);

// User-profile roots: Windows (C:\Users\), Git Bash (/c/Users/), WSL
// (/mnt/c/Users/) and POSIX (/Users/, /home/). The drive letter must not follow
// another letter. The slash forms must start a path, so a URL like
// https://host/home/page does not hit, and a lowercase /users/ (a web route)
// counts only behind a drive letter.
const USER_ROOTS = [
  /(?<![A-Za-z])[A-Za-z]:[\\/]+Users[\\/]+/gi,
  /(?:^|[^\w.-])(?:(?:\/mnt)?\/[A-Za-z]\/(?:[Uu]sers|home)|\/(?:Users|home))\/+/g,
];

const CASE_DATA_ROOT = /0\. CASE DATA[\\/]+/gi;
const DOCUMENTS_ROOT = /Litigation - Documents[\\/]+/gi;

// What may end a segment: the end of the text, a separator, whitespace, a quote
// or closing punctuation.
const SEGMENT_END = /^(?:$|[\\/\s"'`.,;:)\]}>])/;

const MAX_STRING_LENGTH = 2000;

function namesPerson(text: string): boolean {
  for (const match of text.matchAll(EMAIL)) {
    if (!SERVICE_LOCAL_PARTS.has(match[1].toLowerCase())) return true;
  }
  return false;
}

// True when some root in `text` is followed by a segment that is not on the
// allow-list. A root followed by nothing names nothing and passes.
function namesSegment(text: string, root: RegExp, allowed: readonly string[]): boolean {
  for (const match of text.matchAll(root)) {
    const rest = text.slice(match.index + match[0].length);
    if (SEGMENT_END.test(rest)) continue;
    const lower = rest.toLowerCase();
    const isAllowed = allowed.some(
      (segment) => lower.startsWith(segment) && SEGMENT_END.test(rest.slice(segment.length))
    );
    if (!isAllowed) return true;
  }
  return false;
}

const REDACTION_RULES: ReadonlyArray<readonly [string, (text: string) => boolean]> = [
  ["email", namesPerson],
  ["user_path", (text) => USER_ROOTS.some((root) => namesSegment(text, root, USER_SEGMENTS))],
  [
    "matter_folder",
    (text) =>
      namesSegment(text, CASE_DATA_ROOT, PLACEHOLDERS) || namesSegment(text, DOCUMENTS_ROOT, DOCUMENTS_SEGMENTS),
  ],
  ["too_long", (text) => text.length > MAX_STRING_LENGTH],
];

/** The kinds of identifying detail `text` holds, in rule order; empty when it holds none. */
export function findRedactionHits(text: string): string[] {
  return REDACTION_RULES.filter(([, hits]) => hits(text)).map(([kind]) => kind);
}
