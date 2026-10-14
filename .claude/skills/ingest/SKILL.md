---
name: ingest
description: >
  Use when asked to ingest, import, or add a litigation document into the case database —
  affidavits, pleadings, transcripts, exhibits, correspondence, or case law.
  Matches: "ingest [path]", "add this to the file", "import this document."
---

# Ingest

Thin routing skill — delegates immediately to the `case-data` gatekeeper.

This skill deliberately carries no `disable-model-invocation` line: `/legal-research`'s flow
opens it through the Skill tool, which refuses a skill carrying that line. It is a stated
exception, like the gatekeepers. Do not add the line back.

Do not extract, summarize, or present facts here — that is `litigation-fact-extractor`'s job.

A BC Court of Appeal application/response book, or a book of authorities, is one PDF holding several distinct documents behind a set of bookmarks. `case-data` splits it by those bookmarks and reports the parts it does not ingest (reasons for judgment, the order, argument, the book's own authorities listing) rather than force-fitting the whole file through one path.

Do not intentionally run ingestions into the same matter in parallel; queue them and let each handoff finish before starting the next.

## Procedure

1. **Court decisions only — citation preflight.** Before delegating, check whether
   the authority is already held: `shared/research-priority.md` tier 1 (the
   matter's ingested layer) and tier 2 (the shared pooled layer, where this
   runtime can reach it — that file says how, and what to do when it cannot). A
   tier-2 hit carries principles, criteria, and authorities someone already
   derived: surface them for reuse and say so, rather than re-deriving from
   scratch. It does not cancel the ingest — the matter still needs its local copy —
   but it changes what the ingest has to work out for itself. Skip this step
   entirely for affidavits, pleadings, transcripts, exhibits, and correspondence:
   the pool holds no matter documents. **For a book of authorities**, the
   preflight list is the book's own bookmark titles — run the same tier-1/tier-2
   check per citation, rather than treating the book as one undivided authority.
2. Pass the document path — or, for a folder or a batch of documents, the folder path and the fact that this is a scan — and any matter context to `case-data`.
   **Court decisions also take an optional issue focus** — a narrower legal issue (e.g. competence-competence, attornment to court jurisdiction) that limits which concepts get criteria. Use the one the caller or the practitioner's request supplies. When the practitioner invoked `/ingest` directly and named none, ask once: "Any specific legal issues to focus on when ingesting this decision? If not, I'll extract all relevant principles." For a batch of more than ~5 files, ask it in the same single confirmation as the file list. A skipped question means full scope. When a focus was given, the final report names the concepts stored without criteria, so the practitioner sees what was scoped out.
3. `case-data` routes internally — a single document in hand and a folder scan are different rows of its routing table, so state which this is and let the router pick the operation. Never pre-empt that routing, write your own SQL, or diff a folder against the database by hand.
4. **Court orders take one extra leg.** An order's operative terms can change rows the file already holds — the style of cause, the trial date, the party roster, counsel of record — so after the document is ingested, `case-data` runs an order-effects pass that proposes those changes and applies only what the practitioner approves. Expect a proposed-changes table on an order, and nothing at all when the order changes no stored field.
5. **A second version of a court document already held is proposed as a supersession.** An unsigned draft, a signed copy and the filed copy of one document are one document. `case-data` shows both copies, proposes which to keep as the source of record and why, and asks one question: keep the proposed copy, keep the other copy, or they are different documents. Nothing is written before the answer. The kept copy takes the other's facts and links, and the other file moves to `0. DRAFT\Superseded`.
6. **Correspondence from the forum that sets a date takes a shorter leg.** `case-data` reports the date it found and recommends recording it as an anchor through `practice:docket-clerk`, citing the document. Nothing is recorded during the ingest, and no deadline is worked out (ADR 0024 D12).
7. **A letter the firm sent takes a delivery check.** After the letter is ingested, `case-data` has the `practice:delivery-checker` agent check whether it went out and arrived by each method it states, and reports the result in one line per method. The result is reported and kept nowhere. Never ask the practitioner whether an ingested letter was sent: the report says what was confirmed, what was not found and what could not be checked.
