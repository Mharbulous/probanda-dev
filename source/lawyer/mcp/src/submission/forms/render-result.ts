// drafting_forms__render's response types.

import { type MockupMove } from "../writing-folder.js";
import { type StoredLayout } from "./layout-snapshot.js";
import { type ChangedSinceSnapshot } from "./render-general.js";
import { type CurrencyWithheld, type ProseFormatHit } from "./projections.js";
import { type BoardMove, type PagesWritten } from "../matter-pages.js";
import { type PartiesDriftRow } from "../parties-drift.js";
import { type FormCurrency } from "../form-currency.js";
import { type PhaseTimings } from "./timings.js";

export interface RenderedDocument {
  document_type: string;
  /** Absent in 'filed' mode -- filed-face rendering writes nothing to disk (build #359); the caller decides where the returned markdown lands.
   * In mockup mode: the mockup in the Writing's own folder in 0. DRAFT, the only copy.
   * On the Work Board: this filing's Work Board page, present only when this render wrote the pages
   * and the filing is live (a retired filing has no page). */
  path?: string;
  /** The renderer's own file name (e.g. "Written Argument.md") -- present in every mode, since 'filed' mode has no path for a caller to derive it from. */
  file_name: string;
  /** Absent under draft_dir or presentation_dir unless this document was named in `documents` (#466). Never on the Work Board. */
  markdown?: string;
  /** Mockup mode, beside `markdown`, only when a row of the mockup's legend has a note written for
   * the model (forms/legend.ts): one string per note. Never written to any file. */
  symbol_notes?: string[];
  /** The Work Board only (#1365): this filing's section's short summary as fixed-grammar text.
   * Present only when the board was named in `documents`, and on a retired filing's refusal. */
  board_summary?: string;
  /** Present only under draft_dir or presentation_dir, on every document but the Work Board: the document's length, so a
   * caller can tell before asking for it inline whether it alone would overflow the host's tool-result cap (#466). */
  markdown_chars?: number;
  /** The Work Board only, when this render wrote the pages: false when the section this filing last
   * reported (matter-pages-state.json) matches apart from meta.rendered, true otherwise. Revision
   * cannot say this, since a job or shelving write moves no revision. */
  board_changed?: boolean;
  /** Beside board_changed whenever a section was recorded (#1035): each job added (from null),
   * removed (to null) or moved to another board column since it. Empty when no job moved. */
  board_moves?: BoardMove[];
  /** The Work Board only: true when this render wrote the matter's pages. */
  pages_written?: boolean;
  /** The Work Board only, when the filing's stored layout declares `ingest_inputs`: those document types and
   * the ids of the filing's own Ready jobs, which take /draft's input check before a claim. */
  ingest_inputs?: { types: string[]; ready_jobs: number[] };
}

