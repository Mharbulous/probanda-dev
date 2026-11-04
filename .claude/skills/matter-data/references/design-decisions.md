# Load-bearing design decisions

The `verified` enum's authoritative definition lives in `shared/conventions.md` — the values are restated here for context, but treat `shared/conventions.md` as canonical for it and for the other cross-cutting semantics (notes-prefix convention, citation format, bitemporal pattern, connection pattern, clock source for dates). Do not restate them divergently anywhere else.

Table counts, stated consistently everywhere in this skill: **main = 23 tables, law = 5 tables, privileged = 3 tables.**

---

## 1. Two-track privilege model is structural

`privileged.sqlite` is a separate attached database. SQLite cannot declare a cross-database foreign key, so by construction no FK path can run from privileged material to `evidence_links` or `positions`. This is not a policy we enforce with code — it is a structural impossibility we get for free by keeping privileged material in its own database file. Never merge the privileged tables into `main.sqlite` "for convenience"; doing so would make it possible to build an FK from privileged material to admissible evidence, collapsing the firewall. The firewall lives on the boundary main↔privileged — it is **not** the facts↔evidence boundary, which is a different concern.

## 2. The privilege dividing line is judgment, not schema

Which side a source falls on — privileged or admissible — depends on client intent and any waiver, which are matters of legal judgment. Nothing in the schema decides it. The line is enforced by the ingest decision rules, the verifier sweep, and lawyer review — layered human/agent judgment — and never by a CHECK constraint. Do not try to add a schema rule that "automatically" classifies privilege; it cannot capture intent or waiver and would produce false confidence.

The firm's standing call is that everything under `2. SOLICITOR CLIENT` is privileged, and `operations/ingest-extract.md`'s solicitor-client folder rule applies that call by path. This records one human judgment made once, not an inference, so this decision holds. Outside that folder the call is made per document. Whether a file belongs in the folder is `/housekeeping`'s question: ingest adds no misfiling detection and never comments on it. Nothing in the schema or triggers changes.

## 3. Promotion never deletes

When a privileged source becomes producible, insert a **new** `main.sources` row and keep the original privileged row in place forever. Do not move or delete the privileged row. The two-row lineage is discoverable after the fact by matching `file_hash` across the two databases. This preserves the audit history of what was once privileged and how it came to be produced. See `references/playbooks/promotion.md`.

## 4. `fact_provenance` ≠ `evidence_links`

These two look similar and must never be consolidated. `fact_provenance` (in `privileged.sqlite`) records investigative provenance — where a fact was *learned* — which may itself be privileged. `evidence_links` (in `main.sqlite`) records admissible proof — what can be *put before the court*. A fact that has provenance but no evidence link is a trial-preparation gap: we know the fact but cannot yet prove it admissibly. Query 10 exists specifically to surface those facts. Collapsing the two tables would erase the distinction between "how we know it" and "how we can prove it."

## 5. The text dump is the migration/rebuild boundary

The plain-text SQL dump (`evidence.sql`) is the durable boundary that survives cloud-sync corruption and is the source for rebuild and migration. Its sections are delimited by markers `-- ===== v6 BEGIN <db> =====` / `-- ===== v6 END <db> =====`. Migrations and rebuilds always run on temp copies of the databases under `DELETE` journal mode; they never operate against the native binary files directly. Do not "optimize" a migration or rebuild to edit native files in place — that reintroduces the sync-corruption exposure the text boundary exists to avoid.

## 6. Verification is three-tier with mandatory session isolation

The `verified` column takes four values (canonical definition in `shared/conventions.md`): `0` unverified (fresh extraction), `1` AI-or-human verified, `-1` AI-rejected, `2` needs human judgment. The independent AI verifier **MUST** run in a session isolated from the agent that created the rows — verification performed in the same context as extraction is not verification, because the verifying agent shares the extractor's assumptions and errors. The lawyer's review queue is `verified = 2` only; everything else is handled upstream by the extractor and the AI verifier.

## 7. Views filter `verified >= 0`

The reporting views filter `verified >= 0` (and additionally `valid_to IS NULL` for the bitemporal views). This threshold is deliberate. Filtering on `= 1` would empty the views during ingestion, when freshly extracted rows still sit at `0` and haven't been verified yet — the practitioner would see nothing while work is in progress. Not filtering at all would let AI-rejected rows (`-1`) leak back in and flip a fact's posture. `>= 0` is the only threshold that shows in-progress work while excluding rejected rows. Do not change it to `= 1` or drop it.

## 8. `qualification` is verbatim pleading text; `notes` is commentary

`qualification` holds the verbatim limiting language from a pleading; `notes` holds lawyer or agent commentary. Never collapse the two into one column — the verbatim text has evidentiary weight that commentary does not. In particular, never split a qualified admission into separate admit and deny rows: a qualified admission is exactly **one** `admit` position row carrying the limiting language verbatim in `qualification`. Splitting it fabricates a denial the party never made.

## 9. Posture is view-derived, never stored

Fact posture (`disputed | admitted | not_admitted | no_position | claimed | unaddressed`) is derived by the views from current positions; it is never written to a column. The factual position types are `claim | admit | deny | not_admit | no_position`. No row means actual silence. `position_basis` explains a non-admission or qualified response without turning it into a new fact. Position types are enforced by a CHECK constraint, not by a lookup table — there is no `position_kind` table (that is a retired name; never recreate it). Court findings and appeals of posture are out of scope for this schema. Storing posture would let it drift out of sync with the positions it is supposed to summarize.

## 10. law.sqlite isolation

The legal-authority database (`law.sqlite`, 5 tables) is kept physically separate from client data for two reasons. First, it prevents the agent from conflating precedent facts (the facts of a decided case) with the facts of the live matter — a contamination that produces subtly wrong extractions. Second, because it holds zero client PII, the accumulated legal research ports cleanly to a new matter with nothing to scrub. Never introduce client data into `law.sqlite`, and never pass party names or the style of cause to a legal-authority subagent.

## 11. Deferred memos are problem+insight, not spec

The memos under `references/deferred/` capture a Problem and the Insights gained about it — they are design capital, not specifications. Their "Direction" sections are explicitly non-binding. When a memo's trigger fires, absorb the rationale and design fresh against the then-current schema; never copy a memo's Direction verbatim into an implementation plan. Each memo carries a `schema-context:` header naming the schema version it was written against, and the router table flags memos known to predate the current schema — honor those flags, because a memo's concrete suggestions may reference retired schema shapes.

## 12. Nine cross-database trigger pairs are the FK layer

