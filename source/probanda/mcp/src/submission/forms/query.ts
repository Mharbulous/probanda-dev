// Shared row fetchers for the submission form renderers (build ticket
// #297). Thin wrappers over drafting_data__query's generic
// connection-discipline primitive -- SQL lives here, not in backend.ts,
// consistent with the /drafting-data gatekeeper's "this backend never
// embeds a query" boundary (that boundary is about the MCP backend, not the
// forms renderer, which is itself the ticket's own SQL-owning surface).

import { readFileSync } from "node:fs";

import { DataServerError } from "../../errors.js";
import { extractJsonBlock, validateVenueBlock } from "../../knowledge/declared-layout.js";
import { parseKnowledgePath, shippedLayer } from "../../knowledge/tree.js";
import { submissionDataQuery } from "../backend.js";
import type { CaptionHeading } from "./components.js";
import type { StoredLayout } from "./layout-snapshot.js";

export interface ProceedingRow {
  id: number;
  matter_reference: string;
  /** The venue's knowledge-tree key, `<Country>/<Jurisdiction>/<Venue>` (schema v28), e.g.
   * `CAN/BC/BCSC`. NULL while the forum is not yet chosen (ADR 0018): such a proceeding holds
   * only Writings with `needs_forum_parts` 0 (schema v30). */
  forum: string | null;
  court_or_centre: string | null;
  registry: string | null;
  file_number: string | null;
  style_of_cause: string | null;
  courthouse_address: string | null;
  rule_24h_consent: number;
  /** BCCA outer cover page's "ON APPEAL FROM" line (schema v13) -- the order under appeal. */
  under_appeal_judge: string | null;
  under_appeal_court: string | null;
  under_appeal_pronounced: string | null;
  /** Verbatim sealing-order/publication-ban/anonymity-order line(s) for the cover page (schema v13); NULL when none apply. */
  access_restrictions: string | null;
}

export interface FilingRow {
  id: number;
  proceeding_id: number;
  /** Open text since schema v29: an alias in its venue's kinds index in /draft's tree, which maps
   * it to the kind's type file (filler-registry.ts). */
  kind: string;
  subkind: "default_judgment" | "consent" | null;
  round: "opening" | "response" | "reply" | "non_participation" | null;
  title: string;
  /** Lifecycle dates (schema v17) -- NULL until the act happens, cleared to undo it. */
  filed_on: string | null;
  decided_on: string | null;
  entered_on: string | null;
  retired_on: string | null;
  retirement_reason: "appeal_expired" | "appeal_exhausted" | "decided" | "settled" | "abandoned" | "adjourned_generally" | "other" | "delivered" | null;
  /** Whether the Writing prints parts only a forum supplies, from its type file (schema v30). A
   * needs-forum Writing never sits on a proceeding with no forum. */
  needs_forum_parts: 0 | 1;
  /** The stored layout (schema v30), JSON text `{"layout", "venue", "passage_hashes", "type_file",
   * "venue_file"}` (forms/layout-snapshot.ts; a v30-backfilled row lacks the last two); NULL until
   * the runtime snapshots the Writing. */
  layout_snapshot: string | null;
  /** The signer (schema v30): a firm roster key, or a party for a `signer: party` type; at most one. */
  signer_key: string | null;
  signer_party_id: number | null;
  /** The signer's details as JSON text, NULL until the Writing is sent (schema v30). */
  signer_snapshot: string | null;
  /** The `documents` row of the copy as sent (schema v30, ADR 0024 D6). */
  sent_copy_id: number | null;
  /** The date a session confirmed the Writing links its cited authority or cites none (schema v40,
   * #1231); NULL until then. */
  authority_confirmed_on: string | null;
  /** Counsel's decision that the factual-basis Part is filed empty (schema v49): the date and the
   * reason verbatim, both set or both NULL. Absent (undefined) on a database held below v49, because
   * the filing row is read with SELECT *. */
  pure_law_on?: string | null;
  pure_law_note?: string | null;
}

export interface PartyRow {
  id: number;
  proceeding_id: number;
  name: string;
  role: string;
  ordinal: number;
  is_client: number;
  is_applicant: number;
  to_be_served: number;
  /** This and the four counsel fields are case data's (party/counsel SSOT): the drafting read fills
   * them from case data, a sent Writing from its snapshot. `parties` holds none of them (schema v43). */
  address_for_service: string | null;
  counsel_name: string | null;
  /** Three-state AFS filed flag (schema v10, #372/#380) -- 'unknown' renders a question marker
   * on the mockup, never a guessed checkbox; independent of address_for_service itself. */
  address_for_service_filed: "yes" | "no" | "unknown";
  /** BCCA cover page's counsel contact table (schema v13) -- address_for_service supplies the address itself. */
  counsel_firm: string | null;
  counsel_phone: string | null;
  counsel_email: string | null;
  /** BCCA outer cover page's bracketed lower-court-role line, e.g. "Plaintiffs" (schema v14) --
   * one value per party, since parties sharing an appeal role are not guaranteed to share a
   * lower-court role. NULL for non-BCCA proceedings and for any party not yet elicited. */
  lower_court_role: string | null;
  /** The /case-data party this row stands for (schema v41, party/counsel SSOT); NULL until a session
   * links it, and on a sent Writing's snapshot rows, which are never compared. */
  case_party_id: number | null;
}

