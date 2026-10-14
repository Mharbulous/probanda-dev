# Operation: ingest-verify

Read `../shared/conventions.md` first; derive the live `matter_root` per §2.2 and read `coclerk.json` only to confirm initialization; halt on any tool error per §2.3.

This operation re-verifies a source or case-law authority that already has
extracted rows. It is reached either from `../operations/ingest.md` when the gate
finds a hash match, or from the targeted corrected-row backlog. It dispatches an
**independent, session-isolated** verifier, applies that verifier's delta, and
immediately re-checks any autonomously corrected fact/position in another fresh
isolated session.

The backend-free apply rules (confirmed / corrected / rejected / missing, and the human-reviewed escalation) live in `../shared/verification-protocol.md`; the `verified` enum, notes prefixes, citation format, and bitemporal mechanics live in `../shared/conventions.md`. This file supplies the executable logic plus the operation-specific rules the shared protocol does not cover.

Every read below runs through `case_data__query`, every write through `case_data__execute`, per `../shared/conventions.md` §2.3 — pass `matter_root` on every call.

---

## Entry mode

- **Hash-matched source** — run a `normal` pass over the source/segment. For a
  hash-matched email (`.eml`/`.msg`), the pass also covers its attachment
  children: after the email's own rows, take each main-store row whose
  `parent_source_id` is the email's `source_id` and give each child one
  dispatch, as affidavit segments get one dispatch per segment within their
  parent's pass. A child that is itself an email has its own attachments
  covered the same way, recursively.
