// The layout snapshot of a Writing (planning/1. Design/2026-09-24_draft-generalization-and-
// localize-spec.md section 5, "Layout snapshot" and "Re-snapshot"). This module is the one place
// the runtime composes and validates filings.layout_snapshot: the creation write (plan Phase 14,
// forms/layout-snapshot.ts) calls composeLayoutSnapshot and never re-implements it, so a
// re-snapshot re-runs the same validation and stores the same five members. The SQL here is the runtime's own, as
// forms/query.ts's is; the /drafting-data gatekeeper documents the column in
// filing-checklists.md section 13.
//
// Re-snapshot is allowed only while the Writing is drafting. resnapshotWriting refuses a sent or
// retired Writing, and the v32 trigger guard_filings_layout_frozen refuses the same write at
// database level. Registered as the tool drafting_data__resnapshot_writing (plan Phase 20), which
// /draft calls only on the practitioner's explicit instruction.

import { DataServerError, NotFoundError, ValidationError } from "../errors.js";
import { citedItems, type BlockKind } from "../knowledge/declared-layout.js";
import { NO_VENUE, type KindsView } from "../knowledge/index.js";
import type { ItemStatus } from "../knowledge/sidecar.js";
import { knowledgeRead, type KnowledgeReadResult } from "../knowledge/tools.js";
import type { KnowledgeSeams } from "../knowledge/tree.js";
import { submissionDataExecute, submissionDataQuery } from "./backend.js";
import type { StoredLayout } from "./forms/layout-snapshot.js";
import { UNBUILT_PROJECTIONS, type LayoutPart } from "./forms/projections.js";
import { isJobOnlyBoard } from "./forms/query.js";

type Json = Record<string, unknown>;

export interface TreeKey {
  country: string;
  jurisdiction: string;
  venue: string;
  kind: string;
}

export interface ComposedSnapshot {
  needs_forum_parts: 0 | 1;
  layout_snapshot: string;
  /** The type file's stem, as kinds.json names it. */
  type_file: string;
  /** layout_snapshot parsed: both blocks, the passage hashes, and the two knowledge paths. */
  stored: StoredLayout;
  /** The matched kinds row's recipient; null outside _NoVenue. */
  recipient: string | null;
  /** The matched kinds row's alias names, from which creation picks the kind render accepts. */
  aliases: string[];
  /** Whether the type file is learned (carries `learned_by: agent`). */
  learned: boolean;
}

/** Resolve the stored kind to its type file, read and validate the type and venue blocks through
 * knowledge__read's merge (corrections substituted), refuse a part whose projection is not built,
 * a `legal-basis` or `terms` part with paragraph_numbering none and a `caption` part under _NoVenue, hash
 * every cited passage, and return the JSON text filings.layout_snapshot stores,
 *   {"layout", "venue", "passage_hashes", "type_file", "venue_file"},
 * the last two being the knowledge paths the filed render's confirmation gate reads again (a
 * _NoVenue Writing's tree key is stored nowhere else). Pure apart from the tree read. Fails hard. */
