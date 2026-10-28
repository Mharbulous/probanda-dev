// A Writing's stored layout (spec §5 "Layout snapshot" and §6 piece 2; shared/declared-layout.md).
//
// Build side: at Writing creation the runtime, not the model, composes the snapshot from the tree
// key the composing skill passes, through composeLayoutSnapshot (../writing-snapshot.ts), the one
// composer, which re-snapshot also calls. It resolves, reads, validates and hashes; this module
// adds only what creation needs: the recipient checks, the forum reconciliation against the
// proceeding, the signer, and the INSERT. The snapshot is one JSON text,
//   {"layout", "venue", "passage_hashes", "type_file", "venue_file"},
// the two blocks kept separate and verbatim, as the v30 backfill writes them; `type_file` and
// `venue_file` are the knowledge paths the filed render's confirmation gate reads again, since a
// _NoVenue Writing's tree key is stored nowhere else. A v30-backfilled row carries neither, and
// cites nothing (the backfill refuses a block that cites a rule_ref).
//
// Read side: renderers read only the stored copy (storedLayout). citedStates reads, once per
// render, the current effective status of every item the stored copy cites.
//
// Creation (submissionDataCreateWriting) writes the filings row with the snapshot and the type's
// needs_forum_parts in one parameterized INSERT: the needs-forum guard fires at INSERT, so neither
// value can be fixed up after it.

import { DataServerError, NotFoundError, ValidationError } from "../../errors.js";
import { citedItems, type BlockKind } from "../../knowledge/declared-layout.js";
import { AUDIENCES, NO_VENUE } from "../../knowledge/index.js";
import type { ItemStatus } from "../../knowledge/sidecar.js";
import { knowledgeRead } from "../../knowledge/tools.js";
import { parseKnowledgePath, type KnowledgeSeams } from "../../knowledge/tree.js";
import { readFirmProfile, type FirmProfile } from "../../tools/practice/firm-profile.js";
import { submissionDataWriteAll, type WriteStatement } from "../backend.js";
import { composeLayoutSnapshot } from "../writing-snapshot.js";
import { boardAttachmentsHeld, fetchParties, fetchProceeding, MILESTONE_KIND, type FilingRow, type ProceedingRow } from "./query.js";

type Json = Record<string, unknown>;

const TOOL = "drafting_data__create_writing";

export interface StoredLayout {
  layout: Json;
  venue: Json | null;
  passage_hashes: Record<string, string>;
  /** The type file's knowledge path; null on a v30-backfilled row. */
  type_file: string | null;
  /** The venue.md knowledge path; null under _NoVenue and on a v30-backfilled row. */
  venue_file: string | null;
}

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ------------------------------------------------------------ build --

function treeKeyOf(raw: unknown): { segments: string[]; key: string; noVenue: boolean } {
  if (!isObject(raw)) throw new ValidationError(`${TOOL}.tree must be {country, jurisdiction, venue}`);
  const extra = Object.keys(raw).filter((k) => !["country", "jurisdiction", "venue"].includes(k));
  if (extra.length > 0) throw new ValidationError(`${TOOL}.tree has unknown field(s) ${extra.join(", ")} (allowed: country, jurisdiction, venue)`);
  const segments = (["country", "jurisdiction", "venue"] as const).map((field) => {
    const value = raw[field];
    if (typeof value !== "string" || value === "" || /[\\/]/.test(value)) {
      throw new ValidationError(`${TOOL}.tree.${field} must be one folder name of /draft's knowledge tree`);
    }
    return value;
  });
  const key = segments.join("/");
  parseKnowledgePath(`draft/${key}`, `${TOOL}.tree`);
  return { segments, key, noVenue: segments[2] === NO_VENUE };
}

export interface SnapshotArgs {
  tree: unknown;
  kind: string;
  recipient?: string;
  proceeding: ProceedingRow;
}

export interface BuiltSnapshot {
  needs_forum_parts: 0 | 1;
  /** The JSON text stored in filings.layout_snapshot. */
  snapshot: string;
  stored: StoredLayout;
  /** Whether the type file is learned (carries `learned_by: agent`). */
  learned: boolean;
  /** The forum the proceeding was reconciled against, which it must still have at INSERT; null
   * under _NoVenue, whose key fits any forum. */
  forum: string | null;
}

