---
status: accepted
---

# A new PDF's first ingestion runs on Haiku, at medium effort up to 8 pages and high effort from 9 to 30

Opus high is too expensive for a document's first ingestion, which is a cheap first pass: a document is re-ingested later only by a stronger model. A test measured how Haiku's fact extraction changes with the number of pages one subagent reads, at medium and high effort (2026-10-20). Brahm made this decision from its results, published as [0012-haiku-effort-by-document-length.html](0012-haiku-effort-by-document-length.html).

- **1 to 8 pages: Haiku, medium effort.**
- **9 to 30 pages: Haiku, high effort.**
- **Over 30 pages: not decided.** No test gave Haiku high more than 29 pages at once.

## The evidence

The test read 20 pages of one scanned records production in rotated windows of 1 to 20 pages: 634 runs, all 16 effort and size combinations interleaved in one queue, scored against a key checked by Fable. A rerun of medium at 3 and 4 pages matched the first round within a point or two.

- **Medium recall falls as the batch grows**: about 65% at 1 to 3 pages, 59% at 5, 54% at 10, 49% at 15 and 39% at 20.
- **High recall holds at 58% to 65% at every size from 1 to 20 pages.**
- **High costs 1.4 to 2.1 times as much as medium** at the same size. Per page, both get cheaper and faster as batches grow.
- **Errors are rare at every size** (23 of 9,337 claims) and come from a few hard passages, not from batch size. Without the faint-scan and form-layout artefacts, medium's few errors sit at 15 and 20 pages and high's stay near zero.

Up to about 4 pages the two settings find the same share of facts and medium costs less. From 5 pages up high finds more, by 6 to 24 points from 10 pages. The 8-page boundary sits in that crossover.

## Considered options

- **Medium for every first pass**: cheapest, but by 20 pages it finds 39% of the facts against 65% at 1 to 3 pages.
- **High for every first pass**: the same recall on documents of up to 4 pages for 1.4 to 1.6 times the cost.
- **Split long documents into small batches on medium**: matches high's recall, but costs more than high on whole documents, because each subagent repeats a fixed setup cost.

## Limits

- One document, mostly redacted emails and forms, and one scan with a faint image that Haiku sometimes misread.
- The test measured pages per subagent, not document length. The decision assumes a document of up to 30 pages is read by one subagent.
- An earlier test on 11 mixed documents of up to 29 pages agreed that medium falls above 10 pages and high loses less.

## Consequences

- /ingest counts a PDF's pages before extraction and dispatches the extractor on Haiku at the effort this table gives.
- A document over 30 pages needs its own decision, and a test with Haiku high on longer batches, before /ingest handles it.
- The planned record of each document's extraction model and effort, with re-ingestion only by a stronger model, builds on this split.
