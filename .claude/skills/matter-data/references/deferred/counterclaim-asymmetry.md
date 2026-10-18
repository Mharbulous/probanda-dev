schema-context: v6.9

# Counterclaim Asymmetry

## When this memo fires

- The matter involves a counterclaim or a third-party notice.
- The agent is asked a posture question that is really per-proceeding, not global (e.g. "what's our position on this fact in the counterclaim vs. the main action?").

## Problem

`v_fact_status` derives one posture per fact by aggregating `v_current_positions` across all parties, globally. That works cleanly when a matter has a single proceeding with two sides taking positions on the same set of facts. It breaks down once a matter has a counterclaim, a third-party notice, or any structure where the same fact can appear in more than one proceeding with different parties taking different, independent positions in each.

In that world, "posture" isn't a single global value — it's really per-(fact, proceeding). A fact can be `admitted` in the main action and simultaneously `disputed` in the counterclaim, and the current view has no way to express that; it collapses both into one row.

## Insights

- The schema's `positions` table already carries `fact_id` and `party_id`, but not `proceeding_id` — position rows aren't scoped to a proceeding, only to the parties who hold them. Two proceedings sharing a fact and a party can't currently be told apart from the position rows alone.
- The asymmetry only appears when counterclaims/TPNs are present; the majority of matters (single proceeding, two-sided) are unaffected, which is presumably why the original schema didn't need to handle it.
- This is structurally similar to the judicial-notice problem: both are cases where an aggregate, fact-level view hides something that is really scoped to a specific proceeding-and-fact pair. A future redesign should consider whether one general per-(fact, proceeding) mechanism serves both memos rather than building two bespoke ones.
- Any fix has to preserve the existing global `v_fact_status` behavior for the common single-proceeding case — this isn't a case for replacing the view, but for extending what it can express when more than one proceeding is in play.

## Direction (non-binding)

- A future design could scope posture derivation by proceeding, deriving posture per (fact, proceeding) where positions can be traced to a proceeding (directly or via the party's role in that proceeding), and only falling back to a global posture when a fact only appears in one proceeding.

## Left open

- How to attribute a `positions` row to a proceeding when the row itself doesn't carry `proceeding_id` — via the source's proceeding, via the party's proceeding role, or via a schema change.
- Whether this needs a schema change (e.g., a `proceeding_id` on `positions`) or can be solved by a smarter view.
- How this interacts with the judicial-notice memo's per-proceeding event framing.

---

This memo is problem+insight capital, not a spec. When the trigger fires, absorb the problem framing and insights above and design fresh against the schema in force at that time. Do not copy the Direction section verbatim into an implementation plan.

**Cross-reference (v7.5 correction):** party-role integrity for counterclaims is
owned by `operations/proceedings-profile.md` §§3/5. The deprecated
`plaintiff_by_counterclaim` value was removed; `defendant_by_counterclaim` is
valid only for a standalone counterclaim-only party, and the only sanctioned
role stack is `{defendant, third_party}`. That remains a different axis from
this memo's still-open per-proceeding *fact posture* problem.
