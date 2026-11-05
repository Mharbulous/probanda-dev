---
name: drafting-data
user-invocable: false
description: Sole gatekeeper for the per-matter drafting database — Writings and their proceedings, the shared substance they are built from (parties, facts, documents, witnesses, authorities, relief, submissions, opposing points, gaps), job process state, counsel's review records, and the mockups rendered from them. Not the authority on what the law is (legal-research) or deadlines (docket-clerk); it stores and serves the underlying data they consult. Distinct from /matter-data — the drafting database is separate, not an extension of matter-data's main/law/privileged split.
---

<!-- litigator v0.20.1 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: it means the directory containing this SKILL.md, not a placeholder to search for or guess. Read references and shared files natively from there, never over the litigation data server's skill-source tool and never by requesting folder access; scripts and templates the text declares are executed and read from there too. Before each fresh read (a file not already in context), list only `${CLAUDE_SKILL_DIR}/../../..` (the folder holding this plugin's folder). If it holds this plugin's folder name, with any `~g<N>` suffix removed, plus a `~g<N>` higher than this plugin's folder's own (none counts as 0), or if `${CLAUDE_SKILL_DIR}` no longer exists, the plugin was re-synced mid-session: take the highest `~g<N>` copy and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, authors or requests a screenshot of one, but may present one to a human user to view, staging it first where presenting needs that, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

**Internals stay confidential** (`shared/internals-confidentiality.md`): nothing the practitioner sees names a Probanda tool, table, field, internal type or code, or explains how Probanda works inside. It hides mechanism, never an outcome or an error.

## Contents

Every-run rules first (Anti-Patterns, Configuration, Operation Routing), then jobs, schema and CRUD. Tool contracts and board files: `references/tool-contracts.md`.

# drafting-data — router and schema owner

Helper skill — not user-invocable. The single gatekeeper for the drafting database: **one SQLite database per matter**, reached only through the `drafting_data__*` / `drafting_forms__*` MCP tools. No other skill may embed SQL, resolve the database path, or assume schema shape — all of that stays here.

The drafting database is work product: a reserved item never reaches the filed face, and a session orients from the mockup's work markers (`drafting_forms__render`'s `markdown`), querying only to look up detail, refresh or verify.

## Anti-Patterns

- **Any other skill embedding SQL, resolving the drafting DB path, or opening a connection directly.** All access goes through the `drafting_data__*` / `drafting_forms__*` tools via this skill.
- **Rendering a `reserved` row, or a `killed` row, on any filed face.** Held-in-reserve/undisclosed material by design (ADR 0004); a killed submission or authority (schema v16) is reserved by construction and additionally must never resurface as a "new" candidate in a later drafting or research pass. Both are renderer defects, not business decisions to make per-call.
- **Treating the design doc's table list as informal.** `references/schema.sql` is the literal contract; if a change is needed, change `references/migrations.sql` (a new hop, never an edit to the 0 → 1 hop) and regenerate `references/schema.sql` from a fresh migration.

## Configuration

If no matter folder is connected, ask its exact path, request only it, not a parent or firm root. To compute `db_path`: prove the current matter folder live through a host-namespace surface (list it, require a known child such as `4. LAWYER BRIEF`) — never trust a stored breadcrumb — resolve `case_data_dir` the same way `/matter-data` does, and append `submission.sqlite`. `drafting_forms__open_session` is this rule's executable form: it performs exactly these steps host-side from the matter folder's absolute path, and this section stays the rule's owner. Only its pointer read is read-only: the call also migrates a database behind the bundle's schema on its own initiative (with a copy-aside backup), writes the matter's Litigation Strategy page and Work Board pages, and can return counsel and parties refusals. So it is a session-entry call, never a way to look up a path for a tool that does not open the database. A `C:\…` string is not a path inside the Cowork sandbox's Linux guest — treat any listing of it there as unproven, never as evidence of absence.

