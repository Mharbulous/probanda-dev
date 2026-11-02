# Judging tier 2 groups

Know-what for the `file-manager:email-dedupe-judge` agent, and for anyone checking its verdicts.

A tier 2 group is copies of one email (same Message-ID) that are not byte-identical. Usually they differ only in delivery headers (`Received`, `Delivered-To`, signatures) because the same email arrived twice. Sometimes they hold different content: a copy with an attachment stripped, a version edited before resending, a forward that kept the Message-ID, a list copy with a footer.

## The rule

- **Subsumed copy goes.** Copy A can go when another copy B in the group holds all of A's information: A's body text is contained in B's (equal, or B's is a superset), and every attachment of A is in B (same SHA-256).
- **Each holds something unique, keep both.** If A has text or an attachment B lacks and B has text or an attachment A lacks, keep both.
- **The kept copy is the superset, whatever its age or UID.** Never keep a copy because it is newer.
- **Three or more copies.** Keep the smallest set of copies whose union holds everything; remove each copy subsumed by a kept one. If one copy subsumes all the others, keep only it.
- **Headers.** Differences in delivery headers (`differing_transport_headers`) are not information. Differences in `subject`, `from`, `to`, `cc`, `date` or `content-type` are not, on their own, lost information when the body and attachments are a superset, but a different `to` or `cc` (another recipient list) or `from` means the copies may be different sends: keep both and say so.
- **When unsure, keep both.** A truncated diff, an undecodable body, an attachment present in name but with a different hash, or anything the comparison file does not settle: decision `keep_all`, reason `uncertain: ...`.

## Evidence to use

Per group, in this order: `hints` (mechanical: `body_equal`, `body_i_within_j`, `attachments_i_subset_of_j`, ...), then `attachments` (compare `sha256`, not filenames), then `body_diffs` (lines with `-` exist only in copy 0, `+` only in the other copy), then `differing_headers`. A diff with only `+` lines means the other copy adds text; only `-` lines means copy 0 adds text; both means each has something unique, unless the changed lines are whitespace or quoting only.

## Verdict file

Write exactly this shape, one entry per group in the comparison file, nothing else:

```json
{"groups": [
  {"group_id": "g1", "decision": "remove",
   "keep": [{"folder": "INBOX", "uid": 12}],
   "remove": [{"folder": "INBOX", "uid": 9}],
   "reason": "UID 12 has the same text plus the order.pdf attachment UID 9 lacks"},
  {"group_id": "g2", "decision": "keep_all", "keep": [...], "remove": [],
   "reason": "each copy has a paragraph the other lacks"}
]}
```

`reason` is one short sentence a lawyer can check, naming what the kept copy holds. It quotes no more than a few words of the email.
