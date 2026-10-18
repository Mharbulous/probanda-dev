# Verification Protocol

Backend-free verification semantics. Verification is a **pipeline stage**, not a flag: an independent pass re-reads a source against the rows extracted from it and either confirms, corrects, rejects, or supplements them. This file speaks only in terms of **sources**, **facts**, **positions**, **legal edges**, fields, and states — no SQL, no table-qualified writes, no engine specifics.

Two verification tracks share the semantics below and differ in what they read and what they may write:

| Track | Unit | Reads | Covered in |
|---|---|---|---|
| **Source verification** | one source (or segment) | the source document + the facts/positions extracted from it | the sections up to "Stamping the verification timestamp" |
| **Edge verification** | one authority document | the judgment/statute + the legal edges citing it | "Legal edges" (below) |

Cross-cutting definitions (the `verified` enum, notes prefixes, citation format, bitemporal mechanics) live in [`conventions.md`](conventions.md) — referenced here, not restated.

## Session isolation is mandatory

The verifier MUST run in a session **isolated from the extractor** that produced the rows. Same-context verification is not verification: an agent that just extracted the rows carries the same assumptions and blind spots that produced any errors, and will tend to ratify its own work. The verifier starts fresh, receives only the inputs below, and takes an adversarial stance — it assumes the extraction is wrong until the source proves otherwise. The binding doctrine statement lives in [`../../shared/authority-claim-verification.md`](../../shared/authority-claim-verification.md).

## Verifier input

The verifier is given:

- **matter context** (enough to judge relevance and party attribution);
- the **original source document**;
- the **page range** where applicable (for a segmented source such as an affidavit, one verification pass per segment);
- the **existing extracted rows** for that source — each with its id, locator, `verified` value, and `human_reviewed` value;
- the **current positions** in play for the facts involved.

Facts and positions also include `pending_reverification`. The `verified`,
`human_reviewed`, and pending values are supplied so the verifier can see which
pipeline owns each row; the apply rules below govern what may change.

The dispatch also names one of two modes:

- **`normal`** — check every supplied row and scan the source for omissions.
- **`targeted_reverification`** — check only the supplied fact/position target ids
  whose corrected current values are pending. Do not receive the first verifier's
  reasoning, previous value, or output, and do not perform an omission scan.

## Verifier output shape (JSON only)

The verifier emits a single JSON object and nothing else, with these arrays:

- **`confirmed[]`** — rows the source supports as extracted (kind, id, locator).
- **`corrections[]`** — each with: `kind` (the entity type, e.g. fact or position), a **row reference** (id/locator), the **field** to change, the **current** value, the **proposed** value, a **reason**, and a **locator** anchoring the correction in the source.
- **`rejections[]`** — rows the source contradicts or does not support (kind, id, reason, locator).
- **`missing[]`** — assertions present in the source but absent from the extracted rows.
- **`ambiguous[]`** — rows the verifier cannot resolve from the source (kind, id, reason, locator).

Every in-scope existing row must appear in exactly one disposition set:
`confirmed`, `rejections`, `ambiguous`, or the set of row references in
`corrections`. Multiple field corrections for one row count as one corrected
disposition. In normal mode this partition covers every supplied row. In targeted
mode it covers exactly the target ids and `missing` must be empty.

Before any write, the main agent validates the whole result: every id resolves in
the input snapshot and any unknown id rejects the whole output; each `current` value byte-matches that snapshot (JSON null only
matches SQL `NULL`); every field is allowed for its row kind; the disposition
partition is complete and disjoint; targeted output names no non-target row; and
no required reason or locator is absent. Duplicate array entries or duplicate row
dispositions are invalid (multiple distinct field corrections for one corrected
row are the sole exception). Malformed or incomplete output rejects the whole result and
leaves rows and timestamps untouched. A document-level accuracy boolean never
substitutes for row dispositions.

## Apply rules — exact

The main agent applies the verifier's output as follows. Follow these exactly; the distinctions carry the whole pipeline.

- **Confirmed ordinary row** → set `verified = 1`. **Never touch `human_reviewed`** — AI confirmation is not human review.
- **Rejected** → set `verified = -1` (the row is excluded from the working views but retained).
- **Correction or NULL backfill to a non-human-reviewed fact** → apply the fix
  **in place** and set `verified = 0, pending_reverification = 1`.
