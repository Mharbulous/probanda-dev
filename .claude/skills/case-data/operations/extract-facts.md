# Operation: extract-facts (batch folder scan)

Read [`../shared/conventions.md`](../shared/conventions.md) first; derive the live `matter_root` per §2.2 and read `coclerk.json` only to confirm initialization; halt on any tool error per §2.3.

This operation scans a folder for PDFs not yet in the database and extracts them in bulk. It is the "scan for new documents" entry point — distinct from `ingest.md`, which handles one document the agent already has in hand. Read [`../shared/extraction-protocol.md`](../shared/extraction-protocol.md) for the extraction semantics (hash-before-extraction, honest status then flip, no fuzzy-merge, per-run report contract) — this file does not restate them.

## 1. Folder selection (every run — no persisted config)

Prompt the user to choose a folder to scan, **every run**. Do not read or write a config file for this choice. A calling skill that names the folder in its instruction has made the choice — use that folder and skip the prompt; nothing is persisted either way. Offer the standard candidates plus a custom option:

- `RAW`
- `3. CORRESPONDENCE`
- `5. COURT FILE`
- `7. DISCOVERY`
- `6. LAW`
- custom path, typed by the user

Resolve the chosen folder relative to the matter root.

## 2. Recursive walk

Walk the chosen folder recursively. Collect files matching `.pdf`, `.docx`, `.eml`, `.msg`, or `.doc` case-insensitively. Exclude any file or directory component whose name starts with `~` or `.` (editor lock files, hidden/system directories). Track every other file's extension too, for the summary report — this operation ingests `.pdf`/`.docx`/`.eml`/`.msg`, and a `.doc` only when it is RTF and read as an authority (§4); every other extension is named, not silently dropped.

Run this inline (pure filesystem walking — no database access, so no `case_data__*` call is involved here):

```python
import os, hashlib

CANDIDATE_EXTS = ('.pdf', '.docx', '.eml', '.msg', '.doc')

def find_candidate_sources(scan_root):
    candidates = []
    skipped_extensions = {}
    for dirpath, dirnames, filenames in os.walk(scan_root):
        dirnames[:] = [d for d in dirnames if not d.startswith('~') and not d.startswith('.')]
        for fn in filenames:
            if fn.startswith('~') or fn.startswith('.'):
                continue
            ext = os.path.splitext(fn)[1].lower()
            if ext in CANDIDATE_EXTS:
                candidates.append(os.path.normpath(os.path.join(dirpath, fn)))
            elif ext:
                skipped_extensions[ext] = skipped_extensions.get(ext, 0) + 1
    return candidates, skipped_extensions

def sha256_of_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()
```

## 3. Classification against the source and law stores

For every candidate source, compute its path (relative to the matter root, matching how `sources.file_path` is stored) and its SHA-256 hash (raw bytes, per the extraction protocol). Compare both against the two stores the single-document gate probes ([`ingest.md`](ingest.md) Step 3) and the law store [`ingest-status.md`](ingest-status.md) rule 3 reads: after the corruption check below, `privileged.privileged_sources` and `law.authorities` first, then `main.sources`.

Paths are compared in conventions §2.4's stored form against the matter root, ignoring case, so a legacy row holding an absolute host path or forward slashes, or a differently-cased path, still names the scanned file. Stored rows are never rewritten here (`relocate-source.md` does that on a move).

More than one top-level main row with the file's hash is data corruption: the one-top-level-source-per-hash trigger forbids it. The file is **Corrupt**: skip it and report it as corruption, by name with the source ids holding its hash, as the single-document gate and `ingest-status.md`'s `anomaly` do. Choose no survivor, change no row, and continue with the other files.

A hash match on a row carrying `[SUPERSEDED-BY:#` means the file is an earlier version of a document the matter holds ([`supersede-draft.md`](supersede-draft.md)): **Superseded**, skipped and reported as held, at whatever path. A privileged or law hash match means the file is held ([`ingest-status.md`](ingest-status.md) rules 2 and 3): **Unchanged** at the same path, **Duplicate** at another. A hash found only in an authority's `[SECOND-COPY:<sha256>]` marker (conventions §11) is held by reference and is **Duplicate**, as a filed copy of a read email attachment is. A held file is never extracted, so a privileged file is never re-registered in main and an authority is never read again. Otherwise:

| Path match (top-level main source) | Hash match | Disposition | Action |
|---|---|---|---|
| no | no | **New** | extract |
| no | yes | **Duplicate** | skip; report (same content already registered, as another file, as an email attachment or as an authority) |
| yes | yes; status `complete`, or NULL with child rows | **Unchanged** | skip |
| yes | yes; status `failed`, or NULL with no child rows | **Re-extract** | extract from scratch, as the gate routes it ([`ingest.md`](ingest.md) Step 4), into the existing source row (§5) |
| yes | yes; status `partial` | **Partial** | skip; report the file by name with its `/ingest` route: verify the completed portions, and offer re-extraction of the missing exhibits or segments |
| yes | no; the new hash held by another row (counted as below) | **Duplicate** | skip; report the path holding the content (the file was replaced by a copy of another ingested file); leave the row at this path untouched |
| yes | no | **Changed** | re-extract |

Child rows are counted as the gate counts them: `facts`, `positions`, `relief_items`, `relief_positions`, `source_references`, and expert `witnesses.report_source_id`.

```python
EXTRACT = ('new', 'changed', 're-extract')

CHILD_ROWS = (
    "SELECT (SELECT count(*) FROM facts WHERE source_id = :id)"
    " + (SELECT count(*) FROM positions WHERE source_id = :id)"
    " + (SELECT count(*) FROM relief_items WHERE source_id = :id)"
    " + (SELECT count(*) FROM relief_positions WHERE source_id = :id)"
    " + (SELECT count(*) FROM source_references WHERE source_id = :id)"
    " + (SELECT count(*) FROM witnesses WHERE report_source_id = :id)"
)

def classify(con, rel_path, file_hash, matter_root):
    here = stored_form(rel_path, matter_root).lower()

    def at_here(path):
        return path is not None and stored_form(path, matter_root).lower() == here

    held = con.execute(
        "SELECT source_id FROM sources WHERE file_hash = ? AND parent_source_id IS NULL",
        (file_hash,)).fetchall()
    if len(held) > 1:
        return 'corrupt'
    if con.execute("SELECT 1 FROM sources WHERE file_hash = ? "
                   "AND instr(coalesce(notes, ''), '[SUPERSEDED-BY:#') > 0", (file_hash,)).fetchone():
        return 'superseded'
    held_paths = [p for (p,) in con.execute(
        "SELECT file_path FROM privileged.privileged_sources WHERE file_hash = :h "
        "UNION ALL SELECT file_path FROM law.authorities WHERE file_hash = :h",
        {'h': file_hash})]
    if held_paths:
        return 'unchanged' if any(at_here(p) for p in held_paths) else 'duplicate'
    if con.execute("SELECT 1 FROM law.authorities WHERE instr(coalesce(notes, ''), ?) > 0",
                   (f'[SECOND-COPY:{file_hash}]',)).fetchone():
        return 'duplicate'
    at_path = [r[:3] for r in con.execute(
        "SELECT source_id, file_hash, ingestion_status, file_path FROM sources "
        "WHERE parent_source_id IS NULL") if at_here(r[3])]
    row_by_path = next((r for r in at_path if r[1] == file_hash),
                       at_path[0] if at_path else None)
    row_by_hash = con.execute(
        "SELECT source_id FROM sources WHERE file_hash = ? "
        "AND NOT (parent_source_id IS NOT NULL AND file_path IS NULL "
        "AND ingestion_status IS NOT 'complete')", (file_hash,)
    ).fetchone()
    path_match = row_by_path is not None
    hash_match = row_by_hash is not None
    if not path_match and not hash_match:
        return 'new'
    if not path_match and hash_match:
        return 'duplicate'
    if path_match and row_by_path[1] == file_hash:
        source_id, _, status = row_by_path
        if status == 'complete' or (
                status is None and con.execute(CHILD_ROWS, {'id': source_id}).fetchone()[0] > 0):
            return 'unchanged'
        return 'partial' if status == 'partial' else 're-extract'
    if hash_match:
        return 'duplicate'
    return 'changed'
```

`stored_form` is conventions §2.4's helper, and `matter_root` is the live host matter root derived at the top of this operation.

Build the extraction list: every source whose disposition is in `EXTRACT` (`new`, `changed`, `re-extract`). Report `duplicate`, `unchanged`, `partial`, `superseded` and `corrupt` sources without touching them.

