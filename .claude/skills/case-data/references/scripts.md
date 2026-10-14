# Local utility scripts — registry (`references/scripts/`)

These are **E1-only conveniences** that mirror the inline behavior embedded in
the operation files. Each ports a piece of the same logic to a standalone Python
3 command-line tool that uses only the standard library (`sqlite3`, `hashlib`,
`json`, `os`, `re`, `shutil`, `tempfile`, `uuid`, `argparse`, `sys`, `zipfile`,
`xml.etree`, `email`, `html`). They are run directly as `python3 <script>.py
<args>`.

**Status after the permission-fatigue conversion (2026-07-15+, handover 123B):**
none of these scripts are retired. They were never part of the in-VM (E2/Cowork)
database path this conversion removed — that path was the *inline* Python code
embedded directly in the operation `.md` files (now routed through
`case_data__query`/`case_data__execute`, see `../shared/conventions.md` §2.3);
these standalone CLIs were always E1-only mirrors of that logic, kept as
optional local tooling, and remain valid. `rebuild.py` still backs the
**unconverted** rebuild mode (`../operations/maintain.md`), which could not move
onto the `case_data__execute` contract because that contract has no "validate a
from-scratch reconstruction, then conditionally replace" mode.

**Migrate converted 2026-07-27.** It now runs host-side through
`case_data__migrate` (`../operations/migrate.md`) from any environment. Two
consequences for this directory:

- `migrate_engine.py` joins it — the engine behind the tool. It is a **module**,
  not a CLI: the MCP server puts this directory on `PYTHONPATH` and imports it.
  It lives here rather than in the sibling `scripts/` dir precisely because its
  material is here — it imports `rebuild` and `resolve_paths` as bare siblings,
  and reads `migrations.sql`/`triggers.sql`/`queries.sql` through
  `rebuild.read_ref()`.
- `rebuild.py` gained a second role: `migrate_engine` imports it and calls
  `upgrade_74_to_75` / `upgrade_75_to_76` directly on its own staged temp
  copies. Those two are now **host-side implementation detail of the tool** as
  well as E1 CLI internals. Treat them as a public interface of this module:
  they must stay pure in-temp transforms over a `{main, law, privileged}` path
  dict, reading no pointer, no `evidence.sql`, and no native file.

`dump.py` is the one script whose job the conversion made
redundant for normal use (`case_data__execute` now dumps automatically on every
write) — it is kept as a manual recovery lever, not deleted, since dump mode in
`maintain.md` still documents an E1-independent way to force a re-dump.

## Execution rules — E1 only (read this first)

The environment contract in [`../shared/conventions.md`](../shared/conventions.md)
§1 is binding. It distinguishes two environments:

- **E1 — Native filesystem** (a local command-line environment on the
  practitioner's machine): direct file I/O is trustworthy. **These scripts run
  only here.**
- **E2 — Mediated / sandboxed filesystem** (a container or sandbox where the
  matter folder arrives over a network- or FUSE-style mount): file-size metadata
  can be stale, which corrupts binary reads/writes and can silently truncate
  files read by a language runtime.

**In E2 these scripts MUST NOT be executed, imported, copied, or staged.** The
mount can serve stale or truncated bytes, so a script read from
`references/scripts/` (or a `main.sqlite` staged through it) may be a corrupt
copy — a hash of a truncated file, a dump of a partial database, a rebuild from
a truncated `evidence.sql`. In E2, use the **inline operation code** in the
operation files instead (which reads critical text files as §1 directs, never a
runtime `open()`). See
[`../shared/conventions.md`](../shared/conventions.md) §1 (the "Rules that apply
only in E2" block) for the full contract.

**`render_document.py` is exempt from this E1-only rule.** The E2 prohibition
above protects sqlite binaries and their staged copies from stale-mount
corruption; `render_document.py` opens no database, imports neither
`resolve_paths` nor `fuse_safe_io`, and resolves no matter pointer — it reads
one matter document the same way the ingest gate's inline hash step already
does in-session, on every path, in E2 (`../operations/ingest.md` Step 2). It
runs in both E1 and E2.

**`extract_outline.py` is exempt for the same reason.** It opens no database,
imports neither `resolve_paths` nor `fuse_safe_io`, and resolves no matter
pointer — it reads one matter document's bookmarks, the same class of read as
`render_document.py`. It runs in both E1 and E2. Stdlib only: `zlib`, `re`,
`json`, `sys`, `os`, `collections` — no `pypdf`, no PyMuPDF (`case-data/references/design-decisions.md`
#45).

Behaviors shared by every script (except `render_document.py`,
`merge_authorities.py` and `submission_law_bridge.py`, all exempt for the
reasons stated at their own entry below):

- **Built-in SQLite only** (`sqlite3` module) — never a `sqlite3` CLI binary.
- **`PRAGMA journal_mode = DELETE`** on every connection (WAL is forbidden).
- **Temp-copy staging** (`fuse_safe_io`): the native `.sqlite` binaries are
  copied to an OS temp directory, operated on, closed, and — for mutating tools
  (`dump`, `rebuild`, `migrate`) — copied back atomically. Native binaries are
  never mutated in place.
- The binaries live in the **native sibling** `0. CASE DATA\<matter_id>
  <short_name>\` folder outside the synced matter tree; this placement is
  load-bearing (see [`../shared/conventions.md`](../shared/conventions.md) §2).

## Modules (imported by the CLIs, not run directly)

| Module | Purpose |
|---|---|
| `resolve_paths.py` | Path-resolution helpers: absolute detection (drive-letter / UNC / POSIX), both-separator joins, folder-name parsing, case-data root + `COCLERK_CASE_DATA_ROOT` override, legacy `9. AI` migration, and the full `resolve_pointer()` preamble (mirrors [`../shared/conventions.md`](../shared/conventions.md) §2.3). |
| `fuse_safe_io.py` | Temp-copy staging helpers: `stage_copies` / `copy_back` / `cleanup` / `open_attached` / `staged`. Enforces `PRAGMA journal_mode = DELETE`. |

## Command-line tools

| Script | Purpose | CLI invocation example |
|---|---|---|
| `resolve_pointer.py` | Resolve `coclerk.json` to concrete database paths; print them as JSON. | `python3 resolve_pointer.py "C:\...\8165.L8153 Example Matter"` |
| `get_matter_profile.py` | Print `matter_metadata` completeness (present/missing keys) + per-proceeding parties summary. | `python3 get_matter_profile.py "C:\...\Example Matter"` |
| `get_facts_for_drafting.py` | Read-only: facts with derived posture, current positions, and current evidence links — each with a computed citation. | `python3 get_facts_for_drafting.py "C:\...\Example Matter" --posture disputed` |
| `get_legal_authorities_for_drafting.py` | Read-only: concepts, their elements/factors, and shaping authorities from `law.sqlite`. | `python3 get_legal_authorities_for_drafting.py "C:\...\Example Matter" --concept-type cause_of_action` |
| `dump.py` | Write `evidence.sql` (header `schema v9.0`, three section marker pairs, per-DB `iterdump`). | `python3 dump.py "C:\...\Example Matter"` |
| `rebuild.py` | Atomic rebuild of the three binaries from `evidence.sql` (native files untouched on failure; validates table counts main≥21 / law≥5 / privileged≥3 — `MIN_TABLES` — and triggers present before move-in). Also the home of the `upgrade_*` in-temp transforms `migrate_engine` imports. | `python3 rebuild.py "C:\...\Example Matter"` |
| `migrate_engine.py` | **Module, not a CLI.** The engine behind `case_data__migrate` — chain building, plan token, backup/restore, all-or-nothing native replacement. Imported by the MCP server over `PYTHONPATH`; see `../operations/migrate.md`. | *(not run directly)* |
| `parties_of_record.py` | Read-only: the parties of record of one proceeding, matched by file number, with counsel and address for service resolved to the per-proceeding override when set, else the party's own value. Returns `ok`, `not_applicable` or `unavailable` with a reason, never a bare empty list, in the drafting runtime's own field names. Reads a temp copy of `main.sqlite` only. Spawned by the drafting runtime over `PYTHONPATH`; see `design-decisions.md` #56. | `python3 parties_of_record.py "...\0. CASE DATA\Example Matter" S-290001` |
| `resolve_participant.py` | Read-only: resolves a name, surname or file code to the participants it could mean (party, counsel, witness, expert, tribunal member), each with every name, alias and file code on record as `search_terms`. Exact first; then `near`, Levenshtein distance at most 2 on a surname of four letters or more, labelled with its distance. Returns `ok`, `not_found` or `unavailable` with a reason. Reads a temp copy of `main.sqlite` only. Behind the model-facing `case_data__resolve_participant`, called only by `../operations/participants.md`; see `design-decisions.md` #65, #66. | `python3 resolve_participant.py "...\0. CASE DATA\Example Matter" Quillfeather` |
| `resolve_authority_source.py` | Read-only: finds one stored authority's file by citation, by its recorded path, then a hash search of the matter tree (`6. LAW` first, 20 s deadline), then a caller-named file, and gives it as a PDF, converting RTF or Word through Microsoft Word into a host-local cache. Returns `ok`, `authority_ambiguous`, `unresolved`, `converter_missing` or `conversion_failed` in the drafting runtime's own field names. Reads a temp copy of `law.sqlite` only. Spawned by the drafting runtime over `PYTHONPATH`; see `design-decisions.md` #61 and `../operations/verify-law.md` §2. | `python3 resolve_authority_source.py < request.json` |
| `verify_sources.py` | Check every source `file_path` + locator exists under the matter root and the citation is well formed; report checked / OK / broken. | `python3 verify_sources.py "C:\...\Example Matter"` |
| `lint_comparative_gloss.py` | Read-only, advisory: flag comparatives/intensifiers in an edge's `proposition`/`finding` that appear NOWHERE in the judgment it cites (the unsourced-gloss defect class). Resolves the source by `authorities.file_path`, falling back to a `file_hash` search when the path is stale (files renamed post-ingest). RTF (Westlaw `.doc`) read through `render_document.py`'s RTF reader, and an RTF it refuses reported `SOURCE_UNREADABLE`; PDFs reported `SOURCE_UNSUPPORTED`, never guessed. Flags are advisory and NEVER block a push — to act on one, route it through `operations/amend-law.md`. | `python3 lint_comparative_gloss.py "C:\...\Example Matter" --json` |
| `compute_hash.py` | SHA-256 (lowercase hex) of a file's raw bytes, streamed in 1 MB chunks. | `python3 compute_hash.py "C:\...\5. COURT FILE\ncc.pdf"` |
| `render_document.py` | Renders a `.docx`, `.eml`, Outlook `.msg` or RTF (`.doc`/`.rtf`, e.g. a Westlaw download) to deterministic plain text (`¶N` body paragraphs, `hdr` header block for email; an RTF judgment is one paragraph per line with no marker) in an OS temp dir, plus a JSON metadata line (format, paragraph count, attachment name+SHA-256). For an `.eml` or `.msg` it also writes each attachment's bytes to `<output_dir>/<basename>.attachments/` and reports each one's size, content type and path. A binary Word `.doc` is refused. Stdlib only, including its own readers for the `.msg` container and RTF; no database, no matter pointer — runs in E1 and E2 alike (see the exemption note above). | `python3 render_document.py "C:\...\3. CORRESPONDENCE\Letter.docx" "C:\...\Temp"` |
| `extract_outline.py` | Reads a PDF's bookmarks (outline) deterministically — an xref-driven stdlib parser, no `pypdf`/PyMuPDF. Prints `{pages, entries[{level,title,page,range}], anomalies[]}` as one JSON line; `{"error": ...}` and a non-zero exit on any parse failure (never a partial or guessed outline). Stdlib only; no database, no matter pointer — runs in E1 and E2 alike (see the exemption note above). Backs `../shared/bookmark-segmentation.md`. | `python3 extract_outline.py "C:\...\5. COURT FILE #CA59991\Application Book.pdf"` |
| `merge_authorities.py` | **Pure stdio, no DB or file access** — a JSON→(proposal\|SQL) function for `operations/merge-authorities.md`. `--plan` detects duplicate `law.authorities` pairs, runs the deterministic checks, elects the canonical row, and emits a proposal JSON; `--emit-sql` turns an approved proposal into a guarded merge script for `case_data__execute`. Deterministic: merge date + operator are required `--emit-sql` arguments (never read from the clock; the operation reads the date through `case_data__query`, conventions §10). **Exempt** from the `resolve_paths` / `fuse_safe_io` staging conventions below precisely because it never touches a file or database. E1-only execution rule applies unchanged (run it locally, not in E2). | `python3 merge_authorities.py --plan --input rows.json` |
| `supersede_draft.py` | **Pure stdio, no DB or file access** — runs `../operations/supersede-draft.md`'s own fenced functions, read from that file: `candidates`, `rank`, `fold-plan`, and `emit-sql`, which turns an approved decision into one guarded script for `case_data__execute`. The decision carries its date, read through `case_data__query` (conventions §10). A refused request prints `REFUSED: <reason>` and exits 2. **Exempt** from the `resolve_paths` / `fuse_safe_io` staging conventions for the same reason as `merge_authorities.py`. See `design-decisions.md` #64. | `python3 supersede_draft.py emit-sql < decision.json` |
| `submission_law_bridge.py` | **Pure stdio, no DB or file access** — a JSON→SQL function for `operations/ingest-submission-law.md`. `--summary` reports what the SQL would write (counts, held-back edges, doubt escalations, collisions, the synthetic oral citation, skipped dropped rows); `--emit-sql` emits one script for `case_data__execute`. Deterministic: `--ingested-on` is a required argument (never read from the clock; the operation reads the date through `case_data__query`, conventions §10), so the same payload and date give byte-identical SQL. **Exempt** from the `resolve_paths` / `fuse_safe_io` staging conventions for the same reason as `merge_authorities.py`. | `python3 submission_law_bridge.py --emit-sql --input payload.json --ingested-on 2026-09-11` |
| `ingest_authority.py` | **No database access.** Reads one file, an extractor's result, checks it, and returns the fixed statements that apply `../operations/ingest-extract.md` Path D (authority, concepts, determined-by stubs, links, criteria), with the checked result bound as one JSON parameter. A result that fails a check returns `problems` and no statements. Behind the model-facing `case_data__ingest_authority`, which runs the statements through `case_data__execute`'s own transaction; spawned by the data server over `PYTHONPATH`. **Exempt** from the `resolve_paths` / `fuse_safe_io` staging conventions for the same reason as `merge_authorities.py`. See `design-decisions.md` #68. | `python3 ingest_authority.py < request.json` |

## Notes

- `resolve_paths.resolve_pointer(..., migrate_only=True)` is the schema-version
  guard's escape hatch. Its callers are `migrate_engine.py` (the operative one),
  `rebuild.py --migrate`, and `resolve_pointer.py --migrate-only`. The `case_data__query`/`case_data__execute` backend
  (`source/probanda/mcp/src/case/backend.ts`) carries its own hand-ported
  resolver with **no such parameter**, which is what keeps the bypass off the
  read path — never "simplify" that backend into importing this module.
- After a bare `rebuild.py`, run `dump.py` so
  `evidence.sql` carries the fresh `schema v9.0` header. `case_data__migrate`
  writes the dump itself and needs no follow-up.
- `dump.py` and `rebuild.py` are the only tools here that
  write native binaries. The three `get_*` tools and `resolve_pointer.py`,
  `verify_sources.py`, `compute_hash.py`,
  `lint_comparative_gloss.py`, `parties_of_record.py`, `resolve_participant.py` are read-only with
  respect to the databases (`resolve_pointer.py` may normalize `coclerk.json`, a
  plain-text artifact, per the resolution contract). `render_document.py`
  touches no database at all — it is a pure file-to-file text transform.
- Each command-line tool imports `resolve_paths` and (where it touches binaries)
  `fuse_safe_io` from this same directory, so run them from within
  `references/scripts/` or add that directory to `PYTHONPATH`. `merge_authorities.py`
  and `submission_law_bridge.py` are the exceptions — pure stdio, they import
  neither and need no `PYTHONPATH`.
