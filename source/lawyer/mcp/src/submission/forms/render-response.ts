// Shaping a render's documents array: selection, listing and withholding the hearing.

import { gapMarker } from "./markers.js";
import { ValidationError } from "../../errors.js";
import { type RenderedDocument } from "./render-result.js";

/** Response-only filter. Every document is still rendered, and in mockup mode still written to
 * its canonical path beside the database -- only what crosses the tool boundary shrinks, because
 * a caller checking one thing (the Job Board's ticket state, the frontmatter) otherwise pulls a
 * ~79K-character four-document payload through the token cap. Filtering the render itself would
 * leave the other canonical mockups stale at an old revision, and filtering before the filed-face
 * citation gate below would let an uncited statement through -- so this runs last, on the response
 * array alone. An unrecognised name fails loudly rather than quietly returning nothing. */
export function selectDocuments<T extends { document_type: string }>(documents: T[], wanted?: string[]): T[] {
  if (!wanted || wanted.length === 0) return documents;
  // Two documents can share a type (two affidavits), so name each type once.
  const available = [...new Set(documents.map((doc) => doc.document_type))];
  const unknown = wanted.filter((name) => !available.includes(name));
  if (unknown.length > 0) {
    throw new ValidationError(
      `This Writing has no ${unknown.join(", ")} (it has: ${available.join(", ")})`
    );
  }
  return documents.filter((doc) => wanted.includes(doc.document_type));
}

export type Projectable = Pick<RenderedDocument, "document_type" | "path" | "file_name" | "symbol_notes"> & { markdown: string };

/** The response's symbol_notes field: absent when the legend carries no note. */
export function symbolNotes(notes: string[]): Pick<RenderedDocument, "symbol_notes"> {
  return notes.length > 0 ? { symbol_notes: notes } : {};
}

/** #466: under draft_dir or presentation_dir, every document is listed with its length, and only those
 * `wanted` names carry their markdown inline. The caller has already refused an unknown name. */
export function listDocuments(documents: Projectable[], wanted: string[] | undefined): RenderedDocument[] {
  return documents.map((doc) => ({
    document_type: doc.document_type,
    ...(doc.path ? { path: doc.path } : {}),
    file_name: doc.file_name,
    markdown_chars: doc.markdown.length,
    ...(wanted?.includes(doc.document_type) ? { markdown: doc.markdown, ...symbolNotes(doc.symbol_notes ?? []) } : {}),
  }));
}

/** ADR 0013 (deadline isolation): a mockup render withholds the hearing date and time (on a Notice of
 * Application, the proposed hearing) from the markdown it returns, so neither enters a drafting session's context. The mockup file keeps the real values, which makes these two sentences the one exception to "returned markdown is
 * byte-identical to the file". Anchored on the renderer-owned template sentences
 * (render-notice-of-application.ts, render-bcca-stay-response.ts), never on the date's value, which would
 * also blank a fact dated the same day. Each value is replaced on its own, and a blank or gap marker stays
 * visible so a missing required field is still seen. Applied after every copy is written and measured. */
const HEARING_WITHHELD = "[withheld from drafting context]";

const NOA_HEARING = /^(The applicant proposes that the matter will be heard on )(.*?)(\.)$/m;

const BCCA_HEARING = /^(THIS IS A RESPONSE TO the stay application .*, returnable )(.*?)(?: at (.*?))?\.$/m;

export function withholdHearing<T extends { markdown?: string }>(doc: T): T {
  if (doc.markdown === undefined) return doc;
  const unlessBlank = (value: string, blank: string) => (value === blank ? value : HEARING_WITHHELD);
  const markdown = doc.markdown
    .replace(NOA_HEARING, (_m, head: string, proposed: string, tail: string) => `${head}${unlessBlank(proposed, "________________")}${tail}`)
    .replace(BCCA_HEARING, (_m, head: string, date: string, time: string | undefined) =>
      `${head}${unlessBlank(date, gapMarker("gap"))}${time === undefined ? "" : ` at ${HEARING_WITHHELD}`}.`
    );
  return { ...doc, markdown };
}
