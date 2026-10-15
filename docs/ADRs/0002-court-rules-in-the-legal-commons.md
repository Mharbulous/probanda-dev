---
status: accepted
---

# The legal commons holds Court Rules text, filled rule by rule by the practitioners who use it

Every Rule Library fetches its own copy of the same public text. The legal commons holds the official published text of Rule Sets and practice directions instead, one record per rule or practice direction per version, each with its in-force window and its Venue and Rule Set. Probanda loads nothing in bulk. When `court-rules-clerk` serves a Rule Set, part or version the commons lacks, it tells the practitioner and offers to contribute it. The practitioner chooses what goes up: one rule, some parts, the whole Rule Set or nothing. Older versions arrive the same way, when a practitioner needs one and contributes it. What a court has said a rule means enters through the commons' existing principle and authority model, linked to the rule's record. The goal is every Rule Set complete through crowdsourcing.

## Considered options

- **No rule text in the cloud, pooling only publisher maps**: the commons could not search rule text, and a map saves only one fetch of a contents page.
- **Probanda loads whole Rule Sets and their history itself**: Probanda would bear the cost of every Rule Set and every past version, most of which no practitioner uses.
- **Excerpts only, as practitioners quote them**: with no Rule Set structure behind them, the commons could not say what it is missing.

## Consequences

- This rests on Commandment 3, which lets the legal commons database hold the official published text of rules of procedure and practice directions, and on Commandment 6, which limits only responses to a write. Statutes stay User Data, so the procedural sections of an enabling Act stay with legislation-fetcher.
- A Rule Set may stay partly filled for a long time. The commons records which parts and versions it holds, and the clerk states which parts it searched. It never reports that a Rule Set has no rule on a point unless the whole Rule Set is held.
- A contribution records no contributor, because which rules a firm uses can hint at its matters.
- A contribution is the publisher's text as fetched, with its source address, currency marker and sha256. A second contribution of the same version is checked against the first, not added again.
- The commons searches contributed text by meaning, number and heading. The Rule Library keeps its local number, heading and full-text search.
- `source/research/hooks/commons-read-only.py` narrows to let rule contributions through and nothing else, once what it would stop enforcing has been stated.
- Each practitioner allows a Venue's own website for their own machine only, in their firm's `_hosts.json`. No allowance reaches another user.
- The rule overlay's verbatim rule text falls within the exception, so it may stay in the overlay's cloud payload.
- Each publisher's terms for reusing its text are checked before the commons is published at legal-commons.org.