/**
 * The layout a new Writing stores, composed by composeLayoutSnapshot and checked against the
 * creation arguments. Fails hard, writing nothing: a tree key that is no folder path, a
 * `recipient` missing under _NoVenue, given elsewhere or no audience, everything the composer
 * refuses (a kind matching no row or more than one by itself, a block the validator refuses, an
 * unbuilt projection, a `legal-basis` part numbered none, a rule_ref the two blocks cite with
 * different passages), a recipient that is not the matched row's, and a venue key that is not the
 * proceeding's forum.
 */
export function buildSnapshot(args: SnapshotArgs, seams: KnowledgeSeams = {}): BuiltSnapshot {
  const { segments, key, noVenue } = treeKeyOf(args.tree);
  if (noVenue && args.recipient === undefined) {
    throw new ValidationError(`${TOOL}: a _NoVenue kind needs recipient (${AUDIENCES.join(", ")})`);
  }
  if (!noVenue && args.recipient !== undefined) {
    throw new ValidationError(`${TOOL}: recipient applies only under _NoVenue; a venue's kinds carry no recipient`);
  }
  if (args.recipient !== undefined && !AUDIENCES.includes(args.recipient)) {
    throw new ValidationError(`${TOOL}: recipient must be one of ${AUDIENCES.join(", ")}`);
  }

  const [country, jurisdiction, venue] = segments;
  const composed = composeLayoutSnapshot({ country, jurisdiction, venue, kind: args.kind }, seams);
  const typeFile = composed.stored.type_file as string;
  // The stored kind resolves on its own, so a re-snapshot (which has no recipient) resolves it the
  // same way; recipient only confirms the audience of the row it names.
  if (noVenue && composed.recipient !== args.recipient) {
    throw new ValidationError(
      `${TOOL}: kind "${args.kind}" is ${typeFile}, whose recipient is ${composed.recipient}, but recipient ${args.recipient} was passed`,
      "recipient_mismatch"
    );
  }
  const needsForum = composed.needs_forum_parts === 1;

  const { proceeding } = args;
  if (!noVenue && proceeding.forum !== key) {
    if (proceeding.forum === null && needsForum) {
      throw new DataServerError(`${TOOL}: proceeding ${proceeding.id} has no forum, and ${typeFile} needs forum parts; choose the forum first`, "needs_forum");
    }
    throw new DataServerError(
      `${TOOL}: tree key ${key} is not proceeding ${proceeding.id}'s forum (${proceeding.forum ?? "not chosen"}); a venue's Writing sits on a proceeding in that venue`,
      "forum_mismatch"
    );
  }

  return { needs_forum_parts: composed.needs_forum_parts, snapshot: composed.layout_snapshot, stored: composed.stored, learned: composed.learned, forum: noVenue ? null : key };
}

// ------------------------------------------------------------ read --

// storedLayout and scalarValue live in query.ts, beside FilingRow, so the venue heading there reads
// the stored venue block without query.ts importing this module, which would close an import cycle.
export { scalarValue, storedLayout } from "./query.js";

/** One item the stored layout cites, with its current effective status. */
export interface CitedState {
  rule_ref: string;
  /** Where the stored block cites it: `title`, `page_limit`, `parts[1]`, `caption_lines`, ... */
  field: string;
  block: BlockKind;
  /** The knowledge path of the file that records it. */
  file: string;
  /** The file's header fields, for the learned-file notice. */
  header: Record<string, string | null>;
  /** The passage hash the snapshot recorded. */
  snapshot_hash: string;
  /** The item's effective status now; undefined when the file no longer carries the rule_ref. */
  item?: ItemStatus;
}

/**
 * Every item the stored layout cites, in block order (the type block's cited fields, its parts,
 * then the venue block), each with its effective status from one knowledge__read of its file. A
 * layout citing nothing reads nothing. A read that fails (the file retired, the case data root
 * missing) fails the render.
 */
