# Shared conventions — single source of truth

This file is the **single source of truth** for the cross-cutting semantics every operation depends on: the pointer-resolution preamble, the environment contract, the database connection pattern, the `verified` enum, notes prefixes, citation format, the bitemporal update convention, dump discipline, schema phases, the clock source for dates, the pointer JSON forms, the stored path form, the pending markers, and the wording rules. Operations reference this file rather than restating any of it. When two documents would say the same thing, this one is authoritative.

**Read this file as the first step of every operation.**

---

## 1. Environment contract

All database I/O runs through three host-side MCP tools — `matter_data__query` (read), `matter_data__execute` (write), and `matter_data__migrate` (schema upgrade) — served by the `plugins/litigation/mcp` runtime (permission-fatigue conversion, 2026-07-15+; migrate added 2026-07-27). This collapses the prior environment split for database access: the host process reaches the native `0. CASE DATA` binaries directly, so there is no per-session workspace-access prompt for the case-data folder, no in-VM heredoc, and no FUSE-staleness exposure on binary reads — the same tool contract runs identically from a local CLI session and from Cowork. **If these tools are not visible in the current session's tool list, halt immediately and report — never fall back to direct file or database access.**

`matter_data__migrate` is the only tool that bypasses the schema-version guard, and the bypass is reachable from nowhere else: `query`/`execute` are served by a separate process whose pointer resolver has no such parameter at all. See `../operations/migrate.md`.

One thing still happens in the calling session, not the backend — never via a runtime `open()`, which is unsafe on a mediated/FUSE-style mount:

- **Read the matter pointer** — `probanda.json`, else the legacy `coclerk.json` (§2.1) — from the matter root (native file-read tool — it is a matter file) to obtain `matter_root` (§2.2) — required on every `matter_data__*` call.

A write does not read `references/triggers.sql`: `matter_data__execute` loads it itself (§2.3). When an operation does read a file under `references/` (for example `queries.sql`), it is skill source, not a matter file: fetch it however this skill's own content arrived.

### E1 note

In a local command-line environment, the utility scripts under `references/scripts/` MAY still be run directly for one-off maintenance work outside the normal operation flow — see `references/scripts.md`.

---

## 2. Storage layout and the matter pointer

### 2.1 Folder layout