- **Corrected-row backlog** — run `@query_05d_pending_reverification`, group the
  returned rows by `source_id` (and affidavit segment), resolve the recorded source
  exactly as the ingest path does, and run `targeted_reverification` directly for
  those row ids. Do not put these rows through another normal pass first. A row
  whose source has `file_path` NULL and a `parent_source_id` (an email
  attachment's child) is resolved through its parent chain as in Step 2's
  attachment-child rule, not as the ingest path resolves a file.

**How a pass reaches an attachment child.** The ingest gate never routes to a
child row (`ingest.md`). A child is reached only (1) inside the normal pass of
its parent email, when the email is re-presented interactively through
`/ingest`, or (2) from the corrected-row backlog. The unattended folder scan
(`ingest-unattended.md`) does not verify a `complete` source, so it never
reaches one.

The pending backlog is AI work, not `operations/review.md`. A source that cannot be
resolved or a verifier that cannot complete remains pending and quarantined; report
the exact failure and continue to the next source.

---

## Step 1 — Query the existing rows for the source

For the hash-matched `source_id`, load the current state the verifier needs:

```sql
-- All facts for the source, every column the verifier reasons over.
SELECT fact_id, description, category, date_of_fact, source_id, source_locator,
       verified, human_reviewed, pending_reverification,
       basis_of_knowledge, informant, notes
FROM main.facts
WHERE source_id = ?;

-- Current positions only (open bitemporal rows).
SELECT position_id, fact_id, party_id, position, qualification,
       source_id, source_locator, verified, human_reviewed,
       pending_reverification, notes
FROM main.positions
WHERE source_id = ? AND valid_to IS NULL;

-- Expert witness metadata tied to this report source.
SELECT w.witness_id, w.name, w.witness_type, w.field_of_expertise,
       w.retained_by_party_id, w.report_source_id, w.qualified,
       pw.proceeding_id, pw.called_by_party_id
FROM main.witnesses AS w
LEFT JOIN main.proceeding_witnesses AS pw ON pw.witness_id = w.witness_id
WHERE w.report_source_id = ?;
```

For a privileged-store match, query the source plus its current instruction rows instead; do not query or expose instruction descriptions through a main-store projection:

```sql
SELECT source_id, proceeding_id, category, title, description, author,
       recipient, date, file_path, file_hash, verified, notes
FROM privileged.privileged_sources
WHERE source_id = ?;

SELECT instruction_id, proceeding_id, party_id, instructed_by, date,
       description, source_id, source_locator, status, valid_from,
       prior_id, verified, notes
FROM privileged.client_instructions
WHERE source_id = ? AND valid_to IS NULL
ORDER BY instruction_id;
```

---

## Step 2 — Dispatch the verifier (session-isolated)

Dispatch the read-only `practice:verify-source` agent, whose body mirrors
[`../agents/verify-source.md`](../agents/verify-source.md), in a session
**isolated from the extractor and from every prior verifier of this pass** —
same-context verification is not verification
(`../shared/verification-protocol.md`). Provide:

- **matter context** (enough to judge relevance and party attribution);
- the **document** (absolute path; in E2, the granted sandbox path);
- the **existing extracted rows** from Step 1 (each with its id, locator,
  `verified`, `human_reviewed`, `pending_reverification`, and — for facts —
  `basis_of_knowledge` / `informant`);
- the **current positions** in play;
- the **document type** and the **page range** where applicable.
- For a `.docx`/`.eml`/`.msg` source, re-render it first per `ingest-extract.md`'s
  Document pre-processing section (same script, freshly invoked — never a
  cached rendering) and supply the fresh rendering as `{{RENDERING}}` alongside
  the original path.
- For an email attachment's child source (`file_path` NULL), walk
  `parent_source_id` up to the nearest ancestor with a `file_path` (the
  top-level email). First hash that file and compare it with that ancestor
  row's `file_hash`. A mismatch means the file changed or moved, which is the
  ingest path's business (`ingest-status.md`, `relocate-source.md` by hash),
  not an attachment verdict: report it, verify nothing, write nothing. If it
  matches, re-render it with `render_document.py` (freshly, never cached) and
  take the written attachment whose SHA-256 equals the `file_hash` of the next
  row down the chain. If that row is itself an email, render that attachment in
  turn, until you reach the target child's attachment, and verify against it.
  No attachment with the expected hash at any step, under a parent whose own
  hash matched, is an anomaly: report that the email's contents do not match
  its record, verify nothing, write nothing. The rows keep their state (pending
  rows stay pending). Either report stops only that child and its own children:
  the pass continues with the email's other children.
- `VERIFICATION_MODE = normal` with no targets for a hash-matched pass, or
  `VERIFICATION_MODE = targeted_reverification` plus the exact pending target ids
  for a backlog/second pass.

**Dispatch a path the verifier can open.** Its only tool reads its own session filesystem — it cannot list a directory, and in a bridged session it cannot see host files at all. Supply the explicit path of every file it must read, each rendered PNG page individually rather than the render directory. Where host files arrive only over a bridge (Project Cowork), stage a byte-exact copy into the session first (`device_stage_files`) and dispatch that path; [`verify-law.md`](verify-law.md) §2 states this rule in full.

**A verifier that is unavailable — never substitute another agent — that fails, or that returns malformed JSON leaves this source's rows, stamp and marker untouched** and does not halt the run: continue to the next source and report the failure. A failed pass is never recorded as a verification.

**Affidavit segments get one dispatch per segment** (one for the body, one per exhibit page range) — never a single verifier over a compound document. A book-nested affidavit's own page range is on its source row's `notes` (`ingest-extract.md` Path E); supply that as the body's page range. Its exhibits' ranges come from their facts' `p<N>` locators as usual.

**Privileged source exception:** read a client-instruction memo inline in a fresh verification pass and do not send it to a subagent. Compare each stored current instruction to the document by locator, and return the same confirmed/correction/rejection/missing shape locally. Keep the document and instruction descriptions out of the user-facing report; report row IDs, statuses, and counts.

The verifier returns one JSON object per `../shared/verification-protocol.md`.
Validate the entire result before composing SQL: ids, byte-exact current values,
allowed fields, required reasons/locators, complete and disjoint row dispositions,
duplicate entries, and—when targeted—exact target membership plus empty missed arrays. Reject the
whole result on any failure; write and stamp nothing for that pass.

---

## Step 3 — Apply each pass atomically

Apply one validated verifier pass in one `case_data__execute` transaction per
`../shared/verification-protocol.md`. The transaction includes that pass's row
delta and `last_verified_at` stamp. Every inserted `created_date` or `valid_from`,
every `valid_to` close, and the stamp are `date('now','localtime')` in the
writing statement (`../shared/conventions.md` §10). In particular:

- ordinary confirmation → `verified = 1`, pending `0`, never touch
  `human_reviewed`;
- ordinary rejection → `verified = -1`, pending `0`;
- non-human fact correction/NULL backfill → update in place at
  `verified = 0, pending_reverification = 1`;
- non-human position correction/NULL backfill → bitemporal successor at
  `verified = 0, pending_reverification = 1`;
- human-reviewed correction → do not apply; set `verified = 2`, pending `0`, and
  append the existing idempotent proposed-correction note;
- missing fact/position → insert at `verified = 0, pending_reverification = 0`
  (or `verified = 2` when a human-review prefix applies).

After a successful normal transaction creates pending rows, re-query the
committed current rows so a corrected position's new successor id is known. Launch
one new verifier session for all targets in that source segment. It receives the
source and corrected current values only—never the first verifier's output,
reasoning, or previous values.

Apply the targeted result in a second transaction:

- confirmed target → `verified = 1, pending_reverification = 0`;
- corrected again, rejected, or ambiguous target → preserve the current substance,
  set `verified = 2, pending_reverification = 0`, and append one idempotent
  `REVERIFICATION:` note with the finding, reason, locator, and proposed value when
  present;
- failed dispatch/read/validation → no transaction, no stamp, leave pending.

The following rules are **operation-specific** and extend the shared apply rules:

### Missed-position parent resolution (three ordered steps)

A `missed_position` names its parent fact by locator/description, not by `fact_id`. Resolve the parent in this order, stopping at the first hit:

1. **Same-source locator match** — find the fact with `(source_id = this source, source_locator = the missed position's parent locator)`.
2. **Cross-source description match within the proceeding** — **transcripts only.** Match the parent fact by description across other sources in the same proceeding. **If the match is ambiguous, report it** and do not guess.
3. **Same-transaction newly-inserted fact** — if the verifier's `missing[]` in this same run inserted the parent fact, link to that just-inserted `fact_id`.

If none resolves, report the position as unlinkable rather than inserting an orphan.

### Dedup of missed rows

- **Missed facts** dedup by `(source_id, source_locator)` — skip an insert that would duplicate an existing fact for the source.
- **Missed positions** dedup by `(fact_id, party_id, source_id)` — skip a position that already exists for that fact/party/source.

### `sources.file_path` update

If the user supplied a document path that differs from the stored `sources.file_path` (the file moved), **update `sources.file_path`** to the current path within the same transaction.

### Hallucination flags — report, never auto-apply

The verifier's `hallucination_flags` (loose characterizations, minor inaccuracies) are **reported to the user, never auto-applied**. Only genuine corrections (clear errors) mutate rows.

### Witness and client-instruction deltas

- For a witness statement or expert report, confirmations/corrections may update only witness attributes the document establishes and the proceeding assignment. A conflicting non-NULL identity/type or party attribution is `ambiguous` and requires human review; never split or merge witnesses automatically.
- For a current client instruction, apply a correction or changed instruction bitemporally: close the current row (`valid_to`), set its status to `superseded`, and insert a successor with `prior_id`; never overwrite its description. A confirmed row may move to `verified = 1`. A rejected row moves to `verified = -1` without deleting history. Missing instructions insert at `verified = 0` unless directly practitioner-confirmed.

---

## Step 4 — Report and dump

- Each successful pass already stamped `last_verified_at` atomically with its
  delta. A failed pass leaves the prior stamp untouched and does **not** halt the
  operation — continue to the next source.
- **Leave `ingestion_status` unchanged** — verification does not re-open or complete ingestion; it only adjusts row-level `verified` state.
- **Report** applied first-pass corrections, second-pass confirmations, second-pass
  escalations, still-pending targets, human-reviewed deferrals, NULL backfills, and
  hallucination flags — grouped by entity type.
- Each successful `case_data__execute` regenerates `evidence.sql` automatically;
  no separate dump call. Report every `INSERT`/`UPDATE`.

---

## Step 5 — Order-effects pass

If the re-presented source meets `order-effects.md` Step 1 detection, hand off to `order-effects.md` after Step 4. On a re-ingest the stored values usually already match the order's terms, so the diff is empty and the pass reports "order effects: none" without interrupting the practitioner — that emptiness is the idempotency, not a skipped step. A non-empty diff means the order's effects were never applied, which is exactly what this pass exists to catch.

---

## Path D — Case-law authority verification

Use this path for an already-ingested `case_law` authority whose hash duplicate
routes to the case-law verification pass. It is also the resumable v7.3 capture
sweep unit. Process one authority at a time.

### D1 — Resolve the authority document

Resolve the document exactly per [`operations/verify-law.md` §2](verify-law.md):
accept the recorded path only on a sha256 match, fall back to a matter-tree hash
search when the path is stale, and report/escalate `source_unresolvable` when
neither arm succeeds. Apply that section's RTF-conversion rule by reference; do not
invent a second conversion path. A source-unresolvable authority is not dispatched,
written, stamped, or marked capture-complete.

### D2 — Load the complete stable-id payload

Load every current value the verifier can reason over or correct:

```sql
SELECT authority_id, title, citation, authority_type, jurisdiction, disposition,
       fact_pattern, loss_description, file_path, file_hash, notes,
       last_verified_at
FROM law.authorities
WHERE authority_id = ?;

SELECT ca.concept_id, ca.authority_id, c.name, c.description, c.jurisdiction,
       ca.relationship, ca.proposition, ca.finding, ca.factual_context, ca.obiter,
       ca.order_terms, ca.verified
FROM law.concept_authorities ca
JOIN law.legal_concepts c ON c.concept_id = ca.concept_id
WHERE ca.authority_id = ?
ORDER BY ca.concept_id;

SELECT lc.criterion_id, lc.concept_id, lc.requirement_type, lc.criterion_order,
       lc.criterion_description, lc.burden_of_proof,
       lc.determined_by_concept_id, lc.authority_id, lc.authority_proposition,
       lc.notes, lc.in_force_date, lc.repeal_date, lc.treatment,
       lc.treated_by_authority_id
FROM law.legal_criteria lc
WHERE lc.authority_id = ?
ORDER BY lc.concept_id, lc.criterion_order;

SELECT treating_authority_id, treated_authority_id, treatment, scope, notes
FROM law.authority_treatments
WHERE treating_authority_id = ? OR treated_authority_id = ?;
```

### D3 — Dispatch and validate

Dispatch the read-only `practice:verify-caselaw` agent, whose body mirrors
[`../agents/verify-caselaw.md`](../agents/verify-caselaw.md), in a session isolated
from the extractor. Step 2's dispatch-path and unavailability rules apply here
unchanged — never substitute another agent, and an unavailable, failed or malformed
verifier leaves this authority's rows, stamp and marker untouched.
Provide the resolved document, `LEGAL_CONTEXT` containing questions of law only,
optional `ISSUE_SCOPE`, and the D2 payload as `EXISTING_DATA`. Never pass party names
or the style of cause.

**Validate the returned JSON completely before any write.** Reject the whole
authority result if it is malformed, if an id does not resolve inside the D2
payload, if a `current` value does not byte-match (JSON null matches only a stored
SQL `NULL`), if a correction field is outside the matching `amend-law` allowlist,
if `proposed` is null outside the nullable allowlist, if an anchor is missing, or
if a missed-concept object fails the full extraction shape. Treatment corrections
must carry both authority identities and
`route: "practitioner_review"`. A validation failure leaves all rows, stamps, and
the marker untouched.

### D4 — Apply in honest ordered transactions

There is deliberately no transaction spanning operation boundaries:

1. **Text corrections.** Submit all valid authority, edge, and criterion corrections
   as one `amend-law` batch in `verifier` mode; that operation owns its own
   all-or-nothing transaction and repeats the source-anchor/current-value checks.
   An edge already at `verified = 1` is not overwritten: escalate it to
   `verified = 2` with an idempotent proposed-correction note. All treatment
   corrections are practitioner-review escalations, never text writes; enumerate
   them in the review queue. If the amendment batch fails, stop this authority and
   leave inserts, stamps, and marker untouched.
2. **Missed capture.** Only after step 1 succeeds, insert missed concepts, criteria,
   remedy edges, and opportunistically resolvable treatment links in a **separate
   per-authority insert transaction**, following
   `../shared/extraction-protocol.md` fresh-extraction write-order steps 4–8. Every
   new edge is born `verified = 0`; every new criterion follows the existing insert
   semantics. A failure rolls back this insert transaction and leaves the stamp and
   marker untouched.
3. **Stamp and mark complete.** Only after steps 1 and 2 both succeed, use one final
   `case_data__execute` transaction to stamp `authorities.last_verified_at` and
   append the dated plain line `V73 CAPTURE SWEEP COMPLETE <ISO date>` to
   `authorities.notes`. The marker append is idempotent: if any line beginning
   `V73 CAPTURE SWEEP COMPLETE ` already exists, do not append another marker,
   even on a later date. Both the stamp and `<ISO date>` are
   `date('now','localtime')` in the writing statement (`../shared/conventions.md` §10).
   This is intentionally **not a conventions-§5
   machine prefix**; it must not route the authority to a review queue.

`hallucination_flags` are reported, never auto-applied. A correction or insertion
failure leaves `last_verified_at` and the capture-complete marker untouched, so the
authority remains on the resumable worklist.

### D5 — Report

Report, per authority: document-resolution arm, fields populated, remedies swept,
`order_terms` fidelity, text amendments applied, verified-edge/treatment
corrections escalated, missed rows inserted, hallucination flags, and whether the
stamp/marker landed. `case_data__execute` dumps after each successful mutation; no
separate dump call is needed.