Because SQLite has no real cross-database foreign keys, nine trigger pairs (a `BEFORE INSERT` and a `BEFORE UPDATE` each, raising on a missing target) stand in as the FK-enforcement layer across the three databases, backed by five delete guards. These triggers are `TEMP` objects: they are loaded per session, after the `ATTACH` statements, and do not persist in the database files. `references/triggers.sql` is the single source of truth for them. A rebuild MUST fail **before** it touches any native file if the triggers are missing — proceeding without them would allow orphaned cross-database references. Do not move this logic into the schema or assume the triggers survive across sessions. `law.legal_concepts` is referenced by two pairs (#6 `causes_of_action.concept_id`, #7 `issue_concepts.concept_id`); privileged client instructions add #8 (`proceeding_id`) and #9 (`party_id`), guarded by the proceeding and party delete guards.

Where `matter_data__execute` gets the trigger text since 2026-09-29: #52.

## 13. Five concept types in one table

`law.legal_concepts` holds five kinds of legal concept — `cause_of_action`, `doctrine`, `test`, `defence`, `remedy` — in a single table, discriminated by a CHECK constraint on `concept_type`. Do not split them into per-type tables; the junctions and gap queries all assume a single concept table. If a new concept type is ever genuinely needed, it must be added in two coordinated places at once: the CHECK constraint **and** the gap-analysis queries that enumerate the types. Adding it to only one produces silent gaps.

## 14. Element gap = FATAL, factor gap = WEAK

In gap analysis, a missing **element** (a mandatory criterion, `requirement_type = 'element'`) is a `FATAL GAP` — the cause of action cannot succeed without it. A missing **factor** (a weighed criterion, `requirement_type = 'factor'`) is merely `WEAK` — it lessens the case but is not dispositive. These two must never be treated alike: reporting a factor gap as fatal cries wolf, and reporting an element gap as weak hides a case-ending defect. Query 03 encodes this distinction; preserve it.

## 15. Criterion nesting is one hop

A criterion may be determined by another concept via `legal_criteria.determined_by_concept_id` — for example, an element that is itself established by applying a legal test. This nesting is deliberately **one hop only**: there is no recursion, and no chain of determinations. By soft convention the target of `determined_by_concept_id` should be a concept with `concept_type = 'test'` (an element determined by a test). Do not build recursive resolution over this column or assume arbitrary-depth nesting; the queries and the mental model both assume a single hop.

## 16. Authority treatments model appellate history

Trial and appellate decisions are stored as **separate** `authorities` rows, linked through treatments — this is how appellate history is modeled. Two distinct tenses are in play and must not be confused. `authority_treatments.treatment` is **present tense** (affirms / reverses / varies / distinguishes / overrules) — the relationship between two authorities. The proposition-level `treatment` on `concept_authorities` and `legal_criteria` is **past tense** (affirmed / reversed / varied / distinguished / overruled) — the current standing of a proposition. Citation precedence follows from this: cite the treating authority when a proposition is affirmed; a reversed or overruled proposition is no longer good law and must not be cited as authority. Treatment linkage is opportunistic — if the treated authority has not been ingested yet, defer the link and report the deferral rather than fabricating a row.

## 17. Compound documents (affidavits) use `parent_source_id`

An affidavit is a compound document. It is stored as a body row (with `parent_source_id` NULL) plus one row per exhibit, each exhibit sharing the body's `file_path` and `file_hash`. The idempotency key for an exhibit is `(parent_source_id, exhibit letter in title)` — deliberately **not** the file hash, because every exhibit shares the body's hash and hashing could not tell them apart. `basis_of_knowledge` and `informant` live on the **body** facts, not on exhibit facts. When an informant is privileged, it is NULLed in `main.sqlite` and the identity is recorded instead in `privileged.fact_provenance.source_note` — preserving the privilege firewall (decision 1) while keeping the basis-of-knowledge trail.

## 18. `human_reviewed` distinguishes lawyer-confirmed from AI-verified

The `human_reviewed` column exists on factual and relief propositions/positions (`facts`, `positions`, `relief_items`, and `relief_positions`) and marks rows a lawyer has personally confirmed, as distinct from rows the AI verifier merely checked. **Only the review operation** sets `human_reviewed = 1`; nothing else may write it (ingestion never sets it). The distinction drives correction handling: a correction to a human-reviewed row is never auto-applied — it is routed to the human queue (`verified = 2`) with an annotation, because overwriting a lawyer's confirmed judgment silently is unacceptable. A correction to a merely AI-verified row may be auto-applied. Erasing this column would make every automated correction free to overwrite the lawyer's own decisions.

## 19. Push-state is derived, never stored; annotations route by kind (v7.0, issue #49)

`law.legal_concepts` carries a one-way up-pointer to the shared cloud legal-knowledge pool (layer 3, issue #48): `cloud_principle_id` (NULL = unpushed), `pushed_at`, and `pushed_source_hash` (SHA-256 of the local push-source fields — `name`, `description`, ordered `legal_criteria`, and **(v7.1) ordered `concept_authorities` edge fields** — `relationship`, `proposition`, `finding`, `obiter`, `treatment`, over `verified >= 0` rows — as they stood at push time; computed by the pushing gatekeeper, since SQLite has no built-in SHA-256). `law.authorities.cloud_authority_id` is a **dedup cache only**, not a tracked pointer — no push-state machinery rides on it.

**What the hash asserts.** `pushed_source_hash` is a snapshot of **local** content. It is **not** a claim of textual equality with the pool. `pushed` means *the pool has seen local content in this exact state*; `diverged` means *local changed since the pool last saw it*. Push severance-rewrites the text on its way out, so pooled text routinely differs from local by design — that difference is **not** divergence and never enters the computation. The edge fields are in the hash because they cross — omit them and a local edit to an edge `proposition` is unrepresentable as divergence, leaving the pool holding text the local record no longer says with nothing surfacing it; `factual_context`, `notes`, and the `verified` value do not cross and stay out.

**Derived push states** (never stored as an enum; computed on read from the three columns above):
- **unpushed** — `cloud_principle_id IS NULL`.
- **pushed** — pointer set, recomputed source hash equals `pushed_source_hash`.
- **diverged** — pointer set, recomputed hash differs from `pushed_source_hash`.

A stored status enum was rejected on the same rationale as decision #9's view-derived posture: every write path would need to know about push machinery, and one forgotten path silently corrupts the state. Up-pointers are **never rewritten on cloud merges** — the redirect hop is resolved inside the cloud lookup tool (issue #48, D2), never locally; a diverged re-push resolves the then-canonical cloud ID at push time. `cloud_principle_id` also never gets a backfill pass: every pre-v7.0 `legal_concepts` row is born `unpushed`.

**Annotation-routing rule** (keeps decision #10's matter-free invariant true under the push pipeline): *doctrinal* annotations (about the principle/authority as law — "reformulated in X", a local judgment's path/hash) belong in the existing `law.*` `notes`/`file_path`/`file_hash` columns; they are local forever and have no cloud column to cross into. *Matter-strategy* annotations ("use this against the limitation defence on issue 3") belong on the **main-side** junction rows — `coa_criteria.notes`, `causes_of_action.notes`, and `issue_concepts.notes` (the new v7.0 junction, decision below) — which are severed from the push pipeline by construction. Route by which of these two a note is; do not put matter-strategy content in `law.*` notes even when it would be convenient at write time.

`main.issue_concepts` (issue_id, concept_id, relevance, notes) exists because the pre-v7.0 association (`causes_of_action.concept_id`, `coa_criteria`, `criteria_facts`, `issue_criteria`) has no path from a standalone doctrine/test/remedy concept (often with no criteria yet) to the issue it was researched for — fabricating a criterion to force the link would be a data lie. `issue_concepts.notes` is the matter-strategy annotation home for that case.

## 20. Legal edges are verifiable and amendable (v7.1, handover 123A)

Until v7.1, `law.concept_authorities` was **write-once at ingest**: written only by `ingest-extract`, read only by `push-state`, verified by nothing, amendable by nothing. The verification protocol covered sources/facts/positions and had no analogue for edges, and `review.md` never surfaced them. An audit of the pooled corpus found the consequence: an edge asserted the "**stricter** 'bound to fail' standard" where the cited judgment never uses the word and never ranks the two standards — faithful extraction plus an **unsourced editorial gloss**, with nowhere to record the defect and no path to fix it. The pool was corrected; the local record — the defect's actual home — could not be.

Three things follow, and they are load-bearing together:

- **`concept_authorities.verified`** carries the same 4-state enum as every other `verified` column (`shared/conventions.md` §4 is canonical). All four states have concrete edge meanings: `2` is the escalation target for an autonomous proposed correction, `-1` retires a fabricated edge without deleting the audit trail. Existing rows backfill to **`0`** — honest, because nothing has ever verified an edge. NULL would be wrong: consumers filter `verified >= 0`, and NULL rows vanish under three-valued logic — a silent empty result, which this project forbids.
- **`concept_authorities.notes`** carries correction provenance (who/why/source) on the row corrected. Parking it on `authorities.notes` would attach it to the wrong entity; on `legal_concepts.notes` it would fan out across up to 47 edges. It never crosses to the pool (push-queue excludes `notes` from the payload) and is excluded from `pushed_source_hash`.
- **`operations/amend-law.md`** is the **sole** sanctioned path that *corrects* law-side text. Its authorization modes are the safety property: an autonomous run with no adjudication may **never** change text — it escalates (`verified = 2`) with an idempotent proposed-correction note. And no autonomous mode overwrites a `verified = 1` edge — see the blanket no-overwrite rule below. (Decision #22 carves out one scoped exception: a **human-approved duplicate merge** may backfill empty fields and fold colliding edges — never *correct* populated text.)
- **`operations/verify-law.md`** (v7.1, handover 124) is the **producer** for edge `verified`, and writes **only** `verified` + `notes` — never text. The two are one seam, and the split is deliberate: `amend-law` structurally cannot express what a verifier produces. Its record requires `field`/`current_text`/`new_text`, so a bare confirmation has no shape; its `verifier` mode sets `verified = 0`, so an autonomous run could never mark an edge verified — the one write the feature exists for; and it refuses an unresolvable source with no write at all, which would strand an unverifiable edge at `0` with nothing recorded. A flags-only operation does not dent the sole-path invariant, which is about **text**: verify-law changes none. Corrections it finds are handed back to `amend-law` in `verifier` mode.

**`human_reviewed` deliberately does NOT extend to edges** (#18 stands: facts/positions only). The distinction it exists for — auto-apply vs escalate — is served here by the no-overwrite rule.

**There is no human-verification column, by decision.** The edge verifier (`operations/verify-law.md`) means `verified = 1` does not imply human adjudication, and the rule is still the **blanket no-overwrite rule** rather than a provenance column: *no autonomous path changes any `verified = 1` edge, whoever set the 1; a verifier disputing one escalates it to `2`.* Cost: some AI-verified edges route corrections through the lawyer's queue that facts would auto-apply. At this corpus size that is cheap, and it buys a rule with no schema change and no notes-parsing to recover provenance. This is the settled answer, not an oversight.

**Deferred, deliberately:** `legal_criteria` gets no `verified` column — criterion edits were never invisible (`criterion_description` is hash-covered, so an edit surfaces as `diverged`); edges were doubly invisible, which is the hole that needed closing. Criterion provenance uses the existing `legal_criteria.notes`.

**The edge backlog is `@query_05c`, not `@query_05a`** (v7.1, 124). Edges stayed out of 05a while no verifier serviced them; `verify-law` is now that service, so the backlog surfaced — but in its own query, keyed by **authority document** (the verifier's batch unit: read the judgment once, judge all its edges together) rather than folded into 05a, whose single `row_id` shape cannot carry an edge's `(concept_id, authority_id)` key. 05c lists `verified = 0` only: `verified = 2` is the lawyer's queue (`@query_05b`), and only a human clears an escalation.

**`last_verified_at` is not edge verification.** It sits on `law.authorities` and attests that a verifier re-read that source **document**. It says nothing about whether an edge's `proposition` is right. The two live on different tables for a reason; do not let a consumer or a pool payload conflate them.

## 21. research-agent holds a read-only `matter_data__query` grant — the documented second consumer

The `research-agent` plugin agent (`source/researcher/agents/research-agent.md`) is granted `matter_data__query` — and only `query`; never `execute`. This is a conscious, written exemption to "only /matter-data calls matter_data__*", adopted 2026-07-20 when a live E2E run proved the Skill-invocation hop needs the underlying tool present in the agent's own grant (Cowork wrappers load prose; tools do not follow). The gatekeeper boundary survives because the agent remains schema-ignorant: it invokes this skill's query operation and executes its instructions verbatim, contains no SQL or schema of its own, and skips `query.md` §1 per that file's read-only-caller rule. Any second agent wanting this grant needs its own entry here first — never a silent copy.

## 22. merge-authorities is the second sanctioned writer of law-side rows (2026-07-20)

`operations/merge-authorities.md` collapses two `law.authorities` rows that are the **same case or statute entered twice** onto a surviving canonical row and tombstones the other. It is the **second** sanctioned writer of law-side rows — the first is `ingest-extract` (inserts), and text *corrections* stay `amend-law`'s (#20). This entry **amends #20's sole-path-for-text claim**: a merge may backfill an empty scalar field, union citations, fold a colliding edge, and re-point references, but it **never corrects populated text** — a both-populated-unequal scalar is a `CONFLICT` the human resolves, and a colliding edge keeps C's text and appends D's to the edge notes. The narrow exception exists because a duplicate row *is* a data defect, and refusing to touch any populated field would strand the merge.

**Architecture — script computes, agent perceives, human decides.** A deterministic stdlib script (`references/scripts/merge_authorities.py`) owns detection, checks, election, field-merge computation, and SQL emission. It is a **pure JSON→(proposal|SQL) function**: it never opens a database, never reads a file, never reads the clock (merge date + operator are required `--emit-sql` arguments). The agent resolves the two perception-only checks (B4 decision date, B6 document comparison) by reading the documents; the human approves every merge. No merge executes without explicit per-pair human approval.

**Tombstone via a notes marker — no schema change.** The merged row is tombstoned by prefixing `law.authorities.notes` with `[MERGED-INTO:#<C> <date> <operator>]`; its original `citation`/`file_path`/`file_hash` are retained for audit and ingest redirect. A `[NOT-DUPLICATE-OF:#<id>]` marker on both rows records a human "not duplicates" ruling and suppresses the pair from future detection. This `[MERGED-INTO:]`/`[NOT-DUPLICATE-OF:]` **marker family is new to `law.authorities.notes`**, and the conventions §5 prefix rule (a prefixed note forces `verified = 2`) does **not** apply — `authorities` has no `verified` column. A dedicated `merged_into_authority_id` column would be cleaner and is recorded here as a **rider for the next scheduled schema bump** — deliberately deferred, not added now, so no migration rides on this feature. (When that bump happens, work `references/schema-bump.md` — see #29.)

**Hard stops B1/B2/B3/B3b are non-overridable.** Different court codes (B1), different year+sequence (B2), an `authority_treatments` link between the pair (B3), or a `treated_by_authority_id` link (B3b) each reject the pair outright — because trial/appeal and successive decisions in one litigation are **separate rows by design** (#16), never duplicates. The script rejects; the operation relays; neither second-guesses.

**Verified-fold rule (surviving state is never maxed).** When an edge collides on both C and D, the surviving edge on C keeps its own `verified` state *only* when C and D agree on both state and text; any disagreement — differing text, or differing state including `C = -1` / `D = 1` — escalates the edge to `verified = 2` within the human-approved proposal. This is the **one** sanctioned overwrite of a `verified = 1` edge (the #20 blanket no-overwrite rule holds for every *autonomous* path; a merge is human-approved).

**Layer-3 is out of scope.** Two *different* `cloud_authority_id`s are recorded in the surviving row's notes and flagged for a **separate, human-initiated** commons merge — the merge never calls a `legal_commons__*` tool (Decision 10; dormant while all cloud IDs are NULL post-pool-purge).

## 23. Theorized facts are provenance-level placeholders (v7.4)

A **theorized fact** is a fact theorized for investigation — the case theory needs it, but no source yet evidences it. At round 1 of an application's argument loop, pre-affidavit, "not yet evidenced" is the *expected* state, not a defect: a litigator works forward from theorized facts, then investigates. This is modelled with **no new table** — the privilege firewall (#1) and the deliberate `fact_provenance` ≠ `evidence_links` split (#4) already carry the whole design. Revised by #67 (2026-10-12): the `main.facts` row is a bare ID, and the wording, category and note live on the privileged side:

- A theorized fact is a **bare** `main.facts` row (#67) with **`source_id NULL`** (no evidentiary source), **`verified 0`** (theorizing is not a source extraction; nothing verified it) and no content. Never `verified 1` — that would assert a verification that did not happen — and never a `notes` prefix. Its wording and category are the labelled lines of the theory provenance row's `source_note` (`operations/bare-privileged-facts.md` §2). A theorized fact is the case theory's own statement and is privileged work product for the same reason the Theory of the Case is, so no non-privileged sentence is drafted from it and no drafting step reads it from `main`.
- Its only provenance is a **placeholder source**: one `privileged_sources` row per application, `category = 'privileged_work_product'`, `title = 'Theory of the case — <app-id>'` (em dash, exactly), created lazily on the first theorized fact. The fact links to it through `fact_provenance`. The **provenance is the case theory itself**.
- The lifecycle has **two markers, not three**: `active` → (a non-privileged source states it, so the row takes that source's own Statement of Fact per #67, and evidence lands) an ordinary evidenced fact, *by construction*, because a real `evidence_link` makes `@query_22` stop matching it — there is no "evidenced" disposition and none is needed; the theory provenance stays as history. Or `active` → `dismissed`, the terminal "our investigation concluded this likely untrue" state.

**Why a `disposition` column, not a `source_note` prefix.** Dispositions are load-bearing for the stage-9 verifier (`theorized_only` tolerated inside the loop; `dismissed_fact` fails a check), and prefix-parsing is fragile. The column takes `CHECK(disposition IN ('active','dismissed')) DEFAULT 'active'`, `NOT NULL`; every existing row backfills to `active` on the ALTER. This is the **one** structural addition — `privileged` is still **2 tables**.

**Why not the rejected alternatives** (they resurface, so they are recorded here): a `theorized`/`dismissed` *position* value is wrong — positions are on-record stances each carrying a `source_id` to a pleading, and storing private case-theory conclusions in `main.sqlite` would breach the firewall (#1). A *posture* value is wrong — posture is derived-never-stored (#9), and nothing exists to derive `theorized` from. A separate privileged stance table is strictly more machinery than reusing `privileged_sources` + `fact_provenance`.

**`v_fact_status` must not read privileged data.** A posture view cannot and should not read the privileged database (#1). A theorized fact is a bare row, so the view skips it (#67) and it has no posture. The theorization state lives on the privileged side and is read only by `@query_22`, never folded into posture.

**`dismissed` is our-side-only and terminal.** It records what *our* investigation rejected; there is no way to know what the opposing side privately dismissed. It is never deleted (mirror of #3 promotion-never-deletes / #2's append-only audit posture): the record of a considered-and-rejected premise is the point. `operations/theorize-fact.md` owns both write paths; the practitioner authorizes every dismissal (the calling pipeline never dismisses autonomously — mirror of the authority-gap "AI dismisses only for mootness" rule). The identifying convention is **title-based** (`LIKE 'Theory of the case —%'`); that fragility is accepted deliberately in exchange for zero new schema surface.

**"Postulate" is not a term in this skill.** The minting verb is **theorize** or **mint** — say *mint a theorized fact*. "Postulate" was only ever a loose synonym for a verb this skill already names, so it carries no meaning of its own here. Do not introduce it — a practitioner-facing term with two meanings is the retired-**Component** defect (#35's `proof_kind`/`basis` reasoning applies unchanged).

## 24. Role integrity is a profile contract and a v7.5 schema boundary

`proceedings-profile` owns the public role-validity contract. The fixed role
enum is `plaintiff | defendant | third_party | intervenor | applicant |
respondent | petitioner | appellant | defendant_by_counterclaim` (`appellant`
added in v8.3, decision #43); `plaintiff_by_counterclaim` is prohibited. A counterclaim defendant is a
standalone counterclaim-only party, not a second role attached to a
main-action party. Exactly `{defendant, third_party}` is a valid multi-role
stack because the same party may occupy both blocks; every other stack is
correction-required and makes the returned profile non-renderable.

The grouped profile is the consumer boundary: opaque party IDs, display names,
valid role groups, and correction-required combinations. Consumers do not
reimplement validation or learn schema details. `style_of_cause` remains the
short cause for orientation and cannot be used to detect omissions from a
formal style.

Party status is formal, not functional. A garnishee or other notice/service
recipient is not promoted into the named-party roster as a `defendant` or
`third_party` merely because an application affects it. The practitioner may
confirm removal of that erroneous association while the underlying entity
record remains available to other matter data.

Schema v7.5 physically removes the deprecated value from the canonical CHECK.
The v7.4→v7.5 transition is rebuild-only: there is no migration marker. It
fails with the exact deprecated rows before reconstructing the role table,
verifies row-count preservation, then stamps all three databases v7.5. This is
intentionally fail-closed; untouched v7.4 matters remain unavailable until
separately rebuilt.

## 25. Pleading responses target propositions; silence is absence (v7.6)

Admissions, denials, non-admissions, and express abstentions are positions on
independently truth-evaluable propositions. They are never themselves facts.
The factual position enum is `claim | admit | deny | not_admit | no_position`;
actual silence is represented by no row. `position_basis` records why a party
declined to admit or qualified its response, while `qualification` remains the
verbatim limiting text per decision #8.

A response paragraph or range resolves to every atomic fact stored at the
referenced locator in the pleading being answered. Unresolved references abort
the whole document transaction and name the smallest unresolved locator; a
placeholder fact would preserve syntax while losing the proposition and is
therefore prohibited. Current-position uniqueness is scoped to `(fact, party,
responding source, responding locator)`, so a response never supersedes the
originating pleading's claim.

Remedies are separate: `relief_items` hold what is sought and
`relief_positions` hold `seek | consent | oppose | no_position`. Incorporation,
adoption, paragraph references, and procedural metadata live in
`source_references`. These tables exist to enforce the categorical boundary in
schema rather than relying on reconstruction prose to recover it later.

## 26. The housekeeping review log is operational run-state, deliberately (v7.7)

`main.housekeeping_reviews` records which files the `/housekeeping` file-naming run has
already opened and reached a verdict on. It is **not case data** — no fact, position,
authority or source depends on it, no view reads it, and deleting the whole table would
cost nothing but a wasted re-review. It lives here anyway, and the reasoning is worth
keeping because the obvious objection ("that isn't case data") is correct and still not
decisive.

**Why in `main.sqlite` rather than a sidecar file.** The record has exactly the same
lifetime, scope, and portability requirements as matter data: one per matter, durable
across sessions, carried in the `evidence.sql` text dump, and rebuilt with everything
else. A sidecar JSON or SQLite file next to the matter would need its own staging
discipline (§ conventions 2.1), its own dump path, its own rebuild story, and its own
corruption exposure on synced storage — three mechanisms re-invented to hold five
columns. Reusing the one store that already solves all of that is the smaller design.

**What this does NOT license.** It is not a precedent for parking arbitrary tool state
in `main.sqlite`. The specific properties that earned this table its place are: (a) it
is per-matter and useless outside the matter; (b) it is derived and disposable — losing
it degrades performance, never correctness; (c) it has no FK to anything and nothing has
an FK to it, so it cannot distort the relational model; and (d) no view, query, or
gatekeeper operation other than its own reads it. A proposed table that misses any of
those four needs its own entry here before it lands.

**Never fold it into `sources`.** The temptation is real — `sources` already carries
`file_path` + `file_hash`, and the housekeeping run walks the same folders ingest does.
But a `sources` row asserts *this document is matter material of a stated category*,
which a housekeeping review does not establish and must not imply. Most files
housekeeping renames (disbursement receipts, internal drafts, filed-copy duplicates) are
not sources at all, and writing them as such would be a data lie that the ingest gate,
the verifier sweep, and every downstream fact query would then have to live with. The
two tables share a hash column and nothing else.

**Skip semantics are the caller's, not this skill's.** `housekeeping-log` reports
matches; `/housekeeping` decides what to do with them. In particular, a recorded file
stays skipped even after the naming rules change — the escape hatch is housekeeping's
`--force` argument, not an expiry column here. Storing a rules-version alongside each
row was considered and rejected: every Step 7 refinement to a folder-notes file would
invalidate the entire cache, which converts a rare deliberate re-run into a routine
silent one.

**v8.8: two more outcomes.** The housekeeping redesign added `not_ingested`, a settled
verdict (the practitioner filed the file without ingesting it), and `ingest_failed`, a
remembered ingest failure with its reason, failure class and retry flag. The remembered
failure schedules automatic retries and does not affect case correctness: losing it costs
at most one extra ingest attempt. So it fits (b) above, and the table still meets all four
properties.

## 27. The schema-guard bypass is contained by process separation, not by a flag (2026-07-27)

Migrate is the one operation that must run against a database the version guard exists to
reject, so it needs `resolve_paths.resolve_pointer(..., migrate_only=True)`. Until now that
was the stated reason migrate could not be a tool at all, and it ran E1-only. It is now
`matter_data__migrate`, and the containment is **architectural**:

- The bypass is a hardcoded literal at exactly one call site (`references/scripts/migrate_engine.py`,
  `resolve()`), never derived from tool input. No argument to `matter_data__migrate` can flip it.
- `matter_data__query`/`matter_data__execute` run in a **separate spawn** whose pointer resolver is
  embedded in `source/lawyer/mcp/src/case/backend.ts` and takes one positional argument. Since
  #186 its source is `LOCATE_PY` in `source/lawyer/mcp/src/case/locate.ts`, which the backend
  pastes into its helper and the files server runs on its own; it has no bypass either.
  There is no `migrate_only` parameter to pass — not a guarded one, none.

**Never "simplify" that backend into importing `resolve_paths`.** The duplication looks like debt
and is the safety property: it puts the bypass in a different process from the read/write path
rather than one keyword argument away from it. If the two resolvers must ever converge, the
convergence has to preserve that separation or replace it with something at least as strong.

**The location search converged that way (2026-10-27, #177).** `references/scripts/case_data_resolver.py`
holds `resolve_case_data_dir` and its helpers, and nothing else: no pointer write, no schema guard, no
bypass. `resolve_paths.py` imports it, and the data server's build pastes its text into the backend's
embedded helper (`source/lawyer/mcp/scripts/resolver.mjs`), which refuses a file that defines
`resolve_pointer`, takes `migrate_only` or imports `resolve_paths`. The backend still imports nothing
from the skill tree at run time, and its pointer read and schema guard stay hand-ported (the
pointer read in `source/lawyer/mcp/src/case/locate.ts` since #186, which pastes the same text ahead of it).

**The E1-only rule that preceded this was stale reasoning, and it is worth saying why.** It read as
a FUSE-staleness rule, but `operations/migrate.md` never actually claimed that — it cited two
API-shape gaps (no guard bypass; extending the contract was out of scope). The staleness hazard had
already been removed for every other database path by the permission-fatigue conversion, because it
is a property of **where the file I/O happens**, not of which environment the model is chatting in.
Once the I/O is host-side, a Cowork session and a local session are the same call.

**The carve-out runs in-temp, not through `rebuild.py --migrate`.** `migrate_engine` imports
`rebuild` and calls `upgrade_74_to_75` / `upgrade_75_to_76` directly on its own staging area. The
CLI path was rejected: it resolves its own pointer, requires `evidence.sql` to be overwritten with a
v7.4 dump first — destroying the durable text record of the pre-migration state (#5) — and
`os.replace`s into native files mid-chain, which forfeits all-or-nothing. Faithfully reproducing the
dump→replay round-trip inside temp was also rejected: `iterdump` is strictly **lossier** than a
staged binary (it drops implicit rowids on composite-PK tables and `user_version`), and the row
re-validation the replay would provide happens anyway, since both upgrade functions `INSERT … SELECT`
through the new CHECKs. Consequence: those two functions are now a **public interface** of
`references/scripts/`, not private CLI internals. They must stay pure in-temp transforms over a
`{main, law, privileged}` path dict — reading no pointer, no `evidence.sql`, no native file.

**Model-tier routing is instructional, not technical.** `migrate.md` routes the operation through the
`migration-runner` subagent at `model: opus`, but an MCP server cannot verify which model issued a
call, and the docs say so. What actually holds is the tool's own gate: a content-addressed plan
token (invalidated by any change to the databases, the reference SQL, or `rebuild.py`), the echoed
confirmation string, a hash-verified host-local backup, and same-volume rename replacement with
rollback copies pre-staged. Design so a weak model that ignores the routing still cannot do harm
beyond what the practitioner approved. The subagent's value is reviewing the plan and the
before/after evidence — not being a steadier hand on raw files.

**Backups are host-local (`%LOCALAPPDATA%\Coclerk\case-backups`), deliberately.** Putting three more
copies of privileged binaries into the SharePoint-synced tree during the exact window we want quiet
buys off-machine durability at the cost of sync traffic, conflict-copy risk, and client-visible
clutter. Restore therefore works only from the machine that ran the migration — acceptable, because
that is the machine that ran it.

## 28. Every matter-data write takes one cross-process lock (2026-07-27)

`matter_data__execute` and `matter_data__migrate` both take the same host-local lock, keyed on
`matter_root` (`source/lawyer/mcp/src/case/case-lock.ts`). Contention refuses with
`lock_unavailable` after ~2s of retries rather than queueing indefinitely.

**What it defends against.** Both writers work the same way: stage temp copies of all three
databases, mutate them, copy all three back. Two sessions that stage from the same starting
binaries both report success and the second copy-back silently discards the first's writes — no
error, no conflict, the loss visible only later as missing rows. Every Cowork/CC session spawns its
own MCP server instance, so an in-process mutex would be theatre.

**`matter_data__query` stays lock-free.** It is the hot path and copies nothing back, so it can read
a matter that is mid-migration. That is the deliberate trade: a read racing a write may see either
side of it, which is what a read without a transaction always risks, and no read can destroy a
write.

**The lock file is host-local, not in the matter directory.** A lockfile inside the synced tree
replicates with sync latency — neither a reliable mutex nor promptly released — and would surface
as a mystery file in a client document library. Cross-machine concurrency on synced storage is not
solvable by any lockfile; migrate catches it instead via the plan-token freshness check.

**Stale-break is 5 minutes, set by the longest legitimate holder** (2 minutes, `WRITE_TIMEOUT_MS`), and
a lock whose recorded process has died is free at once. Breaking a live holder's lock mid-chain is far
worse than waiting. Both writers say so in a warning rather than proceeding quietly. Changed from 15
minutes by ingest group locking (`docs/Specs/2026-11-02_ingest-group-locking-spec.md`), because several
runs now take turns on this lock.

## 29. A schema bump touches a dozen files across two languages — work the checklist

The version is not derived anywhere; it is restated in `schema.sql`, `migrations.sql`, four operation docs, five Python scripts, a test file's name and class, and a hand-ported duplicate guard inside the MCP runtime's TypeScript. `references/schema-bump.md` is the complete surface, in dependency order. Work it whole and in one commit — every guard is `version < EXPECTED_USER_VERSION` → reject, so the moment a new guard ships, every matter still on the old version fails closed until it migrates. The two most-missed surfaces are `source/lawyer/mcp/src/case/backend.ts` (its guard is a deliberate duplicate — see #27 — which therefore never inherits a change to `resolve_paths.py`) and the `source/lawyer/mcp/test/case-tools.db.test.mjs` boundary pins that go with it.

**The same rule governs the separate application schema (`application_state.SCHEMA_VERSION`), plus one of its own: a bump adds its own predecessor to `MIGRATION_SOURCE_SCHEMA_VERSIONS` as an explicit literal.** That set was `{1, 2, SCHEMA_VERSION}` until 2026-07-29, so the 8 → 9 bump silently turned it into `{1, 2, 9}` — dropping the schema-8 source path before anyone wrote one, and it would have done the same to 9 on the next bump. Never put `SCHEMA_VERSION` in that set.

**Application-pipeline retirement note (2026-08-27, #374).** The `application_state.py` schema, its `applications.sqlite` database, and the `application_state__*`/`application_engine__*` MCP namespaces described in the decisions below retired along with `/prepare-application` and `/responding-to-applications`. These entries are left as historical record of decisions made while that schema was live; they are not maintained further, and any file or tool path they name may no longer exist.

## 30. report_context is a sanctioned in-tree read-only consumer of main/law (2026-07-28)

`application_state.py` carries one operation — `matter_data__application_report_context`, reachable
only server-side from the draft-application path in source/lawyer/mcp/src/application/engine.ts (deleted, #374)
— that reads `main.sqlite` and `law.sqlite` directly. It assembles the live case-context the
show-don't-tell Draft Application renders: style of proceeding, party roster, referenced fact
statements with posture, and law-side noting-up currency. The boundary holds because of **what
reaches model context, not which process opens the file**: the operation returns assembled,
path-free content; database names, locations, and schema never surface in model-visible output
(this is the point of the gatekeeping — models that see database particulars rationalize direct
access; deterministic in-tree scripts are what the gate exists to route through).

Its read discipline, all deliberate:

- **Temp-staged copies only** (staging discipline, decision above resolve_paths' design note) —
  never a live handle on synced storage.
- **No lock** (#28's rationale: a read cannot destroy a write; same as `matter_data__query`).
- **No temp triggers** (#12's triggers are write guards; this path never writes).
- **Version-guarded via `resolve_paths.EXPECTED_USER_VERSION`**, imported lazily from
  `references/scripts/` so the version is never restated (#29's most-missed surface).
- **`privileged.sqlite` is never opened.** Nothing the report needs lives there; theorized facts
  were ordinary `main.facts` rows (#23) when this was written, and are bare rows since #67.
- **Fail-visible, per section**: a missing/old-version database degrades to
  `{"available": false, "reason": ...}` and the renderer prints an explicit unavailable
  placeholder — never a silently empty section.
- **Deliberately absent from the capabilities roster**: the roster and the MCP tool surface are
  pinned to each other by the Node contract test, and report_context is not a model-facing tool.
  The features flag `readiness_report_context` is the capability signal.

This is a **read-only** exemption in the spirit of #21 (research-agent's query grant): it adds no
writer, no SQL outside the matter-data tree, and no new model-facing surface. Any future operation
wanting the same direct-read pattern needs its own entry here first.

## 31. A citation is stored in parts, never as an assembled string (application schema 9, 2026-07-29)

Authority citations live as separate fields on both tables that hold them, and the readiness report
**formats** them. It used to **parse** them: a regex split a single freehand worker-authored label
(`SCCR Rule 1-1(1) — definition of "document" (B.C. Reg. 168/2009)`) back into instrument, pinpoint,
and proposition, and expanded a three-entry abbreviation map. The regex is gone
(`_format_authority_citation` in `requirement_readiness_sections.py` replaced `_parse_authority_label`).

**Why a parse could never be made correct**, which is the part worth keeping: the italics rule is
kind-dependent, and a single string does not carry the kind. A case italicizes the style of cause
only (`*Tekk Enterprises v. Acme Co.*, 2024 BCCA 118`), legislation the instrument name only, and
`other_primary` — a research memo — nothing at all. The pinpoint also changes sides: it follows the
cite for a case, precedes it for legislation (`*Supreme Court Civil Rules*, r. 7-1(1), B.C. Reg.
168/2009`). No amount of regex hardening recovers a distinction the input never encoded.

**The field names are deliberately identical on both tables** — `authority_kind`, `proposition`,
`authority_title` (the italicized element), `authority_cite` (the roman remainder), `pinpoint` — so
one formatter serves both consumers. `authority_integrity_observations` already carried three of the
five and only needed `authority_title`/`authority_cite`; `candidate_content` needed all five, because
a researched authority exists as candidate content long before any integrity observation verifies it,
and §4 renders it in that window.

- **`pinpoint` carries its own label as written** (`r. 7-1(1)`, `para 31`, `s. 8`). The renderer
  synthesizes no prefix. The old parser stored a bare `1-1(1)` and prepended `r. `, which silently
  assumed every authority was a rule.
- **`authority_label` is kept and is not redundant.** It stays the freehand work label the
  practitioner picked the authority out by. It is never parsed. Deleting it in favour of the parts
  would lose the practitioner's own handle on the item.
- **The five columns on `candidate_content` are nullable and sparse**, NULL for every other content
  type, rather than a sibling table or a JSON blob. Per-type tables are refused on #13's reasoning; a
  JSON blob would put schema inside a column, which is the thing being fixed. They are mirrored on
  `candidate_content_versions` so the history is not lossy — with one dated exception: rows migrated
  from schema 8 on 2026-07-29 carry NULL parts, because back-filling them would fabricate provenance
  (see the migration decisions below).
- **The content_type-to-field coupling is enforced in Python, not by a CHECK.** `_upsert_content`
  fails both ways — an `authority_excerpt` missing its parts, and the parts on any other type — and
  names the offending fields (`invalid_authority_content` / `invalid_content`). A CHECK would raise
  an opaque `IntegrityError`. Only the kind enum is schema-level, because that alone is a categorical
  invariant (see the closing principle). The same rule is restated in
  source/lawyer/mcp/src/application/change-payloads.ts (deleted, #374) for the reason that
  module existed at all: to fail before the worker is discarded, not after.
- **The parts join the no-op short-circuit.** `_upsert_content` skips a byte-identical re-upsert, and
  the citation parts are compared alongside the other five columns — otherwise a corrected pinpoint
  with an unchanged body would be silently dropped.

**A v8 → v9 migration now exists (2026-07-29). The no-migration decision was reversed, not
forgotten.** The original entry said `SCHEMA_VERSION` went 8 → 9 with `_migrate_schema` left alone,
because `CREATE TABLE IF NOT EXISTS` cannot add columns to an existing table and a schema-8 matter
should simply reinitialize — the correct pre-alpha posture (user global CLAUDE.md: no user data, no
migration scripts). That premise **failed for this schema space** on 2026-07-29, when matter L8443
was found holding live schema-8 application state. The `IF NOT EXISTS` fact stands and is answered
by DDL-rebuild: the migration drops the three widened tables, calls `_create_schema` once, and
reinserts every row carrying explicit primary keys and `sequence` values. The repo has crossed this
bridge before — the main chain's rebuild-only posture (#24) yielded to `matter_data__migrate` with
real upgrade functions once live matters existed (#27). This is that precedent, not an exception to
it. The scoped exception is recorded here; it does not edit the global rule.

Two facts made it close to forced. A v8 database is unreadable through the **entire** tool surface —
every path runs `_guard_initialized` → `_require_schema_version`, and `_capabilities` deliberately
raises rather than report a v8 matter as healthy — so nothing can even inventory one, which is why
the dry run is load-bearing rather than gold-plating. And the only pre-existing alternative destroys
canonical state: `_preserve_and_reinitialize` requires a legacy `state.json` root; it is the
legacy-import path, not a general schema-N escape hatch.

Three decisions inside the migration are load-bearing:

- **`observation_fingerprint` is preserved, never recomputed.** Schema 9 silently widened the
  formula: `_normalize_authority_integrity_observation` added `authority_title` to the
  required-string loop and now sets `authority_cite`, both of which `_upsert_authority_integrity_observation`
  hashes. A migrated row's stored fingerprint is therefore not reproducible under schema-9 code.
  Recomputing is not merely identity-rotating, it is breaking: `authority_links_current` compares
  each legal-basis observation's *recorded* authority fingerprints against the *stored* authority-row
  values, so rotating the stored side flips it false for every linked observation →
  "Linked authority observations changed" → `legal_basis_satisfied` false → the disclosed projection
  refuses. The matter would exit migration needing full worker re-verification of every legal basis.
  Nothing anywhere recomputes it from a row — every consumer treats it as an opaque token compared
  against a recorded snapshot. **Recorded cost:** migrated rows carry fingerprints the current
  formula cannot reproduce until each observation is next legitimately re-upserted, so a future audit
  path that ever recomputes will see them as tampered. That is why the migration writes the affected
  `observation_id`s into `audit_events`. `candidate_content.fingerprint` has no equivalent drift — it
  is caller-supplied.
- **The observation mapping rejects `authority_kind`, `proposition` and `pinpoint` as extra keys.**
  They already exist NOT NULL at schema 8, and since nothing recomputes the fingerprint, a
  mapping-supplied rewrite of a hashed field would be permanently undetectable.
- **Historical `candidate_content_versions` rows migrate with NULL parts, and no synthetic version
  row is appended.** Injecting today's practitioner parts into older rows fabricates provenance; NULL
  is honest and legal. A synthetic row was considered and rejected as affirmatively hazardous: the
  protected-floor lookup takes `ORDER BY sequence DESC LIMIT 1` on `(content_id, content_fingerprint)`,
  so a synthetic row sharing the fingerprint would *shadow* the genuine latest version, and every
  legitimate append is paired with a `content_classification_events` insert the migration would have
  to skip or fabricate. Provenance goes to `audit_events` instead. This is the dated exception to the
  "mirrored on `candidate_content_versions` so the history is not lossy" sentence above.

The contract itself — the four recognized source versions, the dry run, the fingerprint
compare-and-swap and its threat model, and the exact mapping shape — lived in
operations/application-state.md, which retired with the rest of the application pipeline
(2026-08-27, #374).

## 32. The legal spine is additive, and its two derived columns stay out of the fingerprints (application schema 10, 2026-08-03)

Schema 10 separates the entities the domain model draws — statement, excerpt, pinpoint, authority — which until now were flattened into one `authority_integrity_observations` row each (a rule resting on two passages of one case needed two rows, and no excerpt could be shared). Four new tables carry it: `statements`, `statement_test_parts`, `excerpts`, `statement_excerpts`.

**It is additive, deliberately.** The legacy `proposition`/`pinpoint`/`excerpt` columns and `components_json` stay populated and authoritative; the engine still reads them. Phase 1 of the gap-review refactor lands the schema and the migration only, so the phase leaves the suite green and the derivation switch is a separate, reviewable change. Do not read this as a half-finished cutover — the coexistence window is the design.

**`authority_tier` and `basis_kind` are derived, stored, CHECK-pinned, and outside the hashes.** Each is a pure function of a column that already exists (`authority_kind`, `criterion`). Storing them makes a tier query a filter rather than a Python-side map inside SQL; the CHECK pins the pairing so the two can never drift, which is what earns them a place despite decision #9's derived-never-stored posture. Keeping them **out of `observation_fingerprint`** is the load-bearing part: both fingerprint payloads are built as `{key: normalized[key] for key in sorted(normalized)}`, so a field added to `normalized` is hashed automatically. Folding in a derived column would rotate every stored token, flip `authority_links_current` false for every linked observation, and force full worker re-verification of every legal basis — decision #31's hazard, for zero information gain. They are therefore set on the row dict *after* the fingerprint payload is built. Never move them into `normalized`.

**Components become statements; observations become excerpts.** The plan's phrase "each flattened observation becomes one statement plus one excerpt" resolves this way because a legal-basis component already *is* the statement node in all but name — it carries a proposition and links to several authority observations — and because the statement kind is specified to come from "its criterion's legacy component kind", which only a component has. Mapping observations 1:1 to statements would instead mint N statements for what the model calls one, perpetuating the very flattening the refactor removes. `statements.source_component_id` records the correspondence in the data, not only in the receipt, so the coexistence window is navigable.

**An unlinked observation gets an excerpt and no statement.** `statements.basis_observation_id` is NOT NULL, so a statement for an observation no component links would need a fabricated basis. Its proposition is still on the legacy row, which this migration does not clear, and the identifier is reported in both the dry run and the receipt. Silence would have been the wrong answer; invention would have been worse.

**No SQL functions in CHECK constraints — ever.** `proposition TEXT NOT NULL CHECK (proposition <> '')` is written that way because the recovery-dump replay (`_execute_recovery_dump`) installs an authorizer that denies `SQLITE_FUNCTION`. `CHECK (length(trim(proposition)) > 0)` passes every test that does not rebuild and fails `rebuild_from_dump` with `not authorized to use function: length`. The Python write path strips before the value reaches the column, so the comparison is sufficient.

**`_rebuild_into_current_schema` is shared by both migration paths on purpose.** `_create_schema` only ever emits the *current* DDL, so a migration starting from any version must satisfy today's columns — the schema-8 path broke the moment schema 10 landed, because its reinserts filled only the columns schema 9 introduced. A future bump that widens a table must extend that one helper, not add a second reinsert loop. The schema-8 path therefore also builds the spine: a schema-8 database already holds everything the spine derives from, and landing a matter at the current version with the new tables empty would be a silent hole.

## 33. A Python enum and its CHECK constraint are one decision in two places (application schema 12, 2026-08-03)

`PRIMARY_SOURCE_STATUSES` accepted `{verified, not_primary, validation_unavailable}` while the `authority_integrity_observations` CHECK allowed only two of them. `not_primary` therefore passed `_normalize_authority_integrity_observation`, passed `application_engine__validate_operation_result` (`change-payloads.ts` types the field as a bare string), and then died at the INSERT with a bare `sqlite3.IntegrityError`. Schema 12 widens the CHECK; the value was always the correct one, since a textbook cannot honestly be recorded as primary authority and `change-payloads.md` instructs workers to emit it.

**The failure mode is the point, not the typo.** source/lawyer/mcp/src/application/state.ts (deleted, #374) caught `ApplicationStateError` and returned its named code; every other exception becomes `internal_error` / "Unexpected application-state driver failure". So a business-rule violation is legible and a constraint violation is not — this one surfaced as an apparent backend fault, and a live session spent a subagent and ~230k tokens inventing a missing-practitioner-checkpoint precondition to explain it before the real cause was found. **Read a bare `internal_error` from this surface as an unhandled host exception, never as a business rule.**

**The invariant, stated once so it is checkable:** every `*_STATUSES` set in this file and the CHECK on the column it guards are one decision written twice, and they must be compared whenever either moves. At the time of writing the four sibling columns (`excerpt_status`, `treatment_status`, `statutory_currency_status`, `jurisdiction_status`) all agree with their enums; only this one had drifted. Widening a Python enum without its CHECK is not a lenient failure — it is an opaque one, and it clears every gate before it fails.

**Why the regression test did not exist.** `test_authority_integrity.py` already supplied `not_primary`, but only paired with a *satisfied* `primary_authority` adjudication, which fails at `authority_integrity_adjudication_mismatch` before any write. The value never reached the INSERT. The added test pairs it with the honest `unsatisfied` adjudication so the row is actually stored; it fails with the original `IntegrityError` when the CHECK is reverted. A test that exercises a value only on a path that rejects it early is not coverage of that value.

**The migration is the emptiest one this schema has had, deliberately.** SQLite cannot alter a CHECK in place, so `_migrate_eleven_to_twelve` recreates the table through the shared `_rebuild_into_current_schema` — no column changes, no value changes, no fingerprint recomputation, nothing asked of the practitioner. `SCHEMA_ELEVEN_COLUMNS` is frozen as a literal even though it equals the current shape today, for the reason #29 gives: the next bump that widens this table would otherwise silently retarget this migration's guard at a shape it was never written against.

## 34. Entitlement is its own content class because four of its five proof kinds are not evidence (application schema 13, 2026-08-03)

> **Vocabulary note (2026-08-06).** What this section calls an *entitlement condition* is, in practitioner-facing language, a **Ground** — see prepare-application's glossary (retired 2026-08-27, #374). The canonical-state names below (`order_entitlement_observations`, `ORDER_ENTITLEMENT_*`, `order_entitlement_criterion`, `verify_order_entitlement`, the `conditions`/`proof` criterion keys) are **unchanged and still accurate**; they are scheduled for a Layer 2 rename that has not happened. This section deliberately keeps describing the schema as it is.

`order_entitlement_observations` holds, per order sought on the desk-order track, the conditions that entitle the applicant to the order and each condition's proof *reference*. The obvious cheaper design — carry them as `material_facts` and `evidence_uses` inside `order_facts_evidence_observations` — was the standing default and was overturned on the evidence, recorded in `Engineering/decisions/2026-08-03_desk-order-D4-D5.md` part 3.

**The premise that killed reuse.** `evidence_uses` carries no source kind at all: its payload is a closed 12-field set and every use is document-bound, validated against a canonical tracked document. There is no way to record "proved by the registry file" — only "proved by tracked document X, sworn or not". The renderer's `court_record` label is real but comes from the live matter-data context at render time; it is display enrichment of a resolved fact, not part of any observation, not fingerprinted, not adjudicable, and not writable by any change payload. And `_order_facts_evidence_mechanical_gate` hard-codes the hearing-track evidentiary model: `sworn_evidence` may be `satisfied` only if **every** material fact has a sworn use. That gate is exactly right for a chambers application and exactly wrong for an entitlement spine whose settled law says the proof kinds are several, only one of which is sworn.

**Score the reuse honestly and it fails.** Of the seven default-judgment conditions, two (proof of service, proof of non-service of a response) fit the incumbent natively — and they still ride it. Four cannot be carried without a fabricated `evidence_uses` row, a proof that does not exist at preparation time, or an assessment that blocks forever: the response period expiring is registry arithmetic nobody swears to; the registrar's endorsement is produced by the registry at filing; the draft order is a deliverable, not proof; and whether the claim falls within a given subrule is a characterisation of the applicant's own pleading. One (the composite "no response filed and served") is only its parts.

**The seam, drawn once.** The new class holds the condition list and each condition's proof reference, and **never re-models evidence**. A `sworn_evidence` condition names an existing `evidence_uses` entry and copies the facts-evidence observation's fingerprint as a caller-supplied assertion, so a re-sworn affidavit surfaces as drift on the condition row rather than going silently stale; every other `proof_kind` must name no evidence use at all, and the normalizer refuses one that does. `ORDER_ENTITLEMENT_DOWNSTREAM_PROOF_KINDS` — `registry_endorsement` and `document_to_be_produced` — is the one place the model says "somebody else supplies this later", and it is what lets `proof` be satisfied without lying. A `pending` condition of any other kind blocks.

**The middle path is rejected, and an implementer re-proposing it should read why first.** Adding a `proof_kind` to `evidence_uses` and relaxing the gate per kind is not reuse; it is a rewrite of the incumbent's invariants under reuse's name. It would make the same four blocking legal-integrity criteria mean different things on different tracks — the fork the "one readiness derivation, two document projections" rule forbids, relocated into the reducer where it is hardest to see — and it would widen every `set(x) != FIELDS` contract track-conditionally, turning categorical checks into conditional ones. It saves nothing: the same change-payload mirror, bundle rebuild, reducer work and catalogue bump, plus the semantic contamination.

**Decision #13 does not apply and #26 is satisfied.** #13 refuses splitting one kind of thing by subtype; an entitlement condition is not a subtype of a facts-evidence observation — different categorical invariant (heterogeneous proof kinds, including proof that does not yet exist), different producer, different projection target. The class computes its own fingerprint over its own payload with the same `{key: normalized[key] for key in sorted(normalized)}` pattern, adds no field to any existing `normalized` payload, and therefore rotates no stored token and forces no worker re-verification (#31/#32).

**The `requirements` widening is why the migration exists at all.** The new table arrives on its own through `CREATE TABLE IF NOT EXISTS`; the new `order_entitlement_criterion` column on `requirements` does not, so `_migrate_twelve_to_thirteen` goes through the shared `_rebuild_into_current_schema` per #32. That helper now reads and reinserts `requirements` itself rather than taking them as a parameter — those rows need no transformation, so threading them through five callers would be five copies of one `SELECT` — and it raises rather than proceeding if a rebuild would drop a stored column. `SCHEMA_TWELVE_COLUMNS` is frozen as a literal, same reason as its three predecessors.

**Entitlement shares the `supporting_evidence` work family, so that family alone dispatches by operation.** `verify_order_entitlement` and `verify_order_facts_and_evidence` are both the order's supporting material and both fit the family's resource contract, so `requirement_operations` selects the input and change normalizer on `ORDER_ENTITLEMENT_OPERATION` rather than on the family name. Conditions ride inside the one observation, so the change count is fixed at one observation plus two adjudications however many conditions an order type turns on: `maximum_changes: 8` was checked against a seven-condition order and left alone deliberately — the byte budget, not the change count, is the limit that would ever bind.

## 35. A computed figure is its own content class, and its proof enum is closed at two (application schema 14, 2026-08-05)

`order_computation_observations` holds, per order sought on the desk-order track, each computed figure with the inputs it rests on, the proof of each input, and the steps that derive it. It exists because a default-judgment sum was built by continuing from a prior firm memo's closing balance over a rate history taken from that memo and the open web: every figure arguably correct, none of it evidence, and **no canonical state anywhere could say so** — the figures rode into a filed package through a loosely-gated `snapshot_slice` and a hand-written memo nothing tracked.

**Why not `material_facts`.** The obvious reuse — carry each input as a material fact with a sworn evidence use — fails on the same premise that killed reuse for entitlement (#34), one step further along. The dominant input on this route is a figure **proved by the pleaded words themselves**, and `evidence_uses` is document-bound with no shape for that: recording a pleaded figure as a sworn use would be a data lie, and recording it as an unsworn one would trip `_order_facts_evidence_mechanical_gate`, which requires every material fact to carry a sworn use before `sworn_evidence` can be satisfied. A computed figure is also not a fact: it is a *derivation over* facts, and the thing that needs adjudicating is whether the derivation closes over proven inputs.

**The enum is closed at `{pleaded, sworn_evidence}` and there is deliberately no `unproven`.** An input fitting neither shape has no legal shape on a desk order, so the normalizer refuses the whole observation — fail closed, never label. A third value would let an unproven input be *recorded*, and anything recorded gets reasoned past. The field is `proof_kind` and never `basis`: **Basis** is a practitioner-facing legal-spine term (`GLOSSARY.md`, `BASIS_KINDS`, `basis_observation_id`, schema-10's CHECK-pinned `basis_kind`), and giving that word a second meaning is exactly the retired-**Component** defect. It shares its name with `ORDER_ENTITLEMENT_PROOF_KINDS` and differs in value set, like the sibling `*_STATUSES` enums; `pleaded` is deliberately not entitlement's `characterisation`, which is a *condition about* the pleading rather than a value taken from it.

**The arithmetic is not re-derived, and that is the decision.** The normalizers check structure — inputs declared, every step consuming only declared inputs or its own earlier steps, `result_value` byte-equal to the last step's output — and leave the numbers alone. Re-deriving decimal arithmetic in the reducer would be a second implementation that can disagree with the first, and a disagreement between two implementations of one sum is worse than no check. `consumes` may name an earlier step precisely so a compounding calculation is expressible without an undeclared figure entering through the side.

**`no_computed_figures` is the empty case, and the next reader must not "fix" it.** An order stating no computed figure is the common case, and it may be adjudicated `satisfied` on both criteria — but only through a present observation whose `no_computed_figures: true` affirmatively records that judgment. The gate refuses satisfaction-on-empty without it, and refuses the flag alongside recorded computations.

This is **not** commit `0088d95`'s defect rebuilt. There the criteria were *absent from state* — nothing instantiated, nothing adjudicated, a vacuous `all()` over rows that did not exist. Here the criteria always instantiate, block at `unresolved` until the operation runs, and satisfaction-on-empty is a recorded, fingerprint-bound judgment. Two alternatives were considered and rejected: **conditional instantiation** would give the inert `applicability` metadata a reader it has never had and rebuild `0088d95`'s illegible-absence shape as a feature; **`filing_contribution: none`** would let an unproven figure reach a filed order, which is the failure the class exists to stop.

**Known residual, stated so it is not rediscovered as a hole:** nothing mechanical can detect that a dollar amount inside `rendered_wording` *is* computed — a pleaded "$135,369.14" and a derived "$167,475.02" are indistinguishable bytes. The empty-case judgment is therefore the operation's, checked by the sweep's presence tests and ultimately by the practitioner at order approval. A wording-parsing heuristic was considered and rejected: it would be a statement about the record made in code, the same defect as the subrule classifier `draft-requisition.md` forbids.

**The seam and the costs are #34's exactly.** A `sworn_evidence` input names an existing `evidence_uses` entry and copies the facts-evidence observation's fingerprint as a caller-supplied assertion, so a re-sworn affidavit surfaces as drift rather than going stale; a `pleaded` input must name no evidence use, and the normalizer refuses one that does. The class computes its own fingerprint over its own payload with the same `{key: normalized[key] for key in sorted(normalized)}` pattern, **adds no field to any existing `normalized` payload**, and therefore rotates no stored token and forces no worker re-verification (#31/#32). It is the third operation of the `supporting_evidence` family — that family already dispatches normalizers by operation rather than family name, which is what makes a third operation the sanctioned extension shape rather than a new family. The `requirements` widening (`order_computation_criterion`) is again why a migration exists at all: the new table arrives through `CREATE TABLE IF NOT EXISTS`, the new column does not, so `_migrate_thirteen_to_fourteen` goes through `_rebuild_into_current_schema` per #32, and `SCHEMA_THIRTEEN_COLUMNS` is frozen as a literal for #29's reason.

**What the practitioner feels, and it is intended.** Both criteria are mandatory, so at the first catalogue reconcile every existing desk-order application becomes ineligible to file until `verify_order_computation` has run once per order — including orders with no computed figure. An application that filed under the pre-`0088d95` vacuum is exactly the one that should re-earn eligibility. Reconciliation fires on catalogue drift, never pre-emptively; say so in the leg where it happens rather than letting changed eligibility appear unexplained.

## 36. Order effects are HITL-gated, diff-based, and audit-marked (2026-08-09)

`operations/order-effects.md` is the **third** sanctioned writer of proceeding-level rows (`ingest-extract` inserts them at initialize/ingest time; `review` adjusts verification state). It exists because ingesting an order registered the source, its facts, and its evidence links correctly and left `parties.name` and `proceedings.style_of_cause` stale — the order *corrected the misspelled defendant names*, and nothing in the pipeline read its operative terms and asked what stored rows those terms had changed. The mismatch surfaced as an ad-hoc chat remark, not as a step anything would run again.

**The gate is the design, not a safety margin.** No write happens without per-proposal practitioner approval — auto mode, batch ingests, and "bias toward not stopping" instructions do not waive it. This is #22's register (*script computes, agent perceives, human decides*) applied to a surface where the agent, not a script, does the computing; the approval is what makes that acceptable. An implementer who "optimizes away" the stop for obvious cases has removed the feature and kept its cost.

**Diff, not a rule table.** The space of orders is open-ended — amend a style of cause, extend a trial, add or remove a party, grant a lawyer's withdrawal, stay, discontinue, transfer registry. An enumerated rule table would be permanently incomplete and would fail silently at exactly the orders nobody anticipated. Comparing operative terms to live values has no such tail, and it buys idempotency for free: a re-presented order re-diffs to empty and never interrupts (which is why `ingest-verify` carries the pointer too, and why the pass runs *after* the document transaction commits rather than inside it — the source and its facts stay durable whether or not the effects pass completes). Step 1 also fires on a Rule 22-6 counsel-change notice: not an order, but it changes counsel of record, already on the surface.

**The writable surface is closed by enumeration, and it is small on purpose.** `proceedings` (five fields), `parties` (nine fields since v8.9), `proceeding_parties` (INSERT/DELETE, and since v8.9 its six per-proceeding override fields, #55). Every other effect of an order is already captured as facts, positions, relief, and source references by ordinary extraction and is report-only here. Widening this surface is a decision that belongs in this file, not in the operation.

**`human_reviewed` and `verified` do not reach this surface, and no column should be added to make them.** None of the three tables carries either column, so #18's lawyer-confirmed-row protection has nothing to protect and #6's verification pipeline has nothing to pipeline. The plan for this feature specified a "lawyer-confirmed row" flag in the proposal table; it was dropped as a rule that could never fire. The approval collected at the gate *is* the human judgment for every row this pass touches — that is the whole reason the surface can be written without the verification machinery the fact/position tables need.

**The audit trail is a `source_references` row, uniformly.** For the same reason — no `notes` column anywhere on the surface — every applied change writes one `main.source_references` row (`reference_type = 'procedural'`, `source_id` = the order, `source_locator` = the operative term) whose `description` carries the `ORDER-EFFECT:` marker. This is a **new marker family**, sibling to #22's `[MERGED-INTO:]`, and the conventions §5 prefix rule does not apply to it: it must never route anything to a review queue. The row is written `verified = 1` because the practitioner personally approved its content, which is exactly what conventions §4 value `1` means.

**Deadline arithmetic delegates, always.** An order changing a trial date proposes the `trial_date` field and then recommends the `lawyer:docket-clerk` agent, which owns anchor extraction and cascade recalculation. A second implementation of deadline arithmetic living inside matter-data would be a second thing to keep correct, and the two would disagree.

## 37. Experts are witnesses; client instructions are privileged and bitemporal (v7.8)

Experts are modeled as the `expert` subtype of `main.witnesses`, rather than a parallel entity, because both fact and expert witnesses are evidentiary actors assigned to proceedings and differ only by expert-specific attributes such as field, retainer, report, and qualification.

Client instructions live only in `privileged.client_instructions`, with current/history rows linked by `prior_id`, because the instruction itself is core solicitor-client privileged material and later changes must preserve an auditable temporal record without leaking its content into `main.sqlite`.

## 38. Order approval is a Boolean work authorization (2026-08-13)

Every tracked candidate order has exactly one practitioner-controlled Boolean
`approved` value. Approval authorizes legal research and fact/evidence
marshalling; it does not approve wording, decide final filing inclusion, or
create a task. Wording edits preserve approval. `remove_candidate_order` is the
only transition to the null, untracked state, and `reorder_candidate_orders`
controls the shared display order.

Catalogue reconciliation instantiates tracked order scopes independently of
approval. This keeps the state model complete without interpreting why the
practitioner has or has not authorized work. Working drafts show every tracked
order: approved orders are numbered, while not-approved orders are unnumbered
and marked 🤔. Filing-ready projections include approved orders only.

## 39. An admission is a proof instrument, not a stance (v8.1, 2026-08-16)

`main.admissions` holds the admissions that establish a fact without the fact's own
sworn evidence. It is the data layer under `prepare-application`'s admitted-proof
route, and it is a **new table rather than a widening of `positions`** — a fork that
is settled, not open.

**Why not `positions`.** #25 states that positions are on-record stances bound to a
responding source and locator, and that "actual silence is represented by no row." A
deemed admission is a *legal consequence of silence*, never an assertion the admitting
party made: nobody says anything, a response period expires, and the pleaded facts are
taken as admitted. Minting an `admit` position row for that would fabricate a stance
the party never took — precisely the defect #8 forbids when it refuses to split a
qualified admission into a denial the party never made. Positions answer *what did this
party say*; admissions answer *what may we now prove without swearing to it*. Both
questions are real, and one table cannot answer both honestly.

**Six kinds, and only four of them are coverage.** `express_pleading`,
`express_notice_to_admit`, `deemed_default` and `deemed_rule_7_7` need neither
swornness nor directness and qualify the unsworn route. `express_other`
(correspondence, counsel in court, an admission to a witness) and `discovery` are
**provenance-only instruments**: they are recorded so an application can cite them,
but they reach coverage only through a sworn evidence use that exhibits or deposes to
them, with the hearsay excused by the admissions exception. `@query_25_admitted_facts`
computes that distinction as `route_qualifying`; it is mechanical, never worker
judgment.

**`deemed_default` is not a Rule 7-7 mechanism, and the two must never be conflated.**
R. 7-7(1) permits a notice to admit only "in an action in which a response to civil
claim has been filed", and only against a "party of record" — a person who has filed a
pleading, petition or response to petition (R. 1-1). Every Rule 7-7 path is therefore
structurally closed against a defaulting defendant. Facts deemed admitted by a
defendant's default are `deemed_default`, whose basis is the distinct deeming-by-default
doctrine (verified 2026-08-16 as to the Rule 7-7 exclusion; the deeming doctrine itself
is a practitioner-supplied premise whose pinpoint is still open).

**Deemed kinds require both an instrument and an effective date**, enforced by a
table-level CHECK. A deemed admission arises from a served instrument plus a non-event,
so a row with no traceable instrument is unprovable — the recording mirror of the sworn
route's document binding. Withdrawal closes `valid_to` and happens **by consent or with
leave of the court** (R. 7-7(5)) — model and render both; leave alone is wrong.

**`qualification` is here for #8's reason, and it is disqualifying by construction.**
It holds verbatim limiting language, never commentary. A qualified admission never
satisfies a proof route mechanically; relying on one requires an explicit recorded
reason addressing why the limit does not touch the fact as pleaded, and the
qualification renders verbatim.

**All foreign keys are main-side**, so this adds no cross-database trigger pair (#12
stays at nine). The table is purely additive — no backfill, and a matter that never
records an admission is indistinguishable from its v8.0 self.

**The Codex host stays at v7.8 and does not get this table.** `references/schema.sql`
and `references/queries.sql` are host variants for exactly this reason, and the shared
application engine validates the *envelope*, never this table — so a Codex matter simply
never populates an admission use and behaves as it does today.

## 40. Renderer-assigned ordinals are the locator-stability mechanism for docx/eml; `.msg` stays out; attachments are report-only (issue #282)

Fact extraction was `.pdf`-only, with the `.pdf`-only candidate filter duplicated across three files. Litigation matter folders routinely hold `.docx`/`.eml` correspondence the pipeline could never see. `references/scripts/render_document.py` renders a `.docx` (`zipfile` + `xml.etree` over `word/document.xml`) or an `.eml` (the `email` package) to deterministic plain text in OS temp, never the matter tree, with the original `file_path`/`file_hash` preserved on the stored rows — the same shape as the pre-existing RTF-conversion rule in `operations/ingest-extract.md` Path D.

**Renderer-assigned ordinals are the locator-stability mechanism.** `¶N` is assigned by the renderer from document order, not computed by the subagent — that is what keeps fact dedup by `(source, locator, description)` stable across re-extraction of byte-identical input, and what makes `ingest-verify.md`'s re-render-and-re-resolve sound: the verifier re-renders fresh every time rather than trusting a cached rendering, so a stored `¶N` is only ever trusted after it re-resolves against a fresh render of the current bytes. **Corollary: Word automatic numbering is deliberately not resolved.** Only literal run text (`w:t`) is rendered; `w:numPr` (resolved through `numbering.xml`, abstract definitions, level overrides, restarts) is out of scope for v1. A hand-rolled numbering resolver risks emitting a *wrong* paragraph number, and a wrong `para. N` cited to the court is strictly worse than a stable, honestly-unnumbered `¶N`. A numbered docx pleading whose numbers appear as literal text still earns `para. N`; one that relies on Word's auto-numbering gets `¶N` instead — still stable, still independently re-derivable, just not the number a reader sees rendered by Word.

**`.msg` is excluded, and stays excluded.** The standard library has no OLE/compound-file-binary reader — `.msg` is a binary Outlook container, not a text format `zipfile`/`email` can open. Outlook COM automation was rejected because the Cowork sandbox — where the gap was actually hit (two 2026-08-15 ingest E2E runs that also breached the stdlib-only rule by `pip install`ing packages mid-session) — cannot reach a local Outlook COM server. A hand-written CFB (compound file binary) parser was rejected for no demonstrated demand beyond the two runs that hit it; writing and maintaining a binary container parser for a format with a cheap practitioner-side workaround is not justified by two incidents. The run report names `.msg` explicitly with "save as `.eml` or PDF and re-ingest" rather than silently dropping it.

**Attachments are report-only; compound-source modelling is deliberately deferred.** For each `.eml`, attachments are enumerated — name, SHA-256, and whether that hash is already a registered `sources`/`privileged_sources.file_hash` — but never extracted or given a `sources` row of their own. The firm's filing convention already stores attachments as sibling files, so an unregistered attachment is a practitioner filing action the next scan picks up, not a gap this pipeline needs to close by inventing content it was never handed. Modelling an email and its attachments as a parent/child compound source, the way an affidavit body and its exhibits share `parent_source_id` (decision #17), was considered and rejected: no demonstrated need, and it would need a *different* parent/child semantics than the affidavit one — an attachment's hash is its own, unlike an exhibit, which shares the body's hash by construction. Do not build attachment-content extraction or a compound-source model speculatively; the trigger to revisit is a demonstrated need, not this entry's existence.

**Reversed in part by #51 (2026-09-28):** `.msg` is now ingested, and an email's attachments, `.eml` and `.msg` alike, are child sources. The ordinal mechanism above stands.

## 41. Representation provenance is two breadcrumbs on a snapshot table, and the notice path is #36's, not a new one (v8.2, 2026-08-25)

`main.parties` gains `service_address_filed_date` and `replaced_representative`. The date answers the only question the file is actually asked — *was service at time X made to the address for service then on record?* — and the replaced name is the search key into the scanned court file when a deeper dig is needed. **A full bitemporal address-for-service history was considered and rejected.** `parties` is a snapshot table with no `valid_from`/`valid_to` and no verification pipeline (#36 explains why it has neither); giving it a history table would mean a second write path, a second reader, and a second thing to keep true, to answer a question the two breadcrumbs answer for the common case. Chains of successive changes reconstruct from the court file — that is the intended cost, not an oversight. A **Notice of Withdrawal sets both fields symmetrically with an appointment**: filing date, and the withdrawing lawyer as the replaced representative, the party becoming self-represented at its Rule 4-2(7) last-known address. Withdrawal is not "no change" because no new lawyer appears.

**This extends #36; it does not supersede it.** The HITL gate, the diff-not-a-rule-table posture, the `ORDER-EFFECT:` audit row, and the closed-by-enumeration surface are all unchanged — only the trigger set and two fields moved. `order-effects.md` Step 1 now also fires on the Rule 22-6 counsel-of-record notices (`NACL`, `NOWOL`, `NOAIP`; `NOITW` excluded — an intention to withdraw changes nothing), because they change the identical proceeding-level truth an order granting withdrawal changes, with no judicial act to detect. Their writable surface is `parties` only: a unilateral filing cannot add or remove a party of record. `ORDER-EFFECT:` stays the sole marker for both instrument kinds — the description already names the instrument, so a sibling marker would buy a parsing surface and no information.

The gap this closes was found by `docs/E2E-tests/2026-08-25-0922 matter-data-e2e-test.md` Finding 4.1: two counsel-change notices sat fully extracted in `facts` for roughly twelve weeks while `parties` stayed stale, because nothing in the pipeline had a trigger for them. `NACL` ("Notice of Appointment or Change of Lawyer") did not exist in the file-naming registry and was minted for this; `NIWAL`, which appears in that matter's stored `file_path` values, is not a code and never was.

## 42. The proceeding linkage check gives `proceedings-profile` a bounded write on `main.sources`, restricted to filed documents, and a new `notes` marker family (2026-08-26)

Ingesting `5. COURT FILE #CA59991` registered its court documents but never created the CA59991 row in `main.proceedings` — nothing in the ingest pipeline checked for the gap, and a second scan's "unchanged, nothing to ingest" path re-confirmed the broken state silently, forever. `operations/proceedings-profile.md` §6/§7 close this: a linkage check reached from `ingest-extract.md` (per document) and `extract-facts.md` (every scan, unconditionally, which is what makes the check self-healing across past sessions) that detects an unregistered or unmatched proceeding and routes into the operation's existing, previously-unreached Backfill/Query+fill modes, then back-fills `main.sources.proceeding_id` on the sources that describe it.

**`proceeding_id` is reserved for what was actually filed in a court or tribunal — never correspondence, even when the correspondence names the file number.** This was not the first draft of this decision. An early version of §7 searched every still-unlinked source for a digit-normalized file-number substring match against `title`/`file_path` and put every hit to the practitioner via `AskUserQuestion`, on the theory that a confirmed correspondence match was safe to link. A live run against the matter that motivated this design (L8212, 2026-08-26) put that theory in front of the practitioner directly, and it was rejected on the spot: the search surfaced a Logica Law cover letter that does name the appeal, and two opposing-counsel letters that name neither this proceeding nor any single one — they discuss a live dispute spanning a BCSC action *and* a related VanIAC arbitration in the same breath. Correspondence relates to the **matter** as a whole, never to one proceeding specifically, and linking it to whichever proceeding happens to be under confirmation at the time would be arbitrary, not a fact about the document. §7's `UPDATE` therefore carries `AND category = 'court'` — the one routing-category value that, by its own name, connotes something filed (`extraction-protocol.md`'s vocabulary never states a filed/produced-exchanged framing in prose; this decision is the framing's one home, not a restatement of one already there) — and there is no candidate search, no elicitation, and no explicit-ID escape hatch for a non-`court` source. If a genuine need to link one is ever found, it needs its own decision recorded here first; do not reintroduce the rejected search as a shortcut.

**`PROCEEDING-CHECK: evidence-only — <reason>` is a new marker family on `main.sources.notes`, exempt from `shared/conventions.md` §5's forcing rule on its own footing.** It is neither #22's footing (`law.authorities` has no `verified` column at all) nor #36's (`ORDER-EFFECT:` lives in `source_references.description`, a different column, written `verified = 1` under practitioner approval). §5's binding rule is an **at-insert** rule for extraction-time defect prefixes on a freshly written row; this marker is **appended post-insert** to an existing row, recording a deliberate leave-unlinked decision — the linkage check's own R1 screen concluding a `category = 'court'` source is unrelated-proceeding evidence, or the practitioner picking the conflict flow's "ingest as evidence only" option — never a fresh-extraction discrepancy. It never touches `verified`; forcing `verified = 2` would misroute an already-verified source into the lawyer's queue for no reason. Two mechanics are load-bearing and must not drift: **append after any existing note content with a separator, never prepend** — `review_queue`'s `flag_type` classification matches `sources.notes` with position-anchored `LIKE 'PREFIX:%'` patterns, so prepending would silently reclassify an existing §5-prefixed discrepancy note as a bare linkage marker; and the idempotency check that skips an already-marked source matches the marker as a **substring**, so append position never breaks it.

**`proceedings-profile` gains a bounded write surface on `main.sources`: exactly `proceeding_id` and `notes`, on `category = 'court'` rows only, closed by enumeration** — never `category`, `ingestion_status`, `verified`, `file_path`, or anything else ingest-owns, and never a non-`court` row regardless of what it names. (`main.sources` already has several writers — ingest-extract, ingest-verify, extract-facts, review, the ingest-extract name-check hook — so this is not "a second writer"; the point is the narrow, enumerated boundary of what this operation may touch on a table it does not own, the same closed-surface shape #36 uses for `order-effects.md`.) Design constraint 1's ownership split — ingest writes sources, `proceedings-profile` writes proceedings/parties — stays true in spirit: this operation still writes proceeding-level *content* only through its own three tables; a `proceeding_id` back-fill is a linkage back-reference on rows ingest already created, not a second path to the same content.

**An exact-match back-fill is applied and reported, not elicited.** When R3 matches an existing proceeding's `file_number` exactly, §7 links the orphaned `category = 'court'` sources without a confirmation prompt. This is deliberate, not an oversight of constraint 2 — linking an already-confirmed proceeding to sources ingest itself created is inside ingest's own write authority, not a proceedings-table write. A one-tap confirmation could be added at negligible cost if ever preferred; it is not required by this design.

## 43. `appellant` closes a role-enum gap the BC Court of Appeal exposed; `respondent` is deliberately not disambiguated (v8.3, 2026-08-26)

A live run of the proceeding-linkage check (#42) against matter L8212's BC Court of Appeal file CA59991 registered the proceeding but could not write its party roster: the role enum had no value for the party who filed the appeal ("Brightwater Outfitters Inc. and Thistle Collective Inc.") or, at first glance, for the party opposing it ("Northfield Clothing Corporation, Andrew Marlowe, and Jesse Marlowe"). `proceeding_parties.role` gains **`appellant`** — a table rebuild (CREATE new / INSERT SELECT / DROP / RENAME), the same shape #24's `plaintiff_by_counterclaim`/`defendant_by_counterclaim` widening used at v7.1→v7.2, because SQLite has no `ALTER TABLE` for a CHECK constraint.

**`respondent` is reused unchanged, not disambiguated into a separate `appeal_respondent` value.** Two things support this, independently: (1) `main.proceedings` carries no proceeding-type discriminator — `court` is a free-text field, and no role's meaning is scoped by what kind of proceeding it appears in anywhere else in this schema, so a Court-of-Appeal-only `respondent` variant would be the first role in the enum to carry that scoping, for no consuming code that needs it; (2) BC practice itself does not draw the distinction — "respondent" is the correct term for the opposing party in a petition, in a chambers application, and in an appeal alike, so a second value would invent a distinction the profession doesn't make. The render order and role_label logic (`operations/proceedings-profile.md` §5) therefore need no proceeding-type awareness to place `appellant`/`respondent` correctly.

**Render order places `appellant` between `petitioner` and `defendant`**, not at the tail near `third_party`/`intervenor`/`applicant`. The existing order groups the two roles that commence an ordinary two-sided proceeding (`plaintiff`, `petitioner`) ahead of the two that oppose one (`defendant`, `respondent`); `appellant` is the same kind of commencing role — the party who filed the proceeding — so it joins that first block rather than the trailing block of roles for additional or procedural parties (`third_party`, `intervenor`, `applicant`). Full order: `plaintiff, petitioner, appellant, defendant, respondent, third_party, intervenor, applicant`, then standalone `defendant_by_counterclaim`. Label: `APPELLANT(S)`, following the plain-`(S)` pluralization every role but `third_party` uses.

This is purely additive: no existing row is read or rewritten, row counts are unchanged, and the table-count assertion does not move (`main` stays at 22).

---

## 44. Sought orders are a document transcription, not a stance, and get their own table (v8.4, 2026-08-26)

Issue #372 (design of the respondent filing kind on the submissions-drafting side) decided that a BCSC Application Response needs each Part 1 order of the served Notice of Application as a first-class row — paragraph number and wording verbatim — so the response can position on it without re-typing the served document. Because the submission-drafting pipeline reaches case data only through this skill's gate, the capture happens here, at ingest, in a new `main.sought_orders` table.

**Why not `relief_items`.** `relief_items`/`relief_positions` answer *what remedies are in play and who seeks/opposes them*: a paraphrased description, bitemporally versioned per party, generic across every pleading type. Form 33's Parts 1–3 address orders by the served notice's own Part 1 paragraph numbers, so the consumer needs a 1:1, verbatim, document-numbered transcription — a different question, the same "one table cannot honestly answer both" reasoning as #39's `admissions`-vs-`positions` split. The repo's own research doc (`docs/Research/2026-08-25 Form 33 Application Response form-set inventory (issue 371).md`, items 127–128) independently reached the same conclusion before this decision was made. **Dual capture is intended, not duplication**: an ingested Notice of Application still produces `relief_items` rows through the unchanged `extract-facts` path, and `sought_orders` rows are never deduplicated against them — one records the proceeding's remedy posture, the other transcribes one document's own printed text.

**Why not `/prepare-application`'s candidate orders.** That mechanism is forward-looking (orders *we* plan to seek in our own draft application), lives in a separate `applications.sqlite`, and is untouched by this decision. The new table's name (`sought_orders`, matching Form 32's own Part 1 heading "ORDER(S) SOUGHT") deliberately avoids the word "application" so a future reader does not assume the two are related.

**Detection is two required positive signals, not a negative substring check.** A naive design considered rejecting a document as the served notice if it contained the substring "APPLICATION RESPONSE" (Form 33's own heading). This is defeated by both forms' own boilerplate: a genuine Notice of Application instructs the recipient to "file an application response in Form 33" on its face, and a genuine Application Response's face contains "notice of application" — so a substring scan misfires in both directions. The actual gate (`operations/ingest-extract.md`, Path A) requires (1) a **standalone title line** reading exactly "NOTICE OF APPLICATION" and (2) a **Part 1 heading** matching `PART 1 … ORDER(S) SOUGHT`, both on the same document. The filename is corroborative only. A false positive is harmless because the extraction subagent (`agents/extract-sought-orders.md`) is the final validator and returns an empty array with `not_a_notice_of_application: true` on a document that fails its own signal check; a false negative costs only the capture, since the drafting-time fallback of reading the served document is the guaranteed path per #372.

**No new marker family, no backfill, no verify-path coverage.** Degraded extraction reuses the existing `verified`/`notes`-prefix convention: an unnumbered Part 1 gets `notes = 'UNCONFIRMED: Part 1 unnumbered; ordinal assigned positionally'`, OCR-uncertain wording gets an `OCR:` prefix, both forcing `verified = 2` per `shared/conventions.md` §5. `ingest-verify.md` and the `@query_05a`/`@query_05b` human-review-backlog queries already omit `relief_items`, `relief_positions`, `source_references`, and `admissions`; `sought_orders` staying out matches that existing precedent rather than opening a new one. A previously ingested Notice of Application is not retroactively re-captured — a hash match routes to `ingest-verify.md`, which does not run this extraction; the drafting-time fallback remains the guaranteed path for any matter ingested before this decision. An amended/renumbered Notice of Application is handled by construction: it is a different file with a different hash, gets its own `sources` row, and its own fresh `sought_orders` rows.

This is purely additive: no existing row is read, rewritten, or backfilled, and a matter that never ingests a Notice of Application is indistinguishable from its v8.3 self apart from the stamped version. Row counts are unchanged across this hop, and the table-count assertion moves from 22 to 23 on `main`.

---

## 45. Bookmark-driven book segmentation is a stdlib outline parser, three write-only report boundaries, and a three-level source tree — no schema change (2026-09-02)

A BC Court of Appeal application/response book bundles reasons for judgment, the order, one or more affidavits, a memorandum of argument, and a table of authorities behind one set of PDF bookmarks, required by the registrar's own completion instructions. `/lawyer:ingest` previously ignored them entirely: a 257-page book fails both the page-1 jurat gate and the `AFF`/`SWORN` filename cue, so it would be force-fit through Path A or bounce. `references/scripts/extract_outline.py` reads a PDF's outline (Part-level and affidavit-level page ranges, and per-authority ranges in a book of authorities) and `shared/bookmark-segmentation.md` decides how to use it.

**Why a stdlib outline parser, not `pypdf` or PyMuPDF.** `pypdf` is not installed on the practitioner's machine and the repo forbids external packages (root `CLAUDE.md`); PyMuPDF (`fitz`) is installed and used by `/assemble`'s `assemble-affidavit` subskill, but that use was never recorded as an exception, may not be present in the Cowork sandbox, and this skill already has a written posture of refusing a PDF dependency rather than taking one (`lint_comparative_gloss.py`'s `SOURCE_UNSUPPORTED` for PDFs, and #40's rejection of Outlook COM after a `pip install` breach). `extract_outline.py` earns the same E1+E2 exemption as `render_document.py` (no database, no `resolve_paths`/`fuse_safe_io`, no matter pointer) and fails loudly (`{"error": ...}`, non-zero exit) on any parse failure rather than guessing a partial outline.

**Three segments are reported, never written.** Reasons for judgment and the order are report-only: the order under appeal is very likely already on file as its own source from when it was pronounced, and hash dedup cannot catch a copy reproduced inside a different book (a different hash, a different file). Argument and the book's own table-of-authorities listing are also report-only, for a different reason: routing them to `/drafting-data`'s `opposing_orders`/`opposing_authorities` — the original design's plan — is **illegal under the packager's `dependency-direction` check** (the repo-only plugin-packager skill's `SKILL.md` §8), which forbids any litigation skill file from containing `/drafting-data` or `drafting_data__`, whole-tree, including planning prose. Submissions pulls from `/matter-data`, never the reverse. `/draft` keeps its existing manual read of the served book for these two collections; a matter-data landing table for a book's table of authorities is deferred, not built here.

**Three-level source tree, no schema change.** `main.sources.parent_source_id` is already a self-referential FK with no depth limit. A book is a top-level row (`parent_source_id IS NULL`); each evidence-Part affidavit is a child of the book (dedup `(parent_source_id, title)`, its page range recorded as plain text in `notes`, never a machine prefix); each exhibit stays a child of its affidavit, unchanged. The `duplicate top-level source file_hash` trigger only fires on `parent_source_id IS NULL`, so nesting a book's affidavits under it does not collide with the standalone-affidavit dedup rule, which is unchanged and still keyed on `(file_hash, parent_source_id IS NULL)`.

**A book of authorities writes automatically, with the hash tier applied once per book.** All entries in one BOA share the book's file hash — the ordinary hash-tier probe must run once against the whole book, never per authority, or eighteen authorities collapse to a false single match. The citation tier then runs per authority using the bookmark title as the incoming citation, before any dispatch.

Out of scope, deliberately: a matter-data table for a book's table of authorities; content/date-based duplicate detection for an order reproduced inside a book; and detecting which side's book is being ingested (the practitioner chooses what to ingest).

---

## 46. A retired filing's research reaches the law database through one bridge, and an oral decision is a pointer, not a citable authority (v8.5, 2026-09-11)

A filing's legal research used to die with the filing. Retirement is now the
**one designed flow-back** into case data: `operations/ingest-submission-law.md`
consumes a payload the drafting pipeline assembles — assertions, authorities,
statements of law, the opposing authorities the filing answered, and an oral
decision's treatments — and lands it in `law.sqlite`. Direction is one-way and
stays that way: matter-data never opens the drafting store, never names its tools,
and knows nothing about it beyond what the payload itself says.

**The bridge is a pure JSON→SQL script on `merge_authorities.py`'s footing**
(#22's "script computes, agent perceives, human decides"). No database, no
filesystem beyond its input JSON, no clock — `--ingested-on` is a required
argument. Identical input gives byte-identical SQL, which is the whole reason a
recovery-and-re-retire is safe to re-run.

**Bridge identity is a notes marker, not a column.** `[FROM-SUBMISSION:la#<id>]`
on the concept, `[FROM-SUBMISSION:sol#<id>]`/`[FROM-SUBMISSION:opp#<id>]` on the
edge, `[FROM-SUBMISSION:filing#<id>]` on everything in the run. **The bridge
rewrites only rows carrying its own marker** — a concept or authority it did not
mint keeps its own text, and a re-run never clobbers a human's work. This marker
family sits on `law.*` notes on exactly #22's footing: `shared/conventions.md`
§5's forcing rule is an at-insert rule for extraction-time defect *prefixes*, and
these are bracket markers, so the `verified = 2` escalation below is set
explicitly rather than inferred. An edge at `verified = 2` or `-1` is never
touched on a re-run — #20's blanket no-overwrite rule, unamended.

**Tense discipline decides the treatment mapping** (#16). Only `overruled` maps
to a past-tense edge `treatment`. `negative`, `distinguishable` and `good_law`
map to edge `treatment` NULL plus the idempotent note
`NOTED-UP <date> (submission): <value>` — `distinguishable` is a prospective
risk the drafter flagged, not something a court did, and writing it as a
past-tense treatment would assert an event that never happened.

**`pinpoint` and `excerpt` are `order_terms`' class, deliberately.** They are
local-only capture: excluded from `pushed_source_hash`, excluded from the push
payload, on `push-state.md`'s never-return list. `finding` stays NULL for a
bridged edge — `finding` is the case-brief's own field, and filling it with a
submission excerpt would put two different things in one column. A `pinpoint`
edit alone therefore never derives `diverged`, which is correct: the pool never
saw it.

**`answered` is written only on a practitioner tie.** The drafting store's
opposing authorities carry no link to a law assertion, so no tie can be
inferred. An untied opposing authority lands as an authority row with **no
edge** — honest, and recoverable later by a tie.

**An oral-reasons authority is a pointer, and three rules follow from that.**
Its citation is synthetic and fixed — `Oral reasons, <court> <file_number>,
<judge>, <YYYY-MM-DD>` — so upsert-by-citation finds it again; it carries **no
style of cause, ever** (#10), and the bridge refuses a payload whose court,
file number, judge, or assembled citation contains the neutral particle. It
gets **`authority_treatments` rows only and never a `concept_authorities`
edge**: it can be cited for nothing until a transcript exists (design D4).
And it **never merges** — `merge-authorities.md` hard-stops it as **B9**,
because the citation-normalization rules B1/B2 run on cannot tell two synthetic
citations apart, and folding one into a reported decision would assert that a
transcript-free pointer and a reported judgment are the same document. The
transcript upgrade that would replace the pointer is a separate flow,
deliberately deferred — it is not a merge.

**`@query_27_oral_treatments_for_authorities`, not `@query_26`.** The design
named 26; v8.4 had already taken it for `sought_orders`. The next free number
wins — query numbers are allocation order, never semantics.

**Schema v8.5 is the first `law` hop since v7.3**, and the first that rebuilds a
**parent** table. `migrate_engine._apply_marker` sets `PRAGMA foreign_keys = ON`
before every marker, so the hop brackets itself in an explicit
`PRAGMA foreign_keys = OFF; … ON;` — the precedent is `rebuild.upgrade_69_to_70`.
Table counts do not move: `law` stays at 5.

---

## 47. A client instruction needs a party, not a proceeding (v8.6, 2026-09-13)

`privileged.client_instructions.proceeding_id` is nullable from v8.6, and
`party_id` stays `NOT NULL`. The v7.8 table (#37) required both, which
contradicted this schema's own domain model: a matter may have no proceeding at
all (pure advice work), and solicitor-client privilege attaches whether or not
one exists. So no instruction could be recorded before a proceeding was
registered.

**The trigger layer already had it right, and the column made it dead code.**
FK #8 (#12) carries `WHEN NEW.proceeding_id IS NOT NULL`, the same guard
`privileged_sources.proceeding_id` uses. The column's `NOT NULL` rejected a NULL
before that trigger ever ran. The fix makes the column match its trigger. It
adds no trigger, notes-marker family, or table.

**`party_id` stays required, deliberately.** An instruction always names the
instructing party, with or without a proceeding. Only the proceeding
requirement was the defect (#482).

**The hop is a table rebuild on `privileged` under a
`PRAGMA foreign_keys = OFF; … ON;` bracket.** SQLite cannot drop a `NOT NULL` in
place. No other table references `client_instructions`, but it references itself
through `prior_id`, so the old table cannot be dropped while the new one's rows
point at it under the `foreign_keys = ON` that `migrate_engine._apply_marker`
sets. The 84 → 85 `law` hop is the precedent. Rows and `prior_id` chains copy
across unchanged, and table counts do not move: `privileged` stays at 3.

---

## 48. An `answered` edge is verified by the tie and never crosses to the pool (2026-09-13)

The bridge (#46) used to write a practitioner-tied `answered` edge at
`verified = 0`. The push-queue gate holds a concept back whole on any `0` edge,
so every retirement that tied an opposing authority produced a first push with
nothing pushable. The commons push stopped before its currency stage, the
stage the filing-retired trigger exists for (#500, T500 E2E finding 4.2).

**The `0` was not a pending check. It was a claim no check could make.**
`concept_authorities.verified` asks whether the cited document says what the edge
says. An `answered` edge claims something about the filing: the other side cited
this authority against this concept, and the filing answered it. Re-reading the
authority cannot confirm that, and `verify-edges.md`'s relationship and voice
tests would have routed it to `2`. The drafting store has no verification column
for opposing authorities either, so the `0` was unconditional.

**So the tie itself is the verification, and the edge lands at `1`.** The
practitioner made the tie personally, which is exactly what conventions §4's `1`
means (the same footing as #36's order effects). It is the second recorded
bridged equivalence in `shared/verification-protocol.md`. Consequences: the gate,
`@query_05c` and verify-law need no change, because the bridge never writes an
`answered` edge at `0`. The bridge's `held_back` never names one. A statement row
may no longer claim `answered`. Only a tie writes it.

**It never crosses.** A pool edge says an authority stands for a principle. An
opposing authority does not. Push-state's serializer and push-queue join both
filter `relationship != 'answered'`, as an identical pair. That is not the
edge-filtering push-state rejects: that rejection is about filtering on
`verified`, which changes, so verification would move the hash. `relationship`
never changes after the write. The opposing authority therefore drops out of
stage 5b's noting-up set unless it also supports another candidate. Its oral
treatments stay recorded locally.

**Rejected: publish `answered` edges (keep the gate, run verify-law).** It needs a
verifier contract for a claim no document can settle, gives the pool a support
row that asserts the opposite, and still holds back every retirement's first push.

**No migration.** The filter removes only `answered` rows, so a concept without
one hashes byte-identically. Edges written before this decision are left as they
stand. A standing `0` edge still gates its concept until the filing is
re-retired, because the bridge re-syncs its own-marker edges that are not at
`2`/`-1`. A standing `2` edge stays with the lawyer (#20). A concept pushed while it
carried an `answered` edge at `1` (a lawyer's clearance, or a statement row that
claimed `answered` before this decision) would now read `diverged`, and its
re-push goes through the pool's own dedup like any other.

---

## 49. A pending privilege call is a column on `main.sources` (v8.7, 2026-09-23)

`main.sources.privilege_status` records whether the practitioner has made the
privilege call on a main-store document. It is nullable with no DEFAULT and
takes two values:

- **NULL** — never assessed. This is the honest backfill for every existing row.
- **`pending`** — the call is undecided. Ingest's Path B "Unclear — decide
  later" answer writes it, and the v8.6 → v8.7 migration promotes the legacy
  `PRIVILEGE REVIEW PENDING…` note to it.
- **`cleared`** — the practitioner decided the document is not privileged.

There is no `privileged` value. A document decided privileged does not stay in
main at all: `operations/resolve-privilege.md` re-homes it to
`privileged.privileged_sources`.

While a source is pending, three things hold. A cross-column CHECK refuses
`listed = 1`. TEMP triggers refuse a new `evidence_links` or `positions` row that
cites it. The drafting and evidence reads hold back its facts, positions and
evidence links: `v_fact_status`, `v_current_positions`, queries 01, 02, 04, 20
and 25, and `get_facts_for_drafting.py`. The facts themselves are still
extracted, so nothing is lost while the call waits. `@query_28` is the worklist.

**Why pending lives in main.** The facts of a pending document have to be held
out of drafting, and the posture views are where drafting reads them. A main
view cannot read the privileged database: SQLite raises `view cannot reference
objects in database privileged`, and #23 forbids a posture view reading
privileged data anyway. So a pending document registered on the privileged side
could not have its facts held out. Its facts would be ordinary `main.facts`
rows that no main view could tell apart.

**Why it is not a privilege classifier.** #2 forbids a schema rule that decides
privilege, and this column decides nothing. It records the practitioner's
judgment, or that the judgment has not been made. Every value is written by a
practitioner's answer or by the migration's reading of a note a practitioner's
workflow wrote. The CHECK and the triggers enforce what follows from an
undecided call. They never make the call.

**Rejected, because each resurfaces:**

- *Pending on the privileged side.* Its facts could not be held out of drafting
  (above).
- *Overloading `verified`.* `verified` grades extraction quality (conventions
  §4). A privilege call is a different question, and folding it in would push a
  pending document into the lawyer's `verified = 2` queue or hide it with the
  rejected rows.
- *The free-text note as the mechanism.* That is what existed, and nothing
  enforced it. A view cannot reliably key on prose, a note can be reworded, and
  no guard stopped a pending document being listed or cited as proof. The note
  survives only as optional context.
- *A tombstone main row after a Privileged outcome.* It would keep a privileged
  document registered on the non-privileged side, and every reader would have
  to exclude it forever.

**The deletion is an exception to #3's spirit, and a narrow one.** "Promotion
never deletes" governs privileged → producible, where the privileged row is the
permanent record of how a document was once treated. A pending main row is a
holding state, not a record of a decided treatment, and #1 keeps main for
non-privileged sources only. So a Privileged outcome deletes it. Its facts stay
in main as bare rows (#67): `source_id` cleared and the content emptied once it
is copied to the privileged record, and each gains a `fact_provenance` row
pointing at the new privileged source (#4: where a fact was learned is
provenance, not proof). The lineage survives in the privileged row's `notes` and in the
matching `file_hash`, the same join key #3 uses. The operation stops instead of
deleting when anything other than facts references the source (evidence links,
positions, admissions, relief rows, source references, sought orders, an expert
report, a cause of action, child sources). Deciding what becomes of those rows
is a separate practitioner instruction.

**The verification backlogs still see pending facts, deliberately.**
`@query_05a`/`05b`/`05d` and `@query_12` are unchanged, and `review_queue`'s
fact branch became a LEFT JOIN on `sources` so a flagged fact stays queued after
a Privileged outcome clears its `source_id`. The AI
verifier checks extraction quality, which is independent of the privilege call,
so a pending document's facts keep moving through verification while the call
waits. The history reads (09a/09b) and the integrity reads (06,
`verify_sources.py`, `dump.py`, the ingest dedupe probes) are unchanged for the
same reason.

**Superseded by #67 (2026-10-12).** This paragraph first observed that a fact
from a decided-privileged source reached drafting without a citation, because
its `source_id` is NULL and `v_fact_status` included it as it included a
theorized fact (#23). That is no longer true. A Privileged outcome now leaves the
fact as a bare row, and `v_fact_status` skips it.

No table is added: `main` stays at 23.

---

## 50. Stored paths are matter-relative and re-pointed by hash; three markers record a deferred or by-reference read (2026-09-24)

The `/housekeeping` redesign (`Engineering/1. Design/2026-09-23_housekeeping-redesign-spec.md` §B4) ingests a file and then moves it, so a stored `file_path` has to survive a move. Three decisions follow.

**One stored path form.** `file_path` on `sources`, `privileged_sources` and `authorities` is relative to the matter root, with backslash separators (`shared/conventions.md` §2.4). A relative path survives the matter folder being synced to another machine, and a single form lets a plain equality test, and `extract-facts.md` §6's `LIKE '5.%'` arm, work. Legacy rows keep what they hold. Every reader accepts every form, and no sweep rewrites them: `operations/relocate-source.md` rewrites a row when it next moves it. The interactive `ingest-extract.md` path is unchanged.

**`relocate-source.md` re-points by hash.** The hash is the durable identity, the same join key #3 uses for lineage. It re-points every record of the file in all three stores, including a merge tombstone and the privileged row a promotion keeps, because each names the same bytes. The old path is a check, not the key: a record naming a third place is re-pointed only when nothing with the file's hash is still there, so the record of a copy's twin stays put. It writes only `file_path`. That is a path repair, not a text correction, so #20's and #22's text rules do not reach it.

**Three markers, on #42's footing.** `ORDER-EFFECTS-PENDING:` and `LINKAGE-PENDING:` on `main.sources.notes` record a pass that an unattended ingest deferred because the pass needed the practitioner. `[SECOND-COPY:<sha256>]` on `law.authorities.notes` records a second file of an authority that was read by reference: the citation tier reused the authority and extracted nothing. All three follow #42's mechanics: appended, never prefixed, never touching `verified`, routing nothing to a queue. The fixed text is what lets a plain `REPLACE` clear the two pending markers when their passes run. The second-copy marker is never cleared. Without it the second file leaves no stored trace, `ingest-status.md` reports it `none` on every run, and it is read again forever. A column or table for it was rejected: one marker line per file carries the whole fact, and #22 already made `law.authorities.notes` the home of machine markers.

**A fourth marker, `DATE-ANCHOR-PENDING:` (#1134, ADR 0024 D12).** An unattended ingest of forum correspondence that sets a date writes it on the same footing. It is the one pending marker no matter-data pass clears, because its follow-through is `/dates-and-deadlines`' anchor write, in another lane; the practitioner's word clears it through `SKILL.md`'s route. A note was rejected: housekeeping raises no signal from `notes`, so the recommendation would never reach the practitioner, while a `pending` marker raises the existing `follow_up` signal with no housekeeping change. The marker text carries no date.

## 51. `.msg` is ingested through a built-in reader, and its attachments are child sources (2026-09-28)

#40 kept `.msg` out for want of demonstrated demand. The demand arrived: a production folder on a live matter held 40 `.msg` files out of 64, all skipped, with the practitioner told to convert them by hand. `.msg` is what Outlook writes when an email is dragged out of it, so it is the usual form of email in a matter folder, and the practitioner approved reversing #40 on both points.

**A built-in reader, not a package.** `render_document.py` carries its own reader for the compound-file container and the Outlook property streams inside it, standard library only. `extract-msg` was rejected: the no-external-packages rule forbids it, and the sandbox where the gap was hit cannot reach a package index, so an install step would fail exactly where it is needed. Nothing is installed and nothing is asked of the practitioner. The reader is read-only and covers what ingest needs: addresses, dates, subject, message ids, the plain or HTML body, and attachment bytes. A body held only as compressed RTF is refused with a stated reason and not guessed at.

**The sent date is honest about its zone.** Outlook stores times in UTC. The original zone survives only in the transport headers, which a sent item never has. The rendering gives the transport `Date` when there is one and otherwise the UTC time, labelled as UTC with the zone not recorded.

**Attachments are child sources with their own hash and no path.** #40 foresaw that the affidavit pattern would not transfer unchanged. A child row points at its email through `parent_source_id` and carries the attachment's own SHA-256. Its `file_path` is NULL, because the bytes live inside the email. Sharing the email's path was rejected: the folder scan's path lookup would meet a row whose hash is not the file's and classify the email as changed on every run, and `relocate-source.md`, which re-points by hash (#50), would strand the child on a move. No schema change was needed: the duplicate-hash trigger guards top-level rows only. An attachment whose hash is already registered is reported and not registered twice. An attachment of a kind ingest cannot read is named in the report and gets no row.

**`.eml` follows the same rule (2026-09-29).** The practitioner approved treating both email kinds alike, so an `.eml`'s attachments are written out and registered the same way. The `.eml` rendered text is byte-identical to before, so stored `¶N` locators hold.

**How a verification pass reaches a child (2026-09-29, #1254).** The ingest gate never routes to a child row, so a child is reached only inside the normal pass of its parent email, when the email is re-presented interactively through `/ingest`, or from the corrected-row backlog. The unattended folder scan does not verify a `complete` source and never reaches one. A normal pass on a hash-matched email covers its children, as an affidavit's pass covers its segments, because leaving them to the backlog would mean a re-presented email never re-verifies what its attachments said. A child's bytes are found through its parent chain, with the top-level file's own hash checked first, so a changed or moved email is reported as the ingest path's business rather than as an attachment verdict. The procedure is `operations/ingest-verify.md`'s Entry mode and Step 2.

**Not changed:** the privileged store, which has no parent column, so a privileged email's attachments stay report-only.

## 52. `matter_data__execute` loads the trigger layer itself (2026-09-29, issue #1254)

Every write used to re-send the whole of `references/triggers.sql`, about 16 KB, as a `triggers_sql` parameter pasted from a fresh read of the file. A 40-email folder scan makes about 50 write calls, so the same text crossed the tool boundary about 50 times.

**Decision.** The server reads `references/triggers.sql` from the skill tree it ships with, install-first (the installed plugin's bundled skill source, else the checkout), the same way `matter_data__migrate` finds its reference SQL. It loads the file on every write, before the script, or after the commit on a bootstrap. The parameter is removed from both `matter_data__execute` and `matter_data__query`, so a caller that still sends it gets a validation error, and `triggers.sql` stays the single source (#12). The optional `triggers_sql` on `query` went too: no operation used it, and it let a read-only tool run an arbitrary script.

**What #12 still guarantees.** No write runs without the triggers. A missing or empty `triggers.sql` fails the call before anything is staged or committed.

**Rejected: a batch-write tool** taking one trigger text and several scripts. It adds a second write surface, and a failed batch call would leave it unclear which scripts committed, against the verify-before-retry rule in `shared/conventions.md` §2.3.

**Not changed:** one transaction per `matter_data__execute` call.

## 53. A repeated attachment is reported once per run, keyed by SHA-256 (2026-09-29, issue #1254)

A signature image attached to 40 emails was named 40 times in a folder-scan report, once under each email. The attachment's identity is its SHA-256 alone. Names are display only, because the same bytes arrive under different names and different bytes under the same name.

**Per surface.**
- **Folder-scan summary** (`operations/extract-facts.md` §7, which holds the line format): one line per distinct attachment SHA-256, for every repeated attachment, readable, already registered or unreadable.
- **Single-document path** (`operations/ingest-extract.md`): one email per run, so per email and per run coincide. An attachment repeated within that email, for example inside an attached email, is named once with its count.
- **Unattended `notes`** (`operations/ingest-unattended.md`): stays per file, because the contract is one output entry per input file. Each attachment named there carries the first 12 hex characters of its SHA-256, so a caller can aggregate repeats across files without re-rendering.

## 54. A standalone copy of an email attachment already read is held by reference (2026-09-29, issue #1258)

An email is ingested first and its attachments become child rows (#51). The firm then files each attachment as a sibling file beside the email (#40), so the same bytes arrive again as a standalone file. The ingest paths disagreed on that file: the single-document gate and `ingest-status.md` read it again as a new top-level source, while the folder scan's `classify` skipped it as a duplicate. `ingest-extract.md` already settled the reverse order: an attachment whose hash is registered anywhere writes nothing.

**Decision.** An email attachment is a child row with no `file_path` (#51's defining property; affidavit exhibits and book children always carry their body's path). When a file's hash matches no top-level row but matches an attachment that was read through (`ingestion_status = 'complete'`), the file is already held and nothing is extracted:
- **Gate** (`operations/ingest.md` Step 3): report the attachment and its email and stop, offering verification of the email, whose pass covers its attachments.
- **`ingest-status.md`**: verdict `ingested_by_reference`, store `main`, `source_ids` the attachment's row, `stored_path` null, never `moved`. The anchor is the matching attachment whose parent is not itself a match, so an attached affidavit is named by its own row, not by an exhibit. `ingest-unattended.md` returns it with nothing written, and `/housekeeping` files it under the row kind it already has for `ingested_by_reference` (move, review log, manifest), which never calls `relocate-source`.
- **Folder scan** (`operations/extract-facts.md` §3): `duplicate`, as before. Its one-line hash query tests only path and status, not the parent: an attached affidavit's exhibits carry no status, so they never decide a scan on their own, and the outcome matches `ingest-status.md`.
- **`relocate-source.md`** leaves attachment rows out of its probe, so filing a standalone copy never writes a path onto the attachment. A file held only as an attachment is `failed`, `no_rows`. It leaves an attachment out whatever its status, because an unread attachment must not gain a path either. This assumes every child row with no path is an attachment or an attachment's descendant. `ingest-extract.md` is the only writer of such rows.

**An attachment not read through is no record of the file.** Verification never reopens ingestion (`ingest-verify.md`), and re-presenting the email writes nothing for a registered hash, so nothing would ever read a `failed` attachment again. Treating its copy as held would file it unread, silently. Instead every path, the folder scan included, reads the copy afresh as its own top-level row, and the attachment row stays as it is. The practitioner chose this over reading the copy into the attachment row, which would need a new route and a write onto an existing child. A partly read attached affidavit therefore has its read portion extracted a second time, and those facts are reported as suspected duplicates, not merged.

**Rejected.** Extracting every copy again: each fact would be recorded twice under two source ids, and the no-fuzzy-merge rule (`shared/extraction-protocol.md`) would report every pair as a suspected duplicate. A top-level marker row for the copy's path, in the style of #50's second-copy marker: the copy's hash is the attachment's own, so a hash lookup already finds it on every run, and a row with no status and no facts would route to extraction unless another rule intercepted it. Telling attachments apart by the parent's kind: it needs a join and recursion for an email attached to an email, where a null path needs neither.

**Known limit, accepted by the practitioner.** The copy has no stored path, so two copies of one attachment are told apart only within one `ingest-status` call, where the later is a duplicate. A second copy filed in a later housekeeping run is filed as another named document, not trashed. Catching it would need the copy's path stored, which is the rejected marker row.

## 55. Counsel of record is court-record state, held here, per party with a per-proceeding override (v8.9, 2026-09-30)

A drafting session nearly addressed correspondence to counsel who were no longer of record. The drafting store had copied each party's counsel and address for service once, at proceeding setup, and never read them again, while this skill went on applying every counsel-change notice and order (#41). Counsel of record and the address for service change whenever a notice is filed, so they are court-record state, and this skill owns them. The drafting runtime now reads them live, through a script this skill owns (#56), instead of trusting its own copy.

**Email and telephone get fields of their own.** `parties.lawyer_email` and `lawyer_phone` exist because the court forms print counsel's email and telephone in separate cells, and `contact_info` is one free-text blob a reader would have to parse. The hop backfills nothing: splitting an existing blob would be a guess, so NULL is the honest value until an instrument or the practitioner supplies one. `contact_info` stays for anything else.

**Per party by default, with an override per proceeding** (practitioner decision, 2026-09-30). In principle counsel of record is per proceeding, and the difference only occasionally matters. So `parties` keeps the default, and `proceeding_parties` carries six nullable override fields (`lawyer_name`, `lawyer_firm`, `lawyer_email`, `lawyer_phone`, `address`, `service_address_filed_date`). An override is written only when the practitioner expressly says counsel differs for that proceeding, on every role row the party holds in it. A reader resolves each value to the override when set, else the party's own value. A notice or order updates the party's own fields unless the party already carries an override for the instrument's proceeding, in which case it updates the override (`operations/order-effects.md` Step 3). This amends #41's "their writable surface is `parties` only" for notices: a notice may write a party's override fields, and still never inserts or deletes a `proceeding_parties` row.

**Rejected.** *Counsel per proceeding only*, moving the fields off `parties`: every matter would need a per-proceeding entry for the common case of one counsel throughout. *A separate counsel table*: a second write path and a second reader for the answer the two fields already give, #41's reasoning against a history table.

Purely additive. Table counts do not move: `main` stays at 23.

## 56. `parties_of_record.py` is a sanctioned read-only consumer, spawned by the drafting runtime (2026-09-30)

`references/scripts/parties_of_record.py` returns the parties of record of one proceeding, matched by file number, with counsel and address for service resolved per #55. The drafting runtime spawns it over `PYTHONPATH`, the way `matter_data__migrate` reaches its engine, and prints each drafting party's counsel and address for service from the result, matched by `case_party_id`, in place of its own copy (#1279); a party it cannot match is drift, so a drafting session sees it at session entry and a filed render refuses while it stands. This is #30's footing, and the reasons carry over.

**Why a script here and not a query in the runtime.** The practice-data reads embed their schema in runtime TypeScript, and the matter-data runtime is forbidden to hold SQL or schema (`plugins/CLAUDE.md`). With the script, every table and column name stays in this skill. The result speaks the drafting runtime's own vocabulary (`counsel_name`, `address_for_service`, `case_party_id`), so no matter-data table or column name has to appear in the runtime either. A runtime test pins that for the submission tree.

**Its read discipline, all deliberate:**

- **A temp copy of `main.sqlite` only.** Never the native file, never `law` or `privileged`: nothing it returns lives there.
- **No lock** (#28: a read cannot destroy a write).
- **Version-guarded through `resolve_paths.EXPECTED_USER_VERSION`**, imported, never restated (#29).
- **Fail-visible.** Three statuses, never a bare empty list: `ok`, `not_applicable` (no matter-data database in the folder, or neither a file number nor ids, so nothing to read) and `unavailable` (no proceeding or two with that file number, a database behind the current schema, or a party whose role rows carry different overrides). Each non-`ok` status carries its reason. The runtime treats any non-`ok` status as drift on every party, so a filed render cannot go out on counsel nobody could read.
- **Not a model-facing tool.** No operation calls it. A session reads parties through the query operation as before.

**The file number is matched after trimming whitespace, exactly otherwise.** Two stored formats of one number (`S-290001` against `VLC-S-S-290001`) read `unavailable`, naming the number, rather than being matched by a guess.

**A proceeding with no file number is read by `case_party_ids`** (2026-10-01, #1279). A proceeding before filing has no court record, so the runtime passes its linked parties' ids in place of a file number, and the script returns each party's own values, no per-proceeding override applying, with `roles` empty. An id case data does not hold is absent from the result, and the runtime names that party as drift.

## 57. Ingest coverage is ingest-status over whole folders, and every glob match counts (2026-10-01, #1312)

`/draft` checks before each new letter that the matter's correspondence and court file are in case data. `operations/ingest-coverage.md` answers it: it walks and hashes the named folders, runs `ingest-status.md`, and reduces the verdicts to files to ingest, damaged records, unreadable files, missing folders and the newest ingested correspondence date. It writes nothing.

**Not the folder scan.** `extract-facts.md` extracts rather than reports, and its classification is not ingest-status's (#1311). Coverage reuses ingest-status so that a report and an ingest gate never disagree about a file.

**Every match of a glob is in scope** (practitioner decision). A matter has one court-file folder per action, and older matters name it `5. COURT DOCS`, so the caller passes `5. COURT*` and every match is walked. Treating several matches as ambiguous, as `/draft`'s referenced-correspondence step does, was rejected: that step looks for one letter, while coverage asks whether anything anywhere in scope is missing.

**The housekeeping review log is not consulted.** A file housekeeping filed without ingesting it is still reported. Housekeeping's kind list can still file client `.msg` email that way (#1336), and that email is case data only once ingested, so hiding it would report a matter current on exactly the files the check exists to surface.

## 58. A counsel offer-back fill-in records the filing date and no replaced representative (2026-10-01, #1309)

`/drafting-data`'s counsel offer-back applies, through `operations/order-effects.md`, a counsel or address value that case data lacks. Read literally, #41's provenance rule would then name the party's own lawyer as their predecessor, because the rule takes `replaced_representative` from the stored `lawyer_name`. The practitioner ruled on #1309: when an apply leaves the representative's identity unchanged (a **fill-in**), it records `service_address_filed_date` as the filing date of the instrument the value comes from, and no replaced representative. Replacing a stored non-counsel value, such as a party's own business address, is still a fill-in. An apply that changes the representative's identity is a representation change, and #41 applies to it unchanged.

**The offer-back entry is not gated by order detection.** The instrument is usually an originating or responding filing, which no detection signal matches, and the practitioner has already named it. Its writable surface is a counsel-change notice's (#41 as amended by #55). This narrows #41 for the offer-back path only. The order and notice paths are unchanged, and no schema change was made: #41's rejection of an address-for-service history still stands.

## 59. An RTF `.doc` is read by `render_document.py`'s built-in reader, never pandoc (2026-10-02, #1410)

Westlaw downloads are RTF with a `.doc` extension, and every case name cited in them sits inside a `HYPERLINK` field. Westlaw writes the field instruction bare (`{\*\fldinst HYPERLINK "url" }`), where Word braces it (`\fldinst{HYPERLINK "url"}`). Pandoc 3.8.3 keeps a field's visible result only in Word's form, so on a Westlaw file it silently drops every cited case name: Rhema, 2024 BCSC 1896, para 45 read "summarized in , and". All 4,504 fields across one matter's 40 Westlaw files were the bare form. LibreOffice keeps the text but is not installed on the practitioner's machine, and adding it would be a new installed program on every machine and session.

**A built-in reader, as #51.** `render_document.py` reads RTF itself, standard library only. It keeps `\fldrslt` text, drops the instruction and every other non-text destination, and refuses a file it cannot read with a stated reason: unbalanced braces, an undecodable byte, or a binary Word `.doc`. Do not reinstate pandoc as a fallback. A fallback that loses text without failing is the defect this decision fixes. `lint_comparative_gloss.py` reads RTF through this same reader (#1442), and reports a file it refuses as `SOURCE_UNREADABLE` rather than searching partial text.

**No `¶N` markers on an RTF rendering.** The judgment numbers its own paragraphs, and those numbers are the pinpoints cited. A second numbering invites a wrong "para. N" (#40's reasoning), and markers inside the text would break the verbatim diff of an excerpt that spans paragraphs.

## 60. Session entry runs ingest coverage host-side, executing the operation's own fenced code (2026-10-03)

`/draft` had no ingest step at session entry, so a session improvised one: about eight tool calls and about 47 KB of this skill's instructions. `drafting_forms__open_session` now returns `ingest_coverage`, computed on the host by `references/scripts/ingest_coverage.py`, which the drafting runtime spawns over `PYTHONPATH` as it spawns `parties_of_record.py` (#56). The scope is four fixed globs, `2. SOLICITOR CLIENT*`, `3. CORRESPONDENCE*`, `5. COURT*` and `7. DISCOVERY*`, the first two counting as correspondence. The runtime passes the host matter folder as both `matter_root` and `matter_folder`, so no sandbox path is involved. `/draft`'s per-letter check (#57) keeps its own three folders and still runs the operation through this skill. Amended 2026-10-04: the scope is no longer four fixed globs, because the drafting runtime passes only the folders the opened filing's type declares as its ingest inputs, and `/draft`'s per-letter check (#57) moved, for a letter that is a Writing, to the claim of that letter's job.

**The script executes the operation's fenced code.** It reads `operations/ingest-coverage.md`, `operations/ingest-status.md` and `shared/conventions.md` from the skill tree beside it, which the install ships whole, and runs their Python blocks and the `-- ingest-status probe` as the repo test `test_ingest_coverage.py` already did. The markdown stays the single source, so the session-entry report and the per-letter check cannot disagree. Moving the code into a `.py` file was rejected: it would change how housekeeping, extract-facts, ingest-verify and relocate-source run ingest-status. The fenced functions' names and the probe's marker line are therefore this script's interface.

**Its read discipline is #56's:**

- **Temp copies of all three databases**, in a folder named by `resolve_paths.staging_prefix`, so a call killed on timeout leaves none behind. Never a native file. Unlike #56 it reads `law` and `privileged`, because a file held only there is not a gap.
- **No lock** (#28).
- **Version-guarded through `resolve_paths.EXPECTED_USER_VERSION`** (#29).
- **Fail-visible.** Three statuses: `ok` with the operation's output, `not_applicable` (no `main.sqlite`) and `unavailable` (`law.sqlite` or `privileged.sqlite` missing, or a database behind the current schema). The runtime reads a failed spawn or a spent budget as `unavailable` too. Each non-`ok` status carries its reason, and `/draft` never reports the folders ingested on one.
- **Not a model-facing tool.** It writes nothing and adds no `matter_data__*` tool.

## 61. `resolve_authority_source.py` is a sanctioned read-only consumer of law, spawned by the drafting runtime (2026-10-03)

`references/scripts/resolve_authority_source.py` finds the file of one stored authority and gives it as a PDF, for `/draft`'s scrutiny review (`drafting_forms__draft_harness`, step `scrutiny_review`). It is the executable form of `operations/verify-law.md` §2's locating rule: the recorded path when its sha256 equals the stored hash, else a hash search of the matter tree, `6. LAW` first, stopped at 20 s and reported as truncated, else a file the practitioner named, which carries no hash identity unless its hash equals the stored one. The drafting runtime spawns it over `PYTHONPATH`, as it spawns `parties_of_record.py` (#56). This is #30's footing, and #56's reasons carry over.

**The citation is the identity.** The drafting store and law share no key, and `submission_law_bridge.py` already treats the citation as the identity between them. The script matches a row whose citation is equal after collapsing whitespace and case, else one whose citation contains the neutral citation (`2026 BCCA 74`), which tolerates a pinpoint suffix in either store. A merge tombstone (#22) is not a match. Two live rows read `authority_ambiguous`, both listed, and never a guess.

**Word converts, nothing else.** A non-PDF source is converted by Microsoft Word through COM, from a temp copy so nothing is written beside the matter's file, into `<sha256>.pdf` in a host-local cache folder the caller names (`%LOCALAPPDATA%\Coclerk\scrutiny-review`). A cached PDF is reused, so a retry skips Word. No Word reads `converter_missing`. There is no LibreOffice path, because LibreOffice is not installed on the practitioner's machine (#59).

**Its read discipline:**

- **A temp copy of `law.sqlite` only**, in a folder named by `resolve_paths.staging_prefix`. Never the native file, never `main` or `privileged`.
- **No lock** (#28).
- **No version guard.** The five `authorities` columns it reads predate every migration in `migrations.sql`, so an older database reads correctly.
- **Fail-visible.** Five statuses: `ok`, `authority_ambiguous`, `unresolved` (with the paths tried and why each failed, the folders searched, and whether the search was truncated), `converter_missing` and `conversion_failed` (with Word's stderr). The result speaks the runtime's vocabulary (`path`, `sha256`), so no matter-data column name reaches the runtime.
- **Not a model-facing tool.** It writes nothing but the cache file and adds no `matter_data__*` tool.

## 62. The single-file gate refuses every kind the folder scan refuses, images included (2026-10-04)

`operations/ingest.md` Step 2 checks the kind before hashing, by the same list the folder scan (`extract-facts.md`) and `ingest-unattended.md` Step 2 apply: `.pdf`, `.docx`, `.eml`, `.msg`, and a `.doc` only when it is RTF. Any other kind is reported as "a kind ingest cannot read", and nothing is hashed, looked up, routed or written. The gate used to check no kind, so a `.png` fell through to the PDF path, and on 2026-10-04 a retainer receipt image in a live matter's `2. SOLICITOR CLIENT` folder was registered as `privileged.privileged_sources` row 20. This is recorded because the affidavit gate already reads rendered PNG pages, so a later session could "fix" an image by reading it the same way. The practitioner decided on 2026-10-04 that images are not ingestable on any path: a scanned receipt or screenshot enters as a PDF or not at all.

## 63. No OCR text layer at ingest; exhibit lookup is by exhibit rows (2026-10-05)

Ingest adds no OCR text layer to a scanned PDF, because root `CLAUDE.md` forbids external binaries and packages, and tesseract is one. Scanned pages are read natively, and a scanned affidavit's stamp pages from ~150 DPI renders, which avoid OCR for handwritten stamps it would read unreliably (#70). **Superseded by #71 (2026-10-21)** for how a scanned page is read: only from its page image. The question "which affidavit exhibits this document" is answered by `@query_29_exhibits_of_document` over exhibit rows, matched by date or title, not by searching text. Found by `docs/E2E-tests/2026-10-05-1604 draft-e2e-test.md` finding 4.4.

## 64. A second version of a court document supersedes into the operative copy, recorded by notes markers (2026-10-05)

Ingest knew a file only by an exact SHA-256 match, so an unsigned draft, a signed copy and the filed copy of one court document were each read in full and registered as three sources. Extraction was tripled, the earlier copies sat `partial` and kept `ingest-coverage.md` reporting them, and `DISCREPANCY: … possible duplicate` notes reached the review queue with nothing able to act on them. `operations/supersede-draft.md` keeps the operative copy (K) as the source of record, re-points the draft's (S's) rows onto it, and moves the draft file into `0. DRAFT*\Superseded\`. Nothing is deleted, and no schema changed.

**The record is a marker on `main.sources.notes`, #22's footing.** `[SUPERSEDED-BY:#<K> <date> <approver>]` goes on S; `[NOT-VERSION-OF:#<id> <date> <practitioner|comparison>]` (`strict-test` before 2026-10-28) goes on both rows of a rejected pair. A pair where either row names the other with either marker is never assessed again, so the markers are the cache. #22 *prefixes* its marker on `law.authorities.notes`, which has no `verified` column. These are *appended*, because `review_queue` classifies `main.sources.notes` by a position-anchored prefix (#42 and #50 apply the same rule). A `superseded_by_source_id` column would be cleaner and is a **rider for the next scheduled schema bump**, as #22 recorded `merged_into_authority_id`.

**A folded duplicate is retired, not deleted.** It takes `verified = -1`, `pending_reverification = 0` and an appended `[FOLDED-INTO:#<kept fact> <date> <approver>]`. Conventions §4 calls `-1` "rejected"; with a `FOLDED-INTO` marker it means **retired as a duplicate of a kept fact, not false**. The views already filter `verified >= 0` (#7), so none changed. The same treatment retires a relief item, a sought order, a position or a relief position on S that duplicates one on K. `sought_orders` has `UNIQUE(source_id, order_number)` and positions and relief positions a unique current response, so a duplicate there would collide on re-point: it is retired, never moved. The kept row always survives with its own `verified`: S's `1` does not transfer.

**Rank is read at decision time**, from the page comparison: `filed` (a registry stamp) over `affirmed` (executed or signed) over `draft`. `execution_status` is written only where it is NULL. A tie (two filed copies with the same stamp date) keeps the better-looking copy, and asks with no proposal only when neither is, or when a rank is unclear.

**Facts fold across locators.** A fact on S folds into any equivalent fact on K or on K's children: the model judges equivalence beyond an exact normalized match, and the practitioner sees every pairing, in the question's table or the report. That is what lets paragraph facts of a draft fold into the exhibit facts of the filed affidavit. A fact with no equivalent moves to K with its locator unchanged. A child of S whose title matches a child of K folds into it and is marked like its parent; any other child is re-parented to K and takes K's path and hash when it shared S's, so it stays an exhibit of K under #17 and `relocate-source.md`, which follows S's hash, never carries it into the `Superseded` folder.

**Links are re-pointed in place, an identity repair.** `positions`, `admissions` and `evidence_links` are bitemporal (conventions §7), but closing and superseding each row would record a change of stance that never happened: the same stance now cites the operative copy. The write is `relocate-source.md`'s `file_path` repair (#50) at row level, and it is chosen deliberately. Composite keys (`criteria_facts`, `issue_facts`, `privileged.fact_provenance`) take `INSERT OR IGNORE` for K, then `DELETE` for S, so a collision resolves instead of raising. `relief_positions`, `source_references` (both ends), `causes_of_action` and `witnesses.report_source_id` follow.

**A copy with no row yet is inserted.** An unregistered kept copy takes S's place as a top-level row with its own hash: sound only because the comparison has already found every difference from S's pages cosmetic, so anything that changed meaning would have made the pair two documents. It is `complete`, or `partial` when S was, so a gap in S's read is not hidden by the new row. An unregistered superseded copy is inserted the same way, carrying its marker and nothing else, so its hash is on record. S always keeps its own hash: the one-top-level-row-per-hash trigger allows both, and the hash is how a re-presented copy of the moved file is recognised as an earlier version of K.

**Meaning decides, and the practitioner's standing rule asks nothing (amended 2026-10-28).** The strict test made any difference beyond execution marks two documents, recorded nothing on the files, and asked on every tie. Now every pair is compared page by page and each difference is semantic (a word, a figure, a date, an exhibit, a page of content) or cosmetic (execution marks, a same-person signature, font, blur, alignment, a stain). Semantic: `NOT-VERSION-OF` on both rows, and a sticky note on each file at each difference, with no question. Cosmetic only: the higher rank is kept, or on a tie the better-looking copy, with no question. Only an unplaceable difference, an unclear rank or a tie with no better copy asks. The note changes a file Probanda did not create, so it is `file-manager`'s `file_ops__comment_pdf` (Commandment 7): an incremental save that keeps the original bytes, refused unless the file still has its stored hash. The stored hash is then re-pointed to the new one at that path (`rehash_sql`), so no row names bytes its file no longer has. An unannotated copy presented again pairs by name and compares cosmetic-only, so it is superseded. Either path removes only the "possible duplicate" clause from a `DISCREPANCY:` note, and a row at `verified = 2` returns to `0` only when no §5 prefix remains. `main.sources` has no `human_reviewed`, and no fact note is edited.

**Unattended ingest only marks.** `ingest-unattended.md` ingests a matching newcomer as before and appends `SUPERSEDE-PENDING: possible other version of source #<id>.`; the attended gate and the folder scan settle it. The closing period is part of the fixed text: without it `#3` would match inside `#34` for the substring test and the `REPLACE` that clears it.

**Two newcomers pair too (amended 2026-10-05).** The first cut paired a newcomer only with a registered row, so a draft, a signed and a filed copy arriving in one folder scan were each extracted in full. `candidates` now also pairs two newcomers in one `5. COURT…` folder, and the folder scan settles every pair before reading any file: the newcomer finally kept is extracted once, and each other one is inserted marker-only, through the unregistered-superseded-copy path above, once the kept one has its row. Unattended ingest is unchanged in kind: it ingests both and marks each row with the other's id once both have rows.

**Several markers are settled one pair at a time (amended 2026-10-05).** A newcomer paired with several registered rows carries one `SUPERSEDE-PENDING:` marker per row. The gate takes them in ascending order of the named ids, each pair with its own comparison and any question its own, never one question for two pairs. When a pair supersedes the marked row, its script clears every `SUPERSEDE-PENDING:` marker on that row, because a superseded row is never assessed again and a marker left there could never be cleared; each later pair is then taken with the kept row in its place. The same rule settles a group of newcomers in the folder scan.

**A move that did not happen is offered again (amended 2026-10-05).** The database write commits before `file_ops__move` runs, because a file move cannot join the transaction. A refused move (no `0. DRAFT*` folder or two of them, the file not at its stored path) is reported word for word and leaves a superseded row at its old path, and nothing used to move it later. Now the gate and every folder scan run `supersede-draft.md` §6c: a probe for superseded rows whose stored path lies outside `0. DRAFT*\Superseded\`, each reported and offered its move, attended only. `ingest-status.md` reports `move_pending` for such a file, and the unattended paths only pass it on, since they never move a file.

**Code shape is #60's.** The deterministic steps are fenced functions in the operation, run by `references/scripts/supersede_draft.py` and by the tests, so the operation also runs in Cowork, where scripts are not. The emitted SQL guards itself with a temp `_assert` table: a marker already on either row, a note changed since it was read, a decision naming a fact outside S or a target that does not end on K, and afterwards any current fact or live link left on S, or an arriving fact (moved, or on a re-parented child) restating another current fact of K's family, each fail the one transaction. **Each guard is a named `CHECK` (amended 2026-10-05)**, so a refusal reads `CHECK constraint failed: <condition>`, such as `a copy is already superseded`, and the operator reports that condition word for word. One unnamed `CHECK` made every refusal read alike (`CHECK constraint failed: _assert`, or the bare `n = 0` on a newer SQLite), which told the practitioner nothing about what stopped the write.

**The move is a third `file_ops__move` mode**, `superseded: true`: the only destination is `<matter root>\<0. DRAFT*>\Superseded\<leaf>`, `create_folders` may name only that folder, none or two `0. DRAFT*` folders refuse, the name may change, and nothing is overwritten (the operation retries `<stem> vN`). It is matter-data's own destination, so housekeeping and file-sorting never propose it and never sweep it.

## 65. Participants carry recorded aliases, and tribunal members are participants (v9.0, 2026-10-06)

A matter's file names spelt one participant's surname three ways, and the practitioner dictated a fourth. A search by the name as given found nothing, and the session guessed variants by hand (spec `Engineering/1. Design/2026-10-06_participant-name-aliases-spec.md`). The participant was a tribunal member, whom case data could not hold at all: parties, counsel and witnesses had rows, decision-makers had none.

**A participant is a party, a party's counsel, a witness (expert included) or a tribunal member.** `tribunal_members` holds the judges, associate judges, arbitrators, tribunal members and registrars a matter deals with. They are not parties, so they get no `proceeding_parties` row and no role in that CHECK. `capacity` is the forum's own word and `tribunal_body` names the forum, both free text, because forums name these offices too variously for a closed enum (#24's reasoning against a neutral role enum in the drafting store applies). `proceeding_id` is nullable because a registrar or an arbitrator may act across proceedings or before any is filed.

**`participant_aliases` holds other spellings and the firm's file-name codes.** A `spelling` is any other way the name is written (a dropped letter, a different initial letter, a transliteration). A `file_code` is the author/recipient token the firm's file names carry (`SmithJ`); `/file-naming` derives those by rule each time and stores none, so this is the only place a recorded code lives. Each row has exactly one owner, enforced by a CHECK across three nullable foreign keys rather than a polymorphic `(kind, id)` pair, so SQLite enforces every reference natively and deleting a participant who still has aliases fails on the foreign key, like any other main dependent. Counsel is not an entity (#55), so a counsel alias belongs to the party's row with `of_counsel = 1`. A unique expression index stops one owner holding the same alias twice in different cases.

**No alias is written without the practitioner's approval.** `approved_on` is NOT NULL: a writer has to name the approval turn's date, and a row cannot be inserted silently. The schema cannot see a turn, so the approval itself is enforced by `operations/participants.md`, which asks before every write. A near match a search or an ingest turns up is proposed, never recorded.

**Rejected.** *A `tribunal` value in `witnesses.witness_type`*: it puts the decision-maker among the people giving evidence and collides with the expert-only CHECK columns. *An `aliases` JSON column on each table*: four write paths, no uniqueness, and no index for the resolver (#66). *A per-firm code registry in `/file-naming`*: that skill is domain-agnostic and opens no database, and a code is a fact about a participant in one matter.

**The columns are `tribunal_body` and `alias_text`, not `body` and `alias`.** The data runtime's submission-case boundary test refuses any matter-data identifier in the drafting runtime's TypeScript, and both plain words already appear there in their ordinary senses. A new column takes a name nothing else uses. The resolver's output still says `body`, because that is the runtime's vocabulary, not a column.

Purely additive. `main` moves from 23 to 25 tables.

## 66. `matter_data__resolve_participant` is the first model-facing narrow matter-data tool, and the one place edit distance is allowed (2026-10-06)

`references/scripts/resolve_participant.py` resolves a name, surname or file code to the participants it could mean, each with every name, alias and code on record as `search_terms`. The runtime reaches it through `matter_data__resolve_participant`, a read-only tool, by #56's spawn pattern: the script holds all the SQL and returns the runtime's own vocabulary, so the runtime still holds no table or column name.

**Why a model-facing tool, unlike #56 and #61.** Those scripts serve the drafting runtime, which needs one answer in its own vocabulary. This one serves a session: `/find-document`, and next the inbound-correspondence notice (matching a letter's sender). A session given only `matter_data__query` would write the name-matching SQL itself, differently each time, and edit distance is not expressible in SQLite without an extension. The tool is still called only through this skill's `operations/participants.md`: `/find-document` asks `/matter-data` and never names the tool (practitioner decision, 2026-10-06), so the gatekeeper rule holds unchanged.

**Edit distance, labelled, on the surname only.** The knowledge index refuses edit distance because venue codes one character apart are different courts (`shared/knowledge-tree.md`). Names are different: a misspelling is the common case, and a wrong candidate costs only a wider file search, because a near hit is a search input, never an identity. So the resolver matches exactly first (whole name, alias, surname or code stem, case- and accent-insensitive) and falls back to Levenshtein distance at most 2 on the surname, only when both surnames have at least four letters and the distance is under half the shorter one's length, so a three-letter surname never fuzzes. Every fallback hit is `match: "near"` with its distance, and a reader must say "near" wherever it shows one. Given names are matched exactly or by initial, never fuzzed (practitioner decision, 2026-10-06): short given names collide too readily. A given name in the request must agree with one the participant has on record, so an alias recorded without a given name cannot vouch for a wrong one. An organisation matches exactly only, by its whole name, an alias or one of its words of four letters or more.

**The result is an interface.** `role` is one of `party`, `counsel`, `witness`, `expert`, `tribunal`; `capacity` carries a tribunal member's capacity or a party's proceeding roles; `search_terms` lists every name, alias and code to search. The inbound-correspondence notice depends on `role: "tribunal"` and `capacity`, so widen these values only with a new entry here.

**Its read discipline is #56's:** a temp copy of `main.sqlite` only, no lock (#28), version-guarded through `resolve_paths.EXPECTED_USER_VERSION`, and fail-visible with three statuses, `ok`, `not_found` and `unavailable`, each non-`ok` status carrying its reason. `not_found` is not an error: the caller searches the name as given and says so.

## 67. A Fact known only from a privileged source is a bare ID in the non-privileged store (2026-10-12)

If the non-privileged store points at a Fact that is known only through privileged sources, the pointer is a **bare ID**: it holds no information about the content or the nature of that Fact. Only the privileged store knows what the ID means. The owner's words (2026-10-11): "they must be bare IDs that contain no information about the content or nature of the fact that they point to."

**Why.** REQ-0002: privilege attaches to a Statement of Fact by its source and never to a Fact. A Statement of Fact points at a Fact and is never the Fact, so anything derived from a privileged statement by summary, paraphrase or abridgement is another statement pointing at the same Fact, and it carries the privilege. A `main.facts` row holding the privileged document's wording, or a "neutral" rewording of it, is privileged material in the non-privileged store. The remedy is the pointer. A better rewording cannot be one.

**The bare row.** `description = ''` (the column is `NOT NULL`, so empty text), `created_date = NULL` (set explicitly, because its default is a date), `category`, `date_of_fact`, `source_id`, `source_locator`, `notes`, `basis_of_knowledge` and `informant` NULL, and `verified`, `human_reviewed` and `pending_reverification` 0. The exact state, the record and the moves are `operations/bare-privileged-facts.md`.

**The record stays privileged.** `privileged.fact_provenance.source_note` carries the Statement of Fact on a `STATEMENT: ` line, with the row's other content on labelled lines. Nothing is drafted from it at any step: not a neutral proposition, not a summary, not a placeholder sentence.

**Nothing links to a bare row, and readers skip it.** A position, evidence link, admission, criterion link or issue link to a bare row would say what kind of Fact it is, which is information about its nature. So none is written, and Step 4b of `operations/resolve-privilege.md` stops when a link to a fact of the document already exists. `v_fact_status` (and with it `get_facts_for_drafting.py`), `@query_05a` and `@query_05b` exclude `description = ''`, so a bare row never reaches a draft, list, book or page as a blank line or a placeholder. Only `@query_10` and `@query_22` show what an ID means, to the practitioner, by reading the privileged side.

**Filling.** When a non-privileged source later states the same Fact, the row's `description` takes that source's own Statement of Fact, never the privileged wording and never a blend. From then on it is an ordinary fact row and may be linked. The practitioner names the pair. No similarity, text comparison or embedding decides a match.

**Theorized facts are bare rows too** (ruling 2026-10-12). "A theorized fact is a statement of fact without any source", and it is privileged "for the same reason that the Theory of the Case is privileged". It exists "as tool to give direction to investigations" and is never argued, so it never reaches a draft. Its row gains wording only when non-privileged evidence states it, as above. Decision #23 is revised accordingly.

**Why a bare row, not no row.** The `main.facts` row is what hands out `fact_id` values, and `fact_provenance.fact_id` is trigger-enforced against it (#12). No row would need the privileged side to mint IDs that cannot collide with main's, would remove a trigger pair and a delete guard, and would rewrite #12. A bare row changes no table, and #4 needs only the ID to join on.

**Sequential IDs stay.** The order in which rows were created reveals nothing about the content of any privileged communication, and neither does the number of privileged statements about the content of any one of them. A count may be shown. Nothing else about a bare row is.

**Rejected, because each resurfaces:**

- *A neutral proposition drafted from the privileged wording, for the lawyer to review.* It is a statement derived from a privileged statement. "Neutral" means attributed to no one, and it does not mean not privileged.
- *An embedding, full-text or similarity index over the privileged wording for use on the non-privileged side.* An embedding is derived from the content, and comparing it with a non-privileged statement's embedding reveals how close the two are.
- *A randomized `fact_id`.* Sequential IDs reveal nothing here (above), and the order is useful.

**Existing data.** Every matter where Path B "Yes" or `resolve-privilege` ran holds rows carrying the privileged document's wording, and every theorized fact minted before this holds its wording. `operations/bare-privileged-facts.md` §3 and §4 count them and empty them after the practitioner approves the counts. A row is emptied only after its record is on the privileged side, and no row is ever deleted.

**What does not change.** The two-store split and its firewall (#1, #2): no cross-store foreign-key path, and no schema rule that classifies privilege. The practitioner makes every privilege call, and this decision applies the consequence of one already made. `main` keeps its 25 tables and `privileged` its 3. No schema change.

## 68. `matter_data__ingest_authority` writes Path D from the extractor's result file (2026-10-13)

Path D described its writes in prose, so every session rebuilt the same SQL and pasted it, with the whole result, into one `matter_data__execute` call per decision: 16 to 43 KB each across one batch of 21, and a count query after each because the call returns only `ok` (spec `Engineering/1. Spec/2026-10-13_authority-ingest-operation-spec.md`). `matter_data__ingest_authority` takes the path of the extractor's result file and does those writes. `operations/ingest-extract.md` Path D is its only caller and its contract.

**The SQL stays in this skill.** `references/scripts/ingest_authority.py` checks the result and returns fixed statements, with the checked result bound to each as one JSON parameter read through `json_each`. It opens no database. The runtime holds no table or column name (#56, #66): it passes the statements to the execute helper and reads the table names in the returned counts as data.

**It is `matter_data__execute`'s own write path, not a second one.** The helper in `backend.ts` accepts a list of statements in place of a script and runs them through the same lock (#28), staging, trigger layer (#12, #52), single transaction, commit to disk and dump. It imports nothing, so #27's separation holds. A statement marked `refuse` is a guard: a row it returns rolls the transaction back before any write and comes back as a reason. This is not #52's rejected batch tool: one call is one document and one transaction.

**An authority is keyed on its file hash and citation together.** The same hash and citation is a re-run, and it inserts nothing. The same hash under another citation is refused for a single-authority file, because the hash tier of duplicate routing should have caught it. A bundled book's entries share the book's hash, so the caller marks an entry with `bundled_pages` and the tool allows it. A row that matches on both but is a merge tombstone (#22) is refused.

**A stored concept is reused unchanged.** The tool inserts a concept only where no row holds its name and jurisdiction, matched with `IS` so that a NULL jurisdiction matches a NULL. It never rewrites a stored concept's text, which is `amend-law`'s alone (#20). Criteria of a concept are numbered on from its highest stored order, in the extractor's order, and one whose description the concept already holds is skipped.

**`determined_by` follows Path D's three steps** (spec `2026-10-13_determined-by-jurisdiction-resolution-spec.md`): a concept in the same result, else a stored concept in the parent concept's jurisdiction, else a stub there, reported under `stubs`. The tool refuses only a name those steps cannot place: one that names concepts in several jurisdictions in the result, none of them the parent's.

**Treatments stay with `matter_data__execute`.** Matching the treated authority and choosing which of its propositions a treatment reaches are judgments (#16). The tool returns the result's `treats_prior` and the new `authority_id` for that call. A treatment is therefore a second transaction, and a failure between the two leaves a deferred treatment, a state #16 already allows.

**Case law only, for now.** The provision extractor's result has the same shape with fewer keys and the tool accepts it, but that extractor writes no result file, so the statute path still writes through `matter_data__execute`.

No agent is granted the tool. `matter_data__execute` is granted to none either, and the session that runs Path D calls both. The extractor hands its result over through `matter_data__stage_result`, not a file (#76).

## 69. Contacts and their matter roles are practice data (ADR 0009, 2026-10-16)

A party's or counsel's contact details were copied into each matter's `parties` row, so one lawyer on three files was three records that drifted. Contacts now live once, firm-wide, as practice-data `contact` items, tied to matters by `matter_role` items that carry the matter-data `party_id` and `proceeding_id` as `case_party_id` and `case_proceeding_id` (`docs/ADRs/0009-firm-wide-contacts-in-practice-data.md`, spec `docs/Specs/2026-10-16_firm-wide-contacts-spec.md`).

**`contact_info` is no longer written.** Existing values are left alone and serve only to pre-fill a contact. Counsel of record stays here as filed (#55).

**Any write that adds a party or counsel proposes its contact and role in the same approval step** (`operations/proceedings-profile.md` §3, `operations/order-effects.md` Step 3). Case data is written first, for the `party_id`, then the practice items. A refused practice write leaves the matter-data rows standing, and `practice_data__contact_checks` reports the party until its role is recorded.

No schema change. `references/scripts/list_parties.py` reads every party, read-only, for that check.

## 70. The ingest extractors run on Opus at high effort (2026-10-19)

`extract-facts` and `extract-affidavit` are pinned to Opus at high effort, in their frontmatter and on every dispatch (`model: "opus"`, `effort: "high"`), in all three of `extract-affidavit`'s passes. This reverses the extractor half of #558's split, which had the extractors inherit the session model. The token-efficiency report (`docs/Plans/2026-10-19_token-efficiency-findings.md`, Q9 and Q13) found Opus high the configuration to run, and the pin is exact: a Fable session or one at `max` effort still extracts on Opus high. Both places carry it because Cowork is verified to honour the per-call parameters only. `extract-caselaw`, `extract-provision` and `extract-sought-orders` carry the same pin in both places since commit `21748523` (2026-10-24), although their models were not measured. A machine's `CLAUDE_CODE_EFFORT_LEVEL` overrides both settings, and that is the user's own override.

**One document per extractor.** A dispatch carries one document, and a long document is never split across extractors (`operations/ingest-extract.md`, Universal rules). The report's E3 tried both rejected designs: small documents batched to about 40 pages cost 5–23% less only by finding 5–10 points fewer facts, and chunk extractors on a 54-page document cost twice as much for recall inside the single extractor's range. The rule is written down so that no later edit brings either back.

**A fresh extractor per document, in back-to-back waves.** Each document, and each exhibit on Pass 3, gets a fresh extractor, never one resumed by SendMessage and never a fork. The report's E6 found a resume saved −$0.017 to +$0.006 a document, because a run's cost is mostly output, and once lost 2 of 7 facts. A fork reads the parent's whole context, about 150k tokens against an extractor's 9k. The parallel batches of up to 10 stay: each is one wave, and the next starts as soon as the previous one has returned. A running sibling keeps the shared prefix cached (E1), so nothing waits or pings to keep the cache warm. A lapsed cache costs about $0.035 per agent type on Opus.

**Scanned affidavit pages are read natively.** Superseded by #71 (2026-10-21), with the cost rationale below. Path C's Pass 1 and Pass 2's boundary scan read the PDF natively, scanned pages included. The report's E4 found a native read takes a scan at about 100 dpi, for the same recall at 21–51% less cost than ~150 DPI renders. Two things keep ~150 DPI renders. A scanned affidavit's stamp pages are rendered and read by a letter-only Pass 2 dispatch (`STAMP_RENDERS`), because E4 did not measure handwriting and a stamp is one page per exhibit (`shared/bookmark-segmentation.md` §6). `operations/supersede-draft.md`'s page-by-page comparison keeps its renders too, since it was not measured either. Pass 1 still reports `scanned: true`, because the stamp rule keys off it.

## 71. A scanned PDF page is read only from its page image (2026-10-21)

Before any read of a PDF's content, the session calls the lawyer data server's `pdf_pages__images` (under whichever of `mcp__plugin_lawyer_data__pdf_pages__images` and `mcp__remote-devices__plugin_lawyer_data__pdf_pages__images` this host grants) for the pages to be read. A page it returns as `scanned` is read only from its PNG paths. A `born_digital` page is read natively with `Read` and `pages:`. The practitioner decided this on 2026-10-21 for two reasons: an OCR text layer is often garbled, and an invisible text layer can carry an instruction no human sees.

**A dispatch carries a page manifest, not a bare path.** The manifest is an ordered list: `{page, images: [...]}` for each scanned page, where `images` holds each image's `path` in the order the tool returns them, top to bottom, and `{pages: "a-b", pdf}` for each run of born-digital pages. A wholly scanned document is dispatched with no PDF path at all: its `DOCUMENT` gives the file name as `name` in place of `path`. A document can be mixed: one test file held two word-processor pages and six scanned ones. So the manifest is built page by page from the tool's `pages`, and never assumes that an OCR'd PDF is wholly scanned. `law_folder_text` returns a PDF with any scanned page as unread, even when its other pages are born-digital, such as a report with a scanned cover. The session then reads it through a page manifest. Its `ok` row for a PDF carries `page_count` and `scanned_pages: []` from this same classification, so that row is the PDF's manifest, its text is read, and no separate call is made. In a bridged session each PNG is staged like any other rendering (`operations/ingest-extract.md`, Universal rules). No agent gains a tool: the session renders and the agents read.

**Rendering.** The tool writes PNGs at 150 dpi into a fresh OS temp folder, never the matter tree. A page that would be wider than 2000 px is first scaled down to 2000 px wide. A page over 2000 px tall, or over about 3,000,000 px, is then split into equal horizontal tiles, so Claude Code does not shrink the image and the API does not refuse it. In the 2026-10-21 test, 150 dpi matched native recall and fixed the small-digit misreads of a 100 dpi read. The host `pdftoppm`/`pdf2image` render is gone, because Cowork has neither. The letter-only `STAMP_RENDERS` pass on every scanned stamp page is gone too: it existed to read the stamp at ~150 dpi when the boundary scan read at about 100 dpi, and the boundary scan now reads the same 150 dpi PNGs. `STAMP_RENDERS` now carries only the tiles of the small-print retry below.

**Small print.** Where a reader already reports doubt about a page (`ocr_uncertain`), the session renders that page again with `tiles: true` (overlapping tiles at 200 dpi: two for a letter-size page, more for a larger page, the top and bottom halves overlapping by about 10% of the page height, so a stamp centred on the page is whole in one of them) and dispatches that page once more. The second result replaces the first for that page only. Doubt that remains takes the existing `OCR:` / `verified = 2` route. The housekeeping reader's `readability` of `partial` or `poor` on a scanned page 1 takes the same one retry (`/housekeeping` Step 10). Pass 3's `needs_human` does not: it also fires for an exhibit longer than 60 pages and names no page, so a retry would re-read the whole exhibit, and the exhibit keeps `verified = 2`. A reader with no doubt field gets no second dispatch, and no field was added for one.

**Classification.** A page is `scanned` when images cover at least half of it and either some of its text is invisible (render mode 3 or 7, as an OCR layer is) or its visible text covers under 5% of it. So a scan with a hidden OCR layer and a visible Bates or header stamp is `scanned`. This widens the practitioner's "no text, or only invisible text" so that a stamp cannot route a scan's hidden layer to a native read.

**Known gaps.** A scanned page whose visible text covers 5% or more of it, with no invisible text, counts as `born_digital` and is read natively. A scan with no OCR layer but a large visible diagonal watermark counts as `born_digital` too, but it has no hidden layer to misread. A born-digital page that is mostly one large photo with only a small caption counts as `scanned`. That page is only rendered and read from its image, which is harmless. Text hidden under an image is not detected. In a mixed document the reader still holds the PDF path for its born-digital runs, so it could open a scanned page against its instructions. Read-only agents and the session's deterministic checks of their output limit the harm. Each reader is told to ignore instructions in the document, including text visible in a page image.

**What it supersedes.** #63's native read of scanned pages, and #70's "Scanned affidavit pages are read natively" paragraph with its cost rationale. The rest of #70 stands: Opus at high effort, chunks of no more than 20 pages, and a fresh extractor per document and per exhibit.

## 72. Counsel history is one dated practice-data counsel role per appearance (2026-10-23)

#41 kept one `replaced_representative` and one `service_address_filed_date` per party and left chains of changes to the court file. A proceeding often sees several changes of lawyer, so a second change overwrote the stored predecessor, and nobody could answer from case data who acted for a party on a given date. The practitioner chose to keep every appearance.

**Where it lives.** Case data may gain no DDL (it is a legacy store under the Exception in COMMANDMENTS.md), so the history is not a table here. Each appearance is a practice-data `matter_role` (#69) tagged `opposing_counsel` or `co_counsel`, carrying `case_party_id`, `case_proceeding_id`, `from` (on record), `to` (off record), `from_source_id` and `to_source_id` (the case-data source that dated each end) and `unfiled` (true while `from` is an unfiled notice's signed date). The cloud's upsert key for a matter role gained `case_party_id` and `from`, so one lawyer for two parties, or a lawyer back on record after leaving, gets a role for each. `contact-lookup` by matter reads a matter's roles.

**What stays.** `parties.lawyer_*`, `address`, `service_address_filed_date` and `replaced_representative`, and the per-proceeding overrides (#55), remain the current view, written as before, so every reader's output is unchanged and no migration was needed. `operations/order-effects.md` Step 3 proposes the roles beside the party fields: it closes the outgoing role and opens the incoming one from the same instrument, backfills a legacy party's roles when it is next touched, dates an unfiled notice by its signed date and moves it to the filing date by `id` when the filed copy arrives, and lets the first filing that gave an address for service open an appearance. Each approved role row is a Step 4 row with an `ORDER-EFFECT:` audit row (#36). No deadline is derived from these dates.

This supersedes #41's "chains of successive changes reconstruct from the court file" only. #41's two fields and its rejection of a history table inside case data stand.

## 73. `/housekeeping`'s work list reads ingest status and the review log host-side, through one script (2026-10-25, #174)

A housekeeping run on a matter of about 330 files passed every candidate's path and hash through the session five times before any document was read. The file-manager plugin's `housekeeping__candidates` tool now lists, hashes and name-gates the candidates itself, and reads this skill's data through `references/scripts/housekeeping_lookup.py`, spawned once per run over `PYTHONPATH` as #60's script is.

**The `files` server reads the case database only through this script.** The script executes `operations/ingest-status.md`'s probe and `ingest_status`, `operations/housekeeping-log.md`'s `-- housekeeping-log lookup` query with its placeholders bound as `?` lists, and `shared/conventions.md`'s `stored_form`, read from the skill tree beside it. The SQL and the verdict code stay in this skill, the rule the data server's case backend states, and the lookup's join rules (hash match preferred over name, `not_ingested` by hash only, the newest `ingest_failed` by hash) are the operation's, coded once in the script. The review log is still read only by its own operation's query, so #26 (d) holds.

**Its read discipline is #60's:** temp copies of all three databases in a `staging_prefix` folder, no lock, version-guarded through `resolve_paths.EXPECTED_USER_VERSION`, three statuses each with its reason, and no model-facing tool. The session keeps `ingest-status` for Step 9's second call and `housekeeping-log` for every write.

## 74. The suggestion cross-check reads names through one script (2026-10-26)

Before a suggestion leaves the computer, the data server checks its text against the words in the firm's own records (docs/Plans/2026-10-25_suggestion-design.md, decision 8). From case data it needs each document's title and file name, each proceeding's file number and style of cause, and each party's name with its counsel and firm. `references/scripts/list_record_names.py` returns them, for many folders in one spawn, over `PYTHONPATH` as #56's script is, so the SQL stays here.

**Its read discipline is #56's:** a temp copy of `main.sqlite` only (through `list_parties.read_staged`, the same staging), no lock, version-guarded through `_behind`, three statuses per folder, and no model-facing tool. It never reads `housekeeping_reviews` (#26 (d)). What it returns is never logged or sent: the data server matches against it in memory and returns only where a match lies.

## 75. `/housekeeping`'s apply writes are fixed tool calls that execute the operations' own fenced code (2026-10-27)

`/housekeeping`'s Step 15 had the session carry out `relocate-source` and `housekeeping-log` modes `record` and `retry` by hand: read the probe, run `relocate_plan`, compose SQL literals, execute, re-read. A later approval UI is to apply an approved row with no model in the loop, so each became one tool call whose arguments come straight from the approved row: `matter_data__relocate_source` and `matter_data__housekeeping_log`, with `/drafting-data`'s re-point as `drafting_data__repoint_documents`. Neither procedure needed a judgment, so nothing was left for a model.

**The markdown stays the single source.** `references/scripts/relocate_source.py` and `housekeeping_log.py` execute the operation files' own fenced probe, `relocate_plan` and statements, as #60's and #73's scripts do, so the operation text and the tool cannot disagree. The fenced blocks' marker lines and function names are therefore the scripts' interface. Neither script opens a database: the probe runs through `matter_data__query`'s path and every write through `matter_data__execute`'s (#28's lock, #12's triggers, one transaction, the dump), as #68's tool does, so #27's separation holds and the runtime holds no table or column name.

**Values are bound, not spliced.** `housekeeping_log.py` renames each entry's `:name` to `:r<i>_name` so a whole batch shares one set of params and runs as one transaction, the operation's "one call for the whole batch". This is not #52's rejected batch tool: one call is still one transaction.

**The gatekeeper rule gains one named direct caller.** Both tools are still called through their operations by every other skill. `/housekeeping` calls them directly, because its arguments are fixed by the approved row and it needs no operation text to call them. #26 (d) holds: the review log is still written only by its own operation's statements.

**Not changed:** mode `lookup` stays with `housekeeping_lookup.py` (#73), and `relocate-source`'s rules, outcomes and confirmation are as before. The host runs the tool, so its matter folder is `matter_root`.

## 78. A direction of the forum is a `procedural` source reference with a `DIRECTION:` marker, not a table of its own (2026-10-29)

A letter argued that the other side's time to object had closed at a deadline an early direction set. Two later emailed directions had overtaken it, and nothing in drafting looked (CoClerk spec `2026-10-08_draft-procedural-posture-check-spec.md`). `/draft`'s posture check now lists the proceeding's directions before it writes a passage that rests on a procedural step, so case data has to hold each direction with its date, author, proceeding, operative text and source.

**The shape already existed, so it is reused.** A direction lives on its own `main.sources` row (court or correspondence), which already carries the date, the proceeding and the file. `main.source_references` already takes `reference_type = 'procedural'`, and the facts extractor already routed procedural statements there. What was missing was a rule for the text: the extractor now writes one row per operative sentence of a forum's direction or order, its `description` exactly `DIRECTION: <author>: "<sentence>"`, the sentence verbatim, and `verify-source` treats a changed word as a clear error. `operations/procedural-directions.md` reads them newest first.

**A marker family, sibling to #36's `ORDER-EFFECT:`.** The prefix sits on `description`, not `notes`, so conventions §5's notes-prefix rule does not apply: it never sets `verified` and never routes a row to a review queue. The two families never overlap. An `ORDER-EFFECT:` row is an audit line written only on the practitioner's approval, while a `DIRECTION:` row is the forum's own words written at extraction.

**Unlinked correspondence is included.** A forum's email often reaches case data with no `proceeding_id`, because the proceeding linkage check (`operations/ingest-extract.md`) runs for court documents only. The query takes a proceeding's own rows and every unlinked row, and returns `proceeding_id` so the caller can say which were unlinked.

**Not the procedural history log.** `ProceduralHistory.md` (`shared/procedural-history.md`) records one line per event in the session's words and holds no deadline. A `DIRECTION:` row holds the forum's operative sentence verbatim, dates and all, and stays in case data. Neither is written from the other.

**An operation, not a named query.** The read lives in its own operation file, like `operations/mail-folder.md`, rather than as `@query_31` in `references/queries.sql`: that file is a legacy SQL file, and any edit to it changes its hash, which `scripts/check_publishable.py --new-since` reports as a new problem.

**Rejected.** *A `procedural_directions` table* (date, author, proceeding, text, source): a schema bump moves a dozen version surfaces, the tests and the MCP runtime's guard in one commit (`schema-bump.md`), to store what an existing row already holds. Revisit if directions need fields a source reference cannot carry, such as a link from one direction to the one it varies. *An author foreign key to `tribunal_members`*: an order or an email names its author in words, often a case manager writing for the arbitrator, and the resolver (#66) can match the words when someone needs the person.

---

**Closing principle:** schemas encode categorical invariants; prose + verifier backlog encode judgment. Do not swap them.

## 76. An extractor stages its result on the host through `matter_data__stage_result` (2026-10-28, #194)

#68's handover was a file: the session named a scratch `RESULT_PATH` outside the matter tree, `extract-caselaw` wrote its result there with `Write`, and `matter_data__ingest_authority` read the path. In Cowork the agent's `Write` lands in the session's Linux sandbox, which the data server on the Windows host cannot see, so the ingest found no file and wrote nothing (#194). No scratch folder works for both sides: the only folders they share are connected ones, a path into the matter folder names the matter to an agent that must never learn it (#10), and case data need not sit inside the connected matter folder.

So the agent hands the result to the host itself. `matter_data__stage_result` takes the output-contract object as its one argument, stores it in `%LOCALAPPDATA%\Coclerk\extract-results\<uuid>.json` and returns `{result_id, bytes}`. The agent replies `ok <result_id> <bytes>`, the byte count now being the server's, and `ingest_authority` takes `result_id` in place of `result_path` and reads only from that folder. The tool takes no path and no matter, so `extract-caselaw` drops `Write` and can write nowhere. The result costs the agent the same tokens as a `Write` did, and still never enters the session.

A staged result is kept for 7 days, and each new stage deletes the older ones. It is not deleted on a successful ingest, because Path D's rerun and conventions §2.3's verify-before-retry both call the tool on the same result again. The folder is on the User's Machine (Commandment 3). The tool stores any JSON object, so the extract-facts route (#191) can stage through it too.

## 77. The matter's mail folder is a `matter_metadata` key (2026-10-29)

Sessions reading a matter's correspondence had no record of which folder in the practitioner's mailbox holds it, so each one searched for it, and one went to a browser. `shared/matter-mail.md` (the plugins' shared doctrine) now finds the folder once through the lawyer plugin's read-only mail tools, and `operations/mail-folder.md` keeps it under the key `mail_folder`, the path exactly as `mail__list_folders` returns it.

**Why here and not practice-data.** The matter session already holds the case database, and a key in the existing key-value table needs no schema change and no new tool. Practice-data's matters table has fixed columns behind fixed tools, so the same field there would need both.

**What the key is not.** It is not identity and not a completeness key: `profile` never reports it missing, and it is not seeded by `initialize`. It is a pointer into one mailbox, the one the mail tools' credential reads. Which folder trees hold matter folders is not stored here: it is a fact about the practitioner's setup, so it lives in their environment note (`/practice-data`, Practice quirks). A second practitioner reading the same matter from another mailbox would need a key of their own, which needs its own entry here first.
