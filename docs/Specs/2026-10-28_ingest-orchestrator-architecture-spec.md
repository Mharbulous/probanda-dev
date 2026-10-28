# Ingest orchestrator architecture spec

**Date:** 2026-10-28. **Status:** proposed. **Plugin:** `lawyer`, plus one optional `file-manager` write (§3.5).

**Scope.** This spec covers the architecture of `/lawyer:ingest-orchestrator`: the main-thread procedure, the write path, the run lease, the triage record, the document-type taxonomy, the routing table, the extractor interface, supersession, scheduling, failure handling, acceptance criteria and delivery order.

The extractor families get their own later specs (§12). This spec defines only the interfaces those specs must meet.

**Relationship to earlier documents** (each stays the source for what it decided unless this spec says otherwise):

- `docs/Plans/2026-10-19_token-efficiency-findings.md` holds the measured model, batching and return-format findings this spec relies on (E1, E3, E7, #147).
- `docs/Specs/2026-10-19_token-efficient-ingest-and-housekeeping-spec.md` §4.6 is implemented here, as §2 (an extract-facts result file and a loader).
- `docs/Specs/2026-10-24_ingest-model-routing-by-document-type-spec.md` is proposed and not built. §5 of this spec replaces its routing table, for the reason given in §5.1. When this spec is accepted, that spec gets a one-line header pointing here.
- Issue #191 asks for one short line per file and no raw extraction output or SQL in the main session. Its done-test is acceptance criterion A2. #191 dropped the idea of a dedicated ingest *agent* because a subagent cannot spawn agents. This spec keeps the orchestrator on the main thread for the same reason.
- Design decision #76 (`.claude/skills/matter-data/references/design-decisions.md`) made `matter_data__stage_result` the hand-back route. This spec extends it to every extractor.

---

## 0. Evidence and guarantees

**Baseline.** `/lawyer:ingest` (lawyer v0.10.9) ran on `5. COURT FILE#S-256622\` in matter L4443 on 2026-10-27.

**Cost.** The run cost $33.07 in total:

| Component | Cost | Notes |
|---|---|---|
| Orchestrator (Sonnet main thread) | $22.49 (68%) | 88.3M cache-read tokens, 2.0M cache-creation tokens at the 1-hour TTL, auto-compaction at 386k tokens |
| 37 Opus-high extractors | $10.57 | |

**Causes, as numbered in this spec:**

- **C1.** Every hand-back (437 KB) and every SQL script (44 scripts, 540 KB) passed through the main context. The scripts went through twice, printed and then pasted. About 40 per-exhibit write turns each re-read a 200–380k context.
- **C2.** Pass 2 always ran. On Opus it read 18 page images for Wilson and 52 across two agents for Black. A pdftotext grep of the filed copy found all 12 stamp pages for free. Its 3 body false positives drop out once only pages after the body are kept.
- **C3.** Every extraction ran on Opus at high effort. Some work did not need that tier: a 1-page e-filing statement, the boundary scan, and 1–2 page email exhibits. Some did: affidavit bodies, a 39-page share purchase agreement, bank traces that need arithmetic, illegible images, a 25-page email bundle with a privilege issue, and a 144-fact Application Response.
- **C4.** There was one agent per exhibit, and each 1-page exhibit cost 6–14k cache-creation tokens for 1–2k of output. The ≤10 wave cap added about 1.5 minutes.
- **C5.** The first extractor started at 55 minutes. One affidavit's Pass 1 went out 9 minutes after the other two. Idle gaps reached 7 and 19 minutes.
- **C6.** `pdf_pages__compare` flagged every page of a re-scan and wrote its PNGs out of the container's reach. The working method (tesseract plus composites) was rebuilt by hand for each pair. One differently named filed scan ("NOH Application" vs "NOHA") was never compared.
- **C7 (minor).** There were about 40 evidence.sql dumps. Housekeeping reads page 1 of every file and records no type.

**Guarantees this design keeps:**

- **G1.** One ingestion per matter at a time. Today this is only instruction text: `.claude/skills/ingest/SKILL.md` L23 and `operations/ingest-unattended.md` L7. No code enforces it. The per-write lock in `source/lawyer/mcp/src/case/case-lock.ts` (#28) covers one call only. §2.4 makes G1 real.
- **G2.** Per-document crash recovery. This is the honest-status rule (`shared/extraction-protocol.md`, "Register with an honest status, then flip") plus resume by re-presentation (`operations/ingest.md` Step 4).
- **G3.** A filed copy supersedes its page-identical unfiled copy, and the linked facts are kept (`operations/supersede-draft.md`, #64).
- **G4.** Privilege handling: Path B, the solicitor-client folder rule, and #2, #17, #49 and #67 (`operations/ingest-extract.md` "Path B").
- **G5.** Internals confidentiality (`.claude/skills/shared/internals-confidentiality.md`).

Paths below are relative to `.claude/skills/matter-data/` unless they start with `source/`, `docs/` or `.claude/`.

**Thresholds are estimates.** Some thresholds in this spec come neither from §0 nor from a cited file: byte caps, similarity cutoffs, sample sizes, time limits and percentage targets. Each of those is an estimate, chosen to be tuned only by the §10 measurements, and is marked "(est.)" where it appears.

---

## 1. Orchestrator responsibilities and context budget

### 1.1 Shape
- `/lawyer:ingest-orchestrator` is a lawyer skill that runs on the main thread. It must stay on the main thread because only the main thread can dispatch agents and ask the practitioner questions (#191).
- Its `SKILL.md` holds the spine of §8.
- The routing table (§5) and the failure table (§9) live in one reference, `references/routing.md`. The skill reads it once per run.
- `/ingest` hands a run to it according to the answer to open question Q2.

### 1.2 What the main thread does
1. Opens the run with `matter_data__ingest_run {action: "begin"}` and closes it with `{action: "end"}` (§2.4).
2. Calls `matter_data__triage` once for the run's files (§3).
3. Dispatches extractors from the dispatch list that `matter_data__ingest_run {action: "next"}` returns (§8).
   - Each entry is `{dispatch_id, agent, model, effort}`.
   - The Agent prompt is the one line `DISPATCH <dispatch_id>`.
   - The extractor fetches its own inputs by that id (§6.1), so manifests, matter context and answered facts never pass through the main context.
4. Receives one-line acknowledgements (§6.3) and passes each one to `matter_data__ingest_result` (§2.1).
5. Asks the practitioner the questions that tools return in `ask[]`: privilege, an unclear supersession rank, an `other` type. It batches them at natural pauses (§8.4).
6. Runs Path B for internal documents inline (§1.4).
   - The reading stays as it is today.
   - The write changes: the main thread puts its rows into a `privileged` contract object (§2.1), stages it with `matter_data__stage_result`, and writes it through `ingest_result`. It writes no SQL itself.
7. Relays each tool's `report` lines to the practitioner and nothing else.

### 1.3 What the main thread never does
- It never reads an extractor's result, a page image, a PDF page or a text layer. The only exception is Path B (§1.4).
- It never writes SQL for an extracted document. Rows come from `ingest_result`. Supersession and relocation SQL comes from generators the server runs (§2.3).
- It never compares two copies of a document. That is `pdf_pages__compare` (§7).
- It never chooses a model, an effort or a batch. That is the routing table, applied by `ingest_run next`.
- It never loads `operations/ingest-extract.md`, `shared/extraction-protocol.md` or an extractor's guidance. The rules those files give the writer move into the loader scripts (§2.2). The rules they give the extractor stay with the extractors.

### 1.4 Path B stays inline
- Path B reads internal documents inline, deliberately: "these may be privileged, and a read-only extractor subagent has no need to see them" (`operations/ingest-extract.md` "Path B"). G4 keeps that.
- To protect the budget, the orchestrator runs every Path B document after all other writes in the run (§8.3).
- If the run's Path B documents total more than 40 pages (est.), the orchestrator writes the rest of the run, ends it, and offers the Path B set as a separate run.
  - In an unattended run, the Path B documents over the cap are left out and reported for the next attended run.
  - The cap is to be confirmed by A2's measurement.

### 1.5 Context ceiling (measurable)
- **Ceiling:** the main thread's peak per-turn input, counted as input plus cache-read plus cache-creation tokens, is **≤ 100k tokens** (est.). There is no auto-compaction. The baseline compacted at 386k. The 100k leaves room for about 25k of skill text, up to about 150 document lines and Path B.
- **Loaded text budget:** `SKILL.md` plus `references/routing.md` is ≤ 80,000 characters (est.), about 20k tokens. A unit test in the skill's `tests/` enforces this.
- **Output caps** that keep tool results small:
  - `ingest_result`: ≤ 600 bytes per document (est.).
  - `ingest_run next` and `triage`: ≤ 200 bytes per file or dispatch line (est.), paginated at 50 lines (est.).
  - Each tool's schema in `source/lawyer/mcp/src/schema/case-data.ts` states its cap, and a test pins it.

---

## 2. Write path

### 2.1 `matter_data__ingest_result` (new tool, data server)

**Input:**
```
{ matter_root, run_id,
  document: { file_path, file_hash, store: "main"|"privileged" },
  contract: "facts"|"affidavit_body"|"affidavit_exhibits"|"sought_orders"|"caselaw"|"provision"|"efiling_statement"|"privileged",
  result_ids: [string],           // from matter_data__stage_result (#76)
  answers?: { privilege?, category?, proceeding_id?, participants?: {<name as extracted>: party_id} } }
```

**Behaviour:**
- It generalizes `matter_data__ingest_authority` (`source/lawyer/mcp/src/case/ingest-authority.ts`, #68).
  - `caselaw` reuses `references/scripts/ingest_authority.py` unchanged.
  - Each other contract gets one converter script in `references/scripts/`, for example `ingest_facts.py` and `ingest_affidavit.py`.
  - The `privileged` converter writes Path B's rows: the privileged source, bare `main.facts` rows, provenance with `source_note`, and client instructions. It follows `operations/bare-privileged-facts.md` and `ingest-extract.md` "Path B".
  - Each converter validates its result against its contract (§6.2), then returns fixed statements. The checked result is bound as one JSON parameter and read through `json_each`.
- The SQL stays in the skill and the runtime holds no table name (#56, #66, #68).
- Execution uses the statement helper `caseDataExecuteStatements` in `source/lawyer/mcp/src/case/backend.ts`. That gives it the same lock (#28), staging, triggers, single transaction and dump.
- **Helper change:** today `run_statements` rolls back the whole transaction on any exception or `refuse` row. The helper gains **statement groups**, where each group is `{ref, statements[]}`:
  - before each group: `SAVEPOINT g_<n>`;
  - on an exception or a `refuse` row inside a group: `ROLLBACK TO g_<n>`, then `RELEASE`, then record `{ref, reason}`, then continue with the next group;
  - a statement outside any group keeps today's rule and rolls back everything.
  - Tests cover one good group, one failing group, and a failing statement outside any group.
- **Refusals:**
  - a `result_id` that does not exist;
  - a contract mismatch;
  - a `run_id` that is not the live lease (§2.4);
  - a running bundle whose plugin version differs from the version recorded at run begin (§9, row R7).
- **Output** (≤ 600 bytes):
  ```
  { outcome: "written"|"already_written"|"refused",
    source_id, counts: {facts, positions, relief, links, exhibits},
    items: [{ref, outcome, reason?}],
    ask:   [{kind, ref, say}],
    report: [string] }
  ```
  - `items` covers exhibits and is listed only when an item did not succeed.
  - `ask` and `report` lines are in plain practitioner language with no internals (G5, §9).
  - `already_written` makes a retry safe. The tool checks the existing dedup keys before writing, so the verify-before-retry rule of `shared/conventions.md` §2.3 (L74) runs inside the tool.

### 2.2 Writer rules that move into the converters
Today the main thread applies these while composing SQL. Each one becomes converter logic and is tested in `tests/`:

| Rule | Source today |
|---|---|
| Routing category → source category, 1:1 | `shared/extraction-protocol.md` L189–210 |
| Pleading-position validation | Path A, `references/scripts/pleading_positions.py` (already a script) |
| Exhibit dedup by `(parent_source_id, letter)`, fact dedup by `(source_id, locator, description)` | `operations/ingest-extract.md` L19–21, L283 |
| Privileged informant set to NULL in main and recorded in provenance | #17, `ingest-extract.md` L268 |
| Honest status, then the flip: body `partial` until every exhibit is resolved, then `complete` or `partial` | `extraction-protocol.md` L35–39, `ingest-extract.md` Pass 3 "Finally" |
| `needs_human` or a failing exhibit → that exhibit gets `verified = 2` and the rest continue | `ingest-extract.md` Pass 3 step 4 |
| A privilege signal inside an exhibit → that exhibit is written as Path B's *Unclear* branch (facts only, `privilege_status = 'pending'`) and an `ask` is returned | new, applies #2 and #49 |

**Participant matching.**
- Converters open no database (#68). So the tool runs the existing `matter_data__resolve_participant` logic on the result's names before it calls the converter, and passes the resolved ids in.
- A name that does not resolve becomes an `ask`. Its answer comes back in `answers.participants` on the repeated call. It is never guessed.

### 2.3 Transactions, savepoints and dumps
**This replaces** "one `matter_data__execute` call per exhibit … never batch multiple exhibits into one `sql_script`" (`operations/ingest-extract.md` Pass 3 step 3).

- **A non-affidavit document** is written in one transaction (unchanged, `ingest-extract.md` L35).
- **An affidavit body** is written in one transaction when Pass 1 is acknowledged, with status `partial`. This is unchanged, `ingest-extract.md` L266.
- **An affidavit's exhibits** are written by `contract: "affidavit_exhibits"` calls.
  - Each call carries every exhibit acknowledged since the last call for that affidavit.
  - It is one transaction with `SAVEPOINT ex_<letter>` before each exhibit.
  - An exhibit that fails validation or a constraint is rolled back to its savepoint, recorded with `verified = 2` and its reason, and the next exhibit proceeds.
  - The call that resolves the last exhibit also sets the body's final status.
- **Crash recovery (G2).**
  - A staged result outlives a crash. It is kept 7 days (#76).
  - The run journal (§2.4) records every acknowledged `result_id` against its document and item.
  - On resume, `ingest_run next` lists the results that were acknowledged but not written. The orchestrator writes them without re-extracting.
  - A crash inside a transaction rolls the whole transaction back. Its results are still staged, so the call is simply repeated.
  - Recovery is therefore at least as fine as today's per-exhibit commits. Nothing paid for is lost unless the resume comes more than 7 days later.
- **Dumps.**
  - `write_dump` (`backend.ts`) keeps running after every committed call. The dump rule does not change.
  - Dumps fall from about 40 to the number of write calls: about one per document plus one per affidavit wave. That is an estimate of about 12 for the baseline folder.

### 2.4 Run lease and journal: `matter_data__ingest_run` (new tool)
- **Actions:** `begin | next | status | end`.
- **State:** host-local, beside the case locks: `%LOCALAPPDATA%\Coclerk\ingest-runs\<same 16-hex key as case-lock.ts>\`, overridable with `COCLERK_INGEST_RUN_ROOT`.
  - `lease.json` holds `{run_id, started, heartbeat, plugin_version, mode}`.
  - The owner is whoever holds the `run_id`, not a pid. Cowork shares one server process across sessions (`case-lock.ts` L7–9).
  - `journal.jsonl` is append-only and has one line per event: begin, triage, dispatch, ack, write, ask, answer, end, takeover.
  - A run's folder is deleted 30 days (est.) after its `end`.
  - The check-and-set on `begin` takes `acquireLock` from `source/lawyer/mcp/src/data-lock.ts` (#185) with its own LockSite.
- **`begin {resume?: run_id}`:**
  - **Without `resume`:** refuses `run_active` while another lease's heartbeat is less than 60 minutes old (est.). The refusal names the unfinished run's `run_id`.
  - **With the `run_id` of an unfinished run:** takes that lease over at once, logs `takeover`, and returns the run's unfinished work. Resuming after a crash or a new session is therefore one call, with no wait.
  - **Over 60 minutes without a heartbeat:** a plain `begin` takes over too.
  - The displaced holder's next call is refused `lease_lost`.
- **Heartbeat:** every `ingest_run`, `ingest_result` and `triage` call that carries the `run_id` renews it.
- **Enforcement:**
  - `ingest_result` refuses without the live `run_id`.
  - `matter_data__execute` gains an optional `run_id`. When one is given, it is checked against the lease.
  - Without one, `execute` behaves as today, so other skills' writes during a run still work under the per-write lock.
  - Every ingest path calls `begin` and passes `run_id`. That covers `operations/ingest.md`, `ingest-unattended.md`, the folder scan in `extract-facts.md` and the orchestrator. So an old path started in another session is refused `run_active` (D1).
- **Limit (unchanged from #28):** the lease is per machine. Two machines that sync the same matter folder are not serialized. That is out of scope.

### 2.5 `matter_data__execute` changes
- **New optional input `generator: {script, args}`.** The server runs an allowlisted SQL-emitting script from `references/scripts/` and executes its output in the same call, so the SQL never reaches the model.
  - The first allowlist entry is `supersede_draft.py` (`references/scripts.md` L125–131). The server runs its §4 probe and then `emit-sql` in sequence, so the plan's notes are available to `emit-sql`.
  - Relocation is not on the list, because `matter_data__relocate_source` already does it (#75).
  - Why the server runs it: a file the session writes is invisible to the host in Cowork (#76). So a session-written "staged SQL file" cannot work, and the server must produce the SQL itself.
- **Size cap:** an inline `sql_script` over 8 KB (est.) is refused with "too long to send inline: use a generator or ingest_result", but **only on a call that carries a `run_id`**.
  - Existing large callers without a `run_id` are unaffected: the statute path (#68, 16–43 KB), merge-authorities and the submission-law bridge.
  - The refusal is in the tool, not a hook, because the tool is Probanda's own.

---

## 3. Triage record

### 3.1 Tool
- `matter_data__triage {matter_root, run_id?, paths[] | folder, hints?}` is new and deterministic, with no model. It lives in the data server and reuses:
  - the page classification in `source/lawyer/mcp/src/files/extract/page-images.ts` (`scanned` / `born_digital`, #71);
  - the text extraction in `files/text-extract.ts` (pdf.js);
  - `references/scripts/extract_outline.py` for bookmarks (`shared/bookmark-segmentation.md`).
- **This amends #71.** The build session records it as a note under #71.
  - #71 forbids a *model* reading a scanned page's text layer, because that text is often garbled and can carry instructions no human sees.
  - Under this spec, a *script* reads the text layer, and only to locate pages, classify them and compare them.
  - The only things that leave the script are page numbers, labels that match the stamp pattern, counts, feature names, verdicts and hashes. No model ever receives text-layer text.

### 3.2 Fields (one entry per file, keyed by SHA-256, with its current path)
| Field | Values |
|---|---|
| `page_count`, `kind` | pdf / docx / eml / msg / doc-rtf (#62's list) |
| `pages` | ranges of `scanned` and `born_digital` |
| `text_layer` | `none` / `ocr_hidden` / `native` |
| `text_quality` | `good` / `poor` / `none`. `good` means at least 500 bytes per page (the `text-extract.ts` threshold) and at least 80% of tokens (est.) being words of 2 or more letters. |
| `type` | an id from §4, with `type_basis` (feature names matched) and `type_confidence` `high` or `low` |
| `execution` | `draft` / `affirmed` / `filed` / `unknown`, from filename words and the registry-stamp or jurat features |
| `pairs[]` | `{other_hash, basis: "name"/"content"/"both", page_delta}` |
| `segments[]` | `{kind: "body"/"exhibit"/"entry", label, start, end, by: "text_layer"/"ocr"/"vision"/"bookmark", uncertain, type}`. Covers affidavit bodies and exhibits, and the entries of a bookmarked book. `type` is the segment's own §4 type: an exhibit is `record_document` by default and `correspondence` when its first content page has letter or email header features (From/To/Subject/Sent lines, or a letterhead with a "Dear" salutation). A scanned exhibit with no usable text is reclassified when Pass 1 is acknowledged: its inventory description containing "email", "letter" or "correspondence" makes it `correspondence`. |
| `sequence_ok` | true when the exhibit labels form an unbroken sequence (below) |
| `by`, `at` | `housekeeping` or `ingest`, and a timestamp |

**Pairing:**
- **By name:** the `same_title` rule of `operations/supersede-draft.md` §1, unchanged.
- **By content:** this is new. It catches the missed "NOH Application" vs "NOHA" pair (C6). Two files form a content pair when all of these hold:
  - their page counts differ by 2 or less;
  - the 64-bit difference hashes of page 1 and the last page are each within 10 bits (est.);
  - for born-digital files, page-1 token Jaccard is at least 0.6 (est.).

**Affidavit boundaries by script:**
- **Jurat.** It is the first page matching `(SWORN|AFFIRMED)\b.{0,80}\bBEFORE ME`, case-insensitive. `body_end` is that page.
- **Stamp.** A stamp page is a page after `body_end` that matches the pattern below. It is case-insensitive, and the quotes may be straight or curly or absent:
  ```
  this\s+is\s+exhibit\s+["“”']?([A-Z]{1,2}|\d{1,3})["“”']?
  ```
- **`sequence_ok`.** True when the labels are A to Z, then AA, AB and so on, or 1, 2, 3 and so on, with no gap and no repeat. Pass 1's `exhibit_inventory` count is checked against them later (§8.2).
- This reproduces the measured C2 result: all 12 stamps found, and the 3 body false positives excluded.
- **Candidate pages for the next step** (OCR when built, otherwise vision; §5.2) are:
  - every page after `body_end` whose `text_quality` is not `good`;
  - every page between the last good stamp before a gap in the sequence and the first good stamp after it.

### 3.3 Storage
- The record is a file, `triage.json`, in the matter's case-data folder, found by `case_data_resolver.py` (#177). It is written only through the tool, atomically (tmp file then replace).
- It is not a `main.sqlite` table, because that would need a #26 exception (it is not case data and other operations read it).
- **Sync risk.** #26 warns that a sidecar file is exposed to corruption on synced storage. The risk is accepted here because the file is a derived cache:
  - an unreadable or invalid `triage.json` is renamed `triage.bad-<timestamp>.json`;
  - the run's entries are recomputed;
  - the `report` says the file list was re-read.
  - The build session records this as a new design-decisions entry that cites #26.
- It holds no per-type table or column (Commandment 5). `type` is a generic string, and `segments[]` is generic, not affidavit-specific.
- It stays on the User's Machine (Commandment 3).
- An entry is reused while its hash matches and is recomputed otherwise.
- The type is advisory. It never decides privilege and never causes a document to be skipped. Privilege stays with Path B and #2, and `never_ingest` stays with the folder map.

### 3.4 Ingest's fallback
- This is the primary path. `ingest-orchestrator` calls `triage` for every file in the run, and the tool computes any entry that is missing or out of date.
- For a file whose `type_confidence` is `low`, `ingest_run next` schedules one Haiku page-1 read, one reader per file. The reader is chosen by the answer to Q3.
- Its fields go back to `triage` as `hints`, and the type is recomputed by the same rules. If it is still `low`, the type becomes `other`, which asks the practitioner, as `extraction-protocol.md` L189–210 does today.

### 3.5 How housekeeping writes it
- Optional, and specified by the later housekeeping triage spec (§12).
- `/housekeeping` calls `matter_data__triage` twice (`.claude/skills/housekeeping/references/work-list-and-reading.md`):
  - **Before Step 9**, its ingest step, with paths only. This run's ingest then finds every entry already computed.
  - **After Step 10**, its reader step, with `hints`: each reader result's `title`, `filing_stamp`, `signature`, `readability` and `pages_read`. These sharpen the stored type for later runs.
- This is file-manager naming a lawyer tool, which is a downward reference and needs no `source/layering.json` ruling.
- Today that reader output is never persisted (`housekeeping/SKILL.md` L117: "Signals, reasons and evidence … are not written"). C7 is the cost of that.

---

## 4. Document-type taxonomy

### 4.1 Output contracts
- **F** (facts): the `extract-facts` contract (`source/lawyer/agents/extract-facts.md` "Output contract").
- **A** (affidavit): body, then exhibits (`extract-affidavit.md` Passes 1 and 3). An exhibit's item contract is F without `basis_of_knowledge` and `informant`.
- **SO** (sought orders): `extract-sought-orders.md`.
- **L** (caselaw) and **P** (provision): unchanged.
- **E** (e-filing statement): new and script-only.
  - It writes no fact rows.
  - It writes source metadata: filing date, registry, file number and the document filed, linked to that document's source when it is held.
  - It adds one procedural-history entry through the existing `matter_data__procedural_history_append` logic.
  - These are fields copied from a fixed form, not the wording of a fact (§5.2, tier S).
- **R** (register only): no facts are extracted.

### 4.2 Types
Each type maps to a glossary id in `.claude/skills/shared/document-types.md` "Types". Types that share a contract differ only by *module*, a guidance file the agent reads (§6.1). A later spec specializes a module, not an agent.

| Type id | Glossary id | Distinguishing features (any one with `high`; see §3.2) | Contract | Module |
|---|---|---|---|---|
| `affidavit` | court_filings / documents_exchanged | jurat pattern; "AFFIDAVIT" title on p1; `I, <name>, of` opening; AFF code in filename | A | affidavit |
| `affidavit_book` | court_filings | ≥2 jurats or bookmark classes per `bookmark-segmentation.md` §3 | A per affidavit (Path E) | affidavit |
| `pleading` | court_filings | "NOTICE OF CIVIL CLAIM", "RESPONSE TO CIVIL CLAIM", "COUNTERCLAIM", "PETITION", "RESPONSE TO PETITION"; `Form \d+` | F | pleading |
| `notice_of_application` | court_filings | the two structural signals of `ingest-extract.md` L122–131 | F + SO | court_document |
| `application_response` | court_filings | "APPLICATION RESPONSE" title | F | court_document |
| `order_or_reasons` | court_filings | "THIS COURT ORDERS"; "ORDER MADE AFTER APPLICATION"; "Reasons for Judgment" in the matter's own proceeding (extract-facts §4) | F (then the order-effects leg) | court_document |
| `efiling_statement` | court_filings | Court Services Online e-filing statement or filing-receipt layout on born-digital pages | E (script); F at tier O if scanned or not parsed | — |
| `other_court_document` | court_filings | requisition, notice of hearing, notice of change of lawyer, appointment | F | court_document |
| `correspondence` | the six `correspondence_*` ids | letter or email header fields; `.eml` / `.msg` | F | correspondence (audience from glossary id) |
| `client_or_internal` | client_communications, retainer_and_billing, work_product | glossary flag `privileged_by_default`; solicitor-client folder | Path B inline (§1.4) | — |
| `record_document` | documents_exchanged, searches | a list of documents, a produced document or a search result; also an affidavit exhibit by default (§3.2 `segments[].type`) | F | record |
| `transcript` | trial_materials / documents_exchanged | Q/A line numbering; "examination for discovery" | F | transcript |
| `witness_or_expert` | documents_exchanged | as `ingest-extract.md` L229–236 | F | record |
| `financial_record` | documents_exchanged | bank statement or trace layout; ledger tables; an agreement with schedules of amounts | F | financial |
| `disbursement_record` | disbursement_records | invoice or receipt for a cost paid on the matter | R (§4.3) | — |
| `authority` | authorities | glossary flag `authority` | L / P | — |
| `never_ingest` | drafts, raw_intake | glossary flag `never_ingest` | none | — |
| `other` | — | nothing matched | asks the practitioner (`extraction-protocol.md` L189–210) | — |

**Modules that share contract F:** correspondence, record (discovery documents and exhibits share it), pleading, court_document, transcript and financial. Client, counsel and internal correspondence share the correspondence module's contract; client and internal correspondence differ only in being routed to Path B.

### 4.3 Disbursement records go to practice data
- A disbursement record is a firm billing record: a cost paid on the matter. It is not evidence of what happened between the parties. The bill-of-costs workspace already takes disbursements from a disbursement CSV export, "not from case data" (`.claude/skills/calculate/references/bill-of-costs-workspace.md` L107).
- **This changes** `extraction-protocol.md` L205, which maps `disbursements` to a case-data source category. Ingest now registers the file for coverage only (contract R) and extracts no facts.
- The amounts belong in a practice-data store that the financial-and-disbursement spec (§12) defines. None exists today: `.claude/skills/practice-data` has no disbursement store.
  - Practice-data writes are checked by Probanda's Cloud (`.claude/skills/practice-data/SKILL.md`).
  - So that spec must keep the amounts and payees on the User's Machine (Commandment 3) and add no store per tag type (Commandment 5).
- **Exception:** a disbursement record that is an affidavit exhibit, or that supports a special-damages claim, is a `record_document` and is extracted as evidence.

---

## 5. Routing table and tiers (amends #70)

### 5.1 Why facts stay on Opus high
The 2026-10-19 findings (E7) measured fact recall on whole documents:

| Configuration | Recall | Cost per document |
|---|---|---|
| Opus high | 0.83 | about $0.36 |
| Opus medium | 0.74 | $0.28 |
| Sonnet high | 0.67 | $0.17–0.22 |
| Haiku high | 0.58, with wrong and reversed claims | $0.02 |

- The 2026-10-24 routing spec's Haiku-for-correspondence and Sonnet-for-exhibits table contradicts that measurement. It is replaced here.
- This design must not lose extraction quality. So **every output that is a fact, position, relief item or legal statement stays on Opus high**.
- C3's over-specified items are handled by moving work that is not fact extraction off Opus: boundary location, stamp letters, e-filing fields, and comparison.
- Short exhibits can drop a tier only through the trial in §5.3.

### 5.2 Tiers (mechanical criteria)
| Tier | Model / effort | Criterion: a task belongs to the lowest tier whose criterion it meets |
|---|---|---|
| **S** | script, no model | Its output is page numbers, letters, hashes, counts, verdicts against fixed rules, or the fields of a born-digital fixed-layout form. It never produces the wording of a fact. |
| **H** | Haiku / high | It locates pages, reads labels of 2 characters or fewer, or compares page images, and a deterministic check catches a wrong answer (sequence check, count check, page-delta check). It never produces facts. |
| **M** | Sonnet / high | No task by default. It is entered only by §5.3. |
| **O** | Opus / high | Any output that is a fact, position, relief item, sought order or legal statement (E7). |

**Escalation (applied by `ingest_run next`, never chosen by the orchestrator):**
- S fails or is uncertain → OCR on the §3.2 candidate pages, if Q1 builds it → H on the pages still unresolved.
- H uncertain → one tiled retry at 200 dpi (#71 "Small print") → O on only the unresolved pages.
- O fails → the existing `verified = 2` or `failed` status.
- No task escalates twice at the same tier.
- *Uncertain* means any of: `ocr_uncertain`; `sequence_ok = false`; Pass 1's inventory count ≠ the stamp count; or a `failed` acknowledgement.

### 5.3 Trial gate for tier M
- A fact module moves to M only when all of the following hold:
  - a keyed trial by the E7 method (blind scorer, at least 30 gold facts of that module, at least 2 runs per cell; all est.) shows recall within 3 points (est.) of O;
  - the trial shows no wrong or reversed claim;
  - Brahm records his acceptance as a new design-decisions entry. A change to this table is a change to extraction quality, so a human accepts it.
- **Candidates:** 1–2 page correspondence exhibits and record documents of 2 pages or fewer (C3).
- Until a module passes, it stays on O.

### 5.4 The table
| Type or task | Handler | Tier | Batching |
|---|---|---|---|
| Triage, pairing and boundaries for every file | `matter_data__triage` | S | the whole run in one call |
| Low-confidence type | page-1 reader (Q3) | H | one file per dispatch, as `housekeeping-reader.md` runs today |
| Stamp letters when S is uncertain, or a scan with no usable text layer | new agent `lawyer:locate-stamps` (Read, `stage_result`) | H | ≤40 pages per dispatch, the existing Pass 2 batch |
| Pass 2 escalation | `extract-affidavit` PASS 2 on only the unresolved pages | O | one per affidavit |
| Affidavit body (Pass 1) | `extract-affidavit` PASS 1 over pages 1 to `body_end` when triage found the jurat, otherwise pages 1 to 20 as today (`ingest-extract.md` "Pass 1") | O | one per affidavit, 20 pages per read (#70) |
| Exhibit (Pass 3) | `extract-affidavit` PASS 3, module from the exhibit's type | O (M only via §5.3) | one per exhibit; §6.4 governs small exhibits |
| Pleading, court document, correspondence, record, transcript, financial, witness or expert | `extract-facts` with module | O | one per document (#70) |
| Notice of application | `extract-facts` and `extract-sought-orders`, dispatched together | O | one each |
| E-filing statement | converter `ingest_efiling.py` | S; escalates to O on a scanned page or a parse failure | in the triage call |
| Re-scan or version comparison | `pdf_pages__compare mode:"rescan"` | S; `unread` and `review` pages go to H `compare-pages` (advisory only, §7.3) | ≤5 pages per group (existing) |
| Authority | `extract-caselaw` / `extract-provision` | O (unchanged) | one per decision |
| Client or internal | Path B inline | main thread | last in the run |
| Disbursement record | register only | S | in the triage call |

### 5.5 How #70 is amended
The build session replaces #70's first paragraph with the following:
- The fact extractors (`extract-facts`, `extract-affidavit` Passes 1 and 3, `extract-sought-orders`, `extract-caselaw`, `extract-provision`) stay pinned to Opus high, in frontmatter and on every dispatch.
- Locate-only work (boundaries, stamp letters, page-1 type) runs at tier S or H under `references/routing.md`.
- Pass 2 runs only as the O escalation of §5.2. Its condition "Only if Pass 1's `exhibit_inventory` lacked exhibit page starts" (`ingest-extract.md` "Pass 2") is deleted, because C2 showed it is always true.
- #70's "one document per extractor" and "fresh extractor per document" stand, except as narrowed by §6.4.
- The parity test that pins the law extractors (`tests/test_plugin_agent_parity.py`, commit `6975959d`) stays, and gains `locate-stamps` at Haiku high.

---

## 6. Agent interface contract

### 6.1 Every extractor receives
**How inputs arrive.**
- The prompt is the one line `DISPATCH <dispatch_id>`.
- The agent's first call is `matter_data__dispatch_inputs {dispatch_id}`, a new read-only tool. It returns the inputs that `ingest_run next` stored for that dispatch.
- The tool serves `LEGAL_CONTEXT` without parties to legal extractors (#10). It never returns the matter root.

| Input | Content |
|---|---|
| `PAGE_MANIFEST` | the #71 manifest for the pages it reads, and only those |
| `DOCUMENT` | name, kind, date if known (#71: a wholly scanned document gets `name`, not `path`) |
| `MATTER_CONTEXT` | parties and proceedings, as today. Legal extractors get `LEGAL_CONTEXT` without parties (#10). |
| `ANSWERED_FACTS` / `ANSWERED_RELIEF` | as in `extract-facts.md` "Inputs" today |
| `MODULE` | the module id from §4.2. The agent reads that module's guidance through `skill_source__read`. |
| `ITEMS` | one or more `{ref, page_range, letter?}` entries. There is more than one only under §6.4. |
| `CONTRACT` | the contract id and version |

`ingest_run next` builds every value.

### 6.2 Every extractor returns
- It calls `matter_data__stage_result` once per item, with an object containing:
  - `{contract, contract_version, ref, ...the contract's fields...}`, plus
  - `flags[]` of `{kind: "needs_human"|"ocr_uncertain"|"privilege_signal"|"unresolved_reference", ref, page?}`.
- **Tools allowlist**, in each agent's frontmatter `tools:`:
  - `Read`, `matter_data__dispatch_inputs` and `matter_data__stage_result`, plus `skill_source__read` for an agent that takes a `MODULE`;
  - each MCP tool is listed under both the `mcp__plugin_lawyer_data__` and the `mcp__remote-devices__plugin_lawyer_data__` prefix;
  - never `matter_data__execute` or any writing tool.
  - `extract-caselaw` already holds `Read` and `stage_result` (#76).

### 6.3 Reply and failure signalling
- The reply is one line per item, and nothing else:
  - `ok <ref> <result_id> <bytes>` on success;
  - `failed <ref> <reason>` on failure, where the reason is one of `unreadable`, `out_of_range`, `stage_refused`, `not_this_type`.
  - This is #76's `ok <result_id> <bytes>` with a `ref` added, so batched items can be told apart.
- A reply that is missing, malformed or multi-line counts as `failed <ref> no_ack`.
- The orchestrator passes the line to `ingest_result` (on `ok`) or to `ingest_run {action: "status", ack}` (on `failed`). It never interprets the reason.
- The agent never reports facts, counts or doubts in the reply. Doubts go in `flags`.

### 6.4 Batching small items (experiment, ships last)
- **Allowed only** for Pass 3 exhibits of the same affidavit and the same module, each 2 pages or fewer: up to 4 items and 6 pages per dispatch (est.).
- Each item is staged separately. The limits sit far below the 40 pages where E3 lost 5–10 points of recall.
- **Why gated:** E3 found that batching to 20 pages moved cost by −13% to +13%. The per-agent fixed cost is about $0.012 warm on Opus (E1). The saving is therefore uncertain, an estimate of up to $0.03 per small item.
- **Gate:** default off. It is switched on only if an A/B run on at least 20 small exhibits shows cost per item at least 15% lower, recall within 2 points (all est.), and no cross-item fact (a fact staged under the wrong `ref`).
- The ≤10 wave cap (C4) is solved by §8.1's rolling window, not by batching.

---

## 7. Supersession and duplicates

### 7.1 Pairs are formed before any extraction
- `triage` returns `pairs[]` (§3.2). `ingest_run next` sends each pair to comparison before it dispatches either file.
- What follows applies on a `pass` verdict (§7.3). Any other verdict follows §7.3.
- **Both copies are new.** Only the operative copy is extracted. The other copy is registered as superseded by the existing markers (`[SUPERSEDED-BY:#K]`, #64), with no facts of its own. G3's "keeps the same linked facts" holds because the facts exist once, on the operative copy.
- **One copy is already held.** The new copy is not extracted. On a passing verdict, the existing fold (`operations/supersede-draft.md` §4, `supersede_draft.py emit-sql`, run through `execute generator`, §2.5) moves the held copy's facts and links to the operative copy.
- **Rank** is unchanged: filed beats affirmed beats draft (`supersede-draft.md` §3). A tie or an unclear rank goes into `ask` with no proposal, as today.

### 7.2 `pdf_pages__compare` gains `mode: "rescan"`
- **Input:** `{a, b, mode: "rescan", destination_dir}`. The existing hash/pixel mode (`files/extract/page-compare.ts`) stays the default.
**Page alignment.**
- Try offsets of 0, 1 and 2 pages on each side, and keep the offset with the most `same` pages.
- Unmatched pages are allowed only at the start or end, at most 2 in total, and only when each one is a stamp or backing page.
- A stamp or backing page is one that matches the stamp pattern (§3.2), has "E-FILING STATEMENT" or "FILED" with a registry name, or is a backing sheet. A backing sheet is a page under 80 tokens (est.) that holds the style of cause and a law-firm address block.

**Allowed-mark tokens**, removed before comparing. These are the marks named in `supersede-draft.md` §2:
- signature lines: `per`, `signature`, `/s/`, and the deponent's or signer's name on the line under a signature rule;
- the jurat block, from `(SWORN|AFFIRMED)` to the commissioner line;
- registry stamp tokens: `FILED`, `ENTERED`, the registry name, a date in a stamp position, the file number;
- `DRAFT`.

**Per-page verdict.** This is strict and fails closed, following `supersede-draft.md` §2 ("a changed … word, figure … fails") and #64.
- **Native text** (`text_layer = native`, `text_quality = good`):
  - `same` when the token sequences are identical after mark removal;
  - `marks_only` when the only differences are allowed-mark tokens;
  - any other differing token makes the page `different`.
- **OCR text** (`ocr_hidden`, or OCR if Q1 builds it):
  - `same` when every remaining difference is an aligned token pair within edit distance 2 (est.) with identical digits, and there are at most 5 such pairs per page (est.);
  - any token whose digits differ, or more pairs than that, makes the page `review`.
- **No usable text:** the page is `unread`.

**`review` and `unread` pages.**
- They go to the H `compare-pages` agent (`source/lawyer/agents/compare-pages.md`) in groups of 5 or fewer.
- That agent needs a new verdict mode (D6b): `looks_same` / `differs`, plus what differs. Today it only describes what a reader would notice.
- Its answer is advisory and never yields a `pass`.

**Pair verdict.**
- `pass` only when every page is `same` or `marks_only` by script.
- `fail` when any page is `different`, or when `compare-pages` reports `differs`.
- Otherwise `undecided`.
- **Output:** `{verdict, pages:[{a, b, verdict, marks[]}], work_dir}`, ≤ 600 bytes plus 40 bytes per page (est.).
- **PNGs** go to `destination_dir`, the folder the session already uses for `pdf_pages__images` manifests, never `os.tmpdir()`. This fixes C6's out-of-reach images and can ship alone.

### 7.3 Decision rule (no question asked)
- **`pass`** → supersede by rank, automatically, in attended and unattended runs alike.
  - The marker's approver is `auto-rescan`, where today's markers hold `practitioner` (`supersede-draft.md` §6).
  - **This changes** `operations/supersede-draft.md` §5, which asks in attended runs, and `ingest-unattended.md`, which only writes a `SUPERSEDE-PENDING:` marker.
  - The `report` line tells the practitioner which copy was kept and why, in plain words.
  - In an unattended run the file move stays pending, because unattended runs never move files (`ingest-unattended.md` L52). It is offered at the next attended run, by `supersede-draft.md` §6c.
- **A tie or an unclear rank:** in an attended run, an `ask`. In an unattended run, `SUPERSEDE-PENDING:` on both, and only the first copy in path order is extracted.
- **`fail`** → record `[NOT-VERSION-OF:]` on both and ingest both as different documents. This is unchanged in effect from `supersede-draft.md` §2's fail-closed rule.
- **`undecided`, or a tool error**, is not a passing verdict:
  - in an attended run, ask the practitioner with the page list: same document or different;
  - in an unattended run, ingest the higher-ranked copy, mark the other `SUPERSEDE-PENDING:` and extract nothing from it. supersede-draft settles it later.
- The superseded file's move into `0. DRAFT*\Superseded\` stays conditional on file-manager, as today (`supersede-draft.md` §6, `source/layering.json` "conditional" ruling). Without file-manager, the step stops and tells the practitioner. It never falls back to a shell move (Commandment 7).

---

## 8. Scheduling

### 8.1 Rolling window
- `ingest_run next` keeps up to 10 extractors running. That cap is #70's wave size, kept as a concurrency limit. It returns the next dispatches whenever a slot frees up.
- **Waves are gone.** This replaces #70's "the next starts as soon as the previous one has returned".
- **Order:** largest first, by pages to read, so the longest Opus jobs start first and the tail is short (C5).

### 8.2 What runs at once
- **t₀:** `begin`, then `triage` on every file, which also does the script boundaries, pairing and e-filing fields.
- Next, comparisons for every pair, run by the tool.
- Then at once: every affidavit's Pass 1, every Pass 3 whose range came from `sequence_ok` boundaries, and every other document's extractor. All of this fills the window largest first.
  - Pass 3 no longer waits for Pass 1, because its ranges come from the script. That is C5's 9-minute stagger and 55-minute start, removed.
- **Cross-check:** Pass 1's `exhibit_inventory` letters are compared with the script's letters when Pass 1 is acknowledged.
  - A mismatch holds that affidavit's exhibit writes. `next` then schedules the §5.2 escalation for the affected range, and the held results are written once it resolves.
- **Uncertain boundaries:** an affidavit whose boundaries were uncertain at t₀ dispatches Pass 1 and `locate-stamps` together, and its Pass 3 items join the window when they resolve.

### 8.3 Writes
- Writes are serialized by the orchestrator, one `ingest_result` call at a time, under the lease and the per-write lock.
- They happen as acknowledgements arrive. So the database fills during extraction rather than after it (C5's 7- and 19-minute gaps).
- An exhibit write for an affidavit waits for its body write.
- Path B documents come last (§1.4).

### 8.4 Questions
- `ask` items are collected and asked together:
  - when the window has no free slot and nothing is waiting to be written;
  - or at the end of the run.
- Privilege questions follow Path B's three answers (G4).
- In unattended mode, the `ingest-unattended.md` "Substitutions" defaults apply, and no question is asked.

---

## 9. Failure handling

| # | Failure | Response |
|---|---|---|
| R1 | Script finds no stamps, or `sequence_ok = false`, or Pass 1 count ≠ stamp count | §5.2 escalation on the unresolved range: H `locate-stamps`, then a tiled retry, then O Pass 2 on those pages. If it is still unresolved, use Pass 1's `page_start` values if it gave them. Otherwise the body stays `partial`, the exhibits are deferred, and the `report` says which exhibits could not be located. |
| R2 | OCR or a vision letter is uncertain | The same chain from the step after the one that failed. A doubt that remains takes the existing `OCR:` / `verified = 2` route (#71). |
| R3 | Comparison tool error or `undecided` | §7.3: ask (attended), or ingest the higher-ranked copy and mark the other `SUPERSEDE-PENDING:` (unattended). |
| R4 | Extractor crash, no acknowledgement, a malformed acknowledgement, or `failed` | Journal the event. Re-dispatch once with a fresh agent (#70) at the same tier. On a second failure: locate tasks escalate per §5.2, and fact tasks give the item `verified = 2` (exhibit) or the document `failed` status. |
| R5 | `ingest_result` refuses a result as invalid against its contract | The same as R4. The `reason` names the first invalid field (internal; it is never shown to the practitioner). |
| R6 | Partial write or an execute timeout (#28's warning that a write may have committed) | Repeat the same `ingest_result` call. The tool returns `already_written` or completes. It never double-writes (§2.1). |
| R7 | Plugin re-sync mid-run (a new bundle, skill text or agent) | `begin` recorded `plugin_version`. Any call whose running bundle differs is refused `plugin_changed`. The orchestrator ends the run and tells the practitioner the ingest will resume after a restart. On the next `begin {resume}`, staged results are reused only where `contract_version` still matches, and the other items are re-dispatched. **Limit:** while the old server process keeps running, a changed agent or skill file is caught only by `ingest_result` refusing a result whose `contract_version` does not match. |
| R8 | Lease lost (a takeover) | The old holder's next call is refused `lease_lost`, and it stops without writing. |
| R9 | The orchestrator compacts or the session ends | State is in the journal. `begin {resume: run_id}` or `status` returns the next actions, so nothing depends on memory. |
| R10 | The staged result has expired (more than 7 days) | `next` re-dispatches that item. |

**Confidentiality (G5).**
- Every `report` and `ask.say` string is written from fixed templates in the tool, in plain words, with no tool, table, field, code or path into Probanda's own folders.
- A unit test greps the templates against a deny-list: tool name prefixes, the names of every case-data table and column, `result_id`, `SAVEPOINT`, `verified`, `lease`, `run_id`, `contract`.
- Internal reasons go only to the orchestrator, in `items[].reason` and `refused`.

---

## 10. Acceptance criteria

### 10.1 Test setup
- Make a test matter (for example `L4443-T1`) on Brahm's machine.
  - Its profile (parties, proceedings, counsel) is copied from L4443 through `operations/initialize.md`.
  - It holds no sources.
  - It contains a copy of `5. COURT FILE#S-256622\`.
- Run `/lawyer:ingest-orchestrator` attended on Sonnet. Answer privilege questions the same way as on 2026-10-27.
- Run it **twice** (Opus run-to-run spread, findings report Q17), and judge each criterion on the mean.
- **Baseline copy.** Before the test, copy L4443's case data into a second test matter, `L4443-B`. All baseline queries and verifications run on that copy, so verify-source corrections never touch the live matter.
  - Baseline rows are those of sources whose file is in the folder and whose ingestion ran on 2026-10-27.
- The baseline's wall time is read from the 2026-10-27 session transcript, measured from its first message to its last write.
- A developer script, `scripts/measure_ingest_run.py` (not shipped), computes A1–A5 from the session's transcript JSONL and the run journal.

### 10.2 Targets (every target is an estimate; baselines are from §0)
| # | Metric | Baseline | Target |
|---|---|---|---|
| A1 | Orchestrator share of total cost | 68% | ≤ 30% |
| A2 | Orchestrator peak per-turn input (§1.5); compactions | ~386k; 1 | ≤ 100k; 0. Also #191's done-test: no extraction output or SQL in the main transcript, checked by grepping it for `"facts":` and `INSERT INTO` |
| A3 | Time from first message to first extractor dispatch | 55 min | ≤ 10 min |
| A4 | Page-image reads per source page: rendered page images in all dispatched manifests ÷ source pages ingested, from the journal | > 1 (Pass 2 re-read 70 pages) | ≤ 1.05 where triage set `sequence_ok`; ≤ 1.3 overall |
| A5 | Total cost; wall time | $33.07; transcript | ≤ $14; ≤ 50% of baseline |
| A6 | Fact and link quality | 2026-10-27 rows | see 10.3 |

### 10.3 Quality (A6), applied mechanically
1. **Counts.** For each source in the folder, query both matters:
   - facts per source: test ≥ 95% of baseline, summed over the folder, and no single source below 85%;
   - positions, relief items and evidence links: test ≥ 95% of baseline, summed;
   - exhibits found per affidavit: equal.
2. **Verification sample.** Take 30 facts from each matter:
   - 10 from one affidavit body;
   - 10 from the 39-page share purchase agreement exhibit;
   - 10 spread across 1–2 page exhibits;
   - chosen by a fixed seed over `fact_id` order.
   - Run them through `lawyer:verify-source` (`operations/ingest-verify.md`), on `L4443-T1` and `L4443-B`. The test matter's correction rate must not exceed the baseline's by more than 2 points (est.).
   - The count thresholds in step 1 (95% and 85%) are estimates too.
3. **Supersession.** Every pair the baseline superseded is superseded the same way, with linked-fact counts on the kept copy equal to the baseline.
   - The "NOH Application" / "NOHA" pair is compared and gets a verdict.
4. **Locks.** A second `begin` on the same matter during the run returns `run_active`. A killed and restarted orchestrator resumes without re-dispatching any acknowledged item, per the journal.

A run that meets A6 but misses a cost or time target is reported with numbers. Delivery stage D8 (tier-M trials) is not built until A1–A3 pass.

---

## 11. Migration and delivery order

Each stage is a separate release by the CLAUDE.md version rule. **Minor** marks a tool-input change or a change to the agent reply contract.

| Stage | Content | Ships alone? | Removes | Version |
|---|---|---|---|---|
| D1 | `ingest_run` lease and journal; optional `run_id` on `execute`; every existing ingest path calls `begin` (§2.4) | Yes | G1 gap | patch |
| D2 | `ingest_result` for contracts F, A, SO and privileged; the helper's statement groups (§2.1); `dispatch_inputs`; `extract-facts`, `extract-affidavit` and `extract-sought-orders` fetch inputs by id, stage through `stage_result` and reply by §6.3; the converters of §2.2; the `ingest-orchestrator` skill v1, using **today's** passes and models. **Interim classifier:** `ingest_run next` routes by today's rules (folder-map type, the affidavit gate, Notice of Application detection, `ingest-extract.md` L83–131), carried into the server as code, until D4 replaces them with `triage`. | Needs D1 | C1 (most of the orchestrator cost) | minor (agent reply contract) |
| D3 | `execute generator` (supersede); the 8 KB inline cap on calls with a `run_id` | Needs D1 | C1 remainder | patch (the cap applies only to new `run_id` calls) |
| D4 | `triage` (script half): page classes, segments, text-layer boundaries and candidate pages, name and content pairs, type candidate, e-filing converter; `triage.json`; Pass 2 becomes escalation only; Pass 1 reads only to `body_end` | Needs D2 | C2, C7 (ingest half) | patch |
| D5 | `locate-stamps` (H) and the §5.2 chain; the #70 amendment of §5.5 | Needs D4 | C3 (locating) | patch |
| D6a | `compare` writes to `destination_dir` | Yes | C6 (out-of-reach images) | patch |
| D6b | `compare mode:"rescan"`, pairs before extraction, the §7.3 automatic rule | Needs D4 and D6a | C6 | patch |
| D7 | Rolling window, largest-first, Pass 1 and Pass 3 concurrent | Needs D2 and D4 | C4 (wave delay), C5 | patch |
| D8 | Tier-M trials (§5.3), per module | After A1–A3 pass | C3 (short items), if a trial passes | patch per module |
| D9 | Batching experiment (§6.4) | After D7 | C4 (fixed cost), if it passes | patch |
| D10 | Housekeeping writes triage (§3.5), by the housekeeping triage spec | Needs D4 | C7 (housekeeping half) | patch (file-manager) |
| D11 | OCR, only if Q1 is answered yes | Needs D4 | text-less scans at tier S | minor if it raises bundle requirements |

- **Main estimated savings:** D1–D3 carry most of it, because C1 is most of the $22.49. D4–D7 carry most of the time saving.
- **Ordering:** the value order is write path and context, then script boundaries, then tiering, then batching, then triage. The script half of triage moves up to D4, because the script boundaries are computed by it. Only housekeeping's write (D10) stays near the end.

---

## 12. Out of scope: later specs and their interfaces

Each later spec must meet §6 (inputs, `stage_result`, reply line, tools allowlist), name its contract version, supply the converter for its contract in `ingest_result`, and leave its module on tier O unless a §5.3 trial passes.

| Later spec | Types (§4.2) | Contract / modules | Must also define |
|---|---|---|---|
| Affidavit package | `affidavit`, `affidavit_book`, exhibit items | A; affidavit module; exhibit items use the record or correspondence module by exhibit type | Pass 1 inventory fields used by the §8.2 cross-check; how Path E feeds `triage` `segments[]` for each affidavit a book contains |
| Correspondence | `correspondence`, and the inline Path B guidance for `client_or_internal` | F; correspondence module with audience sub-guidance | email attachments in the same extractor (findings Q11/Q16); date flags for docket-clerk (`ingest/SKILL.md` step 6) |
| Discovery documents | `record_document`, `transcript`, `witness_or_expert` | F; record and transcript modules | what distinguishes a list of documents from a produced document; locators for transcripts |
| Pleadings and court documents | `pleading`, `notice_of_application`, `application_response`, `order_or_reasons`, `efiling_statement`, `other_court_document` | F + SO + E; pleading and court_document modules | the E converter's fields and parse-failure rule; how the order-effects leg is triggered from `ingest_result` |
| Financial and disbursement records | `financial_record`, `disbursement_record` | F (financial module); R plus a practice-data store for disbursements | the arithmetic checks the financial module must state; the practice-data disbursement store (§4.3) |
| Housekeeping triage | — | `matter_data__triage` with `hints`, called before Step 9 and after Step 10 (§3.5) | which reader fields become `hints`; whether the reader's `readability` sets `text_quality` |

---

## 13. Open questions (for Brahm)

If a question is still open when its stage is built, the builder takes the recommended answer.

**Q1. Bundled OCR. This departs from the commissioning brief.**
- The brief set the boundary chain as text layer, then OCR on candidate pages, then an agent, and asked for a re-scan "OCR/text diff".
- This spec defines the OCR slot (§3.2 candidate pages, §5.2, §7.2) but does not build an engine.
  - Cowork needs a self-contained bundle, so OCR would mean bundling a WebAssembly engine and its language data into the data server.
  - That reverses #63, which rested on a "no external binaries" rule.
  - The C2 and C6 evidence came from text layers and from tesseract on Brahm's host, not from a bundled engine.
- **Recommended: measure first.** Across three matters, count the stamp pages and re-scan pages with no usable text layer. Build OCR (D11) only if the H `locate-stamps` and `compare-pages` work on those pages costs more than $1 a run (est.).
- **Alternatives:** build OCR now (D11 moves after D4), or never build it.

**Q2. Entry point.**
- Does `/ingest` hand off to `/lawyer:ingest-orchestrator`, or does the orchestrator replace `/ingest` step 3?
- **Recommended:** `/ingest` remains the one trigger. It hands every request covering 2 or more documents, any affidavit, and housekeeping's unattended call (`ingest-unattended.md`) to the orchestrator. The orchestrator is user-invocable, so it can be typed. A single non-affidavit document keeps today's path until D7, then goes through the orchestrator too, so that one write path remains.
- **Alternatives:** the orchestrator replaces `/ingest` step 3 for every request from D2 on, or the orchestrator stays separate and is only typed.

**Q3. Page-1 reader for the fallback classifier.**
- Lawyer may not name `file-manager:housekeeping-reader` (layering).
- **Recommended:** move the reader to lawyer under a new name such as `lawyer:page-reader`, and have housekeeping call that. One reader then serves both. This renames an agent, which is acceptable while no other users exist.
- **Alternatives:** a second Haiku reader in lawyer, or no fallback reader (a `low` type goes straight to `other` and asks).