A hash match on any row counts, children included, except an email attachment (a child row with no `file_path`) that was not read through (`ingestion_status` other than `complete`): its standalone copy is read afresh, as the single-document gate and `ingest-status.md` read it (design-decisions #54). A read-through attachment makes its copy `duplicate`, which is the intended result. An affidavit's exhibits and a book's children share their body's path, so a hash match on one of them always comes with a path match and never yields `duplicate` on their account.

## 3b. Versions of one court document

Before §4's dispatch, run [`supersede-draft.md`](supersede-draft.md) §1's `candidates` over the extraction list's `new` files and the registered top-level `court` rows under the scanned folder, with the scanned folder as `scan_folder`. Its pairs include two `new` files that are versions of each other, so a draft, a signed and a filed copy arriving in one scan are settled before any of them is read. Take each pair through that operation, attended, one pair at a time (its §1). A `new` file paired with a registered row whose pair ends `superseded`, as the kept copy or as the superseded one, is held and comes off the extraction list. Of two `new` files whose pair ends `superseded`, the kept one stays on the list and is extracted once, and the other comes off it: once the kept file's document transaction has committed (§5), that operation's §6 inserts the other marker-only and moves it ("Two newcomers"). A pair ending any other way leaves the list as it was. Two `new` files judged different documents are both extracted, and get their `[NOT-VERSION-OF:]` markers (§6b) once both are written.

Every scan, whatever it found, also runs [`supersede-draft.md`](supersede-draft.md) §6c over the whole matter: each superseded row whose stored path lies outside `0. DRAFT*\Superseded\` is reported, and its move offered, one question per row.

## 4. Document pre-processing, routing read, affidavit gate, then dispatch

For each `.docx`/`.eml`/`.msg` on the extraction list, and each `.doc` that is RTF (Path D's "RTF pre-processing" says when), run the renderer first per [`ingest-extract.md`](ingest-extract.md)'s Document pre-processing section (one rendering per file, reused for the routing read, the gate and the dispatch in this run) — do not restate that logic here. A `.doc` that is not RTF is not read: report it as non-ingestable (§7).

A file on the extraction list whose stored path (§3) begins with `2. SOLICITOR CLIENT` (case-insensitive) takes [`ingest-extract.md`](ingest-extract.md) Path B inline by that file's solicitor-client folder rule, with no question and no routing read, and is removed from everything below: the routing read, segmentation, the affidavit gate and the `extract-facts` dispatch.

Then give every remaining file on the extraction list a routing read of page 1 (for a rendered file, the head of its rendering). The routing read comes first for every file, `6. LAW` included. An internal document (a client email, a lawyer's note, an internal memo) takes [`ingest-extract.md`](ingest-extract.md) Path B inline, with that path's three-answer privilege question to the practitioner, and is removed from everything below: it never reaches the `extract-facts` subagent.

A legal authority (a decision, statute, regulation or treatise) takes [`ingest-extract.md`](ingest-extract.md) Path D inline and is likewise removed from everything below, since the `extract-facts` subagent is given party names (the extraction protocol's contamination control). Path D's own rules apply unchanged. Under `6. LAW` its bulk classification cascade chooses the extractor, and the cascade's tier 4 asks the practitioner inline as Path B does. Elsewhere the routing read's call of the authority's kind chooses it. When the citation tier reuses an authority, Path D's second-copy rule records the file by reference, so the next scan reads it as held (§3). Count it as reused by citation in the report (§7). An RTF `.doc` is read only as an authority, so one the routing read does not take to Path D, the matter's own decisions below included, is reported as non-ingestable (§7). **The matter's own decisions are not authorities here:** reasons for judgment or an order whose style of cause or file number matches a proceeding or party of this matter is a court document and keeps its ordinary path, because Path D would put client data in `law.sqlite` and skip the proceeding linkage and order-effects passes.

Before the affidavit gate, run the compound-book segmentation from [`ingest-extract.md`](ingest-extract.md) against every `.pdf` on the extraction list. A file that engages Path E or the bundled-book-of-authorities cascade takes that path instead and is removed from the per-file dispatch below. Do not restate that logic here.

Before dispatching anything, run the affidavit detection gate from [`ingest-extract.md`](ingest-extract.md) (filename fast-path, then jurat scan on page 1 or the first rendered paragraphs) against every remaining `.pdf` and `.docx` on the extraction list. The gate is **skipped entirely for `.eml` and `.msg`** — an email never takes the affidavit path. Do not restate the gate's logic here — apply it as specified there.

- `.pdf`/`.docx` documents that pass the affidavit gate go through the **compound path** in [`ingest-extract.md`](ingest-extract.md) (a `.docx` body takes Pass 1 only — see that file's Path C note).
- The remaining sources are dispatched to the read-only `probanda:extract-facts` agent, whose body mirrors [`../agents/extract-facts.md`](../agents/extract-facts.md), in **parallel batches of ≤10** per dispatch round; a `.docx`/`.eml`/`.msg` dispatch supplies its rendering as `{{RENDERING}}`, and every dispatch supplies `OUTPUT: ingest` (nothing in a scan uses `naming_evidence`). An email's attachments are then registered and ingested as [`ingest-extract.md`](ingest-extract.md)'s pre-processing section says. [`ingest-extract.md`](ingest-extract.md)'s dispatch-path and never-substitute rules apply unchanged — do not restate them here.

## 5. Sequential ingest per document

A result whose routing category is `authority` is not written: discard its JSON, which was produced with party names, and take the file through Path D (§4). The matter's own decisions (§4) are the exception: write the result with source category `court`.

For each document's returned extraction JSON, ingest it **sequentially** (one document at a time, one transaction per document) using the same rules as the pleadings/transcripts path in [`ingest-extract.md`](ingest-extract.md): register the source with an honest status, dedup facts by locator, insert positions (qualified admission = one admit row + verbatim qualification), insert evidence links only where the document is itself proof, verified = 0 on inserts except prefixed-note rows (→ 2), flip `ingestion_status` to `complete` once read through. A **Re-extract** source (§3) is already registered with the same hash, and the one-top-level-source-per-hash trigger refuses a second insert, so its document transaction reuses that row's `source_id`: it sets the row's `ingestion_status` to `partial` in place of the insert, then writes the children and the flip as usual. Do not restate those rules here — this operation performs the same insert logic per document, just gated by the folder-scan classification above instead of the single-document hash lookup in `ingest.md`.

Sequencing matters: sequential per-document transactions keep partial-run recovery simple (a crash mid-batch leaves cleanly committed prior documents and one honestly-flagged in-progress source).

## 6. Proceeding linkage check (every scan)

Run this **unconditionally at the end of every scan** — whether the run found anything new, changed, or was entirely unchanged. This is what closes the "nothing to ingest" path that can silently leave a court document's proceeding unregistered forever, run after run:

```sql
SELECT s.source_id, s.title, s.file_path, s.category
FROM main.sources s
WHERE s.proceeding_id IS NULL
  AND s.parent_source_id IS NULL
  AND (s.file_path LIKE '5.%'
       OR (s.category = 'court' AND s.file_path LIKE :scan_prefix || '%'))
  AND (s.notes IS NULL OR s.notes NOT LIKE '%PROCEEDING-CHECK:%');
```

`:scan_prefix` is the scanned folder's matter-root-relative path (§1). The first arm is whole-matter self-healing — it fires even when today's scan is of a different folder, catching a proceeding gap left by any past session. The second arm covers a `category = 'court'` source that was touched or skipped *in this scan* but sits outside a `5.` folder (a filed order living in `3. CORRESPONDENCE`, say), which the first arm alone would never reach and which won't be caught again once ingested.

Any rows returned → hand off to [`proceedings-profile.md`](proceedings-profile.md) §6: group the `5.*` rows by first path segment (one call per group), and hand the out-of-folder `category = 'court'` rows over individually. Fold whatever §6 returns — evidence-only skips, out-of-folder filing-question findings, proceedings created or matched, sources back-filled — into the summary report below as additional report lines.

## 7. Summary report

After the batch completes, report:

- dispositions: counts of new / duplicate / unchanged / changed / re-extract / partial / superseded / corrupt sources found, broken down by extension (`.pdf`/`.docx`/`.eml`/`.msg`/`.doc`);
- supersessions (§3b): counts proposed, applied and rejected, with each pair's kept and superseded source, or for a rejected pair why ([`supersede-draft.md`](supersede-draft.md) §7); and each superseded row offered its move (§6c), with whether it moved or the tool's refusal word for word;
- authorities (§4): counts registered, reused by citation, and reported for merge;
- partial sources, each by name with its `/ingest` route (§3);
- corrupt sources, each by name with the source ids holding its hash, reported as data corruption (§3);
- attachments found across `.eml` and `.msg` sources, one line per distinct attachment SHA-256 (the hash is its identity, names are display only): its name or names, size and content type, its outcome (ingested as a child of `<email>`, already registered as `<source>`, or a kind ingest cannot read; a readable attachment ingested in this run reads "ingested as a child of `<first email>`", and every later email carrying it counts toward the same line, not as a separate already-registered report), how many emails carry it, and which. This holds for every repeated attachment, readable, already registered or unreadable (design-decisions #53);
- files that failed to render, each by name with the renderer's own message (for example a `.msg` that is corrupt, or that holds neither a plain-text nor an HTML body);
- non-ingestable files found, by extension — not extracted (this operation ingests `.pdf`/`.docx`/`.eml`/`.msg`, and a `.doc` only when it is RTF and read as an authority);
- inserts: counts by entity type (sources, facts, positions, evidence links) across the batch, per the extraction protocol's per-run report contract;
- verified-0 backlog delta: how much the AI-verifier backlog (`verified = 0` rows) grew as a result of this run.

Writes go through `case_data__execute` (§2.3), which regenerates `evidence.sql` automatically on success — no separate dump call. Report every INSERT/UPDATE performed during the run.