function rows<T>(dbPath: string, sql: string, params: unknown[] = []): T[] {
  return submissionDataQuery(dbPath, sql, params).rows as unknown as T[];
}

export function fetchFiling(dbPath: string, filingId: number): FilingRow {
  const found = rows<FilingRow>(dbPath, "SELECT * FROM filings WHERE id = ?", [filingId]);
  if (found.length === 0) throw new Error(`No filing found with id ${filingId}`);
  return found[0];
}

export function fetchProceeding(dbPath: string, proceedingId: number): ProceedingRow {
  const found = rows<ProceedingRow>(dbPath, "SELECT * FROM proceedings WHERE id = ?", [proceedingId]);
  if (found.length === 0) throw new Error(`No proceeding found with id ${proceedingId}`);
  return found[0];
}

/** A proceeding whose forum is chosen: what a Writing that needs forum parts, and every bespoke
 * renderer, requires. */
export type FiledProceeding = ProceedingRow & { forum: NonNullable<ProceedingRow["forum"]> };

/**
 * The proceeding, refused only when the Writing needs forum parts and the forum is not chosen
 * (spec §5, schema v30). A Writing with `needs_forum_parts` 0 may sit on a forum-less proceeding.
 */
export function requireForum(proceeding: ProceedingRow, needsForum: true): FiledProceeding;
export function requireForum(proceeding: ProceedingRow, needsForum: boolean): ProceedingRow;
export function requireForum(proceeding: ProceedingRow, needsForum: boolean): ProceedingRow {
  if (needsForum && proceeding.forum === null) {
    throw new Error(`Proceeding ${proceeding.id} has forum null, and Writing needs forum parts (needs_forum_parts = 1)`);
  }
  return proceeding;
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A layout scalar, bare or cited as `{value, rule_ref}`. */
export function scalarValue(raw: unknown): unknown {
  return isObject(raw) && Object.hasOwn(raw, "value") && Object.hasOwn(raw, "rule_ref") ? raw.value : raw;
}

/** The Writing's stored layout (forms/layout-snapshot.ts). Fails hard, naming the filing, on NULL
 * or a malformed snapshot. */
export function storedLayout(filing: FilingRow): StoredLayout {
  const bad = (why: string): never => {
    throw new DataServerError(`Filing ${filing.id}: layout_snapshot ${why}`, "invalid_layout_snapshot");
  };
  if (filing.layout_snapshot === null) return bad("is NULL; the Writing has no stored layout");
  let parsed: unknown;
  try {
    parsed = JSON.parse(filing.layout_snapshot);
  } catch (err) {
    return bad(`is not valid JSON: ${(err as Error).message}`);
  }
  if (!isObject(parsed)) return bad("is not a JSON object");
  if (!isObject(parsed.layout)) bad("has no layout block");
  if (parsed.venue !== null && !isObject(parsed.venue)) bad("has a venue that is neither a block nor null");
  if (!isObject(parsed.passage_hashes)) bad("has no passage_hashes object");
  return {
    layout: parsed.layout as Json,
    venue: parsed.venue as Json | null,
    passage_hashes: parsed.passage_hashes as Record<string, string>,
    type_file: typeof parsed.type_file === "string" ? parsed.type_file : null,
    venue_file: typeof parsed.venue_file === "string" ? parsed.venue_file : null,
  };
}

/** A venue.md block's heading fields as printed (shared/declared-layout.md section 8), each cited
 * field's value unwrapped. */
export interface VenueHeading extends CaptionHeading {
  display_label: string;
}

/** The venue.md /draft's shipped tree holds for a forum, as a row with no stored layout reads it. */
function shippedVenueBlock(filing: FilingRow, forum: string): unknown {
  const path = `draft/${forum}/venue.md`;
  const { layer } = shippedLayer("draft", parseKnowledgePath(path, `filing ${filing.id}'s venue`).rest, {});
  let content: string;
  try {
    content = readFileSync(layer.abs, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    throw new DataServerError(`Filing ${filing.id}: forum "${forum}" has no venue.md in /draft's shipped tree (${layer.abs})`, "venue_missing");
  }
  return extractJsonBlock(content, path, true);
}

/**
 * The filing's venue heading: its stored venue block, or, for a row with no stored layout (a
 * seeded test row; every real database is snapshotted since v30), the venue.md /draft's shipped
 * tree holds for the proceeding's forum. Null when the stored layout has no venue block (a
 * _NoVenue type), or when an unsnapshotted row's proceeding has no forum. A forum with no shipped
 * venue.md, and a block the validator refuses, fail hard.
 */
export function venueHeadingFor(filing: FilingRow, proceeding: ProceedingRow): VenueHeading | null {
  const block =
    filing.layout_snapshot !== null ? storedLayout(filing).venue : proceeding.forum === null ? null : shippedVenueBlock(filing, proceeding.forum);
  if (block === null) return null;
  validateVenueBlock(block, `filing ${filing.id}'s venue block`);
  const fields = block as Record<string, unknown>;
  return {
    caption_lines: scalarValue(fields.caption_lines) as string | string[],
    file_number_label: scalarValue(fields.file_number_label) as string,
    registry_label: scalarValue(fields.registry_label) as string | null,
    display_label: scalarValue(fields.display_label) as string,
  };
}

/** The venue heading a caption prints. Fails hard, naming the filing, when there is none: a caption
 * never renders with another venue's heading. */
export function captionHeadingFor(filing: FilingRow, proceeding: ProceedingRow): VenueHeading {
  const heading = venueHeadingFor(filing, proceeding);
  if (heading === null) {
    const why = filing.layout_snapshot === null ? `its proceeding ${proceeding.id} has no forum` : "its stored layout has no venue block";
    throw new DataServerError(`Filing ${filing.id} prints a caption, but ${why}`, "venue_missing");
  }
  return heading;
}

/** The values /case-data owns, which a party row takes from case data while its Writing drafts and
 * from `parties_snapshot` once it is sent, and never from `parties` (party/counsel SSOT). */
export type CaseDataField = "counsel_name" | "counsel_firm" | "counsel_email" | "counsel_phone" | "address_for_service";

/** A `parties` row as stored: everything but the five values case data owns. */
export type StoredPartyRow = Omit<PartyRow, CaseDataField>;

/** A proceeding's `parties` rows, without counsel or the address for service, which the drafting
 * read fills from case data (parties-drift.ts draftingParties). */
export function fetchParties(dbPath: string, proceedingId: number): StoredPartyRow[] {
  return rows<StoredPartyRow>(
    dbPath,
    `SELECT id, proceeding_id, name, role, ordinal, is_client, is_applicant, to_be_served, address_for_service_filed,
            lower_court_role, case_party_id
       FROM parties WHERE proceeding_id = ? ORDER BY ordinal`,
    [proceedingId]
  );
}

/** A proceeding's `parties` rows with every column the database holds, so with the copied counsel
 * values on a database that still has them (schema v42 and before; v43 drops them). Read only by the
 * counsel offer-back and the drop hop's gate, never by a renderer. */
export function fetchPartiesAsHeld(dbPath: string, proceedingId: number): (StoredPartyRow & Partial<Pick<PartyRow, CaseDataField>>)[] {
  return rows(dbPath, "SELECT * FROM parties WHERE proceeding_id = ? ORDER BY ordinal", [proceedingId]);
}

/** The party rows a sent Writing printed (schema v41 `parties_snapshot`, filled in the statement that
 * first set its `filed_on`), in fetchParties's order with the five values it was sent with. A later
 * change to `parties` or to case data never reaches them. */
export function fetchSentParties(dbPath: string, filing: FilingRow): PartyRow[] {
  return rows<PartyRow>(
    dbPath,
    `SELECT party_id AS id, ? AS proceeding_id, name, role, ordinal, is_client, is_applicant, to_be_served,
            address_for_service, counsel_name, address_for_service_filed, counsel_firm, counsel_phone,
            counsel_email, lower_court_role, NULL AS case_party_id
       FROM parties_snapshot WHERE filing_id = ? ORDER BY ordinal, party_id`,
    [filing.proceeding_id, filing.id]
  );
}

export interface FilingRecipientRow {
  /** The `recipients` row. */
  id: number;
  /** NULL only on an `unrecorded` row. */
  name: string | null;
  capacity: string | null;
  email: string | null;
  address: string | null;
  /** The party this recipient is or acts for; NULL for the forum and anyone else not a party's. */
  party_id: number | null;
  role: "to" | "cc" | "bcc";
  ordinal: number;
  /** A sent Writing's party-linked recipient whose party is not among the party rows it was sent with
   * (a party added after the send): no name, email or address was recorded for it. Since schema v44
   * the party_id is snapshotted with the send, so in practice only a Writing sent before that hop, whose
   * snapshot took the party_id it held then, still prints one. */
  unrecorded?: true;
}

/** Databases known to hold `recipients_snapshot` (schema v44). Only a present table is remembered:
 * no hop drops it, while a database below v44 can be migrated mid-session. */
const recipientsSnapshotHeld = new Set<string>();

function hasRecipientsSnapshot(dbPath: string): boolean {
  if (recipientsSnapshotHeld.has(dbPath)) return true;
  const held = rows<{ n: number }>(dbPath, "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'recipients_snapshot'")[0].n > 0;
  if (held) recipientsSnapshotHeld.add(dbPath);
  return held;
}

/**
 * A Writing's recipients from its service list (schema v30): `to`, then `cc`, then `bcc`, each by
 * ordinal. A row with no party prints its own name, email and address. A party-linked row takes them
 * from the Writing's party rows (party/counsel SSOT), `parties`: the case-data read while the Writing
 * drafts, `parties_snapshot` once it is sent. Its name is the party's counsel, else the party's own
 * name; its email counsel's; its address the address for service; its capacity stays its own. Its own
 * name, email and address are never read: schema v43 holds them NULL. A sent Writing reads each
 * recipient's capacity, party_id, name, email and address from `recipients_snapshot` (schema v44,
 * filled in the statement that first set its `filed_on`), never from `recipients`, and a member with
 * no snapshot row fails hard, naming it. A database held below v44 has no snapshot, so its sent
 * Writings read `recipients` as they did before the hop. A
 * party-linked row whose party is not among `parties` fails hard, naming it, on a drafting Writing,
 * and comes back `unrecorded` on a sent one.
 */
export function fetchFilingRecipients(dbPath: string, filing: FilingRow, parties: readonly PartyRow[]): FilingRecipientRow[] {
  const byId = new Map(parties.map((p) => [p.id, p]));
  const fromSnapshot = Boolean(filing.filed_on) && hasRecipientsSnapshot(dbPath);
  const source = fromSnapshot
    ? "LEFT JOIN recipients_snapshot r ON r.filing_id = fr.filing_id AND r.recipient_id = fr.recipient_id"
    : "JOIN recipients r ON r.id = fr.recipient_id";
  return rows<FilingRecipientRow & { held: number | null }>(
    dbPath,
    `SELECT fr.recipient_id AS id,
            CASE WHEN r.party_id IS NULL THEN r.name END AS name,
            r.capacity,
            CASE WHEN r.party_id IS NULL THEN r.email END AS email,
            CASE WHEN r.party_id IS NULL THEN r.address END AS address,
            r.party_id, fr.role, fr.ordinal, r.id AS held
     FROM filing_recipients fr
     ${source}
     WHERE fr.filing_id = ?
     ORDER BY CASE fr.role WHEN 'to' THEN 0 WHEN 'cc' THEN 1 ELSE 2 END, fr.ordinal`,
    [filing.id]
  ).map(({ held, ...r }) => {
    if (held === null) {
      throw new DataServerError(
        `Filing ${filing.id}: recipient ${r.id} has no recipients_snapshot row, so the values it was sent with were not recorded`,
        "recipient_snapshot_missing"
      );
    }
    if (r.party_id === null) return r;
    const party = byId.get(r.party_id);
    if (party !== undefined) return { ...r, name: party.counsel_name ?? party.name, email: party.counsel_email, address: party.address_for_service };
    if (!filing.filed_on) {
      throw new DataServerError(
        `Filing ${filing.id}: recipient ${r.id}${r.capacity ? ` (${r.capacity})` : ""} is linked to party ${r.party_id}, which is not a party of proceeding ${filing.proceeding_id}; ` +
          "link it to one of its parties, or clear its party_id",
        "recipient_party_missing"
      );
    }
    return { ...r, name: null, email: null, address: null, unrecorded: true as const };
  });
}

/** A Writing's own prose blocks (schema v22, slot open text since v33), by slot, each with its row id. */
export function fetchProse(dbPath: string, filingId: number): Map<string, { id: number; text: string }> {
  return new Map(
    rows<{ id: number; slot: string; text: string }>(dbPath, "SELECT id, slot, text FROM filing_prose WHERE filing_id = ?", [filingId]).map((r) => [r.slot, { id: r.id, text: r.text }])
  );
}

/** One statement of law a Writing's own text cites (schema v36, `filing_law`), with its authority. */
export interface FilingLawRow {
  statement_id: number;
  authority_id: number;
  authority_title: string;
  authority_citation: string | null;
  pinpoint: string | null;
  excerpt: string | null;
  doubt: string | null;
  source: string | null;
  verification: string;
  treatment: string | null;
  authority_kind: string; // authorities.kind -- with currency_status, picks what 📇 reads (#1628)
  currency_status: string | null;
  treatment_note: string | null; // authorities.treatment_note (schema v51), printed in the note-up tag
  authority_killed_on: string | null;
  settled_on: string | null; // statements_of_law.settled_on (schema v47), printed in the settled tag
  excerpt_speaker: string | null; // statements_of_law.excerpt_speaker (schema v61), printed in the quoting tag
  linked_provisions: string | null; // linkedProvisionsColumn, read by 🕰️
}

/** Databases known to hold `statements_of_law.settled_on` (schema v47). Only a present column is
 * remembered, as for `recipients_snapshot`. */
const settledOnHeld = new Set<string>();

/** The select expression for a statement's `settled_on`: the column, or NULL on a database held below
 * v47, where no statement can be 'settled', so the settled tag never prints. It keeps v42 readable
 * (forms.ts MIN_READABLE_SCHEMA_VERSION): a matter whose 42 -> 43 hop is refused stays there (#1460). */
export function settledOnColumn(dbPath: string): string {
  if (!settledOnHeld.has(dbPath)) {
    const held = rows<{ n: number }>(dbPath, "SELECT COUNT(*) AS n FROM pragma_table_info('statements_of_law') WHERE name = 'settled_on'")[0].n > 0;
    if (!held) return "NULL AS settled_on";
    settledOnHeld.add(dbPath);
  }
  return "sl.settled_on";
}

/** Databases known to hold the v61 fit columns (`statements_of_law.excerpt_speaker`,
 * `provision_currency.in_force_on`). Only a present column is remembered, as for `settled_on`. */
const authorityFitHeldDbs = new Set<string>();

/** Whether the database holds the v61 fit columns. A database held below v61 has no recorded speaker
 * and no in-force date, so the quoting tag never prints there and 🕰️ reads citation years alone. It
 * keeps v42 readable, as `settledOnColumn` does. */
function authorityFitHeld(dbPath: string): boolean {
  if (authorityFitHeldDbs.has(dbPath)) return true;
  const held = rows<{ n: number }>(dbPath, "SELECT COUNT(*) AS n FROM pragma_table_info('statements_of_law') WHERE name = 'excerpt_speaker'")[0].n > 0;
  if (held) authorityFitHeldDbs.add(dbPath);
  return held;
}

/** The select expression for a statement's `excerpt_speaker` (alias `sl`): the column, or NULL on a
 * database held below v61. */
export function excerptSpeakerColumn(dbPath: string): string {
  return authorityFitHeld(dbPath) ? "sl.excerpt_speaker" : "NULL AS excerpt_speaker";
}

/** The select expression for a statement's linked provisions (alias `sl`), read by 🕰️
 * (authority-fit.ts): every other statement of the same proposition whose authority is a live
 * statute, regulation or rule, as `in_force_on<US>citation` records joined by RS. NULL when there
 * is none or the statement has no proposition. Below v61 the in-force date reads empty. */
export function linkedProvisionsColumn(dbPath: string): string {
  const inForce = authorityFitHeld(dbPath)
    ? "COALESCE((SELECT pc.in_force_on FROM provision_currency pc WHERE pc.authority_id = o.authority_id AND pc.provision = o.pinpoint), '')"
    : "''";
  return `(SELECT GROUP_CONCAT(${inForce} || char(31) || COALESCE(oa.citation, ''), char(30))
             FROM statements_of_law o JOIN authorities oa ON oa.id = o.authority_id
             WHERE o.law_assertion_id = sl.law_assertion_id AND o.id <> sl.id
               AND oa.kind IN ('statute', 'regulation', 'rule') AND oa.killed_on IS NULL) AS linked_provisions`;
}

/** Databases known to hold `submissions.no_facts_needed_on` (schema v48). Only a present column is
 * remembered, as for `settled_on`. */
const noFactsNeededHeld = new Set<string>();

/** The select expression for a submission's `no_facts_needed_on` (table alias `s`): the column, or
 * NULL on a database held below v48, where counsel can have recorded no such decision, so 🧾 reads the
 * linked facts alone. It keeps v42 readable, as `settledOnColumn` does. */
export function noFactsNeededColumn(dbPath: string): string {
  if (!noFactsNeededHeld.has(dbPath)) {
    const held = rows<{ n: number }>(dbPath, "SELECT COUNT(*) AS n FROM pragma_table_info('submissions') WHERE name = 'no_facts_needed_on'")[0].n > 0;
    if (!held) return "NULL AS no_facts_needed_on";
    noFactsNeededHeld.add(dbPath);
  }
  return "s.no_facts_needed_on";
}

/** Databases known to hold `submissions.no_law_needed_on` (schema v60). Only a present column is
 * remembered, as for `settled_on`. */
const noLawNeededHeld = new Set<string>();

/** The select expression for a submission's `no_law_needed_on` (table alias `s`): the column, or NULL
 * on a database held below v60, where counsel can have recorded no such decision, so 📚 reads the
 * linked propositions alone. It keeps v42 readable, as `noFactsNeededColumn` does. */
export function noLawNeededColumn(dbPath: string): string {
  if (!noLawNeededHeld.has(dbPath)) {
    const held = rows<{ n: number }>(dbPath, "SELECT COUNT(*) AS n FROM pragma_table_info('submissions') WHERE name = 'no_law_needed_on'")[0].n > 0;
    if (!held) return "NULL AS no_law_needed_on";
    noLawNeededHeld.add(dbPath);
  }
  return "s.no_law_needed_on";
}

/** Databases known to hold `marker_suppressions` (schema v69). Only a present table is remembered,
 * as for `no_facts_needed_on`. */
const markerSuppressionsHeld = new Set<string>();

/** The facts among `factIds` whose 👤 counsel has suppressed (schema v69): empty on a database held
 * below v69, where counsel can have suppressed nothing. The database deletes a suppression when the
 * fact's postulate changes, so a row read here holds for the line as printed. */
export function suppressedWitnessFactIds(dbPath: string, factIds: readonly number[]): Set<number> {
  if (factIds.length === 0) return new Set();
  if (!markerSuppressionsHeld.has(dbPath)) {
    const held = rows<{ n: number }>(dbPath, "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'marker_suppressions'")[0].n > 0;
    if (!held) return new Set();
    markerSuppressionsHeld.add(dbPath);
  }
  const placeholders = factIds.map(() => "?").join(",");
  return new Set(
    rows<{ keyed_id: number }>(
      dbPath,
      `SELECT keyed_id FROM marker_suppressions WHERE marker = '👤' AND keyed_table = 'facts' AND keyed_id IN (${placeholders})`,
      [...factIds]
    ).map((r) => r.keyed_id)
  );
}

/** The select expression for a submission's `served_order_wordings` (table alias `s`): a JSON array of
 * every wording of every order it serves that is not crossed out -- `order_sought.wording` and each
 * `filing_orders.wording_override` -- read by 📚's ordinary-costs test (markers.ts
 * ordinaryCostsSubmission). `[]` when it serves none. */
export function servedOrderWordingsColumn(): string {
  return `(SELECT json_group_array(w.value)
           FROM order_sought_served_by sb
           JOIN order_sought o ON o.id = sb.order_sought_id
           LEFT JOIN filing_orders fo ON fo.order_sought_id = o.id,
           json_each(json_array(o.wording, fo.wording_override)) w
           WHERE sb.submission_id = s.id AND o.crossed_out_on IS NULL AND w.value IS NOT NULL) AS served_order_wordings`;
}

/** Databases known to hold `authorities.treatment_note` (schema v51). Only a present column is
 * remembered, as for `settled_on`. */
const treatmentNoteHeldDbs = new Set<string>();

/** Whether the database holds `authorities.treatment_note` (schema v51). A database held below v51
 * has no note-up note, so the note-up tag never prints there and the review snapshot reads its
 * pre-v51 keys (markers.ts reviewSnapshotSql). It keeps v42 readable, as `settledOnColumn` does. */
export function treatmentNoteHeld(dbPath: string): boolean {
  if (treatmentNoteHeldDbs.has(dbPath)) return true;
  const held = rows<{ n: number }>(dbPath, "SELECT COUNT(*) AS n FROM pragma_table_info('authorities') WHERE name = 'treatment_note'")[0].n > 0;
  if (held) treatmentNoteHeldDbs.add(dbPath);
  return held;
}

/** The select expression for an authority's `treatment_note` (table alias `auth`): the column, or
 * NULL on a database held below v51. */
export function treatmentNoteColumn(dbPath: string): string {
  return treatmentNoteHeld(dbPath) ? "auth.treatment_note" : "NULL AS treatment_note";
}

/** Databases known to hold `ticket_answers` (schema v52). Only a present table is remembered, as for
 * `recipients_snapshot`. */
const ticketAnswersHeldDbs = new Set<string>();

/** Whether the database holds `ticket_answers` (schema v52). A database held below v52 has no answer
 * saved for any job, so a job's card lists none there. It keeps v42 readable, as `settledOnColumn` does. */
export function ticketAnswersHeld(dbPath: string): boolean {
  if (ticketAnswersHeldDbs.has(dbPath)) return true;
  const held = rows<{ n: number }>(dbPath, "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'ticket_answers'")[0].n > 0;
  if (held) ticketAnswersHeldDbs.add(dbPath);
  return held;
}

/** Databases known to hold `board_attachments` (schema v67). Only a present table is remembered, as
 * for `ticket_answers`. */
const boardAttachmentsHeldDbs = new Set<string>();

/** Whether the database holds `board_attachments` (schema v67, ADR 0042). A database held below v67
 * has no draft attached to any board, and SQL naming the table fails there. */
export function boardAttachmentsHeld(dbPath: string): boolean {
  if (boardAttachmentsHeldDbs.has(dbPath)) return true;
  const held = rows<{ n: number }>(dbPath, "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'board_attachments'")[0].n > 0;
  if (held) boardAttachmentsHeldDbs.add(dbPath);
  return held;
}

/** Databases known to hold `rhetorical_paragraphs` (schema v71). Only a present table is remembered,
 * as for `board_attachments`. */
const rhetoricHeldDbs = new Set<string>();

/** Whether the database holds `rhetorical_paragraphs` and its placement and link tables (schema v71).
 * A database held below v71 has no rhetorical paragraph, and SQL naming the tables fails there. */
export function rhetoricHeld(dbPath: string): boolean {
  if (rhetoricHeldDbs.has(dbPath)) return true;
  const held = rows<{ n: number }>(dbPath, "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'rhetorical_paragraphs'")[0].n > 0;
  if (held) rhetoricHeldDbs.add(dbPath);
  return held;
}

/** Databases known to hold `tickets.deleted_at` (schema v54). Only a present column is remembered,
 * as for `treatment_note`. */
const deletedAtHeldDbs = new Set<string>();

/** Whether the database holds `tickets.deleted_at` (schema v54). A database held below v54 has no
 * deleted job, and SQL naming the column fails there, so every live-job clause is left off. It keeps
 * v42 readable, as `settledOnColumn` does. */
export function deletedAtHeld(dbPath: string): boolean {
  if (deletedAtHeldDbs.has(dbPath)) return true;
  const held = rows<{ n: number }>(dbPath, "SELECT COUNT(*) AS n FROM pragma_table_info('tickets') WHERE name = 'deleted_at'")[0].n > 0;
  if (held) deletedAtHeldDbs.add(dbPath);
  return held;
}

/** Databases known to hold `tickets.created_by` (schema v72). Only a present column is remembered,
 * as for `deleted_at`. */
const createdByHeldDbs = new Set<string>();

/** Whether `tickets.created_by` exists. Before v72 no job records its creating session, so the
 * creator guard on assigning a job is left off. */
export function createdByHeld(dbPath: string): boolean {
  if (createdByHeldDbs.has(dbPath)) return true;
  const held = rows<{ n: number }>(dbPath, "SELECT COUNT(*) AS n FROM pragma_table_info('tickets') WHERE name = 'created_by'")[0].n > 0;
  if (held) createdByHeldDbs.add(dbPath);
  return held;
}

/** Databases known to hold `documents.exhibit_letters` (schema v56). Only a present column is
 * remembered, as for `deleted_at`. */
const exhibitLettersHeldDbs = new Set<string>();

/** Whether the database holds `documents.exhibit_letters` (schema v56). It keeps v42 readable, as
 * `settledOnColumn` does. */
export function exhibitLettersHeld(dbPath: string): boolean {
  if (exhibitLettersHeldDbs.has(dbPath)) return true;
  const held = rows<{ n: number }>(dbPath, "SELECT COUNT(*) AS n FROM pragma_table_info('documents') WHERE name = 'exhibit_letters'")[0].n > 0;
  if (held) exhibitLettersHeldDbs.add(dbPath);
  return held;
}

/** The court-record document's `execution` and `exhibit_letters`, as `court_record_execution` and
 * `court_record_exhibit_letters`, for a query joining that document as `alias`. A database held
 * below v56 reads `exhibit_letters` as NULL. */
export function courtRecordDocumentColumns(dbPath: string, alias: string): string {
  return `${alias}.execution AS court_record_execution, ${exhibitLettersHeld(dbPath) ? `${alias}.exhibit_letters` : "NULL"} AS court_record_exhibit_letters`;
}

/** ` AND deleted_at IS NULL` (on `alias.` when given), so a query sees only jobs that are not
 * deleted (jobs-closeout.md §10a); empty on a database held below v54. */
export function liveTicketClause(dbPath: string, alias?: string): string {
  return deletedAtHeld(dbPath) ? ` AND ${alias === undefined ? "" : `${alias}.`}deleted_at IS NULL` : "";
}

/** A Writing's prose-cited statements of law (#1214), by statement id. */
export function fetchFilingLaw(dbPath: string, filingId: number): FilingLawRow[] {
  return rows<FilingLawRow>(
    dbPath,
    `SELECT sl.id AS statement_id, sl.pinpoint, sl.excerpt, sl.doubt, sl.source, sl.verification, ${settledOnColumn(dbPath)},
            ${excerptSpeakerColumn(dbPath)}, ${linkedProvisionsColumn(dbPath)},
            auth.id AS authority_id, auth.style_of_cause_or_title AS authority_title, auth.citation AS authority_citation,
            auth.treatment, auth.kind AS authority_kind, auth.currency_status, ${treatmentNoteColumn(dbPath)}, auth.killed_on AS authority_killed_on
     FROM filing_law fl
     JOIN statements_of_law sl ON sl.id = fl.statement_id
     JOIN authorities auth ON auth.id = sl.authority_id
     WHERE fl.filing_id = ?
     ORDER BY sl.id`,
    [filingId]
  );
}

export function fetchAllFilingsForProceeding(dbPath: string, proceedingId: number): FilingRow[] {
  return rows<FilingRow>(dbPath, "SELECT * FROM filings WHERE proceeding_id = ? ORDER BY id", [proceedingId]);
}

export function fetchAllProceedings(dbPath: string): ProceedingRow[] {
  return rows<ProceedingRow>(dbPath, "SELECT * FROM proceedings ORDER BY id");
}

/** Proceedings with no filing at all, live or retired (ADR 0018), in id order. */
export function fetchPreFilingProceedings(dbPath: string): ProceedingRow[] {
  return rows<ProceedingRow>(dbPath, "SELECT * FROM proceedings p WHERE NOT EXISTS (SELECT 1 FROM filings f WHERE f.proceeding_id = p.id) ORDER BY p.id");
}

/** The filing's hearing date, or null where it has none -- hearing_details is one-to-one with the
 * filing and VanIAC/requisition filings may never carry one. Read by the lifecycle derivation
 * (forms/lifecycle.ts); each venue renderer still reads the whole row for its own preamble. */
export function fetchHearingDate(dbPath: string, filingId: number): string | null {
  const found = rows<{ hearing_date: string | null }>(dbPath, "SELECT hearing_date FROM hearing_details WHERE filing_id = ?", [filingId]);
  return found.length === 0 ? null : found[0].hearing_date;
}

/**
 * The newest activity timestamp per filing in one proceeding, for the bootstrap ranking.
 *
 * Activity is any timestamp on a ticket, on one of its steps, or on a still-open loose thread
 * (`charted_into IS NULL`). A substance write carries no per-filing timestamp and is
 * deliberately not counted. The row whose `filing_id` is null holds the proceeding-scoped
 * activity, which counts for every filing in that proceeding; folding it in is the caller's.
 *
 * Timestamps are stored `YYYY-MM-DD HH:MM`, so MAX() over text is chronological. The id is
 * bound once per arm rather than as `?1` -- the host Python driver binds `?` by position.
 */
export function fetchLatestActivity(dbPath: string, proceedingId: number): { filing_id: number | null; latest: string }[] {
  // A deleted job counts toward nothing (jobs-closeout.md §10a).
  const live = liveTicketClause(dbPath);
  return rows<{ filing_id: number | null; latest: string }>(
    dbPath,
    `SELECT filing_id, MAX(ts) AS latest FROM (
       SELECT filing_id, created AS ts FROM tickets WHERE proceeding_id = ?${live}
       UNION ALL SELECT filing_id, locked_at FROM tickets WHERE proceeding_id = ?${live}
       UNION ALL SELECT filing_id, plan_approved_at FROM tickets WHERE proceeding_id = ?${live}
       UNION ALL SELECT filing_id, completed_at FROM tickets WHERE proceeding_id = ?${live}
       UNION ALL SELECT t.filing_id, s.done_at FROM ticket_steps s JOIN tickets t ON t.id = s.ticket_id WHERE t.proceeding_id = ?${liveTicketClause(dbPath, "t")}
       UNION ALL SELECT filing_id, created FROM seeds WHERE proceeding_id = ? AND charted_into IS NULL
     ) WHERE ts IS NOT NULL GROUP BY filing_id`,
    [proceedingId, proceedingId, proceedingId, proceedingId, proceedingId, proceedingId]
  );
}

export function fetchRevision(dbPath: string): number {
  const found = rows<{ value: string }>(dbPath, "SELECT value FROM db_meta WHERE key = 'revision'", []);
  if (found.length === 0) return 0;
  const parsed = Number(found[0].value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function clientParty(parties: PartyRow[]): PartyRow | undefined {
  return parties.find((p) => p.is_client === 1);
}

export function applicantParty(parties: PartyRow[]): PartyRow | undefined {
  return parties.find((p) => p.is_applicant === 1);
}

/** Every party in the proceeding that is not the client (issue #345, the unless-admitted guard's
 * per-party half). The schema models no adversity (`to_be_served` is filing-service scoped,
 * `is_applicant` is role, not adversity), so is_client=0 is the only available reading of
 * "opposing", and it is the one the guard uses. Pinned interpretation. */
export function opposingPartyIds(parties: PartyRow[]): number[] {
  return parties.filter((p) => p.is_client !== 1).map((p) => p.id);
}