export function citedStates(stored: StoredLayout, filing: FilingRow, seams: KnowledgeSeams = {}): CitedState[] {
  const out: CitedState[] = [];
  const read = (block: BlockKind, raw: Json, file: string | null) => {
    const cited = citedItems(raw, block, file ?? `"${filing.title}"'s stored layout`);
    if (cited.length === 0) return;
    if (file === null) {
      throw new DataServerError(`"${filing.title}": its layout cites ${cited.map((c) => c.rule_ref).join(", ")} but records no source to read them from`, "invalid_layout_snapshot");
    }
    const result = knowledgeRead(file, seams);
    for (const { rule_ref, field } of cited) {
      out.push({
        rule_ref,
        field,
        block,
        file,
        header: result.header as Record<string, string | null>,
        snapshot_hash: stored.passage_hashes[rule_ref],
        item: (result.items as ItemStatus[]).find((item) => item.rule_ref === rule_ref),
      });
    }
  };
  read("type", stored.layout, stored.type_file);
  if (stored.venue !== null) read("venue", stored.venue, stored.venue_file);
  return out;
}

// ------------------------------------------------------------ creation --

export interface CreateWritingArgs {
  db_path: string;
  proceeding_id: number;
  tree: unknown;
  kind: string;
  recipient?: string;
  title: string;
  subkind?: string;
  round?: string;
  signer_key?: string;
  signer_party_id?: number;
}

function signerRefused(message: string): DataServerError {
  return new DataServerError(`${TOOL}: ${message}`, "invalid_signer");
}

function activeLawyer(profile: FirmProfile, key: string): boolean {
  return profile.roster.some((entry) => entry.key === key && entry.role === "lawyer" && entry.active !== false);
}

/**
 * The signer stored at creation (#990 item 10). A lawyer type defaults to this machine's `person`
 * when the roster marks that person an active lawyer; a passed key must be one. A party type
 * stores a party of the proceeding. Neither missing value fails creation, and a missing firm
 * profile only leaves the lawyer default unset.
 */
function chooseSigner(layout: Json, args: CreateWritingArgs, proceeding: ProceedingRow, env: NodeJS.ProcessEnv, fallback?: () => string | null): { signer_key: string | null; signer_party_id: number | null } {
  if (layout.signer === "party") {
    if (args.signer_key !== undefined) throw signerRefused("signer_key names a roster lawyer, but this type declares signer: party; pass signer_party_id");
    if (args.signer_party_id === undefined) return { signer_key: null, signer_party_id: null };
    if (!fetchParties(args.db_path, proceeding.id).some((p) => p.id === args.signer_party_id)) {
      throw signerRefused(`party ${args.signer_party_id} is not a party of proceeding ${proceeding.id}`);
    }
    return { signer_key: null, signer_party_id: args.signer_party_id };
  }
  if (args.signer_party_id !== undefined) throw signerRefused("signer_party_id names a party, but this type's signer is a roster lawyer; pass signer_key");
  if (args.signer_key !== undefined) {
    if (!activeLawyer(readFirmProfile(env, fallback), args.signer_key)) {
      throw signerRefused(`signer_key "${args.signer_key}" is not an active lawyer on the firm roster`);
    }
    return { signer_key: args.signer_key, signer_party_id: null };
  }
  let profile: FirmProfile;
  try {
    profile = readFirmProfile(env, fallback);
  } catch (err) {
    if (err instanceof NotFoundError) return { signer_key: null, signer_party_id: null };
    throw err;
  }
  return { signer_key: profile.person !== null && activeLawyer(profile, profile.person) ? profile.person : null, signer_party_id: null };
}

export interface CreateWritingResult {
  filing_id: number;
  needs_forum_parts: 0 | 1;
  layout: Json;
  venue: Json | null;
  signer_key: string | null;
  signer_party_id: number | null;
  type_file: string;
  venue_file: string | null;
  learned: boolean;
  /** The drafts attached to the proceeding's own board (schema v67, ADR 0042) that this write moved
   * onto the new Writing's board: non-zero only on a proceeding's first Writing, always 0 below v67. */
  attachments_moved: number;
  warning?: string;
}