A session never reads the render or board files itself (#324): job status arrives as `background_job` on the tool responses. The pages are human interfaces generated from the databases, never read, staged or screenshotted by a session: `shared/html-pages.md`.

Render output, the board files and the bundle's schema ceiling: `references/tool-contracts.md`.

When the database is ahead of the bundle (`bundle_outdated`), or the migration source is (`schema_note`), the note names the server's build and plugin version and one next step. Relay that step as given; never call `drafting_data__migrate` for it.

## Operation Routing

Determine the operation and call the corresponding tool. Each tool's own description gives its arguments, outcomes and refusals; the file named in a row gives the rules around it. Before the first call of a tool marked †, read its section of `references/tool-contracts.md`.

Every tool below except `drafting_forms__open_session` takes an already-resolved absolute `db_path`, never a `matter_root` it resolves itself; `open_session` is the Configuration section's path rule as one call, and returns the `db_path` every other tool takes. Compute `db_path` once, per the Configuration section, before calling any of them.

| Operation | Tool | Notes |
|---|---|---|
| Read-only SQL against the schema | `drafting_data__query` | `{db_path, sql, params?}` — exactly one `SELECT`/`WITH`/`PRAGMA` statement per call (split multi-statement SQL into separate calls); no schema-guard bypass; fails clearly if `db_path` doesn't exist yet — run `migrate` first; read `references/schema.sql` first — never query from a guessed column name |
| Create a Writing | `drafting_data__create_writing` | Resolve the practitioner's phrase to one kinds-index row first. Then write the recipients and prose rows (`references/filing-checklists.md` §13) through `execute`, which never inserts a `filings` row |
| Open a Work Board with no Writing | `drafting_data__create_milestone` | `title` is the practitioner's own words. `references/filing-checklists.md` §11 |
| Record a board's statement of goals | `drafting_data__set_board_goal` † | `confirmed` only on the practitioner's bare yes to the exact wording |
| Attach a file that is no Writing to a Work Board | `drafting_data__attach_to_board` | Creates the forum-less proceeding when the matter has none. `references/filing-checklists.md` §14 |
| Record pages just shown | `drafting_data__record_viewed` † | Right after presenting a view page or a mockup copy; never a Work Board or the Litigation Strategy page |
| Record a general Writing as sent | `drafting_data__record_sent` | `send_anyway` only in the practitioner's own words, recorded verbatim. `expect_revision` is the revision the practitioner saw. `references/filing-checklists.md` §13 "Sent write" |
| Record another Writing as filed | `drafting_data__record_filed` | `expect_revision` is the revision the practitioner saw. `references/filing-checklists.md` §11 |
| Record a Writing as served | `drafting_data__record_served` | `expect_revision` is the revision the practitioner saw. `references/filing-checklists.md` §11 "Served Writings" |
| Take a Ready job | `drafting_data__take_job` | `work/references/job-session.md`, Assign |
| Assign a job | `drafting_data__assign_job` | `takeover: true` only when `work/references/take-over.md` says. Never retry to win. `references/jobs-run.md` §4 |
| Complete the held job | `drafting_data__complete_job` | `references/jobs-run.md` §9 |
| Return a `wip` job to Ready | `drafting_data__release_job` | `expected_holder` only on the practitioner's choice of "Return it to Ready". Never retry to win. `references/jobs-run.md` §10 |
| Tick a step done, or set its status | `drafting_data__set_step` | `done` only once the step's work has run. `cancelled` and `deferred` need the practitioner's own words as `practitioner_words`. `references/jobs-run.md` §6, §6b |
| Rewrite a job's title or steps | `drafting_data__rewrite_job` | The pickup rewrite on a Ready job; `held: true` for the partial replace and the held-job title cleanup. `references/jobs-run.md` §5 |
| Delete a mistaken job | `drafting_data__delete_job` | Never retry to win. `references/jobs-closeout.md` §10a |
| Merge a duplicate job | `drafting_data__merge_jobs` | Only after the practitioner's bare yes, which a hook checks. Never retry to win. `references/jobs-closeout.md` §9c |
| Re-snapshot a Writing's layout | `drafting_data__resnapshot_writing` † | Only on the practitioner's explicit instruction, while the Writing is drafting |
| All other writes: create a proceeding, ingest parties/documents, and every subsequent write | `drafting_data__execute` | `{db_path, sql_script}` — one transaction, no compare-and-swap. A script that inserts a `Legal research: ` job, or changes such a job's title or intent, is refused `research_write_refused`: `create_job` and `rewrite_job` write those. The result carries `changes`, the rows the script inserted, updated or deleted, trigger writes included; on a script that writes only job tables, `changes` 0 means its guards matched nothing and nothing was written. **A hook refusal never reached the tool** (the practitioner-words gate's refusal starts `Refused (practitioner-words gate, #784): `): quote it verbatim, add no cause, stop and ask. No retry, no reworded text, and no "did it land" re-read toward a retry. **Any other non-success result (error, timeout, rejection by the tool or database, no response) does not prove the script didn't commit:** before any further write or retry, re-read the rows it targeted (and `db_meta.revision`, which any non-exempt write moves by trigger), and re-run only if they show it didn't land. Bootstrap's retry-once rule below is safe only because bootstrap writes nothing to this database; a blind re-run of a committed script duplicates its rows |
| Schema migration | `drafting_data__migrate` | `{db_path}` — separate spawn, sole schema-guard bypass; never reachable through `query`/`execute`. Session entry runs it for a new database. Stops at the schema version the running plugin bundle was built against; the override: `references/tool-contracts.md`. **Refused** `counsel_not_reconciled` on the v43 hop: `references/tool-contracts.md` |
| Render a Writing's mockups | `drafting_forms__render` † | Read the returned `markdown` for work markers; present the file (`shared/present-files.md`), never its contents |
| Read the Work Board's lanes and cards | `drafting_forms__board_card` † | Read-only |
| Session entry from a matter folder | `drafting_forms__open_session` † | The Configuration path rule as one call; returns `db_path`. Timeout or no response: retry once, same args, then stop, quote the error verbatim |
| Session entry for any drafting skill | `drafting_forms__bootstrap` † | Start every drafting session here (usually through `open_session`), not with a query battery. Timeout or no response: retry once, same args, then stop, quote the error verbatim, no workaround |
| Pre-filing gate on an assembled package | `drafting_forms__pre_filing_check` † | Read-only: the gate reports, a job fixes |

