/** The fixed title that marks a case brief job (jobs-stock.md §3n). A note-up job scopes authorities too. */
export const BRIEF_JOB_PREFIX = "Brief the case: ";

/** A text with its case, spacing and periods dropped, for comparing citations and styles of cause. */
export function squashed(text: string): string {
  return text.replace(/[\s.]+/g, "").toLowerCase();
}

/** A citation's parallels, split on the commas outside brackets and squashed, each less its pinpoint and a
 * closing court in brackets: `2021 CanLII 3 (BC SC), 2021 BCSC 9` is `2021canlii3` and `2021bcsc9`. A piece
 * without both letters and digits is no citation: a pinpoint's second number, a court alone, `unreported`. */
export function citationParts(citation: string | null): string[] {
  return (citation ?? "")
    .split(/,(?![^()]*\))/)
    .map((piece) => squashed(piece.replace(/\s+at\s.*$/i, "").replace(/\s*\([^()]*\)\s*$/, "")))
    .filter((part) => /\d/.test(part) && /[a-z]/.test(part));
}

const YEAR_WORD_NUMBER = /^\d{4}[a-z]{2,}\d+$/;
const DATABASE_YEAR = /^\d{4}(?:canlii|carswell)/;

/** One case's key from its citation, which the Case Briefs tab folds by and the brief job's guard matches:
 * its neutral citation wherever the text holds one, else its CanLII or Carswell citation, else the citation's
 * text. Null with no citation: such an authority stands alone. */
export function citationKey(citation: string | null): string | null {
  const parts = citationParts(citation);
  if (parts.length === 0) return null;
  const dated = parts.filter((part) => YEAR_WORD_NUMBER.test(part));
  return dated.find((part) => !DATABASE_YEAR.test(part)) ?? dated[0] ?? parts.join(", ");
}
