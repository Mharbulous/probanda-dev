# Extraction Protocol

Backend-free extraction semantics. These rules define *what* extraction means for a matter's case data — the sequence, routing, and reporting contract — independent of any storage backend. This file speaks only in terms of **sources**, **facts**, **positions**, fields, and states. No SQL, no table-qualified writes, no engine specifics.

Cross-cutting definitions (the `verified` enum, notes prefixes, citation format, bitemporal mechanics) live in [`conventions.md`](conventions.md) — this file references them rather than restating them.

## Hash before extraction

Compute the source hash from the **raw file bytes** before any extraction begins. The hash identifies the source for duplicate detection and drift checks; it MUST be taken from the bytes on disk, not from extracted text, not after any conversion, and not after the source is registered. A source that has been converted for reading (e.g. RTF rendered to plain text) still keeps the hash of its original bytes.

## Duplicate routing by `ingestion_status`

When a source's hash already matches a registered source, route by that source's `ingestion_status` instead of re-extracting blindly:

| Existing `ingestion_status` | Route |
|---|---|
| `complete` | **Verify** — send to the verification pass; do not re-extract. |
| `partial` | **Verify the completed portions**, and **offer re-extraction of the missing portions** (e.g. exhibits or segments that were never read). |
| `failed` | **Re-extract from scratch** — the prior attempt produced nothing trustworthy. |
| `NULL` / unknown | Inspect for existing extracted rows: if facts or positions already exist for the source, **verify**; otherwise **re-extract**. |

No hash match at all → treat as new and extract.

**Exception: a copy of an email attachment.** When the only match is an email attachment's child row (no `file_path`) and that row was read through (`complete`), the file is already held: extract nothing, and report the attachment and its email. An attachment row not read through is no match, and the file is extracted as new (design-decisions #54).

## Another copy with a different hash

The hash lookup finds a file's own bytes only. An unsigned draft, a signed copy and the filed copy of one court document have three hashes, so `operations/supersede-draft.md` pairs such copies by name and page count before extraction. That pass can miss a pair. Any ingest, extraction or verification step can still conclude later that a court document is another copy of registered source N. The main agent reaches that conclusion, never a subagent, because no subagent sees another registered source.

- **Scope.** Both are top-level court sources. Source N is not superseded, and neither source already names the other with a `[SUPERSEDED-BY:#`, `[NOT-VERSION-OF:#` or `SUPERSEDE-PENDING:` marker.
- **The conclusion decides nothing.** It is never a reason to skip part of the read, to leave the source `partial`, or to fold or merge anything. The new copy is registered and read through like any other document. Which copy is kept is decided only in `operations/supersede-draft.md`.
- **Never free text alone.** The conclusion is either settled at once or recorded as the pending marker `SUPERSEDE-PENDING: possible other version of source #<N>.` ([`conventions.md`](conventions.md) §11) on the new copy's source. Attended: once the new copy has its source, hand the two sources to `operations/supersede-draft.md` as its `pair`, which writes nothing before the practitioner's answer. When the practitioner gives no answer, write the marker. Unattended: write the marker.
- **A note is optional and never stands in for the marker.** The marker is the record, and it holds only the source id, never document text. Where a note is also written, it is a sentence of its own reading exactly `DISCREPANCY: possible duplicate of source #<N>.`, with anything else in a separate sentence. No other wording is used ("suspected duplicate", "appears to be a copy"), because `operations/supersede-draft.md` removes only that sentence when the pair is decided. The note is a prefixed note, so its source goes to `verified = 2` in the same write (`conventions.md` §5). The marker never changes `verified`.

## Register with an honest status, then flip

Register the source with an **honest, non-complete status before writing any child entities** (facts, factual positions, relief items/positions, source references, evidence links, provenance). Flip the status to `complete` only when the source has actually been registered and read through — even if that read recorded gaps (skipped exhibits, unreadable pages). Reserve `failed` for the case where ingestion could not begin at all.

Surface **every** failure — parse errors, skipped exhibits, tool errors, unreadable segments — in the run report. Never hide a partial or failed read behind a `complete` status. A completed status must mean the source was genuinely processed, not that the run finished without crashing.

## Never fuzzy-merge across sources

Do not fuzzy-merge facts across different sources at extraction time. Each source's assertions are extracted and recorded on their own; if two sources appear to state the same fact, **report the suspected duplication for review** rather than silently collapsing the rows. Merging is a reviewed judgment, not an extraction-time shortcut. Within one source, deduplicate by exact `(locator, description)` so multiple atomic facts from one paragraph survive.