| Artifact | Location |
|---|---|
| `probanda.json` (pointer) | matter root. A reader falls back to `coclerk.json` (the pre-rename name, kept updated by every pointer write so an older copy of the plugin still finds the matter), then to the legacy `9. AI\coclerk.json` |
| `main.sqlite`, `law.sqlite`, `privileged.sqlite` | native `<matter folder>\0. CASE DATA\`, inside the matter folder and so inside the SharePoint-synced library (ADR 0013). A matter set up before then keeps them in the firm-level `0. CASE DATA\<matter_id> <short_name>\` until `matter_data__relocate` moves them (`../operations/relocate.md`) |
| `evidence.sql` (text dump) | beside the binaries, in the matter's `0. CASE DATA\` |

The firm-level `0. CASE DATA\` beside the matter folders holds only the practice stores (`_practice\`).

The **staging discipline** is load-bearing, not the folder location. Every `0. CASE DATA` is inside the SharePoint-synced library, so no folder choice avoids the sync exposure — a synced/FUSE-style mount serves stale file-size metadata that corrupts binary SQLite reads and writes (see §1, E2). What keeps the binaries safe is never leaving a live handle on synced storage: temp-copy staging, `DELETE` journal, copy-back. A future "simplifier" MUST NOT operate on the native binaries in place or relocate the temp-staging flow. The pointer-resolution code below carries this same design note at the path constants for the same reason.

### 2.2 `probanda.json` pointer form (schema_version 5)

```json
{
  "schema_version": 5,
  "matter_root": "C:\\...\\<matter folder>",
  "case_data_dir": "0. CASE DATA",
  "evidence_sql_path": "0. CASE DATA\\evidence.sql"
}
```

`matter_root` is a **breadcrumb, never a truth**. Every operation obtains the current, proven host-namespace absolute path of the matter folder from the live session and passes that path to the tools. The resolver writes it back for humans and diagnostics; no operation uses the stored value as its next invocation argument. This distinction matters because Cowork's sandbox sees a mounted `/sessions/…` path while the native file tools and matter-data backend use the granted Windows host path.

`case_data_dir` is also a breadcrumb, never a truth. A stored absolute or relative path may nominate a location, but it wins only when that location contains `main.sqlite`. Otherwise the resolver takes the matter's own `0. CASE DATA` when it holds `main.sqlite`, then a not-yet-relocated folder under the firm-level root found by database identity (`main.matter_metadata`, else the matter folder name), and for a new matter the matter's own `0. CASE DATA`. It is stored relative to the matter folder when it is inside it, absolute otherwise. The selected location is cached for humans and diagnostics; database operations never trust the stored string without that proof. `evidence_sql_path` retains its pre-conversion meaning (§2.1). A pointer without it gets the matter-data folder's `evidence.sql`, stored relative to the matter folder so that it holds under any user profile. It is stored absolute only when the matter-data root is on another drive.

`sources.file_path` is one too: report drift you notice mid-operation — `pointer-health.md`.

A pointer at any version other than 5 is stale: every `matter_data__*` call hard-fails with "stale pointer — re-run initialize." There is no migration path (pre-alpha) — re-running `initialize` recreates `case_data_dir` from `main.matter_metadata` if the binaries already exist.

**Matter identity lives in `main.sqlite.matter_metadata`, not in the pointer.** The pointer is a location service only; it says where the binaries are, never who the matter is.

**`matter_root` is a host path and nothing else — never use it as a path in any sandbox tool (Bash, Glob, an in-VM runtime).** It exists to be passed through to the host-side `matter_data__*` tools verbatim. The Cowork sandbox runs in a Linux guest where a `C:\…` string is not a path at all, so listing it does not raise — it fails in a way **indistinguishable from an empty directory**. Any guard that infers absence from that listing (duplicate detection, "has this been created yet", existence checks) silently false-negatives and reports a clean result it never actually established. A session that needs the matter folder as a *filesystem* location must use the mounted, practitioner-confirmed folder attached to that session, and must prove that root before deriving anything from it — list it by absolute path and require a known child: the matter pointer (§2.1), or a folder that matches a glob in the practitioner's folder map (`practice_data__folder_map`). With no folder map and no pointer, the root is unproven: say that Probanda does not yet know where the practitioner keeps each kind of document and offer setup (`/probanda-setup`). An unproven root stops.

### 2.3 The tool contract (every operation runs this first)

Pointer resolution, temp-copy staging, `ATTACH`, the schema-version guard, and the `evidence.sql` dump all run **inside** the `matter_data__query` / `matter_data__execute` tools now (permission-fatigue conversion, 2026-07-15+) — no operation file opens a connection, stages a copy, or runs `ATTACH` itself. Every operation follows the same three steps:

1. Prove the current matter folder through a host-namespace surface and use that live absolute path as `matter_root` (§2.2). Read the pointer (`probanda.json`, else `coclerk.json`) only to confirm initialization and inspect breadcrumbs; never reuse its stored `matter_root` as the live argument.
2. For a write, pass only `matter_root` and `sql_script`. `matter_data__execute` loads the cross-database trigger layer itself, on every call, from this skill's own `references/triggers.sql` (the installed plugin's bundled skill source first, else the checkout, the same place `matter_data__migrate` reads its reference SQL). If that file cannot be found or is empty, the call fails before anything is staged or committed: the tool refuses to write without the trigger layer (invariant I3).
3. Call the tool:
   - **`matter_data__query`** — `{ matter_root, sql, params? }`. `sql` must be a single `SELECT`/`WITH`/`PRAGMA` statement; the tool rejects anything else (use `matter_data__execute` for writes).
   - **`matter_data__execute`** — `{ matter_root, sql_script }`. `sql_script` may contain multiple statements; they run in one transaction against the attached `main`+`law`+`privileged` databases (triggers first; on a bootstrap — all three databases empty — after the commit, since the script creates their tables). A script-level failure rolls back the whole script and the error surfaces verbatim — no partial writes within the script, no swallowed errors. On success `evidence.sql` is regenerated automatically; callers never dump separately.

     **A non-success result does not prove the script did not commit — verify before you retry.** An error, a rejection, a timeout, or no response at all can each arrive on a script that already committed. Three paths reach that state. Inside the backend, the transaction commits and all three binaries are committed to native storage **before** `evidence.sql` is regenerated (§3), so a dump that fails — the file locked by cloud sync, a disk error — surfaces the whole call as failed on a write that landed. Also inside the backend, a commit-to-disk that fails part-way normally undoes itself and says so ("every database was rolled back and the previous set is intact", 2026-08 all-or-nothing commit) — but if the undo itself fails the error names which databases carry the new state, and that call must not be retried at all: follow the recovery it names. Outside the backend, a harness rejection or a bridge give-up after the call was dispatched reports non-success without the backend having failed at all. So before any further write or retry, re-read the rows the script targeted with `matter_data__query`, and re-run only if they show the write did not land. Most operation recipes carry no SQL guard against a duplicate re-insert, so a blind re-run is exactly how duplicate rows are created.

   - **`matter_data__ingest_authority`** — `{ matter_root, result_id, file_path, file_hash, bundled_pages? }`. Writes one extracted legal authority's rows from the result the extractor staged with `matter_data__stage_result` (#76), through `matter_data__execute`'s own lock, trigger layer, single transaction and dump. Only [`../operations/ingest-extract.md`](../operations/ingest-extract.md) Path D calls it, and that section is its contract. A result of `ok: false` with `problems` means nothing was written. Any other non-success result falls under the verify-before-retry rule above.

   - **`matter_data__migrate`** — `{ matter_root, mode, plan_token?, user_confirmation?, backup_id? }`. The schema-upgrade path; `plan` then `apply`, gated on a plan token from a fresh dry-run (`user_confirmation` echoes the plan's `user_confirmation_required` string). Full contract in `../operations/migrate.md`; run it through the `lawyer:migration-runner` subagent, not inline.

   - **`matter_data__relocate`** — `{ matter_root, mode }`. Moves a matter's case data from the firm-level root into the matter's own `0. CASE DATA` (ADR 0013); `plan` then `apply`. Full contract in `../operations/relocate.md`.

After taking the live `matter_root`, resolution treats the stored `case_data_dir` only as a proof-gated nomination, derives the live location when it is unusable, and heals the breadcrumb — written to `probanda.json` and, with the same content, to `coclerk.json` (migrate-on-write: a matter still on `coclerk.json` gains `probanda.json` at its first write, and the old name stays updated so an older copy of the plugin keeps working, until a later release removes it). A query never creates an empty database: if resolved `main.sqlite` is absent it fails with **no case database found**. Verify the matter's live `0. CASE DATA` folder and restore `main.sqlite`, or initialize a genuinely new matter.

Writes are serialized per matter: `matter_data__execute` and `matter_data__migrate` take one shared cross-process lock, so a call may fail with **`lock_unavailable`** when another session is writing to or migrating the same matter. That is not a bug to work around — retry once the other session finishes. **`lock_unavailable` is the one execute failure that is safe to retry as-is**: it is refused before any staging, so nothing was written and the verify-before-retry rule above does not apply to it. `matter_data__query` never takes the lock.

If a `matter_data__*` call fails with a **stale-pointer** error, re-run `initialize`. If it fails with a **schema-version** error, run the migrate operation — `matter_data__migrate` with `mode: "plan"` first, never `apply` on its own. (Not rebuild: rebuild replays an already-current dump and rejects an out-of-date one, so the pre-2026-07-27 guard text pointed at a dead end.) Never work around either by touching the native binaries directly. If the tools are absent from the session's tool list, halt (§1) — there is no in-VM fallback.

### 2.4 Stored path form

A stored `file_path` on `main.sources`, `privileged.privileged_sources` or `law.authorities` names the file **relative to the matter root, with backslash separators**: `Court File#S-290001\2026-01-05 NOCC.pdf`. No drive letter, no leading `\` or `.\`, no forward slash. [`../operations/ingest-unattended.md`](../operations/ingest-unattended.md) and [`../operations/relocate-source.md`](../operations/relocate-source.md) write this form, and so does every operation that says it does. Older rows may hold an absolute host path or forward slashes. Every reader accepts those, and `relocate-source.md` rewrites a row to this form whenever it moves it.

