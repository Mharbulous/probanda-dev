# Operation: ingest (the gate)

Read `../shared/conventions.md` first; derive the live `matter_root` per §2.2 and read `coclerk.json` only to confirm initialization; halt on any tool error per §2.3.

`ingest` is the **gate**, not an extractor. It resolves the matter, refuses a kind ingest cannot read, computes the document's hash, looks the hash up against `main.sources`, and routes to exactly one downstream operation. **This operation writes nothing** — no `INSERT`, no `UPDATE`, no dump. All mutation happens in `ingest-extract.md` or `ingest-verify.md`, and each of those runs its own pointer preamble again when it takes over.

The gate exists so that re-presenting a file that was already ingested routes to *verification* rather than blind re-extraction, and a changed file at the same path routes back to extraction. Getting the routing right here is what makes the pipeline idempotent.

---

## Step 1 — Resolve `matter_root` (with a migrate escape hatch)

Prove the current matter folder's host path and use it as `matter_root` (§2.2). Read `coclerk.json` only to confirm initialization. The Step 3 `case_data__query` call is what actually exercises pointer/schema-version resolution — the backend runs it host-side on every call.

If a call in Step 3 fails with the **schema-version guard** message (the database is below v9.0), do not proceed:

1. Report the exact guard message to the user and offer to run `../operations/migrate.md`.
2. If the user agrees, hand off to `migrate`. When migrate reports success, **retry the Step 3 call once**.
3. If the guard fires again after a successful migrate, or the user declines, halt and report. Do not attempt to ingest against a pre-v9.0 database.

