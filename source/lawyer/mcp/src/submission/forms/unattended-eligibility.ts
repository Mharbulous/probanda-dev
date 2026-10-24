// Whether an unattended run may take a job (design §5.3).

import { GLYPH_SLUGS } from "./proposal-inventory.js";
import { scopesShare } from "./ticket-category.js";
import { INELIGIBLE_REASONS, type IneligibleReason, type WorkBoardEdge, type WorkBoardTicket } from "./work-board-ticket.js";

/** "N of M items no longer show their marker" (design §4.7): the live ticket's keys that no
 * generating entry in this render's inventory carries. Null with no inventory, since an absent
 * inventory would read every key as dead, and on a completed, superseded or rejected ticket, whose
 * work is no longer to do. */
export function deadKeySubtitle(ticket: WorkBoardTicket, printed: ReadonlySet<string> | null): string | null {
  if (printed === null || ticket.rejected_at !== null || (ticket.status !== "queued" && ticket.status !== "wip")) return null;
  const dead = ticket.proposal_keys.filter((key) => !printed.has(key)).length;
  return dead === 0 ? null : `${dead} of ${ticket.proposal_keys.length} items no longer show their marker`;
}

/** The session token class an unattended run holds a lock with (plan decision 4), beside an
 * ordinary session's `sess-<hex>`. forms.ts mints it; the renderer reads it off `locked_by`. */
export const UNATTENDED_TOKEN_PREFIX = "sess-unattended-";

/** Design §5.2's eligible list, judged per marker instance: every work marker of work-markers.md
 * table 1a by glyph, with the keyed tables of its eligible instances. An empty list classifies the
 * marker out by name, so eligible-list.unit.test.mjs can tell "classified out" from "never seen". A
 * glyph absent here is ineligible too, so a marker added later fails closed. */
export const UNATTENDED_ELIGIBLE: ReadonlyMap<string, readonly string[]> = new Map<string, readonly string[]>([
  ["🧩", []],
  ["🏛️", []],
  ["📖", []],
  ["📜", []],
  ["📑", []],
  ["💬", []],
  ["📍", []],
  // The court-record instance, keyed on `facts` (actor: holder of the record), is out.
  ["📌", ["statements_of_fact", "admissions"]],
  ["🧷", ["statements_of_fact", "admissions"]],
  ["🔬", []],
  ["↩️", []],
  ["👃", []],
  ["📇", []],
  ["🏷️", ["documents"]],
  ["🕵️", []],
  ["⬜", []],
  ["👤", []],
  ["🗣️", []],
  ["✍️", []],
  ["🖋️", []],
  ["✒️", []],
  ["🎾", []],
  ["🕹️", []],
  ["🥉", []],
  ["🥈", []],
  ["🏅", []],
  ["🦵", []],
  ["🧵", []],
  ["🧾", []],
  ["📚", []],
  ["🧐", []],
]);

/** Whether a Proposal key names an eligible marker instance: its slug's glyph lists its table. */
function eligibleKey(key: string): boolean {
  const [slug, table] = key.split(":");
  return [...GLYPH_SLUGS].some(([glyph, s]) => s === slug && (UNATTENDED_ELIGIBLE.get(glyph) ?? []).includes(table));
}

/** An either/or partner that could still be done: queued or in progress and not rejected. One outside
 * this proceeding (status null) counts as live, as classify() treats such a blocker. */
const livePartner = (p: WorkBoardEdge): boolean => p.status === null || ((p.status === "queued" || p.status === "wip") && !p.rejected);

/** Design §5.3's conditions, one code for each that fails; the ticket is eligible exactly when
 * none does. `titles` maps each key this render derived a Proposal for to that Proposal's fixed
 * text, so a printed key at a later rung matches nothing and reads as `reworded`. With no inventory, the dead-key and
 * reworded checks have nothing to read against and are left to the no-inventory code. `inProgress`
 * is every in-progress job in the proceeding, on any of its filings: substance tables are
 * proceeding-scoped, so sharing a scope entry with one is shared material (#1051). A job with no
 * scope entries shares nothing, and a job never shares with itself. */
export function ineligibleReasons(
  ticket: WorkBoardTicket,
  filed: boolean,
  printed: ReadonlySet<string> | null,
  titles: ReadonlyMap<string, string>,
  inProgress: readonly WorkBoardTicket[]
): IneligibleReason[] {
  const texts = [ticket.title, ticket.intent, ...ticket.steps.slice(0, 1).map((s) => s.text)];
  const failing: Record<IneligibleReason, boolean> = {
    not_ready: ticket.category !== "ready",
    filing_filed: filed,
    no_inventory: printed === null,
    not_one_step: ticket.steps.length !== 1,
    no_proposal_keys: ticket.proposal_keys.length === 0,
    dead_key: printed !== null && ticket.proposal_keys.some((key) => !printed.has(key)),
    reworded: printed !== null && ticket.proposal_keys.some((key) => printed.has(key) && texts.some((text) => text !== titles.get(key))),
    marker_not_eligible: ticket.proposal_keys.some((key) => !eligibleKey(key)),
    live_partner: ticket.conflicts.some(livePartner),
    shared_material: inProgress.some((held) => held.id !== ticket.id && held.scope.some((h) => ticket.scope.some((s) => scopesShare(h, s)))),
  };
  return INELIGIBLE_REASONS.filter((reason) => failing[reason]);
}