`matter_data__execute` takes no bind parameters, so a path reaches a write as a quoted SQL literal with every `'` doubled.

Convert a path to the stored form with this helper, never by hand. `root` is the matter folder the path was taken from: the live host `matter_root` for a legacy stored row, or the session's own view of the folder for a path it listed. A path that is already relative passes through with its separators normalized. Two stored paths name the same file when their stored forms are equal ignoring case, because Windows paths are case-insensitive.

```python
def stored_form(path, root):
    p = path.replace('/', '\\')
    r = root.replace('/', '\\').rstrip('\\')
    if p.lower().startswith(r.lower() + '\\'):
        p = p[len(r) + 1:]
    while p.startswith('.\\'):
        p = p[2:]
    return p
```

---

## 3. Database connection pattern (backend-internal — operations never do this directly)

This section documents what `matter_data__query`/`matter_data__execute` do internally; it is retained for anyone debugging the backend (`source/lawyer/mcp/src/case/backend.ts`), not as something an operation file implements. Main is opened as the primary connection, `law` and `privileged` are attached, `references/triggers.sql` is read by the server from the skill source and loaded as TEMP triggers, `PRAGMA journal_mode = DELETE` and `PRAGMA foreign_keys = ON` are set, and every `matter_data__execute` call runs its whole script inside a single transaction so the cross-database triggers see a consistent state (§2.3, invariant I5). WAL is forbidden — it breaks cross-database atomicity and leaves `-wal`/`-shm` sidecar files that are unsafe on cloud-synced storage. The SQLite binaries are staged into an OS temp directory for the duration of each call and copied back only after a successful commit — a live handle is never left on the SharePoint-synced `0. CASE DATA` tree. Because that stage → mutate → copy-back window is exactly where two concurrent sessions would overwrite each other, `matter_data__execute` holds the shared write lock across the whole of it (`source/lawyer/mcp/src/case/case-lock.ts`; rationale in `../references/design-decisions.md` #28).

---

## 4. Verified enum

`verified` is a four-state pipeline, not a truth flag. "Verified" means the extraction or classification quality was checked — never that a fact is true, proven, admitted, or accepted by the court.

| Value | Meaning |
|---|---|
| `0` | **unverified** — a fresh extraction, awaiting the AI verifier |
| `1` | **verified** — confirmed by the AI verifier or by the lawyer |
| `-1` | **rejected** — excluded from views (views filter `verified >= 0`) |
| `2` | **needs human judgment** — the lawyer's review queue |

The lawyer's queue is `verified = 2` only. `verified = 0` belongs to the AI verifier.

### Corrected-row quarantine

Facts and positions additionally carry `pending_reverification`. A fresh extraction
is `(verified = 0, pending_reverification = 0)`. An autonomously corrected row is
`(0, 1)` until a second verifier in a new isolated session checks the corrected
value. Pending rows are excluded from ordinary factual views and drafting reads;
they appear only in the dedicated AI re-verification backlog and source-verification
reads. The schema forbids `pending_reverification = 1` when `verified != 0` or
`human_reviewed != 0`.

`pending_reverification` is not the lawyer's queue. A successful second pass clears
it and sets `verified = 1`; an adverse second pass clears it and sets `verified = 2`.
Every human Confirm, Correct, Reject, or Delete action clears it atomically.

---

## 5. Notes prefixes

Machine-detectable annotations on the `notes` column of facts, positions, and sources. The `review_queue` view classifies `flag_type` from these prefixes.

| Prefix | Meaning |
|---|---|
| `DISCREPANCY:` | Conflicting values across sources — state both values and name the authoritative one. |
| `UNCONFIRMED:` | Content was not directly readable — the value was inferred. |
| `OCR:` | A probable scan error — state the scanned value and the probable intended value. |
| `REVERIFICATION:` | A targeted second pass did not confirm an autonomously corrected row — preserve the finding and locator for human adjudication. |

**Binding rule:** any row written with a prefixed note MUST get `verified = 2` at insert — straight to the human queue, bypassing the AI verifier. Never write `verified = 0` alongside a prefixed note. **Ingestion never sets `human_reviewed = 1`** — only the review operation sets that flag.

A bracket marker appended to a `sources` or `facts` note, such as `[SUPERSEDED-BY:#…]`, `[NOT-VERSION-OF:#…]` or `[FOLDED-INTO:#…]` ([`../operations/supersede-draft.md`](../operations/supersede-draft.md)), is not a prefix: it never sets `verified` by itself and never routes a row to the queue.

---

## 6. Citation format

Store `source_id` + `source_locator` as two columns. Display the computed citation as `<sources.file_path>#<source_locator>`. **Never store a combined `source_ref` column.**

Locator forms:

- `para. 14` — a numbered paragraph
- `para. 14(a)` — a sub-paragraph
- `p42-L3-L18` — a transcript span (page 42, lines 3–18)
- `p3` — an unnumbered page
- `¶14` — the 14th non-empty body paragraph of a rendered document (docx or email body; ordinal assigned by the renderer)
- `hdr` — an email's header block (From/To/Cc/Date/Subject)

---

## 7. Bitemporal update convention

Applies to `positions` and `evidence_links`. **Never UPDATE or DELETE the substance of a current bitemporal row.** To change a current row:

1. Close the old row: set `valid_to = date('now','localtime')`.
2. Insert the successor: `valid_from = date('now','localtime')`, `prior_id` = the old row's id.

The current row is the one where `valid_to IS NULL`. Views filter `valid_to IS NULL`
plus `verified >= 0`; factual views also require `pending_reverification = 0`. Every read of facts that serves drafting, a list or a page also skips a **bare row** (`description = ''`, a Fact known only from a privileged source: design-decisions #67). That applies to an ad-hoc read as much as to a view.

---

## 8. Dump discipline

Run the maintain dump after **every** mutation. `evidence.sql` is the durable text boundary that survives cloud-sync corruption and is the rebuild/migration source. **Never read `evidence.sql` to inspect live state** — only the maintain/rebuild flow or an explicit dump-inspection request reads it. To inspect live data, query the staged database copies.

---

## 9. Schema phases

Adoption guidance for building out a matter's data — not a hard gate:

- **Phase 1 (minimum viable):** proceedings, parties, sources, facts, positions, evidence_links.
- **Phase 2:** the law tables plus causes_of_action, coa_criteria, criteria_facts.
- **Phase 3:** issues plus their junction tables (issue_facts, issue_criteria).

---

## 10. Clock source for "now" dates

Every "now" **date** matter-data writes (a dated note or marker such as `CORRECTED`, `REJECTED`, `NEEDS HUMAN`, `DISMISSED`, `ORDER-EFFECT: … approved`, `V73 CAPTURE SWEEP COMPLETE`; a bitemporal `valid_from`/`valid_to`; a stamp such as `last_verified_at` or `reviewed_at`) is the **host local date**, `date('now','localtime')`, computed **in the statement that writes it**. Never type a date, and never infer one from the conversation. Date only, `YYYY-MM-DD`, including `last_verified_at`.

- **Host, not sandbox.** `matter_data__query` and `matter_data__execute` run host-side Python, so `'localtime'` is the practitioner's wall clock. A Cowork sandbox clock is UTC and would disagree for seven or eight hours each evening.
- **Pure scripts take the date as an argument.** `merge_authorities.py` (`--merge-date`) and `submission_law_bridge.py` (`--ingested-on`) never read the clock. The operation first runs `SELECT date('now','localtime') AS today` through `matter_data__query` and passes that value unchanged.
- **Name the column on insert.** The schema's `DEFAULT (date('now'))` columns (`valid_from` on `positions`, `evidence_links`, `admissions`, `relief_positions` and `privileged.client_instructions`; `facts.created_date`) default to UTC. An insert into those tables sets the column explicitly with `date('now','localtime')`; never rely on the default. The defaults change at the next scheduled schema bump.
- Rows written before this rule may hold a UTC date, one day late for an evening write. They are not rewritten.

Out of scope: dates taken from a document (a fact's date, a filing date), and the UTC ISO datetimes that `push-state.md` (`pushed_at`) and the migration runner stamp, which record machine events, not practitioner dates.

---

## 11. Pending markers

Six fixed markers record work an ingest deferred, or a file an ingest read by reference. The data server's tools write the five pending markers for [`../operations/ingest-unattended.md`](../operations/ingest-unattended.md). An attended ingest writes one of them, `SUPERSEDE-PENDING:`, when its question about the pair gets no answer ([`../operations/ingest-extract.md`](../operations/ingest-extract.md), "Another copy of a registered source"). [`../operations/ingest-extract.md`](../operations/ingest-extract.md) Path D writes `[SECOND-COPY:]`, and for an unattended run the tool writes it by the same rule. They are not §5 prefixes: they never change `verified` and route nothing to a review queue. Each is appended on its own line after any existing note, never prepended, because `review_queue` classifies notes by position-anchored prefixes (`../references/design-decisions.md` #42). The text is fixed, so a substring test finds a marker and a plain `REPLACE` removes it.

| Marker (exact text) | Column | Means | Cleared by |
|---|---|---|---|
| `ORDER-EFFECTS-PENDING: order-effects pass not yet run` | `main.sources.notes` | the source is an order or counsel-change notice whose effects pass was deferred | [`../operations/order-effects.md`](../operations/order-effects.md), when the pass runs to its end |
| `LINKAGE-PENDING: proceeding linkage check not yet run` | `main.sources.notes` | the proceeding linkage check needed the practitioner and was deferred | [`../operations/proceedings-profile.md`](../operations/proceedings-profile.md) §6, when the check reaches an outcome for the source |
| `DATE-ANCHOR-PENDING: date not yet recorded as an anchor` | `main.sources.notes` | the source is correspondence from the forum that sets a date, and no anchor has been recorded from it | [`../SKILL.md`](../SKILL.md)'s clear route, once the practitioner has recorded the anchor through `lawyer:docket-clerk` or says none is needed |
| `SUPERSEDE-PENDING: possible other version of source #<id>.` | `main.sources.notes` | the source is a court document an ingest registered while source `<id>` may be another version of it: an unattended ingest, or an attended one whose question about the pair got no answer. The text is fixed for each pair; the closing period keeps `#3.` from matching inside `#34.` | [`../operations/supersede-draft.md`](../operations/supersede-draft.md), when the pair is decided, or when the row carrying it is superseded by any pair |
| `[TREATMENT-PENDING:<citation>\|<treatment>\|<scope>]` | `law.authorities.notes` | an unattended ingest read this decision, and it treats the earlier decision named. Whether that one is held, and which of its propositions the treatment reaches, is an attended judgment (`../references/design-decisions.md` #16). The authority's row is the treating authority | an attended Path D run, or [`../operations/verify-law.md`](../operations/verify-law.md) §6, once the treatment is applied or the deferral is reported |
| `[SECOND-COPY:<sha256>]` | `law.authorities.notes` | a second file of this authority, with that hash, was read by reference: the citation matched, nothing was extracted, and the authority stays the file of record | never: the hash is that file's lasting identity |

A marked source still counts as ingested. Append a marker (named values are SQL literals, §2.4):

```sql
-- pending marker: append
UPDATE main.sources
SET notes = CASE WHEN notes IS NULL OR notes = '' THEN :marker
                 ELSE notes || char(10) || :marker END
WHERE source_id = :source_id
  AND (notes IS NULL OR instr(notes, :marker) = 0);
```

For `[SECOND-COPY:]`, run the same statement against `law.authorities`, keyed on `authority_id`. On a merge tombstone (notes starting `[MERGED-INTO:#<C>`) append to the canonical row `<C>` instead. Clear a marker (`[TREATMENT-PENDING:]`: the same statement against `law.authorities`, keyed on `authority_id`):

```sql
-- pending marker: clear
UPDATE main.sources
SET notes = NULLIF(REPLACE(REPLACE(REPLACE(notes, char(10) || :marker, ''),
                                    :marker || char(10), ''), :marker, ''), '')
WHERE source_id = :source_id
  AND instr(notes, :marker) > 0;
```

---

## 12. Wording rules

- Never write "status" for where a fact stands between the parties. Write "posture". "Status" is for the lifecycle of a proceeding or of a source's ingestion.
- Never write "claim" as shorthand for a cause of action. Write "cause of action" or "asserted cause of action".
- Never split a qualified admission into an admit row and a deny row. Record one `admit` position with the limiting words verbatim in `qualification`, never paraphrased.
