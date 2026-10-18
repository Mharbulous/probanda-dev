# Token-efficiency test protocol for /ingest and /housekeeping (draft)

Draft charted on 2026-10-17. The wayfinder map "Token-efficient /ingest and /housekeeping" decides which parts run and in what order; this file is its starting reference, not a settled plan.

## Context
Brahm wants empirical dollar-cost data to choose between two designs: doing housekeeping inside the ingest read (sharing one context), or always doing housekeeping on a cheap model (Haiku) apart from ingest (Opus). No existing skill or report measures this (two searches on 2026-10-17 found only unmeasured rules: "≤20 pages per read", "batches of ≤10", "about 15 per namer"). The protocol answers Q1–Q17 below by running read-only tests in Cowork on copies of real matter files, then pricing every subagent from its transcript.

Facts this design rests on (checked 2026-10-17):
- Each Cowork subagent transcript line carries `model` and `usage`: `input_tokens`, `cache_creation.ephemeral_5m_input_tokens` and `ephemeral_1h_input_tokens`, `cache_read_input_tokens`, `output_tokens` and `output_tokens_details.thinking_tokens`. So cost can be measured exactly, after the run, with no telemetry setup. The transcripts no longer reach the Windows host (E0, 2026-10-17): the Cowork session ran in a remote sandbox, with the connected folder staged into `/mnt/user-data/uploads/`, and nothing was written under `%APPDATA%/Claude/local-agent-mode-sessions/`. Files the session writes into the connected folder do sync back, so every run sheet ends with the copy step under E0.
- Prices per million tokens (platform pricing page): Haiku 5.5 is $0.10 in, $0.125/$0.20 cache write (5m/1h), $0.01 cache read, $0.50 out. Sonnet 5.5 is $2 / $2.50 / $4 / $0.10 / $10. Opus 5.5 is $4 / $5 / $8 / $0.20 / $20. Thinking tokens are billed as output.
- Subagent cache TTL defaults to 5 minutes. E0 confirmed in Cowork that a `fork` subagent inherits the parent context as a cache read, that `SendMessage` resumes a subagent with its full history, and that no subagent rewind exists (results under E0).
- A PDF page read natively costs roughly 3k–8k tokens (its text plus a page image).

## Questions answered
Q1 shared context · Q2–Q5 optimal pages per subagent for OCR PDF, scanned PDF without OCR, .docx, .msg · Q6 fork · Q7 rewind/resume · Q8 cache reuse between subagents · Q9 cost per correct result · Q10 pages housekeeping needs · Q11 text layer against page images · Q12 output share · Q13 effort against accuracy · Q14 orchestrator cost · Q15 number of reads · Q16 email quoted history and attachments · Q17 run-to-run spread.

## Safety rules for every run
- **Read-only on matters.** The corpus is a copy in a test folder outside every matter folder (Commandment 7: Probanda only reads or copies files it did not create). No test calls `ingest-unattended`, `case_data__execute` or any write tool. Ingest tests use the real extractor agents (`legal:extract-facts`, `legal:extract-affidavit`, `legal:extract-caselaw`), which are read-only and return JSON.
- **Client data stays local and out of git.** The corpus, the answer key and the raw results live in a local test folder, by default `~/token-test/`. Only the scripts and the protocol are committed. The results CSV that the scripts print uses document IDs (D001…), never names.
- **One Cowork session per experiment**, opened with the test folder connected. This makes it easy to split transcripts by experiment.

## What gets built (committed to probanda-plugins, dev tooling only, never shipped)
1. `docs/Plans/2026-10-17_token-efficiency-test-protocol.md`: the protocol itself, with one run sheet per experiment holding the exact prompt to paste into Cowork.
2. `scripts/token_test/build_corpus.py`. Given matter folders, it:
   - lists candidate files;
   - counts pages, and detects OCR by `pdftotext` characters per page (under 100 means no text layer);
   - buckets by format × size (1, 2–5, 6–10, 11–20, 21–40, 41–80 pages; .msg/.docx by rendered pages);
   - copies a stratified sample (target 3 per cell where they exist, about 70 files) into `token-test\corpus\` as `D###.<ext>`;
   - writes `manifest.csv` (id, format, pages, ocr, size bucket, source path, kept local only);
   - also writes the text-layer and lower-DPI variants E4 needs.