If a call instead fails with "stale pointer — re-run initialize" (schema_version isn't 5), halt and direct the user to `../operations/initialize.md` — do not attempt migrate for this error, it is unrelated to the user_version guard.

---

## Step 2 — Check the kind, then compute the SHA-256 of the raw bytes

The kind is the file's extension, case-insensitive. Attempt `.pdf`, `.docx`, `.eml` and `.msg`, and a `.doc` only when its first bytes are `{\rtf`. A `.doc` that is not RTF, and any other kind (an image, a spreadsheet, anything else), is a kind ingest cannot read: hash nothing, look nothing up, route nowhere and write nothing. Report the file by name and extension as "a kind ingest cannot read", and stop. The gate ends here, as it does for a copy of an email attachment read through (Step 3). This is the same kind list the folder scan (`extract-facts.md`) and `ingest-unattended.md` Step 2 apply, so a file is never ingestable singly and refused in bulk.

Hash the document's **raw file bytes**, streamed in 1 MB chunks so an arbitrarily large PDF never loads whole into memory. Hash the bytes on disk — never extracted text, never a converted rendering. This is the same hash the extractor and drift checks rely on, so it must be byte-exact and lowercase hex.

This hashing step is local text/byte processing, not database access — it runs in whatever code-execution facility the session provides, not through `case_data__*`:

```python
import hashlib, sys

# DOCUMENT_PATH is the absolute path to the file being presented for ingestion,
# in this session's own filesystem view (the granted matter/sandbox path).
DOCUMENT_PATH = r"<absolute path to the document>"

h = hashlib.sha256()
with open(DOCUMENT_PATH, 'rb') as fh:
    for chunk in iter(lambda: fh.read(1024 * 1024), b''):
        h.update(chunk)
file_hash = h.hexdigest()
print(file_hash)
```

Carry `file_hash` into Step 3.

---

## Step 3 — Look the hash up against both source stores

Call `case_data__query` (§2.3) with `matter_root` and exactly:

```sql
SELECT 'main' AS source_store, source_id, parent_source_id, title, file_path,
       ingestion_status, last_verified_at, notes
FROM main.sources
WHERE file_hash = ?
UNION ALL
SELECT 'privileged' AS source_store, source_id, NULL AS parent_source_id,
       title, file_path, NULL AS ingestion_status, NULL AS last_verified_at, NULL AS notes
FROM privileged.privileged_sources
WHERE file_hash = ?;
```

with `file_hash` bound twice. This is a **read-only probe**; the gate never mutates. Partition the main-store results by `parent_source_id`: child rows (`parent_source_id IS NOT NULL`) are never routing anchors because an affidavit body and its exhibits legitimately share a hash. Every privileged-store match is a routing anchor because privileged sources are not compound.

- **A match carrying `[SUPERSEDED-BY:#N`:** the file is an earlier version of source N, which [`supersede-draft.md`](supersede-draft.md) kept as the source of record. Extract nothing: report it as "already held as an earlier version of source N". When that row's stored `file_path` lies outside `0. DRAFT*\Superseded\`, the move `supersede-draft.md` makes did not happen: say so, and offer it (`supersede-draft.md` §6c). The gate ends here without routing.
- **No match, and the presented path lies under `0. DRAFT*\Superseded\`:** that folder holds only superseded versions, filed there by `supersede-draft.md`. Report the file as one case data does not hold, and stop. The gate ends here without routing.
- **No top-level match, but an email attachment read through:** a child row with no `file_path`, whose parent is not itself a matching row, with `ingestion_status = 'complete'`. The file is a standalone copy of an attachment its email already holds (design-decisions #54). Extract nothing: report each such attachment row (title, `source_id`) and its parent email's `source_id`, say the content is already in the database, and offer `../operations/ingest-verify.md` on the parent email, whose pass covers its attachments. The gate ends here without routing.
- **No top-level match otherwise:** route as a new document, even if child rows appear. That covers an affidavit's exhibits and a book's children, which carry a path, and an email attachment that was not read through, whose file is then read afresh.
- **Exactly one top-level match:** use that row as the routing anchor and apply its existing status logic in Step 4.
- **If there is more than one top-level match:** stop and report data corruption. Do not choose a survivor, mutate either row, or continue extraction. Repair requires a separate matter-scoped instruction.

---

## Step 4 — Route

Decide the destination from the probe result. Route to exactly one operation and hand off — the gate itself does nothing further.

| Probe result | Route |
|---|---|
| Main-store match carrying `SUPERSEDE-PENDING:` | `../operations/supersede-draft.md` first, for the pair each marker names. A row carrying several markers has its pairs settled one at a time, in ascending order of the named ids, each with its own comparison and its own question (`supersede-draft.md` §1, "One pair at a time"). When the match itself ends superseded, nothing more; otherwise the row below for the match's status |
| Match, `ingestion_status = 'complete'` | `../operations/ingest-verify.md` |
| Match, `ingestion_status = 'partial'` | `../operations/ingest-verify.md` on the completed portions, **and** offer the user re-extraction of the missing exhibits/segments |
| Match, `ingestion_status = 'failed'` | `../operations/ingest-extract.md` (re-extract from scratch — the prior attempt produced nothing trustworthy) |
| Main-store match, `ingestion_status IS NULL` | Count existing children for the matched `source_id` across `facts`, `positions`, `relief_items`, `relief_positions`, `source_references`, and expert `witnesses.report_source_id`. If the total is **> 0** → `../operations/ingest-verify.md`; if **0** → `../operations/ingest-extract.md`. |
| Privileged-store match | Count `privileged.fact_provenance` and current `privileged.client_instructions` rows for the matched source. If the total is **> 0** → `../operations/ingest-verify.md`; if **0** → `../operations/ingest-extract.md`. |
| No top-level match, an email attachment read through (Step 3) | none: report and stop, offering `ingest-verify.md` on the parent email |
| A match carrying `[SUPERSEDED-BY:#`, or no match under `0. DRAFT*\Superseded\` (Step 3) | none: report and stop. A superseded row whose stored path lies outside `0. DRAFT*\Superseded\` is offered its move: `../operations/supersede-draft.md` §6c on yes |
| **No hash match** | `../operations/supersede-draft.md` first, with this file as its one newcomer and its first path segment as `scan_folder`, keeping only the pairs that name this file. When no supersession results, `../operations/ingest-extract.md` |

The gate itself still writes nothing: `supersede-draft.md` writes only after the practitioner's answer.

`supersede-draft.md` §1 pairs copies by name and page count, so it can find no candidate for a file that is in fact another copy of a registered court source. The file then goes to `ingest-extract.md` and is registered and read through as a new document. When the session concludes later, during or after that read, that the file is another copy of registered source N, the conclusion is never left in a note: `ingest-extract.md`'s "Another copy of a registered source" step hands the two sources to `supersede-draft.md` as its `pair`, and writes the `SUPERSEDE-PENDING:` marker when the practitioner gives no answer.

This matches the duplicate-routing contract in `../shared/extraction-protocol.md`, including its email-attachment exception; the table above applies it across the main and privileged source stores.

When the presented file is a legal authority (case law / statute / regulation / treatise), the extractor path performs its own hash check against `law.authorities`; the gate still routes it to `ingest-extract.md`, which owns that branch.

---

## Step 5 — Hand off

State the chosen route and the reason (hash match + status, or no match), then hand control to the identified operation. A copy of an email attachment read through, and a superseded version, have no route: the Step 3 report is the whole result, apart from a superseded version's offered move. **The gate writes nothing and runs no dump** — the downstream operation resolves the pointer again, performs the work in a single transaction, and dumps on completion.
