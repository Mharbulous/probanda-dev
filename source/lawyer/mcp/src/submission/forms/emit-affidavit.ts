// Supporting affidavit filed-face emitter (#1487; decisions in #1425's resolution comment).
// Produces affidavit-<document_id>.md for publish-bcsc-form's Form 109 fill (#1488): the deponent,
// affidavit_number and exhibit list as frontmatter, then the numbered paragraphs with each
// {exhibit:N} token printed as its bold exhibit reference. Letters come from the mockup's own
// exhibitLetters, so the filed text cannot letter differently from the mockup. Purpose-built like
// render-form32-filed-face.ts: it emits no marker and no comment.

import { ValidationError } from "../../errors.js";
import { exhibitLetters, renderAffidavit, withExhibitLetters, type AffidavitRow } from "./render-bcsc-affidavit.js";
import type { RenderContext } from "./render-context.js";
import { rows } from "../query-rows.js";

/** One affidavit's filed face. Throws ValidationError on anything the practitioner must still settle. */
export function renderAffidavitFiledFace(ctx: RenderContext, a: AffidavitRow): string {
  // Every 🧩 the mockup shows for this affidavit refuses. They are read off the mockup itself, so
  // the emitter and the practitioner's review surface never disagree about what is still open.
  const gaps = renderAffidavit(ctx, a)
    .split("\n")
    .filter((l) => l.includes("🧩"))
    .map((l) => l.replace(/<!--.*?-->/g, "").trim());
  if (gaps.length > 0) {
    throw new ValidationError(
      `Affidavit ${a.id} (${a.label}): its mockup still shows 🧩, so its filed face is withheld:\n${gaps.join("\n")}\nResolve each through /drafting-data, re-render the mockup, then emit again.`
    );
  }
  if (a.affidavit_number === null) {
    throw new ValidationError(`${a.label}: its affidavit number is not recorded. Record it, then make the affidavit again.`);
  }
  const paragraphs = rows<{ text: string }>(ctx.dbPath, `SELECT text FROM statement_paragraphs WHERE document_id = ? ORDER BY ordinal`, [a.id]);
  // A sworn affidavit relied on with no stored paragraphs owes no 🧩, but has no text to fill.
  if (paragraphs.length === 0) {
    throw new ValidationError(`Affidavit ${a.id} (${a.label}): no paragraphs are stored, so there is no text to emit.`);
  }

  const letters = exhibitLetters(paragraphs.map((p) => p.text));
  const ids = [...letters.keys()];
  const docs = new Map(
    ids.length === 0
      ? []
      : rows<{ id: number; label: string; file_path: string | null }>(
          ctx.dbPath,
          `SELECT id, label, file_path FROM documents WHERE id IN (${ids.map(() => "?").join(",")})`,
          ids
        ).map((d) => [d.id, d])
  );
  // Past the 🧩 check every placed document is tendered by a linked statement, so its row exists.
  const exhibits = ids.map((id) => ({ letter: letters.get(id), label: docs.get(id)!.label, file_path: docs.get(id)!.file_path }));

  const lines: string[] = [];
  lines.push("---");
  lines.push(`deponent: ${a.deponent_name}`);
  lines.push(`affidavit_number: ${a.affidavit_number}`);
  lines.push(`exhibits: ${JSON.stringify(exhibits)}`);
  lines.push("---");
  lines.push("");
  paragraphs.forEach((p, i) => lines.push(`${i + 1}. ${withExhibitLetters(p.text, letters)}`));
  return lines.join("\n") + "\n";
}
