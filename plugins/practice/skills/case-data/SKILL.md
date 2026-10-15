---
name: case-data
user-invocable: false
description: SSOT for this client matter's structured case data. Use for party details and counsel, proceedings and procedural history, witnesses and experts, tribunal members, the spellings and file-name codes recorded for any of them, facts, party positions, evidence links, causes of action, issues, privileged client instructions, and the matter's stored legal authorities/concepts—both lookups or analysis and CRUD. Not the authority on what the law is (legal-research) or deadlines (docket-clerk); it stores and serves the underlying matter data they consult.
---

<!-- practice v0.3.0 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: it means the directory containing this SKILL.md, not a placeholder to search for or guess. Read references and shared files natively from there, never over the litigation data server's skill-source tool and never by requesting folder access; scripts and templates the text declares are executed and read from there too. If `${CLAUDE_SKILL_DIR}` itself no longer exists, the plugin was re-synced mid-session: list only `${CLAUDE_SKILL_DIR}/../../..` (the folder that held this plugin's folder), take the folder named as this plugin's folder with any `~g<N>` suffix removed plus the highest `~g<N>`, and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, stages, authors or requests a screenshot of one, but may present one to a human user to view, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

## Contents

| Section | Read when |
|---|---|
| How to use this file | Always, to route an intent to an operation file |
| Operation routing | Matching the user's intent to an operation file |
| Deferred design memos (discovery table) | A listed trigger fires, such as a privilege dispute or counterclaim posture |
| Retired schema names — never create or reference | Before naming a table or schema generation |

# case-data — Router

This skill is the **sole gatekeeper** for CRUD operations on a litigation matter's structured case data: proceedings, parties, witnesses and experts, tribunal members, participant aliases, sources, facts, positions, evidence links, issues, causes of action, privileged client instructions, and legal authorities. Other skills consume this data only through it. All case data is local SQLite; there is no cloud backend.

## How to use this file

1. Match the user's intent to one row of the routing table below.
2. Read **only** the identified operation file under `operations/`.
3. Every operation begins by reading `shared/conventions.md` (pointer resolution, environment contract, cross-cutting conventions) — that is always the first step.
4. Before composing any SQL, read `references/schema.sql`. Never guess a table or column name.
5. Before modifying this skill itself, read `references/design-decisions.md` — it records load-bearing design decisions.

**This works from any originating skill.** If you arrived here mid-task from another skill's workflow rather than from `/case-data` itself, nothing further is required: following steps 1–4 above *is* what the `case_data__*` tools mean by "Only the /case-data skill may call this tool." Read the operation file the routing table names and do exactly what it says — for most operations that means calling `case_data__query` / `case_data__execute` yourself; `operations/migrate.md` is the exception and routes through the `migration-runner` subagent.

## Operation routing