export interface RenderResult {
  filing_id: number;
  revision?: number;
  documents: RenderedDocument[];
  /** Present only on a successful mockup-mode render for which the caller supplied a
   * session_token (ADR 0009, #609) -- this render ECHOES that value back unchanged, so a session
   * keeps one stable identity across its bootstrap and every later render. Render mints nothing;
   * the token is issued once, by drafting_forms__bootstrap. A consuming skill uses it as
   * tickets.locked_by. */
  session_token?: string;
  /** Present only on a successful mockup-mode render (#548) -- ctx.rendered, the exact stamp this
   * render printed on its documents' Rendered lines, so a caller never needs a second clock read. */
  rendered_at?: string;
  schema_version?: number | null;
  current_schema_version?: number;
  /** True only when the database is ahead of the installed plugin bundle -- see submissionFormsBootstrap's #352 gate. */
  bundle_outdated?: boolean;
  /** True only on the retired-filing refusal (schema v17): mockup mode on a filing with
   * retired_on set renders no mockup and writes nothing beside the database. `documents` carries
   * the Work Board alone, with its board_summary, so the retire flow can read the state Retired,
   * and note explains what happened. A retired filing is recovered (retired_on
   * cleared) before it renders again -- rendering one would archive the mockups of a filing
   * whose work is over. */
  filing_retired?: boolean;
  /** True only on a Work Board with no Writing (forms/query.ts MILESTONE_KIND): mockup mode builds its
   * board and nothing else, so no mockup or manifest is written.
   * `documents` carries the Work Board alone, with its board_summary. A closed one also carries
   * filing_retired and a note. */
  milestone_only?: true;
  /** Each folder of an older build's `<case data>\mockups\` tree this call moved into 0. DRAFT
   * (writing-folder.ts moveCaseDataMockups), once per matter. */
  mockups_moved?: MockupMove[];
  /** Present when the Writing's folder still has the name an older build gave it, with its type's code,
   * because it holds a file this renderer did not write: the folder and the name it should have. Only
   * file-manager renames it, on the practitioner's yes. */
  writing_folder_rename?: { from: string; to: string };
  /** Present only when this render wrote the matter's pages: every view page written (ADR 0033,
   * 2026-10-07 amendment), [{name, filing_id, path}]. */
  view_page_paths?: PagesWritten["view_page_paths"];
  /** Present on the same terms: the matter's Loose Threads page. */
  loose_threads_path?: string;
  /** Old page files this render's page write moved into the matter's TRASH (#1365 D3). */
  moved_to_trash?: PagesWritten["moved_to_trash"];
  /** Old page files that page write could not move, and why. */
  trash_skipped?: PagesWritten["trash_skipped"];
  /** True only on the ticket 2026-08-31 filing-gate refusal: a statement of law deployed on a
   * filed-face document has no authorities.citation. Mirrors bundle_outdated's shape -- documents
   * comes back empty, note explains what to fix. */
  citation_gate_failed?: boolean;
  /** True only on the #451 filed-face refusal: a Notice of Application's associate-judge
   * jurisdiction is not yet determined, so neither Form 32 sentence may print. Same shape as
   * citation_gate_failed. */
  associate_judge_gate_failed?: boolean;
  /** True only on the #825 filed-face refusal: a Form 8 order deployed on this filing has no
   * template_key, or one outside renderTemplate's closed set, so its operative sentence would
   * deliver "(template not chosen)" or 'unrecognized template_key "..."'. Same shape as
   * citation_gate_failed. */
  template_key_gate_failed?: boolean;
  /** True only on the confirmation gate's filed-face refusal (spec §6 piece 5): a general Writing's
   * stored layout cites an item of a learned file that no roster lawyer has confirmed. Same shape
   * as citation_gate_failed, with `unconfirmed` naming each such rule_ref in block order. */
  confirmation_gate_failed?: boolean;
  unconfirmed?: string[];
  /** On a filed render of a general Writing, refused or not: each cited item whose passage differs
   * from the one its snapshot recorded. Absent when none does. */
  changed_since_snapshot?: ChangedSinceSnapshot[];
  /** True only on the unwritten gate's filed-face refusal: a general Writing's `slot:<name>`,
   * `addressee` or `sender` part has no text, or a DB-backed projection (`parties`,
   * `orders-sought`, `legal-basis`, `material-relied-on`, `form-source`) has no rows. Same shape as
   * citation_gate_failed, with `unwritten` naming each such part in block order. */
  unwritten_gate_failed?: boolean;
  unwritten?: string[];
  /** True only on the prose format gate's filed-face refusal (plan 2026-10-07 step 5): a general
   * Writing's prose line holds a bracketed template placeholder, a bare TBD/TODO/TBC, a line opening
   * `Note:` or `Draft note:`, or an emoji the symbol table does not hold (forms/prose-format.ts).
   * Same shape as citation_gate_failed, with `prose_format` naming each line in print order. */
  prose_format_gate_failed?: boolean;
  prose_format?: ProseFormatHit[];
  /** True only on the currency gate's filed-face refusal (#1181): an implied clause names the
   * statute, regulation or rule its cited statement rests on, and that authority's stored
   * statute-currency result is not `current` (null: never checked). Same shape as
   * citation_gate_failed, with `currency_withheld` naming each such clause in print order. */
  currency_gate_failed?: boolean;
  currency_withheld?: CurrencyWithheld[];
  /** True only on the party drift gate's filed-face refusal (party/counsel SSOT): a drafting
   * Writing's proceeding has a party row that is unlinked from case data, linked to a party not of
   * record, or whose counsel and address for service could not be read from case data.
   * Same shape as citation_gate_failed, with `parties_drift` naming each row. */
  parties_drift_gate_failed?: boolean;
  /** Each drifted party row (parties-drift.ts), on the gate's refusal and on a mockup render that
   * marked them. Absent when none drifts. */
  parties_drift?: PartiesDriftRow[];
  /** Why the parties' counsel could not be read from case data, when it could not; every party is
   * then a `parties_drift` row of kind `unchecked`. */
  parties_drift_note?: string;
  /** On a delivered filed render of a Writing with a stored layout: that layout, as storedLayout returns it (spec §6 piece 6). */
  stored_layout?: StoredLayout;
  /** On a mockup render of a kind whose venue document is a court form (form-currency.ts KIND_FORM_KEYS):
   * that form's currency (ADR 0038). A non-null warning also heads the venue document as a mockup-only line. */
  form_currency?: FormCurrency;
  /** On a mockup render of a Writing, only when its Proposed lane holds a note-up Proposal no live
   * job holds and the practitioner has not shelved: those keys, in the lane's order (noteUpDue). The
   * session writes them into the Writing's note-up job (`/drafting-data` jobs-create.md §3k). */
  note_up_due?: string[];
  /** Present on the bundle_outdated, citation_gate_failed, associate_judge_gate_failed,
   * template_key_gate_failed, confirmation_gate_failed, unwritten_gate_failed, prose_format_gate_failed,
   * currency_gate_failed, parties_drift_gate_failed or filing_retired refusal -- what was skipped and what to do. */
  note?: string;
  /** On every response, refusals included (#579). */
  timings: PhaseTimings;
}