The deliberate exception is a pleading response: it does not create a second
fact for an admission, denial, or non-admission. It resolves the cited paragraph
or range to the pleading-being-answered's already stored atomic facts and adds
positions to those facts. This is reference resolution, not fuzzy merging.

## Classify before persistence

Every extracted statement is classified before any write:

- an independently truth-evaluable substantive proposition may become a fact;
- `claim | admit | deny | not_admit | no_position` is a factual position
  targeting a proposition;
- relief sought and `seek | consent | oppose | no_position` responses use the
  relief collections;
- incorporation, adoption, paragraph references, and procedural metadata use
  the source-reference collection;
- legal argument is not forced into facts.

No row means actual silence. An express non-admission is a row, with
`position_basis` chosen from `outside_knowledge | strict_proof |
insufficient_particulars | directed_to_other_party | qualified | other`.
Verbatim limiting text stays in `qualification`.

For response documents, resolve every referenced paragraph/subparagraph/range
against the complete set of atomic facts from the pleading being answered. One
referenced paragraph may resolve to several facts; create one position per
responding party per fact. If any reference cannot be resolved, abort the whole
document transaction and report the smallest unresolved locator. Never create a
paragraph-reference placeholder fact.

Qualified or compound responses may contain new affirmative matter. Attach the
response to the existing target facts first, then create only the genuinely new
substantive proposition with a `claim` position.

## Order effects

A court order is the one source kind whose content can **change the truth of already-stored rows**. Extracting what an order says is not the same as reconciling what it did: an order amending the style of cause, adjourning a trial, adding or removing a party, or granting a lawyer's withdrawal leaves the proceeding-level record stale unless something reconciles it, and a filed counsel-of-record notice does the same without being an order at all.

The semantics, independent of any backend:

- **Detect over-inclusively.** A false positive costs one empty diff; a false negative leaves the record silently stale. Reasons for judgment are excluded by default — reasons explain, the entered order changes state.
- **Diff, do not enumerate.** The space of possible orders is open-ended, so the reconciliation compares the order's operative terms against current stored values rather than matching against a rule table.
- **The changeable surface is closed.** Only the entities describing the proceeding — the proceeding itself, the parties, and the party-role roster — may be changed by this route. Every other effect of an order is already captured as facts, positions, relief and source references by ordinary extraction, and is reported for information only.
- **A counsel-change notice reaches the parties only.** An instrument that changes counsel of record without a judicial act may change the party rows and nothing else — never the proceeding, never the party-role roster.
- **Representation provenance travels with the change.** Whenever a representation change is applied, the date the current address for service was filed and the name of the representative it replaced are recorded as structured values alongside it — not as prose folded into a contact or address field. Legacy free-text breadcrumbs may be migrated opportunistically when a row is next touched; there is no bulk cleanup pass.
- **Nothing is written without human approval.** Proposed changes are presented with their current value, proposed value, and the operative term relied on; the practitioner approves each. No mode, instruction, or batch waives this.
- **Every applied change is traceable** to the order, the operative term, and the approval.
- **Already-satisfied proposals are dropped before presentation**, which makes the pass idempotent by diff and silent on a re-ingest.
- **Deadline arithmetic is not done here.** A date-changing order proposes the date field and hands off to the deadline-owning skill; it never recalculates a cascade itself.
- **Ambiguity is presented, never resolved.** What an order *means* is the practitioner's call.

## Legal authorities

The `authority` routing category (below) selects this path: a store of reusable legal research — authorities and the legal concepts and criteria they support — kept physically apart from client case sources. A legal-authority subagent receives only the matter's **live legal issues** and an optional issue scope; it is **never given party names or the style of cause** (contamination control).

### Duplicate routing

Resolve an incoming authority file against what is already stored, in two passes:

1. **By file hash** (raw bytes, per *Hash before extraction*): a match that is already verified → **skip**; a match that is unverified case law → route to the case-law verification pass; a match that is unverified statute / regulation / treatise → **skip with a notice** to the user.
2. **By citation** (only when no hash matched). Normalize the incoming citation and each stored `citation` into tokens — the same rules the merge script executes (`references/scripts/merge_authorities.py`, "Citation normalization"; the two MUST stay in lockstep):

   - split on commas/semicolons and trim; a style-of-cause fragment (a ` v ` / ` v. ` / ` c. ` particle) is set aside — the title is its home;
   - lowercase; collapse whitespace; remove periods; strip brackets/parens around years, keeping the digits;
   - classify each token as **neutral** (`YYYY court-code sequence`), **statute** (`RSBC/SBC/RSC/SC … c <chapter>`), or **reporter** (volume/reporter/page-shaped).

   Apply, in order:

   - **Exact string equality** of the whole citation → same case from a second file → **reuse the existing authority**; do not register a second; record the second file against it by reference, so it is never read again; report the second file (the first-ingested file stays the file of record). This is the fast path. A bundled book's entries record nothing (below).
   - **Shared neutral-citation token** (even when the full strings differ) → same case supplied from a second file → reuse, as above.
   - A neutral-token or exact match that lands on a **tombstoned** row (its `notes` start with `[MERGED-INTO:#<C> …]`) **redirects to the canonical row `<C>`** — reuse `<C>`, never the tombstone.
   - A **reporter-token** match or a **title-similarity** match is **not** auto-reuse at ingest — register nothing on its account; **report the suspected duplicate for the merge operation** (`operations/merge-authorities.md`) instead. Never merge two authorities on title similarity alone.

No hash and no citation match → extract as fresh.

### Fresh extraction — write order

1. **Dispatch** the case-law extractor (case law) or the provision extractor (statute / regulation / treatise / other), supplying the live legal issues and any issue scope. The subagent is read-only and returns one JSON object keyed by natural values (concept name, citation) — never backend IDs.
2. **Register the authority**: title, citation, type, jurisdiction, disposition,
   `fact_pattern`, `loss_description`, and the original file's path and hash.
3. **Treatment of a prior authority.** If the subagent reports that this authority treats a prior one, record the treatment link **only when the treated authority already exists** (match by citation/title); otherwise **report the deferral** — linkage is opportunistic, never fabricate the treated authority.
4. **Upsert concepts**, identified by name + jurisdiction. Map each subagent descriptor to a stored value via the descriptor mapping below.
5. **Verify concept completeness before linking.** Cross-check every concept name the JSON references — including any `determined_by_concept_name` — against the concepts actually created, and create any straggler first, so no link or criterion points at a missing concept.
6. **Link each concept to the authority** with its relationship, proposition, finding,
   factual context, obiter flag, and `order_terms`. A link that already exists is a
   no-op, not an error. A link whose relationship the local store cannot hold is not
   written: report it to the practitioner (`../../shared/treatment-vocabulary.md`).
7. **Insert criteria** for each concept:
   - resolve `determined_by_concept_name` to its concept; if absent, create a stub `test` concept first and link it (nesting is **one hop** only);
   - keep the subagent's order for a new concept; for a **reused** concept, continue after its highest existing criterion order;
   - skip a criterion whose description exactly duplicates one already on that concept.
8. **Proposition-level treatment.** Apply the subagent's treatment mapping (**present → past tense**) to the treated authority's concept-links and criteria, recording the treatment and the treating authority. The relationship between two authorities is present tense; the standing of a proposition is past tense.

### Descriptor mapping

Subagents speak plain descriptors; the main agent maps each to a stored value (the field it lands in is named by each backend binding):

| Subagent descriptor | Stored value |
|---|---|
| `cause of action` \| `doctrine` \| `legal test` \| `defence` \| `remedy` | concept type `cause_of_action` \| `doctrine` \| `test` \| `defence` \| `remedy` |
| `mandatory element` \| `weighed factor` | requirement type `element` \| `factor` |
| `authority_role` | relationship, passed through as given: a principle-link value of [`../../shared/treatment-vocabulary.md`](../../shared/treatment-vocabulary.md), which defines each one. A value the local store cannot hold yet is held back and reported, never remapped (that file, "Local case-data store") |
| burden descriptors | burden of proof, plain phrase passed through verbatim as free text (e.g. `balance of probabilities`, `on the party asserting duress`) — never snake_cased into the retired 3-value enum |

### Bulk classification cascade — `6. LAW\` scans

