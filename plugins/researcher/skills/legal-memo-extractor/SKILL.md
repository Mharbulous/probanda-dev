---
name: legal-memo-extractor
disable-model-invocation: true
description: Use when extracting or indexing research questions from AI legal research memos — Westlaw AI-Assisted Research memos (.docx), Alexi Instant/Pro Memos (.docx/.pdf), or a mixed folder of both. Trigger on requests to extract questions, create a question index, or catalog/organize multiple legal research memo files.
---

<!-- researcher v0.7.12 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: it means the directory containing this SKILL.md, not a placeholder to search for or guess. Read references and shared files natively from there, never over the litigation data server's skill-source tool and never by requesting folder access; scripts and templates the text declares are executed and read from there too. If `${CLAUDE_SKILL_DIR}` itself no longer exists, the plugin was re-synced mid-session: list only `${CLAUDE_SKILL_DIR}/../../..` (the folder that held this plugin's folder), take the folder named as this plugin's folder with any `~g<N>` suffix removed plus the highest `~g<N>`, and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, stages, authors or requests a screenshot of one, but may present one to a human user to view, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

## Contents

| Section | Read when |
|---|---|
| Source detection — decide per file, then load only that playbook | Deciding which source and playbook applies to each memo file |
| Running the extraction | Running the extractor script or reading its report |
| On-file authority cross-check | Marking authorities as on file in the index |
| Output location | Choosing where the index is written |
| Guardrails | Always |

# AI Legal Research Memo Extractor

Index AI-generated legal research memos (Westlaw AI-Assisted Research, Alexi
Instant/Pro Memos) into a single `research_memos_index.md`: one row per
research question, with the AI answer summary, cited authorities, and a
cross-memo authority rollup.

**Framing: AI memos are leads, not the authority's own text.** Every extracted
question, answer, and citation is unverified until independently checked. The
index says so structurally — a top-of-file caveat plus a per-authority status
column — not just in prose. See `references/output-contract.md`.

## Source detection — decide per file, then load only that playbook

| Signal (in priority order) | Source |
|---|---|
| Filename contains `Westlaw` / `Alexi` (case-insensitive) — but Alexi `Weekly Report` / `Accounting` files are **not memos**, skip them | as named |
| `.docx` whose ZIP has root-level `document.xml` (no `word/` folder) with a `w:wordDocument` root | Westlaw |
| `.docx` with standard `word/document.xml` whose styles include `badge_style`/`badgestyle` | Alexi |
| `.pdf` whose metadata has `/Title (Alexi)` (wkhtmltopdf generator); page 1 carries a `Memo To:` header block and an `Instant Memo`/`Pro Memo` badge | Alexi |
| Plain text (not a ZIP) with `\| N\.` pipe-table lines | Westlaw (legacy export) |
| Anything else | **ask the user; never guess a parser** |

Read `references/westlaw-playbook.md` or `references/alexi-playbook.md` for
the format details of whichever sources are present. Do not load a playbook
for a source that isn't in the folder.

## Running the extraction

All parsing lives in `scripts/extract_memo_index.py` (Python 3, stdlib only —
no pip installs). It applies the detection table above per file, parses, and
writes the index. **Never re-implement the parsing inline.**

```
python extract_memo_index.py --input-dir <folder of memos>
    [--source westlaw|alexi|auto]      # default auto (per-file detection)
    [--matter-root <matter folder>]    # whose probanda.json names the matter-data folder
    [--matter-data-folder <folder>]      # for the standard output location
    [--output <file>]                  # explicit override
    [--verified-citations <file>]      # see cross-check below
    [--label "<Matter name (code)>"]   # index title suffix
```

The script reports every file as parsed, skipped (with reason), or errored —
by name, on stdout and in a "Files not indexed" section of the index. If it
reports errors, surface them; do not silently accept a partial index.

## On-file authority cross-check

An authority in the index is marked `✅ Text on file` only when its text is
already in the matter's law database. That mark does not make it verified:
nothing may rely on the authority until `research-agent` has returned it
(`shared/legal-research.md`, item 2). The database is opaque to this skill:
**delegate to the ``matter-data`` skill** to list the citations of the
authorities on file in the matter's law database (e.g. neutral citations),
write them one per line to a temp file, and pass it as `--verified-citations`.
When no matter database exists or matter-data access isn't available in the
session, skip the cross-check — every authority then stays `Unverified lead`,
which is the honest default.

## Output location

`<matter-data folder>/legal-memo-extractor/research_memos_index.md`, the
matter-data folder being the one `probanda.json`'s `case_data_dir` names. Resolve
it from `probanda.json` and pass it as `--matter-data-folder`; in Cowork, where the
project mounts only the matter folder, first request access to the matter-data
folder itself (never a parent or the firm root) and pass the path the session
sees. It must already exist: if it does not, stop and name `/matter-data`
initialize, and never create it. The script finds the matter from
`--matter-root`, or by walking up from `--input-dir`; when neither finds a
matter workspace it refuses and asks for `--output` rather than guessing. It
also refuses a matter-data folder that is missing or whose name is not the last
segment of `case_data_dir`. One combined index covers all sources, grouped by
source.

## Guardrails

- **No auto-ingestion.** The index is a verification work-queue. Ingesting an
  authority into the law database stays with ``ingest``, one authority at a
  time, deliberately.
- **No renaming.** Memo file naming is ``housekeeping``'s job; this skill may
  flag non-conforming filenames in conversation but never renames.
- **Memo answer text is never stored in the case database** — leads live in
  the index file only.