export function composeLayoutSnapshot(key: TreeKey, seams: KnowledgeSeams = {}): ComposedSnapshot {
  const tail = `${key.country}/${key.jurisdiction}/${key.venue}`;
  // /draft's tree, and under _NoVenue also /legal-research's, which holds the research memo so a
  // researcher install saves one without litigator. A tree not installed, or with no kinds index
  // here, is passed over while the other reads.
  const trees = key.venue === NO_VENUE ? ["draft", "legal-research"] : ["draft"];
  const read: { folder: string; kinds: KindsView["kinds"] }[] = [];
  let firstError: unknown = null;
  for (const tree of trees) {
    const at = `${tree}/${tail}`;
    try {
      read.push({ folder: at, kinds: (knowledgeRead(`${at}/Documents/kinds.json`, seams).view as KindsView).kinds });
    } catch (err) {
      if (!(err instanceof DataServerError) || !["index_missing", "skills_root_missing"].includes(err.code ?? "")) throw err;
      firstError ??= err;
    }
  }
  if (read.length === 0) throw firstError;
  // Exact match only: the stored kind is an alias (or the file stem) the composing skill already resolved.
  const rows = read.flatMap(({ folder, kinds }) =>
    kinds.filter((row) => row.file === key.kind || row.aliases.some((alias) => alias.name === key.kind)).map((row) => ({ folder, row }))
  );
  if (rows.length !== 1) {
    const where = read.map(({ folder }) => `${folder}/Documents/kinds.json`).join(" and ");
    const candidates = rows.map(({ row }) => `${row.file}${row.recipient ? ` (recipient ${row.recipient})` : ""}`);
    const accepted = read.flatMap(({ kinds }) => kinds.flatMap((row) => [row.file, ...row.aliases.map((alias) => alias.name)]));
    throw new DataServerError(
      `kind "${key.kind}" matches ${rows.length} rows of ${where}; exactly one is required ` +
        (candidates.length > 0 ? `(candidates: ${candidates.join(", ")})` : `(accepted kinds: ${accepted.length > 0 ? accepted.join(", ") : "none"})`),
      "kind_unresolved"
    );
  }
  const { folder } = rows[0];
  const typeFile = rows[0].row.file;

  const passage_hashes: Record<string, string> = {};
  const blockOf = (path: string, kind: BlockKind): KnowledgeReadResult => {
    const read: KnowledgeReadResult = knowledgeRead(path, seams);
    const block = read.layout as Json;
    // knowledgeRead has already refused a cited rule_ref no item carries.
    for (const { rule_ref } of citedItems(block, kind, path)) {
      const hash = (read.items as ItemStatus[]).find((item) => item.rule_ref === rule_ref)!.passage_hash;
      if (passage_hashes[rule_ref] !== undefined && passage_hashes[rule_ref] !== hash) {
        throw new DataServerError(`${path}: rule_ref "${rule_ref}" is also cited by the other block with a different passage`, "invalid_layout");
      }
      passage_hashes[rule_ref] = hash;
    }
    return read;
  };
  const typePath = `${folder}/Documents/${typeFile}.md`;
  const typeRead = blockOf(typePath, "type");
  const layout = typeRead.layout as Json;
  (Array.isArray(layout.parts) ? (layout.parts as LayoutPart[]) : []).forEach((part, i) => {
    const held = UNBUILT_PROJECTIONS.get(part.source);
    if (held !== undefined) {
      throw new DataServerError(`${typePath}: parts[${i}].source: projection "${part.source}" is not built yet (${held})`, "projection_not_built");
    }
    if (part.source === "caption" && key.venue === NO_VENUE) {
      throw new DataServerError(
        `${typePath}: parts[${i}].source: projection "caption" prints the venue.md heading fields, and a _NoVenue type has no venue.md`,
        "invalid_layout"
      );
    }
    if ((part.source === "legal-basis" || part.source === "terms") && part.paragraph_numbering === "none") {
      throw new DataServerError(
        `${typePath}: parts[${i}].paragraph_numbering: a "${part.source}" part is always numbered, so its paragraph_numbering must be restart or continue, not none`,
        "invalid_layout"
      );
    }
  });
  const venuePath = key.venue === NO_VENUE ? null : `${folder}/venue.md`;
  const venue = venuePath === null ? null : (blockOf(venuePath, "venue").layout as Json);

  const stored: StoredLayout = { layout, venue, passage_hashes, type_file: typePath, venue_file: venuePath };
  return {
    needs_forum_parts: layout.needs_forum_parts ? 1 : 0,
    layout_snapshot: JSON.stringify(stored),
    type_file: typeFile,
    stored,
    recipient: rows[0].row.recipient ?? null,
    aliases: rows[0].row.aliases.map((alias) => alias.name),
    learned: typeRead.learned === true,
  };
}

interface FilingDates {
  filed_on: string | null;
  retired_on: string | null;
}

