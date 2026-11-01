/** The fixed title that marks a case brief job (jobs-stock.md §3n). A note-up job scopes authorities too. */
export const BRIEF_JOB_PREFIX = "Brief the case: ";

const NEUTRAL_IN_TEXT = /\b(\d{4}) ([A-Z]{2,}[A-Za-z]*) (\d+)\b/;

/** A text's neutral citation, as its fold key, or null when it holds none. */
export function neutralKey(text: string | null): string | null {
  const m = text === null ? null : NEUTRAL_IN_TEXT.exec(text);
  return m === null ? null : `${m[1]} ${m[2]} ${m[3]}`.toLowerCase();
}

/** A text with its case and spacing dropped, for comparing citations and styles of cause. */
export function squashed(text: string): string {
  return text.replace(/\s+/g, "").toLowerCase();
}

/** One case's key from its citation, which the Case Briefs tab folds by and the brief job's guard matches:
 * its neutral citation, else the citation's text. Null with no citation: such an authority stands alone. */
export function citationKey(citation: string | null): string | null {
  if (citation === null || citation.trim() === "") return null;
  return neutralKey(citation) ?? `citation:${squashed(citation)}`;
}