## Job and scrutiny operations

Before any `jobs-*.md` file, read `references/jobs-common.md` (timestamps, session identity, the no-bind-parameters rule, the revision-bump exemption).

| Operation | Read when | File, section |
|---|---|---|
| Timestamps | Writing any job timestamp | `references/jobs-common.md` §0 |
| Session identity | Reading a `session_token` or `locked_by` | `references/jobs-common.md` §1 |
| Read job state | Before a substance write, or a confirm-read | `references/jobs-common.md` §2 |
| Create a job | Selected jobs or a picked Proposal | `references/jobs-create.md` §3 |
| Outline afresh | Reworking a queued job | `references/jobs-create.md` §3a |
| Intake | Pulling Proposals onto the board | `references/jobs-create.md` §3e |
| Spin off blocker jobs | Yes to a spin-off | `references/jobs-create.md` §3f |
| Stock bundle jobs and the Letter save idiom | Stock jobs, or a letter or memo saved | `references/jobs-stock.md` §3b |
| Counsel's review jobs | Pre-review passes leave nothing open | `references/jobs-stock.md` §3c |
| Create a pass finding job | A pass leaves a finding undecided | `references/jobs-stock.md` §3g |
| Create the conversion job | Conversion offer accepted | `references/jobs-stock.md` §3h |
| Create a research offer job | A research offer named to add | `references/jobs-stock.md` §3i |
| Create a research question job | A question about the law with no job, on the practitioner's approval of its issue | `references/jobs-stock.md` §3l |
| Research board writes, and migrating a research job | `/legal-research` board mode, and `shared/research-job-migration.md` | `references/jobs-stock.md` §3m |
| Create a case brief job | The practitioner asks to have a case, or a board's relied-on cases, briefed | `references/jobs-stock.md` §3n |
| Create a scrutiny review job | A scrutiny return recorded `'failed'` | `references/jobs-stock.md` §3d |
| Assign a job | A Ready job picked, or a take-over | `references/jobs-run.md` §4 |
| Approve a plan | A plan announced or changed | `references/jobs-run.md` §5 |
| Tick a step | A step is done | `references/jobs-run.md` §6 |
| Expand scope | Scope widened | `references/jobs-run.md` §7 |
| Capture a loose thread | An out-of-scope idea, or threads ranked | `references/jobs-run.md` §8 |
| Capture a loose thread with no job held | `/legal-research` capture | `references/jobs-run.md` §8a |
| Defer or undefer a loose thread | Asked to defer or bring back | `references/jobs-run.md` §8, "Deferring a loose thread" |
| Discard or restore a loose thread | Asked to drop or restore | `references/jobs-run.md` §8, "Dropping a loose thread" |
| Set a step's status | ↻, ⏳, ☒ or ⏸ on a step | `references/jobs-run.md` §6b |
| Complete a job | Every step resolved, then §14 | `references/jobs-run.md` §9 |
| Release an unfinished job | "release job #N" or Return it to Ready | `references/jobs-run.md` §10 |
| Supersede on retirement | A Writing retired | `references/jobs-closeout.md` §9a |
| Close as superseded | Keys all `(now: dead)` | `references/jobs-closeout.md` §9b |
| Merge two jobs | A merge proposed or asked | `references/jobs-closeout.md` §9c |
| Shelve or restore | Shelve, restore or delete a job or Proposal | `references/jobs-closeout.md` §10a |
| Bring forward or clear | A hold date named; never offered | `references/jobs-closeout.md` §10b |
| Move to another board | Asked; never offered | `references/jobs-closeout.md` §10c |
| Merge two boards (`drafting_data__merge_milestones`) | Asked; never offered | `references/jobs-closeout.md` §10d |
| Clear retired Work Board keys | A non-null `legacy_workboard_artifact_url` | `references/jobs-closeout.md` §13 |
| Gate job check | §9 reads `completed`, or the gate runs | `references/jobs-gate.md` §14 |
| Pre-send gate job | `record_sent` refuses `held` | `references/jobs-gate.md` §14a |
| Integrity checks | Setting `filing_id`, an edge or `charted_into` | `references/jobs-integrity.md` §11 |
| Schema refusals | A CHECK or foreign-key refusal | `references/jobs-integrity.md` §12 |
| Record a scrutiny return | A 🔬 return | `references/scrutiny.md` "Record a verified return" / "Record a failed return" |
| Record a note-up return | A 📇 return | `references/note-up.md` |
| Read a statement for its review | A review job picked | `references/scrutiny.md` "Read for review" |
| Read a submission's legal basis | Is the test on file? | `references/scrutiny.md` "Read a submission's legal basis" |
| Close a scrutiny review | A reviewed statement closed | `references/scrutiny.md` "Close a review (change or keep)" / "Close a review (drop)" |
| Reword one reviewed paragraph, move, recast, remove, restore or kill a paragraph, or swap a Writing's material to be relied on, on the fly | `/draft` runs `draft/references/revise-on-the-fly.md`; a quick edit writes only through `drafting_forms__preview_edit` and `drafting_forms__apply_edit` | `references/paragraph-revision.md` |