/**
 * drafting_data__create_writing: a new Writing, its type resolved from the tree key, its layout
 * validated and stored with each cited passage hash, its needs_forum_parts taken from the type,
 * and its signer chosen, in one INSERT under the data lock. Nothing else writes those two columns.
 * On a proceeding's first Writing the same transaction re-points the drafts attached to the
 * proceeding's own board to the new Writing (ADR 0042): that board becomes the Writing's, so each
 * draft stays on exactly one board.
 */
export async function submissionDataCreateWriting(args: CreateWritingArgs, seams: KnowledgeSeams = {}): Promise<CreateWritingResult> {
  const env = seams.env ?? process.env;
  if (args.kind === MILESTONE_KIND) {
    throw new ValidationError(`${TOOL}.kind "${MILESTONE_KIND}" is reserved for a Milestone with no Writing; create one through drafting_data__create_milestone`, "reserved_kind");
  }
  const proceeding = fetchProceeding(args.db_path, args.proceeding_id);
  // A title names the Writing only. The style of proceeding is the proceeding's own record, and the
  // Milestone prints it from there, so a title that repeats it is refused before anything is written.
  const styleSuffix = proceeding.style_of_cause ? ` - ${proceeding.style_of_cause}` : null;
  const title = args.title.trim();
  if (styleSuffix !== null && title.endsWith(styleSuffix)) {
    throw new ValidationError(
      `${TOOL}.title "${title}" ends with the proceeding's style of proceeding; a title names the Writing only. Nothing was written. ` +
        `Pass "${title.slice(0, -styleSuffix.length).trim()}" instead.`,
      "title_holds_style"
    );
  }
  const built = buildSnapshot({ tree: args.tree, kind: args.kind, recipient: args.recipient, proceeding }, seams);
  const signer = chooseSigner(built.stored.layout, args, proceeding, env, seams.caseDataRoot);
  const statements: WriteStatement[] = [
    {
      // The WHERE re-checks, inside the INSERT's own transaction, the forum buildSnapshot reconciled
      // against, so a forum changed since that read inserts nothing and rolls the whole write back.
      sql:
        "INSERT INTO filings (proceeding_id, kind, subkind, round, title, needs_forum_parts, layout_snapshot, signer_key, signer_party_id) " +
        "SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ? IS NULL OR (SELECT forum FROM proceedings WHERE id = ?) IS ?",
      params: [
        proceeding.id,
        args.kind,
        args.subkind ?? null,
        args.round ?? null,
        args.title,
        built.needs_forum_parts,
        built.snapshot,
        signer.signer_key,
        signer.signer_party_id,
        built.forum,
        proceeding.id,
        built.forum,
      ],
      expect_changes: 1,
    },
  ];
  // Only on the proceeding's first Writing: a proceeding that already had one had no board of its own.
  if (boardAttachmentsHeld(args.db_path)) {
    statements.push({
      sql:
        "UPDATE board_attachments SET filing_id = last_insert_rowid() WHERE proceeding_id = ? AND filing_id IS NULL " +
        "AND NOT EXISTS (SELECT 1 FROM filings WHERE proceeding_id = ? AND id <> last_insert_rowid())",
      params: [proceeding.id, proceeding.id],
    });
  }
  let written: Awaited<ReturnType<typeof submissionDataWriteAll>>;
  try {
    written = await submissionDataWriteAll(args.db_path, statements, env);
  } catch (err) {
    if (err instanceof Error && err.message.includes("needs its proceeding's forum")) throw new DataServerError(err.message, "needs_forum");
    throw err;
  }
  if (!written.ok) {
    throw new DataServerError(
      `${TOOL}: proceeding ${proceeding.id}'s forum changed from ${built.forum} while the Writing was being created; nothing was written`,
      "forum_mismatch"
    );
  }
  return {
    filing_id: written.results[0].rowid,
    needs_forum_parts: built.needs_forum_parts,
    layout: built.stored.layout,
    venue: built.stored.venue,
    ...signer,
    type_file: built.stored.type_file as string,
    venue_file: built.stored.venue_file,
    learned: built.learned,
    attachments_moved: written.results[1]?.changes ?? 0,
    ...(written.warning ? { warning: written.warning } : {}),
  };
}