- **Correction or NULL backfill to a non-human-reviewed position** → apply via
  **bitemporal supersession** (close the current row and insert its corrected
  successor per [`conventions.md`](conventions.md)); the successor carries
  `verified = 0, pending_reverification = 1`.
- **Correction to a human-reviewed row** (fact or position) → **do NOT apply it.** Instead set `verified = 2` (send it to the human queue) and append an **idempotent note** carrying the proposed correction, so the human sees exactly what the verifier wanted to change. Idempotent means re-running the verifier must not stack duplicate notes: if the same proposed correction is already noted, leave it as is.
- **Missing** → insert the omitted assertion with `verified = 0,
  pending_reverification = 0`. If a notes prefix applies to the inserted row (see
  [`conventions.md`](conventions.md)), insert it with `verified = 2` instead and
  the prefixed note, as the prefix convention requires.

After committing a normal pass that created one or more pending rows, immediately
dispatch one new isolated verifier session in `targeted_reverification` mode for
all corrected targets in that source segment. Re-query the committed current rows
first; a position target is the new successor id. The targeted verifier receives
the source and current target values, never the first verifier's reasoning or old
values.

Apply targeted results as follows:

- **Confirmed target** → atomically set `verified = 1` and
  `pending_reverification = 0`.
- **Corrected again, rejected, or ambiguous target** → do not apply another
  autonomous substantive change and do not reject it automatically. Atomically
  set `verified = 2, pending_reverification = 0` and append one idempotent
  `REVERIFICATION:` note containing the finding, proposed value where applicable,
  reason, and locator.
- **Dispatch, read, or validation failure** → make no write. Leave the target at
  `(verified = 0, pending_reverification = 1)` for the dedicated backlog.

A later backlog run uses the same targeted mode directly; it does not run a new
normal pass first. Human Confirm/Correct/Reject/Delete always clears pending in the
same transaction. Human review therefore satisfies the higher-scrutiny gate without
requiring another AI pass.

Corrections to human-reviewed rows are never auto-applied because a human has already ruled on them; the verifier may only escalate, never overwrite.

## Stamping the verification timestamp

Stamp `last_verified_at` on a source (or on the segment, for a segmented source)
**after each successfully validated and applied pass**, including a targeted pass
that escalates an adverse result. Apply that pass's delta and stamp in the same
transaction. The stamp is the host local date, per [`conventions.md`](conventions.md) §10. A pass that fails or cannot complete leaves the timestamp untouched;
if the normal pass succeeded and its targeted follow-up failed, the normal pass's
stamp remains because it truthfully records that completed read.

This remains a source-level attestation that the document was re-read, not a claim
that every row from that source is correct.

---

## Legal edges

A **legal edge** links a legal concept to a legal authority and carries the `proposition` (the transportable rule the authority states) and the `finding` (the court's answer on that precedent's own facts). Edge verification asks one question: **does the cited document actually say this?**

Everything above applies unless contradicted here. The differences are load-bearing.

### What is different about edges

- **The batch unit is one authority document**, not one source. A verifier pass takes a judgment and every edge citing it, so the document is read once and all its edges are judged against it together.
- **No matter context, ever.** Source verification receives matter context to judge relevance and party attribution. Edge verification receives **none** — no party names, no style of cause. The legal-authority store holds zero client material and must stay that way, so the edge verifier is told only questions of law. This is the same anti-contamination rule the case-law extraction verifier follows.
- **The verifier never proposes new edges.** Source verification has a `missing[]` array; edge verification has no analogue. Inserting edges belongs to ingestion. A verifier that invents links would be extracting, not verifying.
- **There is no human-reviewed flag law-side.** The fact-side distinction between lawyer-confirmed and AI-verified does not exist for edges. The protection it buys is preserved by the no-overwrite rule below instead.

### Locating the document

Resolve the authority's document by its **recorded path first, accepted only if the document's hash matches the recorded hash**; on a path miss or hash mismatch, fall back to a **hash search** over the matter tree. The hash is the durable identity; the path is not — files get renamed after ingestion and the path goes stale while the hash stays true.

If the document cannot be resolved either way, the edge is **unverifiable, not unverified**: escalate it (see below). Never leave it silently at unverified — an edge nothing can ever check must say so, or it sits at unverified forever and no one learns why.