3. `scripts/token_test/token_ledger.py`. It reads the Cowork transcripts and finds each run by its tag: every test prompt starts with `RUN <experiment>-<cell>-<doc>-<rep>`. It writes one row per subagent run: model, effort, every token class, thinking tokens, the number of API calls, and dollar cost from a price table at the top of the script. It also writes the orchestrator's own totals per session (for Q14).
4. `scripts/token_test/score.py`:
   - It scores housekeeping names against the answer key deterministically, component by component (date, code, parties, subject, folder).
   - For facts, it writes one comparison file per run. A scorer subagent (Opus) marks each gold fact found, wrong or missing, and each extra claim supported or unsupported. Brahm spot-checks 10% of these marks.
   - Output: cost per correct fact and cost per correct name, per cell.
5. Unit tests for the ledger and scorer against small synthetic transcripts and keys. No client data goes in the fixtures.

## Answer key (Brahm's hands-on part, about 2–3 hours)
12 documents, 3 per format, spread across sizes. For each one:
- the correct file name and folder;
- the facts list from an Opus-high extraction, corrected by Brahm (wrong facts struck, missing ones added).

Housekeeping accuracy can be scored on the whole corpus with no extra key, using names Brahm has already settled (files in subfolders whose names conform). Fact accuracy is scored on the 12 keyed documents only.

## Experiments
Each cell runs on 3 documents. Starred cells (★) run 3 times each, for Q17.

- **E0. Capability checks (Cowork, about $1).** For each item, check the result in the ledger:
  - Does a per-call `model` and `effort` on a plugin agent take effect?
  - Is a `fork` subagent available, and is its inherited context billed as a cache read?
  - Does `SendMessage` resume a finished subagent?
  - Is there any subagent rewind?
  - Is `pdftoppm` present in the VM (page-range PDF reads need it)?

  Later cells that depend on an unavailable feature are marked "not available in Cowork" rather than worked around.

  **Results (run 2026-10-17, one session, about $0.68).** Checked against the subagent transcripts, not only the session's report. The session ran on Sonnet 5.5.
  - **Per-call `model` and `effort`: available.** The Agent tool takes `model` (sonnet, opus, haiku, fable) and `effort` (low to max). `legal:extract-facts` with `model: haiku` ran every call on `claude-haiku-5-5`, and with neither set it ran on the session's `claude-sonnet-5-5`, since the agent pins no model. Thinking tokens on the same document were 3,842 at low effort against 9,819 at high (one run each).
  - **`fork`: available, billed as a cache read.** The fork's own call read 149,523 tokens from cache and wrote 557. It ran on the parent's model, in the background, and answered from the inherited conversation without reading a file.
  - **`SendMessage` resume: available.** The finished Haiku extractor resumed in the same transcript. Its first resumed call read 15,655 tokens of its own history from cache, and it stated the price without rereading the file.
  - **Subagent rewind: not available.** ToolSearch for "rewind", "checkpoint" and "restore" found only unrelated plugin tools, and neither the Agent nor the SendMessage tool has such an option.
  - **`pdftoppm`: available** (`/usr/bin/pdftoppm`, poppler 24.02.0). A Read with `pages: "2"` returned page 2 alone.

  Also seen, for E1: the orchestrator writes its cache at the 1-hour price while subagents write at the 5-minute price, and the second Haiku extractor's first call read 7,214 tokens cached by the first, so siblings on one model share a cached prefix.

  **Copy step, the last step of every run sheet.** Paste into the same Cowork task once it has finished, because a session can see only its own transcripts:

  ```text
  Copy this session's transcript files into the connected folder so they can be checked on the host. Find them with: find / -path '*/.claude/projects/*' -name '*.jsonl' 2>/dev/null | head -50. Copy this session's main <session-id>.jsonl file into a new folder named transcripts next to the test files, and copy its subagents folder, unchanged, to transcripts/<session-id>/subagents. If no such files exist in your sandbox, say so, list every place you looked, and write nothing. Then reply "copied" with the list of files written.
  ```

  `token_ledger.py` reads that `transcripts` folder as a root. It does not yet count a fork's run, and it adds a resumed run's calls to the original run's row.