## Schema reference

`references/schema.sql` is the canonical current schema (its generation, the shape and what is not stored: `references/tool-contracts.md`, "Schema notes"). Never write a deadline here: the appeal deadline is a per-render `appeal_deadline` argument.

**Current version**: `db_meta.schema_version = 81` (`TARGET_SCHEMA_VERSION` in `references/scripts/migrate_engine.py`); each hop's reason is its comment in `references/migrations.sql`. `drafting_forms__open_session` migrates on every entry; below v42 it returns `migration_required`. **v42 stays readable**: a database at v42 lists and renders as current, so a refused v43 hop leaves the matter behind, never unusable. Below a later hop, that hop's feature is absent (v52 saved answers, v67 attachments, v68 deferral, v69 suppression, v74 Bring Forward, v75 discard and suggest, v76 sources to get, v80 the `kv_store` table). The rules for `kv_store` values: `references/kv-store.md`.

## CRUD guidance

- **Reserve is derived, never stored** (ADR 0004, design doc §3, schema v10): there is no `disposition` column — an item (`submissions`, `order_sought`, `authorities`, `statements_of_fact`, `rhetorical_paragraphs`) is *held in reserve* purely because no Writing's advocacy document currently points at ("deploys") it, computed at render time from the join tables. A renderer must filter a deployed face to deployed rows only — a reserved row reaching the filed face is a renderer defect, not something this skill scans for.
- **`documents.file_path`** is written in the stored form, relative to the matter root with backslash separators. Re-pointing it after a file moves: `references/document-paths.md`.
- **Elsewhere**: the per-Writing-kind write checklist, `references/filing-checklists.md`; killed items and statute currency, `references/filing-checklists.md` §1; procedural and material facts, §0; board attachments, §14; adding a document held outside the database (an affidavit already filed, a court order) to a Writing's material list, with the sole-copy best-copy rule, §16; job writes, `references/jobs-common.md`; verification, `references/scrutiny.md`; counsel's review records, `references/review.md`; on-the-fly revision, `references/paragraph-revision.md`; an authority's own text on disk, `references/locate-authority.md`; statement of goals, viewed thumbnails, the rules position tables and schema notes, `references/tool-contracts.md`.