When scanning a `6. LAW\` folder, classify each file by the first tier that resolves; fall through only when a tier cannot decide:

1. **Subfolder name.** `Cases` → case law; `Statutes` → statute; `Regulations` → regulation; `Treatises` → treatise.
2. **Filename citation pattern.** `[YYYY] BCxx NNN` → case law; `SBC/RSBC YYYY c N` → statute; `BC Reg N/YYYY` → regulation.
3. **Dispatch.** Dispatch the provision extractor; if it self-reports `case_law`, re-dispatch to the case-law extractor.
4. **Ask the user**, one file at a time, only for files no earlier tier could classify.

### Bundled books of authorities

A book of authorities bookmarks each authority individually with a clean citation as its title and an exact start page — the trigger is `../shared/bookmark-segmentation.md` §4. Its page ranges come from `references/scripts/extract_outline.py`, the same script and range rule §1 of that file uses.

1. **Hash tier, once per book — never per authority.** All entries in one BOA share the book's file hash, so probe `law.authorities` by that hash **once**, not per entry. A hit means the book was already ingested; apply ordinary hash-tier semantics (above) to the whole book: verified → skip; unverified case law → route to the case-law verification pass; unverified statute/regulation/treatise → skip with a notice.
2. **Citation tier, per authority, from the bookmark title.** No hash hit → for each entry, apply the citation-tier rules above using the bookmark's own title as the incoming citation, before dispatching any extractor. Exact string or shared neutral token → reuse the existing authority, report, extract nothing for that entry. A reporter-token or title-only match → report the suspected duplicate for `operations/merge-authorities.md`, extract nothing for that entry.
3. **Fresh extraction for the rest**, scoped to each entry's own page range (`{{DOCUMENT}}.page_range`), dispatched in parallel batches of ≤10 (Path C's pattern). Register with the book's `file_path` and `file_hash`, and `notes = 'Bundled authority, pp. X–Y'`.
4. **Report per book:** entries already held, suspected duplicates reported for merge, freshly extracted, and any unclassified entries (an entry with no citation token that also has no citation-tier match, per `bookmark-segmentation.md` §4).

## Per-run report

After every extraction run, report:

- inserted and updated counts, broken down **by entity type** (sources, facts,
  factual positions, relief items, relief positions, source references,
  evidence links, sought orders (when a Notice of Application was detected),
  and any provenance);
- skipped duplicate locators;
- the size of the verification backlog produced (rows left for the verifier or the human queue);
- the final `ingestion_status` of each source touched;
- for a compound book (Path E) or a bundled book of authorities: the segments/entries reported but not ingested, with their titles and page ranges, and any outline anomalies from `extract_outline.py`.

## Subagents read-only; main agent owns writes

Extraction subagents are **read-only**: they read the source and emit a single JSON object describing what they found. They perform no writes and hold no backend identifiers. Dispatch on the narrowest grant available, never `general-purpose`, which holds the write tools. The **main agent performs all writes** and owns every backend ID (source, fact, position, and their foreign-key relationships). A subagent's JSON refers to entities by natural keys (party name, locator, exhibit letter, concept name) — never by a backend ID it could not know.

## Category vocabularies (R5)

Two distinct vocabularies are in play. Keep them separate.

### Routing category — what a subagent emits

Extraction subagent JSON reports a **routing category** from this fixed enum:

```
court | correspondence | production | work_product | disbursements | privileged | authority | other
```

This is a routing *hint*, not a storage value. The main agent maps routing → storage:

| Routing category | Where the main agent routes it |
|---|---|
| `court` | source category `court` (1:1) |
| `correspondence` | source category `correspondence` (1:1) |
| `production` | source category `production` (1:1) |
| `work_product` | source category `work_product` (1:1) |
| `disbursements` | source category `disbursements` (1:1) |
| `privileged` | the **privileged-source store** (separate from admissible sources); the agent then picks a privileged category value there |
| `authority` | the **legal-authority ingestion path** (the reusable-law store), not the case-source store |
| `other` | **forces a user decision** — the agent stops and asks how to classify before writing anything |

The first five map one-to-one onto the stored source category. The last three (`privileged`, `authority`, `other`) are **routing-only** values that select a destination or a human decision; they never reach a stored source category. The storage validity constraints must never see `privileged`, `authority`, or `other` as a source category value.

### Fact category — a soft vocabulary

Extractors tag each fact with a **fact category** drawn from this soft vocabulary:

```
background | contract | payment | breach | employment | damages | procedure | liability | credibility
```

This is a soft vocabulary: it is **not** enforced by any validity constraint, and an extractor may reach for a term outside it when nothing fits. Keep the vocabulary **consistent across all subagent templates** so facts remain comparable across sources and document kinds.
