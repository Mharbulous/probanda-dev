// The frontmatter header of a VanIAC Witness Statement or Evidence Index.

import { BLANK_UNDERLINE, frontmatterHeader, type FrontmatterFields } from "./components.js";
import { captionHeadingFor, type FilingRow, type ProceedingRow } from "./query.js";

export function frontmatterFor(
  documentType: string,
  proceeding: ProceedingRow,
  filing: FilingRow,
  revision: number,
  rendered: string,
  clientName: string,
  clientNo: string,
  matterNo: string,
  matterDescription: string
): string {
  const fields: FrontmatterFields = {
    matterNo,
    matterDescription,
    clientName,
    clientNo,
    documentType,
    documentName: filing.title,
    documentDate: BLANK_UNDERLINE,
    venue: proceeding.court_or_centre ?? captionHeadingFor(filing, proceeding).display_label,
    proceedingFileNo: proceeding.file_number ?? "",
    revision,
    rendered,
  };
  return frontmatterHeader(fields);
}
