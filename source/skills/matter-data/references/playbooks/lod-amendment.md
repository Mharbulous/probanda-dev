# Playbook: lod-amendment (amending the list of documents)

**Fires when:** the list of documents (LOD) needs to change — a source is added to or removed from the list, which typically also changes whether it can be relied on as proof of a fact.

## Steps

1. Resolve the pointer and read `shared/conventions.md` first.
2. Identify the `main.sources` row being amended and confirm the change with the user (adding to the list, or removing from it).
3. Flip `main.sources.listed`: `0 → 1` when adding the source to the list, `1 → 0` when removing it. The schema refuses `listed = 1` on a source with `privilege_status = 'pending'`; resolve its privilege first (`operations/resolve-privilege.md`).
4. If the source has a related `main.evidence_links` row for a fact affected by this change, **supersede it bitemporally** rather than updating it in place — the bitemporal update convention is defined once in `../../shared/conventions.md` (§7); follow it exactly rather than restating the mechanics here:
   - Close the current row (`valid_to = date('now','localtime')`).
   - Insert the successor row (`valid_from = date('now','localtime')`, `prior_id` = the closed row's id), with the `strength` or other fields reflecting the amended reality.
5. Run the dump (`shared/conventions.md` §8) after the mutation — this is required after every mutation, not optional for this playbook.
6. Report the `listed` flip and the superseded/successor `evidence_links` row ids.

## What this playbook does not do

- It does not decide privilege status — see `promotion.md` for privileged→producible transitions.
- It does not touch `privileged.fact_provenance` — see `provenance.md`.
- It does not UPDATE or DELETE a current bitemporal row's substance directly; any change to `evidence_links` goes through the close-and-supersede pattern in `../../shared/conventions.md`.