function notDrafting(title: string, row: FilingDates): ValidationError | null {
  const act = row.retired_on ? `retired on ${row.retired_on}` : row.filed_on ? `sent on ${row.filed_on}` : null;
  if (!act) return null;
  return new ValidationError(`"${title}"'s layout can be refreshed only while it is being drafted; it was ${act}`, "writing_not_drafting");
}

/** The dedicated re-snapshot write (spec section 5): only while drafting; moves the revision through
 * the filings update; the needs-forum guard and the layout-freeze trigger run on the write. */
export async function resnapshotWriting(
  dbPath: string,
  filingId: number,
  opts: { jurisdiction?: { country: string; jurisdiction: string }; seams?: KnowledgeSeams } = {}
): Promise<{ filing_id: number; needs_forum_parts: 0 | 1; type_file: string; revision: number }> {
  // filingId is interpolated into the guarded UPDATE below.
  if (!Number.isInteger(filingId)) throw new ValidationError(`filing id ${filingId} is not an integer`, "invalid_filing_id");
  const filing = submissionDataQuery(
    dbPath,
    "SELECT f.id, f.kind, f.title, f.filed_on, f.retired_on, p.forum FROM filings f JOIN proceedings p ON p.id = f.proceeding_id WHERE f.id = ?",
    [filingId]
  ).rows[0] as unknown as (FilingDates & { kind: string; title: string; forum: string | null }) | undefined;
  if (!filing) throw new NotFoundError("That Writing is not in this matter's drafting records", "not_found");
  if (isJobOnlyBoard(filing)) throw new ValidationError(`Work Board ${filingId} has no Writing, so it has no layout to refresh`, "milestone_only");
  const refused = notDrafting(filing.title, filing);
  if (refused) throw refused;

  let key: TreeKey;
  if (filing.forum !== null) {
    const segments = filing.forum.split("/");
    if (segments.length !== 3) {
      throw new ValidationError(`"${filing.title}": its proceeding's court or tribunal, ${filing.forum}, is not one Probanda can name`, "invalid_forum");
    }
    const [country, jurisdiction, venue] = segments;
    key = { country, jurisdiction, venue, kind: filing.kind };
  } else {
    // shared/knowledge-tree.md: the _NoVenue jurisdiction is the writer's; the calling skill passes it and never infers it.
    if (!opts.jurisdiction) {
      throw new ValidationError(
        `"${filing.title}" sits on a proceeding with no court or tribunal, so its layout is refreshed under the writer's jurisdiction, which was not given`,
        "jurisdiction_required"
      );
    }
    key = { country: opts.jurisdiction.country, jurisdiction: opts.jurisdiction.jurisdiction, venue: NO_VENUE, kind: filing.kind };
  }

  const composed = composeLayoutSnapshot(key, opts.seams);
  await submissionDataExecute(
    dbPath,
    `UPDATE filings SET layout_snapshot = '${composed.layout_snapshot.replace(/'/g, "''")}', needs_forum_parts = ${composed.needs_forum_parts} ` +
      `WHERE id = ${filingId} AND filed_on IS NULL AND retired_on IS NULL;`
  );

  // A guarded UPDATE matching nothing is not an error, so this read is what proves the write landed.
  const after = submissionDataQuery(
    dbPath,
    "SELECT layout_snapshot, filed_on, retired_on, (SELECT value FROM db_meta WHERE key = 'revision') AS revision FROM filings WHERE id = ?",
    [filingId]
  ).rows[0] as unknown as FilingDates & { layout_snapshot: string | null; revision: string };
  const refusedAfter = notDrafting(filing.title, after);
  if (refusedAfter) throw refusedAfter;
  if (after.layout_snapshot !== composed.layout_snapshot) {
    throw new ValidationError(`"${filing.title}"'s layout was not refreshed: the saved layout differs from the one written`, "writing_not_drafting");
  }
  return { filing_id: filingId, needs_forum_parts: composed.needs_forum_parts, type_file: composed.type_file, revision: Number(after.revision) };
}
