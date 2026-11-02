/** The fixed prefix that marks a legal research job (jobs-stock.md §3l). The text after it is the issue, the job's intent verbatim. */
export const RESEARCH_JOB_PREFIX = "Legal research: ";

/** The longest a job's title or step may be. */
export const JOB_TEXT_MAX = 500;

const MAX_SENTENCES = 3;
/** A word whose period ends no sentence. A single letter's period ends none either: `s. 164`, `v.`, `S.C.R.`, `e.g.` */
const ABBREVIATION = /(?:^|[\s(])(?:ss|vs|inc|ltd|corp|co|no|nos|para|paras|rr|cl|art|ch|reg|sch|pt|mr|ms|mrs|dr|st|jr|sr)$/i;
const SINGLE_LETTER = /(?:^|[\s(.])[a-z]$/i;

export function isResearchTitle(title: string): boolean {
  return title.startsWith(RESEARCH_JOB_PREFIX);
}

/** The sentences in a text, by its `.`, `?` and `!` followed by a space or its end. A hard case that
 * counts low is left to the judgement check; one that counts high is refused, and the session rewords it. */
function sentenceCount(text: string): number {
  let count = 0;
  for (const end of text.matchAll(/[.?!]["'”’)\]]*(?=\s|$)/g)) {
    const before = text.slice(0, end.index);
    if (end[0][0] === "." && (ABBREVIATION.test(before) || SINGLE_LETTER.test(before))) continue;
    count += 1;
  }
  return count;
}

/** What is wrong with a research job's title and intent, in plain words; empty when both are in the form.
 * This is the mechanical part of the form: whether the issue holds one question, makes sense on its own,
 * holds one conjunctive list and identifies no one is judged by the gate and memo-reviewer. */
export function researchFormProblems(title: string, intent: string): string[] {
  const problems: string[] = [];
  if (title !== `${RESEARCH_JOB_PREFIX}${intent}`) problems.push(`the title must be "${RESEARCH_JOB_PREFIX}" followed by the intent, character for character`);
  if (intent.trim() === "" || intent !== intent.trim()) problems.push("the issue must be non-empty, with no space at either end");
  if (isResearchTitle(intent)) problems.push(`the intent must not itself open with "${RESEARCH_JOB_PREFIX}"`);
  if (/[\r\n]/.test(intent)) problems.push("the issue must hold no line break");
  if (title.length > JOB_TEXT_MAX) problems.push(`the title must be at most ${JOB_TEXT_MAX} characters`);
  if (!intent.endsWith("?")) problems.push('the issue\'s last sentence must end in "?"');
  if (intent.split("?").length > 2) problems.push('only the last sentence may end in "?", and the issue holds one question');
  if (sentenceCount(intent) > MAX_SENTENCES) problems.push(`the issue must hold at most ${MAX_SENTENCES} sentences`);
  return problems;
}
