# Operation: verify-law

Read [`../shared/conventions.md`](../shared/conventions.md) first; derive the live `matter_root` per §2.2 and read `probanda.json` only to confirm initialization; halt on any tool error per §2.3.

Verifies **legal edges** (`law.concept_authorities`) against the authority documents they cite, and records the result in `verified` + `notes`. It is the producer for `concept_authorities.verified` — the column existed from v7.1 with **nothing to populate it**, so every edge sat at `0` and no push gate could mean anything.

The backend-free semantics (session isolation, the unsourced-gloss test, the apply rules, the stamping rule) live in [`../shared/verification-protocol.md`](../shared/verification-protocol.md) §Legal edges. This file supplies the executable logic only.

## The seam — flags here, text in `amend-law`

| Operation | Writes | Never writes |
|---|---|---|
| **verify-law** (this file) | `concept_authorities.verified`, `concept_authorities.notes` | any text field |
| [`amend-law.md`](amend-law.md) | law-side **text** (and `verified` as its consequence) | — |

This does **not** dent `amend-law`'s invariant that it is the *sole* path that changes law-side text: verify-law changes no text. It exists because `amend-law` structurally cannot express what a verifier produces — its input record requires `field`/`current_text`/`new_text`, so it has no shape for a bare confirmation; its `verifier` mode sets `verified = 0`, so an autonomous run can never mark an edge verified; and it refuses an unresolvable source outright, which would leave an unverifiable edge sitting at `0` with nothing recorded.

A **correction** is not this operation's to write. Hand it to `amend-law` in `verifier` mode and let it re-run its own anchor check.

## Scope — what it will not do