### The unsourced-gloss test (mandatory)

The confirmed defect shape is **faithful extraction plus an unsourced editorial gloss** — a proposition that tracks the judgment accurately except for an added word the court never used, typically a comparative that ranks or widens a standard the court merely stated.

So: **every load-bearing word in the proposition must be traceable to the document.** A proposition may generalize and it may compress, but it may not add. Give comparatives and superlatives (*stricter*, *broader*, *higher*, *narrower*, *more onerous*) particular attention — if the document does not itself draw the comparison, the word is a correction, not a quibble. A gloss is not a loose characterization; it is a clear error, because it changes the rule a lawyer would draw. The binding doctrine statement lives in [`../../shared/authority-claim-verification.md`](../../shared/authority-claim-verification.md).

Apply the same **grammatical-voice test** case-law extraction uses, exactly as that file's §3 states it, including its rule for a cited authority and for an appeal court reciting the decision under appeal.

### Apply rules — edges

- **Confirmed** → set `verified` to verified. No note; the flag is the record.
- **Rejected** (the document contradicts the edge, or does not support it at all) → set `verified` to rejected, with a note giving the reason. The row is retained and drops out of the push payload.
- **Correction** (the document supports a different text) → **do not write the text here.** Route it through the law-side text-amend operation in its verifier mode, which re-runs the anchor check and resets the edge to unverified so the corrected text re-enters the pipeline. Verification writes flags; amendment writes text; the two never blur.
- **Ambiguous / unverifiable** (including an unresolvable document) → set `verified` to needs-human, with an **idempotent** note naming the reason. Idempotent means a re-run must not stack duplicate notes: if the same note is already present, leave it.
- **Never autonomously overwrite an already-verified edge.** A verifier that disputes one escalates it to needs-human instead. Until edges carry their own lawyer-confirmed flag, a verified edge may be a human adjudication, and silently overturning a lawyer's ruling is exactly what the fact-side rules forbid.

### A bridged edge's `verified = 1` — the recorded equivalences (v8.5, #48)

[`../operations/ingest-submission-law.md`](../operations/ingest-submission-law.md)
lands the research of a retired filing as `concept_authorities` edges, and maps
the filing's own verification value onto this enum: `verified` → **`1`**,
anything else → **`0`**, and a recorded doubt → **`2`** with an idempotent
`NEEDS HUMAN` note regardless of the verification value.

Say plainly what that `1` does and does not mean. Everywhere else in this
protocol, `1` means an **isolated verifier re-read the source document**. A
bridged statement edge's `1` means the drafting side's own verification — set by the
legal-research gate or by the practitioner, on the same document, before the
filing went out. It is a human or gated judgment about the same question, which
is why the equivalence is accepted; it is **not** a second, weaker meaning of
`1`, and it is **not** a pass by this protocol's verifier.

Two consequences, both deliberate:

- **`last_verified_at` is NOT stamped** by the bridge. Nothing in the bridge
  re-read a document, and the whole point of that column is that it attests a
  re-read.
- **A bridged `0` is held back, and that is the correct outcome.** The remedy is
  to run [`../operations/verify-law.md`](../operations/verify-law.md) over those
  edges, never to flip them to clear the push gate. The bridge's own
  `pinpoint`/`excerpt` capture is what makes that verification pass cheap: it
  hands the verifier the pinpoint and the quoted passage the edge was built
  from.

**An `answered` edge is the second equivalence (design-decisions.md #48).** The bridge
writes it at `1` unconditionally. Its whole claim is the practitioner's tie: the
filing answered this opposing authority on this concept. The practitioner made
that tie personally, which is what conventions §4's `1` means. No re-read of the authority could check a claim about the filing, so it
never enters the verify-law backlog, and it never crosses to the pool
([`../operations/push-state.md`](../operations/push-state.md)).

### Stamping after an edge pass

The edge verifier does re-read the authority's document, which is precisely what the authority's `last_verified_at` attests — so stamp it on a successful pass, per the timestamp rule above.

But keep the two apart: **`last_verified_at` attests that the document was re-read; it never attests that an edge is right.** It lives on the authority; edge verification lives on the edge. A consumer that reads the former as the latter is reading a claim about a different object.
