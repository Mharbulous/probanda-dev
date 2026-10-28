// One Milestone page's data: the matter's meta, its sections, its strip and its attached drafts.

import type { CourtFileAffidavit } from "../court-file-affidavits.js";
import type { PageDates } from "../matter-dates.js";
import type { WritingLabel } from "./writing-label.js";
import type { AttachmentKind } from "./work-board-reads.js";
import type { WorkBoardData } from "./work-board-data.js";

/** One Milestone page (#1365, ADR 0033's 2026-10-05 amendment): the matter's meta and one section, a
 * live filing's or a pre-filing proceeding's. `meta.revision` stays the data line's first key, so
 * readExistingRevision still reads it. The client number and the section's proceeding's forum,
 * registry, file number and style of proceeding are "" when unknown. */
export interface MatterMilestoneData {
  meta: {
    revision: number;
    matter: string;
    client: string;
    rendered: string;
    client_no: string;
    forum: string;
    registry: string;
    file_number: string;
    style_of_cause: string;
  };
  /** A merged board's page only (docs/ADRs/0010): the survivor whose id names the page, which may be
   * retired and then has no section of its own. Absent on a page holding one board. */
  board?: { filing_id: number | null; proceeding_id: number };
  sections: WorkBoardData[];
  /** The matter's dates (ADR 0013, 2026-10-04 amendments): drawn on the page, in no section. */
  dates: PageDates;
  /** The board's thumbnails, drawn on the page in one row, in no section: the viewed ones first, most
   * recently viewed first (board-viewed.ts), then the never-viewed ones, each live Writing's documents
   * in its last render's document order and then the view pages in registry order. A Writing's
   * document gives its manifest label: `short` is drawn on the tile, `long` is its `title`; an entry
   * with no label gives the file name for both. A view page (../view-pages.ts VIEW_PAGES) gives its
   * name and its sibling file's name, and is never a link. Empty on a pre-filing page. */
  strip: StripItem[];
  /** The section's attachments as found on disk when the page was written (../board-attachments.ts),
   * drawn as cards after the strip's thumbnails, never a link (shared/html-pages.md, "Cards only, no link"). */
  attached: AttachedDraft[];
  /** The filing's relied-on affidavits whose court-file name disagrees with drafting data when the page
   * was written (../court-file-affidavits.ts): one card each, in a Court File lane drawn only when
   * there is one. Empty on a pre-filing page. */
  court_file?: CourtFileAffidavit[];
}

/** One thumbnail on a Milestone's strip: `key` is its board-viewed.ts item key, `viewed` whether it was ever viewed. */
export type StripItem =
  | ({ kind: "writing"; key: string; viewed: boolean } & WritingLabel)
  | { kind: "view"; key: string; viewed: boolean; name: string; file: string };

/** A board attachment as found on disk at a page write or a board_card read (ADR 0042). */
export interface AttachedDraft {
  id: number;
  kind: AttachmentKind;
  /** The stored path, relative to the matter root. */
  path: string;
  /** The file's own name, the path's last segment. */
  name: string;
  attached_on: string;
  /** The file's last-modified local date (YYYY-MM-DD); null unless `state` is `present`. */
  modified: string | null;
  /** The name's file-naming registry code, as /file-naming's name gate read it; null when the name
   * does not conform, and `code_error` says why when the gate could not run. */
  code: string | null;
  code_error?: string;
  /** The proceeding's pending jobs (Ready, In Progress, Bring Forward, Blocked) whose scope names
   * this attachment, in board order, each with its Writing's title (null for a General Job). */
  jobs: { id: number; title: string; category: string; writing: string | null }[];
  /** A row of the proceeding with no Writing, on a Writing's board: it shows only on the proceeding's
   * lowest-id live Writing's board, until it is moved to a Writing. False on a pre-filing board,
   * whose own row it is. */
  proceeding_wide: boolean;
  /** `missing` when nothing is at the path, `outside` when the path, or its real path, leaves the
   * matter's draft folder or lies in a privileged or disclosed tree (never read), `unreadable` when
   * reading it failed, with the error code in `error`. */
  state: "present" | "missing" | "outside" | "unreadable";
  /** The error code of a failed read; present only when `state` is `unreadable`. */
  error?: string;
  /** A present client letter's counsel's-review status: the rest of its first line when that line is
   * a counsel's-review line (`pending`, `approved by …`), else null. Only that line is read and
   * drawn, never the body. Null for a reply. */
  review: string | null;
}