- **Never** writes `proposition`, `finding`, `factual_context`, `obiter`, `order_terms`, `pinpoint`, `excerpt`, `relationship`, `treatment`, or any other text/structure column. Corrections route to `amend-law.md`.
- **Never** inserts or deletes rows. A wrong edge is rejected (`verified = -1`), never deleted — the audit trail is the point.
- **Never** writes `cloud_principle_id` / `pushed_at` / `pushed_source_hash` ([`push-state.md`](push-state.md) owns those).
- **Never** writes the pool or calls any `legal_commons__*` tool. This operation is local-only.
- **Never** sets `human_reviewed` — that column is facts/positions only (decision #18) and does not exist law-side.
- **Never** passes matter context, party names, or the style of cause to the verifier subagent (decision #10).

## 1. Select the worklist

The batch unit is **one authority document** — read the judgment once, judge every edge citing it together.

Run named query `05c` (`@query_05c_edge_verification_backlog` in [`../references/queries.sql`](../references/queries.sql)) to list unverified edges (`verified = 0`) grouped by authority. 05c reports the **whole backlog**; the backlog is not the worklist.

**The default worklist is scoped** ([live-issue test](../../shared/live-issue-test.md)): the authorities the current deliverable actually cites, or a caller-named subset tied to a live issue the caller states in one sentence. A whole-backlog run is unbilled firm maintenance and happens only on the practitioner's explicit instruction naming it as that — never propose it, and never widen a scoped run because the backlog is visible. Report the rest of the backlog as a count only.

Edges at `verified = 2` are the **lawyer's** queue ([`review.md`](review.md)), not this operation's — 05c excludes them. Do not re-run the verifier over them; only a human clears an escalation.

## 2. Resolve each authority's document

A caller may also route here for **resolution only** — naming a single stored authority, or an
un-ingested file in the matter tree, with no batch verification intended. An un-ingested file has
no recorded path or hash: resolve it by the caller's named path, apply the RTF pre-processing rule
below unchanged, and state in the report that no hash identity exists for it.

Per the protocol's locating rule, for each authority in the worklist:

1. Read `law.authorities.file_path` and `file_hash`. Try the recorded path; accept it **only if** the file's sha256 equals `file_hash`.
2. On a path miss or hash mismatch, **fall back to a hash search** over the matter tree. Paths go stale when files are renamed after ingestion (a housekeeping rename staled 21 of 47 in the L8142 pilot, with 0 hash mismatches); `file_hash` is the durable identity.
3. **Unresolvable either way** → do not dispatch a verifier for that authority. Escalate **every** edge citing it per §4 with reason class `source_unresolvable`, and continue to the next authority. An edge nothing can check must say so.

[`../references/scripts/resolve_authority_source.py`](../references/scripts/resolve_authority_source.py) is the executable form of this rule for one authority, spawned by the drafting runtime for a scrutiny review (`../references/design-decisions.md` #61).

Report, per authority, which arm resolved it (recorded path, or hash-fallback with the path found). When neither arm resolves it, report the recorded path tried, why it failed (missing, or hash mismatch), and that the hash search found no match. When a resolved file fails conversion, report its path and the conversion failure. For a caller-named file, report the named path and why it could not be read (missing, or conversion failed).

**Hash the original bytes, always.** Resolution matches `file_hash` against the file as it sits on disk — never against converted text (`../shared/extraction-protocol.md`).

**Dispatch a path the verifier can open.** Its only tool reads its own session filesystem. A PDF is dispatched as its page manifest by [`ingest-extract.md`](ingest-extract.md)'s Universal rules (`../references/design-decisions.md` #71): call `pdf_pages__images` for it, and the verifier reads a scanned page only from its PNG. Where host files arrive only over a bridge (Project Cowork), stage a byte-exact copy into the session first (`device_stage_files`), each PNG included, and dispatch that path.

### RTF pre-processing

Most authority documents here are Westlaw `.doc` files that are actually RTF, and the harness file-read tool **refuses them as binary** — so a verifier handed the raw path can read nothing. Render first, exactly as [`ingest-extract.md`](ingest-extract.md) §"RTF pre-processing" specifies (that file is the single source of truth for the rule): a `.doc` whose header bytes are `{\rtf` is rendered to text in the temp dir by `render_document.py` and the subagent is dispatched against the **rendered text**, while the DB rows keep the original `file_path` and `file_hash`.

If rendering fails, the document is **unresolvable for this pass**: report the renderer's stated reason and escalate its edges with class `source_unresolvable` per §2.3 rather than dispatching a verifier that cannot read. A PDF takes no RTF rendering: it goes through `pdf_pages__images` as above, and a refusal from that tool makes it unresolvable for this pass in the same way.

## 3. Dispatch the verifier (session-isolated)

Dispatch the read-only `lawyer:verify-edges` agent, whose body mirrors [`../agents/verify-edges.md`](../agents/verify-edges.md) — one dispatch **per authority document**, in a session isolated from the agent that extracted the edges (`../shared/verification-protocol.md`) — a fresh subagent, never `isolation:"worktree"` (matter dirs aren't git repos). Same-context verification is not verification.

Provide exactly:

- the **document** — resolved absolute path (for a PDF, its page manifest in its place), plus `title`, `citation`, `disposition`;
- the **edges** citing it — `concept_id`, `authority_id`, the concept's `name` and `description`, `relationship`, `proposition`, `finding`, `obiter`, `order_terms`, `pinpoint`, `excerpt`, and the current `verified` value. (`pinpoint` and `excerpt`, v8.5, carry the pinpoint and quoted passage a bridged edge was built from — exactly what the verifier needs to check the edge against the document, and local-only, so they never leave this dispatch.)
- the **treatment vocabulary** — the whole text of [`../../shared/treatment-vocabulary.md`](../../shared/treatment-vocabulary.md) as `TREATMENT_VOCABULARY`, which defines each `relationship` the verifier tests.

**Provide nothing else.** No matter context, no party names, no style of cause.

```sql
-- The dispatch payload for one authority.
SELECT ca.concept_id, ca.authority_id, c.name, c.description,
       ca.relationship, ca.proposition, ca.finding, ca.obiter, ca.order_terms,
       ca.pinpoint, ca.excerpt, ca.verified
FROM law.concept_authorities ca
JOIN law.legal_concepts c ON c.concept_id = ca.concept_id
WHERE ca.authority_id = ? AND ca.verified = 0
ORDER BY ca.concept_id;
```

A verifier that is unavailable (never substitute another agent), returns `document_read: false`, fails, or returns malformed JSON leaves its authority's edges **untouched at `0`** and does not halt the run — continue to the next authority and report the failure. A failed pass must never be recorded as a verification.

## 4. Apply (one transaction)

Apply the verifier's output per `../shared/verification-protocol.md` §Legal edges. All writes for the run go in a **single** `matter_data__execute` call.

| Verifier output | `verified` | `notes` |
|---|---|---|
| `confirmed[]` | `1` | none — the flag is the record |
| `rejections[]` | `-1` | `REJECTED <ISO date> (edge): <reason> [verifier: <reference>]` |
| `ambiguous[]`, or an unresolvable document (§2.3) | `2` | `NEEDS HUMAN <ISO date> (<class>): <detail> [verifier: <reference>]` |
| `corrections[]` | **not written here** | — route to `amend-law.md`, `verifier` mode (§5) |

`<class>` is the reason class: `source_unresolvable`, `loose_characterization`, `minor_inaccuracy`, `wrong_relationship`, or `unsure`. `<ISO date>` is `date('now','localtime')` in the writing statement, never typed (`../shared/conventions.md` §10).

**The no-overwrite guard — check before every write.** An edge already at `verified = 1` is **never** autonomously moved to `-1` or corrected. A verifier disputing one **escalates it to `2`** with its reason instead. Edges carry no `human_reviewed`, so a `1` may record a lawyer's own adjudication, and overwriting that silently is what decision #18 forbids for facts. An edge already at `2` is likewise left alone — it belongs to the human queue.

**Notes are idempotent.** Before appending, check whether the identical note is already present; if it is, change nothing. A re-run must not stack duplicates (`../shared/verification-protocol.md`).

```sql
-- Confirm. The no-overwrite guard is in the predicate, not just in the prose.
UPDATE law.concept_authorities SET verified = 1
WHERE concept_id = ? AND authority_id = ? AND verified = 0;
```

## 5. Route corrections to `amend-law`

For each `corrections[]` entry whose target edge is at `verified = 0`, build an `amend-law` record with `authorization.mode = "verifier"`, `reference` naming this verifier run, and the `source_anchor` the verifier returned. `amend-law` re-runs its own anchor check and sets the edge back to `0` so the corrected text re-enters the pipeline — a corrected edge is **not** a verified edge, and needs a later pass.

If the target is at `verified = 1`, do not send it to `amend-law` — escalate to `2` per §4 instead.

Present the correction batch and take the practitioner's sign-off before it applies, per `amend-law.md` §5.

## 6. Stamp `last_verified_at`

Stamp `law.authorities.last_verified_at` for each authority whose verifier pass **completed successfully** — the pass re-read that document, which is exactly what the column attests. An authority whose document was unresolvable, or whose verifier failed, is **not** stamped. The stamp is `date('now','localtime')` in the writing statement, never typed (`../shared/conventions.md` §10).

**It is not edge verification.** `last_verified_at` says the document was re-read; `concept_authorities.verified` says the edge is right. Never let a consumer or a pool payload read one as the other.

## 7. Report, then dump

`matter_data__execute` regenerates `evidence.sql` automatically on success (§2.3) — no separate dump step.

Report:

- per authority: title, citation, how the document resolved, and the verdict counts;
- per edge changed: concept id + name, authority id + title, old → new `verified`, the reason, and the anchor quote + locator for a confirmation;
- corrections routed to `amend-law` (and their outcome);
- authorities skipped, with why (unresolvable document, verifier failure);
- the **push consequence**: how many concepts this run moved out of push hold-back (`push-state.md` push-queue is the authority on that count — do not compute a second one here).

A verification that changed nothing is reported as such. Never let a failed or empty pass exit looking clean.
