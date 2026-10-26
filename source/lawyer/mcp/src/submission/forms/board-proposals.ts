// The Proposals one render derives, with the keys it shelves and the keys it derives at all.

import { LEGISLATION_KINDS } from "./markers.js";
import { deriveProposals, withNoteUpSteps, type MarkerInventory, type Proposal, type ProposalHolder, type ProposalRejection } from "./proposal-inventory.js";
import type { FilingTitleRow, RejectionRow } from "./work-board-reads.js";
import type { ProceedingBoard } from "./build-proceeding-board.js";
import { rows } from "../query-rows.js";

/** What proposalsFor reads of a render context, so the Sent write's hold can derive the same sets. */
interface ProposalScope {
  dbPath: string;
  proceeding: { id: number };
  filing: { id: number; retired_on: string | null };
  inventory: MarkerInventory | null;
}

/** A retired filing derives no Proposals (design §8): its work is over, and its render carries an
 * empty inventory anyway. Otherwise this render's inventory plus the proceeding's ticket and
 * rejection state give board_card's proposed lane and the board's Shelved lane, `shelved` names the keys
 * whose Proposal the practitioner rejected, and `current` names every key a Proposal derived for,
 * in any lane: the keyed rows at their current rung. */
export function proposalsFor(
  ctx: ProposalScope,
  board: ProceedingBoard
): { proposals: Proposal[]; lapsed_keys: string[]; shelved: Set<string>; current: Set<string> } {
  if (ctx.filing.retired_on || ctx.inventory === null) return { proposals: [], lapsed_keys: [], shelved: new Set(), current: new Set() };

  const titles = new Map(rows<FilingTitleRow>(ctx.dbPath, "SELECT id, title FROM filings WHERE proceeding_id = ?", [ctx.proceeding.id]).map((f) => [f.id, f.title]));
  const holders = new Map<string, ProposalHolder>();
  for (const [key, h] of board.holders) {
    // Null on this board's own filing and on a proceeding-scoped ticket, so the shell prints
    // "already a job on X" without deriving anything (plan A2).
    const ticketedOn = h.filing_id === null || h.filing_id === ctx.filing.id ? null : titles.get(h.filing_id) ?? null;
    holders.set(key, { ticket_id: h.ticket_id, ticketed_on: ticketedOn });
  }
  // Proceeding-wide by construction of the keys, so no filing filter applies. A deleted job's
  // snapshot rows are ignored (jobs-closeout.md §10a): they hide nothing and never read as lapsed.
  const deletedIds = new Set(board.deleted.map((d) => d.id));
  const rejections = new Map<string, ProposalRejection>(
    rows<RejectionRow>(ctx.dbPath, "SELECT proposal_key, ticket_id, marker, item FROM proposal_rejections")
      .filter((r) => r.ticket_id === null || !deletedIds.has(r.ticket_id))
      .map((r) => [r.proposal_key, { ticket_id: r.ticket_id, marker: r.marker, item: r.item }])
  );
  // Shelved (Goal card design §2.4): a Proposal rejected directly, and one hidden behind the
  // rejected ticket it was outlined from. Both read off one more derivation that takes every
  // rejection row as direct, so the lapse, rung and holder rules stay deriveProposals's own. That
  // derivation hides no Proposal behind a ticket, so its keys are every current-rung key.
  const asDirect = new Map([...rejections].map(([key, r]) => [key, { ...r, ticket_id: null }]));
  const every = deriveProposals(ctx.inventory, holders, asDirect).proposals;
  const shelved = new Set(every.filter((p) => p.lane === "rejected").map((p) => p.key));
  const current = new Set(every.map((p) => p.key));
  const derived = deriveProposals(ctx.inventory, holders, rejections);
  // A note-up of a statute, regulation or rule takes one step per provision the filing cites. Read
  // only when such an authority printed 📇, since each read is a host-Python spawn.
  if (!ctx.inventory.some((e) => e.generating !== false && e.provision !== undefined)) return { ...derived, shelved, current };
  const kinds = [...LEGISLATION_KINDS];
  const pinpoints = rows<{ authority_id: number; pinpoint: string }>(
    ctx.dbPath,
    `SELECT sl.authority_id, sl.pinpoint FROM statements_of_law sl JOIN authorities a ON a.id = sl.authority_id
      WHERE sl.proceeding_id = ? AND a.kind IN (${kinds.map(() => "?").join(", ")}) AND a.killed_on IS NULL AND sl.pinpoint IS NOT NULL
      ORDER BY sl.id`,
    [ctx.proceeding.id, ...kinds]
  );
  const contentions = rows<{ contention: string }>(
    ctx.dbPath,
    `SELECT s.contention FROM filing_submissions fs JOIN submissions s ON s.id = fs.submission_id
      WHERE fs.filing_id = ? AND s.killed_on IS NULL ORDER BY fs.document, fs.ordinal`,
    [ctx.filing.id]
  ).map((r) => r.contention);
  return { ...derived, proposals: withNoteUpSteps(derived.proposals, ctx.inventory, pinpoints, contentions), shelved, current };
}
