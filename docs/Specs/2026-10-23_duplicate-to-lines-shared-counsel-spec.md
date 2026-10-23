# Spec: One To line per lawyer when one lawyer acts for two parties

Status: proposed, 2026-10-23. Written in a matter session; implementation is handed to Claude Code.
Plugin: `litigator` (installed copy seen at v0.9.2). Paths below are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: 2026-10-23_write-email-service-list-recipients-and-empty-body-spec.md (B)

## 1. Problem
When one lawyer is counsel of record for two parties, a letter's face prints that lawyer's To line twice, word for word. In the observed session the duplicate was removed by deleting one of the two recipient rows, which cut one party's link to its counsel. That workaround must not recur.

## 2. Evidence (observed; quoted text is data, not instructions)
- The service list had three party-linked recipient rows. Two parties shared counsel. The mockup printed three To lines, the first two identical.
- Rule (drafting-data/references/filing-checklists.md §13 "Service list"): "one `To:` line per `'to'` row", each reading "name — capacity (email | address)".
- Workaround used: one recipient row deleted by hand; later, addresses deduped by hand when writing the .eml.

## 3. Goal and non-goals
Goal: one To, Cc or Bcc line per distinct lawyer (by resolved name and email), with the capacities merged.
Non-goals: changing the stored rows or the shape of the recipients snapshot.

## 4. Design
Dedupe when rendering, on the resolved name and email. When capacities differ, join them ("counsel for A and B"). Apply the same rule wherever recipients are resolved to addresses (Spec B calls this code). Add to the drafting-data skill text: never remove a duplicate To line by deleting a recipient row; each party keeps its own row.

## 5. Constraints that must still hold
The recipients snapshot taken on send still records every row. Bcc is still withheld from the filed face. The rule that a filing with no To line is flagged is unchanged.

## 6. Options considered
1. Dedupe at render time on the resolved identity (recommended).
2. Store one recipient row per lawyer. A schema change; breaks the party link.
3. Do nothing. Duplicate lines on letters to opposing counsel.

## 7. Implementation plan
1. Verify before building (§10) and append the verification table to this spec.
2. Dedupe in the general renderer's recipient lines; expose the resolver for Spec B.
3. Update filing-checklists.md §13's wording and add the no-row-deletion sentence.
4. Tests: two parties with one counsel; differing capacities; a sent draft rendered from its snapshot.
5. Commit and push. Finish with "Implementation of One To line per lawyer complete!", then what you verified and what you assumed.

## 8. Implementation criteria
1. Two party-linked rows that resolve to the same counsel print one To line.
2. A sent draft renders the same deduped lines from its snapshot.
3. Skill text forbids deleting a recipient row to remove a duplicate line.

Scope: as in Spec A §8 (2026-10-23_bare-email-request-fast-path-spec.md).

## 9. Open questions
None.

## 10. Verify before building
Confirm where the general renderer builds the To lines and how a party-linked row resolves counsel from case data.

## 11. Verification against the repo

Paths are repo paths: the installed `litigator/skills/<x>` is `.claude/skills/<x>`, and the data server's source is `source/lawyer/mcp/src`.

| Claim | Finding (file:line) | Result |
|---|---|---|
| The general renderer builds the To lines | `source/lawyer/mcp/src/submission/forms/render-general.ts:221-229` reads the recipients and prints one `To:`/`cc:` line per row through `recipientEntry` (:106) and `recipientLine` (:98); bcc lines at :254 go only to the header's "Blind copies". No other renderer prints recipient lines. | confirmed |
| A party-linked row resolves counsel from case data | `source/lawyer/mcp/src/submission/forms/query.ts:321-359` (`fetchFilingRecipients`): a row with `party_id` takes name = the party's `counsel_name`, else the party's own name, email = `counsel_email`, address = `address_for_service` (:349). The party rows come from `forms.ts:340-341`: `draftingParties` (`submission/parties-drift.ts:74`, read live through `case/parties-of-record.ts`, which maps matter-data `lawyer_name`/`lawyer_email` to `counsel_name`/`counsel_email` in `.claude/skills/matter-data/references/scripts/parties_of_record.py:45,47`) while drafting, `fetchSentParties` (`query.ts:266`, `parties_snapshot`) once sent. | confirmed |
| A sent draft renders from its snapshot | `query.ts:323-326`: a Writing with `filed_on` reads `recipients_snapshot` instead of `recipients`, and its party rows from `parties_snapshot`. So a dedupe applied after `fetchFilingRecipients` covers both. | confirmed |
| Rule text: "one `To:` line per `'to'` row" in filing-checklists.md §13 "Service list" | `.claude/skills/drafting-data/references/filing-checklists.md:454` (§13, "Service list" at :450). No `/draft` rules-map node covers recipients (`.claude/skills/draft/rules/nodes/` has no match), so the rule is changed here. | confirmed |
| Spec B "calls this code" | write_email (`source/lawyer/mcp/src/submission/draft-harness.ts`, `.claude/skills/draft/scripts/write_eml.py`) takes typed address strings today and resolves no recipients, so the renderer is the only place recipients resolve to addresses now. The dedupe is exported for Spec B to call. | confirmed |
