// The frontmatter header of a BCSC Notice of Application or Application Response, or a BCCA
// stay response book or factum: the same fields, under each document's own documentType.

import { BLANK_UNDERLINE, frontmatterHeader, type FrontmatterFields } from "./components.js";
import { captionHeadingFor, type ProceedingRow } from "./query.js";
import type { RenderContext } from "./render-vaniac-submissions.js";

export function filingFrontmatter(proceeding: ProceedingRow, ctx: RenderContext, documentType: string): string {
  const fields: FrontmatterFields = {
    clientName: ctx.clientName,
    clientNo: ctx.clientNo,
    matterNo: ctx.matterNo,
    matterDescription: ctx.matterDescription,
    venue: proceeding.court_or_centre ?? captionHeadingFor(ctx.filing, proceeding).display_label,
    proceedingFileNo: proceeding.file_number ?? "",
    documentType,
    documentName: ctx.filing.title,
    documentDate: BLANK_UNDERLINE,
    revision: ctx.revision,
    rendered: ctx.rendered,
  };
  return frontmatterHeader(fields);
}
