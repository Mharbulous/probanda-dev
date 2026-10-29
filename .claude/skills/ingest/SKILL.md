---
name: ingest
description: >
  Use when asked to ingest, import, or add a litigation document into the case database —
  affidavits, pleadings, transcripts, exhibits, correspondence, or case law.
  Matches: "ingest [path]", "add this to the file", "import this document."
---

**Internals stay confidential** (`shared/internals-confidentiality.md`): nothing the practitioner sees names a Probanda tool, table, field, internal type or code, or explains how Probanda works inside. It hides mechanism, never an outcome or an error.

# Ingest

Thin routing skill — delegates immediately to the `matter-data` gatekeeper.

This skill deliberately carries no `disable-model-invocation` line: `/legal-research`'s flow
opens it through the Skill tool, which refuses a skill carrying that line. It is a stated
exception, like the gatekeepers. Do not add the line back.

Do not extract, summarize, or present facts here — that is `litigation-fact-extractor`'s job.

A BC Court of Appeal application/response book, or a book of authorities, is one PDF holding several distinct documents behind a set of bookmarks. `matter-data` splits it by those bookmarks and reports the parts it does not ingest (reasons for judgment, the order, argument, the book's own authorities listing) rather than force-fitting the whole file through one path.

Do not intentionally run ingestions into the same matter in parallel; queue them and let each handoff finish before starting the next.
## Procedure

0. **No document or folder named: scan, report, ingest nothing.** A bare `/ingest` is a new-document scan of the whole matter. Ask nothing. Tell `matter-data` this is a report-only scan of the whole matter, and relay its report by folder of the files the matter does not hold yet. Nothing is ingested in this run, and privilege is decided later, at ingestion. The practitioner then names what to ingest, and that request runs the steps below. Skip steps 1-7 and end with step 8.
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
   **Two or more documents, or any affidavit: hand the run to `/lawyer:ingest-orchestrator`.** A request covering two or more documents (a folder, a batch, a list), or an affidavit (its name carries `AFF`, `AFFIDAVIT` or `SWORN`, or the practitioner calls it one), goes to the orchestrator (Skill: `lawyer:ingest-orchestrator`) with `matter_root` and the files or the folder, after this step's preflight for any court decision. Skip steps 2-7, which the orchestrator covers, and end with step 8. A single document that is not an affidavit keeps steps 2-7. `matter-data`'s gate hands over an affidavit it finds by its first page, and its folder scan hands over the files it finds.
2. Pass the document path and any matter context to `matter-data`.
   **Court decisions also take an optional issue focus** — a narrower legal issue (e.g. competence-competence, attornment to court jurisdiction) that limits which concepts get criteria. Use the one the caller or the practitioner's request supplies. When the practitioner invoked `/ingest` directly and named none, ask once: "Any specific legal issues to focus on when ingesting this decision? If not, I'll extract all relevant principles." For a batch of more than ~5 files, ask it in the same single confirmation as the file list. A skipped question means full scope. When a focus was given, the final report names the concepts stored without criteria, so the practitioner sees what was scoped out.
3. `matter-data` routes internally — a single document in hand and a folder scan are different rows of its routing table, so state which this is and let the router pick the operation. Never pre-empt that routing, write your own SQL, or diff a folder against the database by hand.
4. **Court orders take one extra leg.** An order's operative terms can change rows the file already holds — the style of cause, the trial date, the party roster, counsel of record — so after the document is ingested, `matter-data` runs an order-effects pass that proposes those changes and applies only what the practitioner approves. Expect a proposed-changes table on an order, and nothing at all when the order changes no stored field.
5. **A second copy of a court document already held is compared page by page.** If any difference changes meaning (a word, a date), both are kept and each PDF gets a comment at each discrepancy. If every difference is cosmetic (a signature, a stamp, font, blur, a stain), `matter-data` keeps the filed over the signed over the draft copy, or on a tie the better-looking one: it takes the other's facts and links, and the other file moves to `0. DRAFT\Superseded`. It asks only when it cannot decide.
6. **Correspondence from the forum that sets a date takes a shorter leg.** `matter-data` reports the date it found and recommends recording it as an anchor through `lawyer:docket-clerk`, citing the document. Nothing is recorded during the ingest, and no deadline is worked out (ADR 0024 D12).
7. **A letter the firm sent takes a delivery check.** After the letter is ingested, `matter-data` has the `lawyer:delivery-checker` agent check whether it went out and arrived by each method it states, and reports the result in one line per method. The result is reported and kept nowhere. Never ask the practitioner whether an ingested letter was sent: the report says what was confirmed, what was not found and what could not be checked.
8. **End every run with the contact check.** Call ``practice-data`` `contact-checks` with the matter ref and its `matter_root`, and report each entry in `parties_without_role` (ADR 0009): a party case data holds that no contact role points to yet. Offer to propose its contact and role, which `matter-data` does as it does for a new party. Report each `unresolved` entry with its reason.