| User intent | Operation file |
|---|---|
| "Set up an evidence database" / new matter, no `coclerk.json` | operations/initialize.md |
| "Check pointer health" / diagnose stored-versus-live path drift / run a read-only pointer sweep | operations/pointer-health.md |
| "Ingest this pleading/transcript/document" | operations/ingest.md (gate → ingest-verify.md or ingest-extract.md) |
| "Log this client email / lawyer note / internal document" | operations/ingest.md |
| "Ingest this witness statement or expert report" / record a witness or expert assignment | operations/ingest.md (gate → ingest-extract.md) |
| "Record this client instruction memo" / a client instruction changed or was superseded | operations/ingest.md (gate → ingest-extract.md) |
| "Ingest this case law / statute / authority" | operations/ingest.md (gate → ingest-extract.md) |
| "Extract facts from new documents" / "scan for new docs" / "sweep the court file for un-ingested affidavits" / scan `6. LAW\` | operations/extract-facts.md |
| "Apply this order's effects to the file" / a court order or counsel-change notice was ingested and the style of cause, trial date, party roster, or counsel of record may now be stale | operations/order-effects.md |
| "The anchor from source N is recorded" / "that date needs no anchor", on a source carrying `DATE-ANCHOR-PENDING: date not yet recorded as an anchor` | shared/conventions.md §11: clear that marker from that source with the clear statement, in one `case_data__execute` call. Nothing else is written |
| "Theorize a fact" (mint a fact the case theory needs, no evidence yet) / "dismiss a theorized fact" | operations/theorize-fact.md |
| "Which facts are still theorized?" / theorized-fact status for a matter or application | operations/query.md (`@query_22_theorized_facts`) |
| "What proceedings are in this matter?" / downstream skill needs proceedings | operations/proceedings-profile.md |
| "Check profile" / "what's missing?" / form-drafting needs profile | operations/profile.md |
| Analytical question ("show me denied facts without evidence") | operations/query.md |
| "Who is <name>?" / resolve a name, surname or file code to a participant and every spelling and code on record (find-document, a letter's sender, a file-name check) | operations/participants.md (resolve) |
| Record another spelling or file code for a participant, or a judge, arbitrator, tribunal member or registrar, after the practitioner approves it | operations/participants.md (record) |
| "Who are the witnesses or experts for this proceeding?" | operations/query.md (`@query_23_witnesses_by_proceeding`) |
| "Show open/actioned client instructions" | operations/query.md (`@query_24_client_instructions_status`) |
| "What has this party admitted?" / admissions binding one named party | operations/query.md (`@query_25_admitted_facts`) |
| "Which documents are awaiting a privilege call?" | operations/query.md (`@query_28_pending_privilege_review`) |
| "Which held authority carries this instrument's full text?" (a statute or regulation, by citation or title; a bundled copy returns the book's path and its `bundled_pages`) | operations/query.md (`@query_30_instrument_text_source`) |
| "Decide privilege for this document" / "resolve privilege review" | operations/resolve-privilege.md |
| "Empty the privileged wording out of the facts" / "make the facts known only from privileged sources bare rows" / a non-privileged source now states a fact that is a bare row (fill it) | operations/bare-privileged-facts.md |
| "Review unverified rows" / "what needs my review" | operations/review.md |
| "Re-check corrected rows" / "clear the re-verification backlog" | operations/ingest-verify.md (`@query_05d_pending_reverification`) |
| "Correct/amend a legal proposition, finding, or criterion" / apply a verifier or lint finding to law-side text | operations/amend-law.md |
| "Two authority rows for the same case/statute" / "merge duplicate authorities" / dedup `law.authorities` | operations/merge-authorities.md |
| "Verify the legal edges" / clear the edge backlog / a push reports concepts held back for unverified edges | operations/verify-law.md |
| Resolve a cited authority to a readable document (claim verification needs the source — stored authority or a named file in the matter tree) | operations/verify-law.md (§2) |
| A retired filing's research is handed over for landing in the law database (assertions, authorities, statements of law, opposing authorities, an oral decision's treatments) | operations/ingest-submission-law.md |
| Consolidation/push skill needs the push queue (unpushed/diverged concepts) | operations/push-state.md (push-queue) |
| Consolidation/push skill records a completed push (up-pointer write-back) | operations/push-state.md (record-push) |
| "Which of these files are already in the case database?" / batch ingest status by path and hash | operations/ingest-status.md |
| "Is this folder fully ingested?" / ingest coverage of matter folders named by glob, with the newest ingested correspondence date | operations/ingest-coverage.md |
| Ingest an explicit list of files without asking the practitioner anything (housekeeping's ingest step) | operations/ingest-unattended.md |
| A file was moved or renamed and its stored path must follow it | operations/relocate-source.md |
| Internal, reached from ingest, extract-facts and ingest-unattended: a draft, signed or filed copy of a court document the matter already holds, kept as one source of record with the other copy superseded | operations/supersede-draft.md |
| "Has housekeeping already reviewed these files?" / record a finished housekeeping review or a failed ingest / schedule a retry | operations/housekeeping-log.md |
| "Dump the database" / "rebuild from dump" | operations/maintain.md |
| "Migrate the case databases" / version-guard failure (never application state — row above) | operations/migrate.md |
| Opposing counsel disputes privilege / admissibility; counterclaim posture; ADR partial settlement; judicial notice; chain of custody | matching `references/deferred/` memo (see below) |

## Deferred design memos (discovery table)

These memos are problem+insight capital, not specs. When a trigger fires, read the memo, absorb the rationale, and design fresh against the then-current schema. A memo absent from this table never fires.

| Memo | Fires when | Schema context |
|---|---|---|
| references/deferred/judicial-notice-semantics.md | "Which eligible facts haven't been noticed?"; judicial notice taken on the record; a pleading invokes judicial notice | v6.9 |
| references/deferred/counterclaim-asymmetry.md | Any matter with a counterclaim or third-party notice; per-proceeding posture questions | v6.9 |
| references/deferred/hearsay-foundation-tagging.md | An actual admissibility challenge or voir dire — never routine ingestion | **pre-v6.9 — re-check table references before acting** |
| references/deferred/real-evidence-chain-of-custody.md | Integrity of a physical exhibit is challenged, or multiple custodians exist | **pre-v6.9 — re-check table references before acting** |
| references/deferred/adr-event-tracking.md | Partial settlements; multi-event ADR histories | v6.9 |
| references/deferred/authority-search.md | Build/design authority search; search by loss, fact pattern, or remedy; FTS over `law.sqlite` | v7.3 |

## Retired schema names — never create or reference

`core`, `ev`, `documents`, `evidence_items`, `legal_authorities`, `authority_propositions`, `position_kind`. These belong to retired schema generations. The current schema is v9.0: **main = 25 tables, law = 5 tables, privileged = 3 tables** (see `references/schema.sql`).