- **E1. Fixed cost and caching (Q8) ★.**
  - Measure each agent type's empty-task baseline on Haiku, Sonnet and Opus.
  - Compare 5 identical subagents started in one turn with 1 started first and 4 more started after it finishes.
  - Compare a second wave started 3 minutes later with one started 7 minutes later (5-minute TTL).
  - Measure: cache-write against cache-read tokens, and cost per run.
- **E2. Housekeeping pages needed and model (Q10, Q9).**
  - A naming subagent (general-purpose, with the housekeeping naming instructions) reads 1, 2, 5 or all pages, on Haiku and on Sonnet, over the whole corpus.
  - Measure: name and folder accuracy against cost.
- **E3. Ingest pages per subagent, by format (Q2–Q5, Q15) ★.** Opus at medium effort with the real extractor.
  - (a) One document per subagent across every size bucket gives cost per page against size.
  - (b) Small documents batched into one subagent at 5, 10, 20 and 40 total pages, against one document per subagent. This tests your "about 20 pages" result.
  - (c) Large documents read in one subagent, in 20-page reads against 5-page reads, against splitting into chunk subagents.
  - Measure: cost per page, and cost per correct fact on keyed documents.
- **E4. Input format (Q11, Q16).**
  - OCR PDF read natively, against its extracted text.
  - Scanned PDF at the default resolution, against 150 dpi and 100 dpi page images.
  - `.msg` whole, against the same message with quoted history stripped.
  - Attachments read in the same subagent, against a separate one.
  - Measure: cost per correct fact.
- **E5. Shared context (Q1).** On the same documents, three designs:
  - (A) one Opus subagent extracts, then names, in the same context;
  - (B) Opus extracts, and a separate Haiku namer reads page 1;
  - (C) Opus extracts, and a Haiku namer works only from the extractor's JSON, reading no pages. This is close to what /housekeeping does today for already-ingested files.
  - Measure: total cost and name accuracy per document, by size and format. That shows where the crossover lies.
- **E6. Recycling the fixed cost (Q6, Q7)**, only for what E0 found available. One primed extractor gets a second document:
  - by `SendMessage` within 5 minutes and after 5 minutes;
  - by a fork of a primed parent;
  - by rewind, if it exists.

  Compare each against a fresh subagent. Measure: cost, and whether accuracy drops as context grows.
- **E7. Model and effort for ingest (Q13, Q9).** On the keyed documents: Haiku, Sonnet and Opus, each at low, medium and high effort. Measure cost per correct fact and the error rate.
- **E8. Output and orchestrator (Q12, Q14).**
  - The output and thinking share comes from every run's ledger rows.
  - Run the extractor's current JSON against a compact form with short keys, no nulls and no repeated quotes.
  - Run an orchestrator that receives full JSON returns against one that has results written to a file and gets a one-line summary back.
  - Measure: the orchestrator session's own cost per document.

**Order:** E0, then E1, then the answer key, then E2–E8. E3 and E5 are the core. If the budget runs short, E4, E7 and E8 can be cut back to fewer cells.

**Rough cost:** about 350–450 subagent runs. The estimate is $60–150 in all, dominated by Opus reads of long PDFs in E3 and E7. E0 and E1 give real figures to re-estimate from before the expensive runs.

## Analysis and the decision it feeds
`score.py` writes `results\summary.csv` and Claude writes a short findings report. The report covers:
- the cost-per-page curve by format, and the best pages per subagent;
- the crossover where a shared context (E5-A) beats a separate Haiku namer (E5-B/C);
- whether caching already recycles the fixed cost;
- the model and effort that minimise cost per correct fact.

Each finding lists its spread across repeats (Q17). Changing the /ingest and /housekeeping skills is a separate later task, decided from that report.

## Verification of the build
- The unit tests for `token_ledger.py` and `score.py` pass.
- `token_ledger.py` on the existing Cowork transcript (agent `a44883bde9a6174a6`) gives the same token totals as summing its `usage` lines by hand.
- `build_corpus.py --dry-run` on one matter lists buckets and OCR flags without copying anything.
- `python scripts/check_publishable.py --new-since origin/main` passes. It shows that no client data or maintainer path was committed: the scripts take paths as arguments, and their defaults use `~`.
