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

  **Getting files to subagents (found 2026-10-19, session 1).** A connected folder is no longer staged into the sandbox: the orchestrator reaches it only through a shell on the user's computer, and a subagent's Read cannot see it ("File does not exist"). This held for the whole 330 MB test folder and for a 12 MB one. A file attached to the chat is placed under `/mnt/user-data/uploads/`, where subagents can read it, so a run sheet that subagents read from ships its files as one attached zip, which the orchestrator unpacks in its sandbox. Results and transcripts are still written back to the connected folder. Real `/ingest` in Cowork would meet the same gap. A Cowork subagent returns its reply through a `SubagentHandback` tool call, not as text. In session 1 the copy step took the orchestrator's transcript before its last turns, so its cost is understated.
- **E1. Fixed cost and caching (Q8) ★.**
  - Measure each agent type's empty-task baseline on Haiku, Sonnet and Opus.
  - Compare 5 identical subagents started in one turn with 1 started first and 4 more started after it finishes.
  - Compare a second wave started 3 minutes later with one started 7 minutes later (5-minute TTL).
  - Measure: cache-write against cache-read tokens, and cost per run.

  **Results (run 2026-10-18, two sessions, about $8.9: subagents $2.12 + $0.88, orchestrators on Sonnet $3.23 + $2.65).** The first session's waits were blocked (Cowork refuses `sleep`), so its timing steps were re-run in a second session (E1b) with Monitor waits on the clock. Wait gaps were checked against the subagent transcripts' start times. All runs had an empty task at effort medium.
  - **Fixed prompt per run:** about 8.1k–9.5k tokens for `legal:extract-facts`, `legal:extract-affidavit`, `legal:extract-caselaw` and `file-manager:housekeeping-namer`, and 82.5k for `general-purpose` (its full tool list). Model makes no difference to size. Haiku often made 2 calls where Sonnet and Opus made 1.
  - **Cost per run, cold / warm (mean of reps 2–3):**

    | Agent | Haiku | Sonnet | Opus |
    |---|---|---|---|
    | Extractors and namer | $0.001 / $0.0006 | $0.023 / $0.0057 | $0.046 / $0.012 |
    | general-purpose | $0.014 / $0.006 | $0.207 / $0.064 | $0.415 / $0.130 |

    "Warm" means about 7.2k tokens read from cache and 1.8k written: the agent's shared prefix is cached, and the task prompt after it is new. A prompt identical to a cached one reads all 9k and costs $0.0029 on Opus. The cache is separate per model, and agent types share only about 1.3k tokens. So E2 should use `housekeeping-namer`, not a general-purpose namer, which costs about 10 times as much in fixed cost.
  - **Five at once against one then four: no difference in caching.** Cowork launches parallel calls about 2 seconds apart, so in each parallel batch the first run wrote the full 9,009 tokens and the other four read them (3 of 3 reps). The one-then-four pattern also had exactly one cold run per batch (3 of 3).
  - **Second wave after 3 minutes against 7 minutes: the 5-minute TTL holds.** After 3 minutes (3:18–3:20 from the last start of the first wave to the first start of the second), the second wave's first run read the cached prefix (3 of 3 reps). After 7 minutes (gaps 7:18 and 7:23), it wrote the whole 9,012 tokens again (2 of 2 reps). The third 7-minute rep did not start: the error was "the account's latest complete list of plugins does not hold its plugin's folder", probably a plugin sync replacing `legal` with `lawyer` mid-run. Later run sheets name agents by their current plugin.
  - **What a lapsed cache costs:** about $0.035 per agent type per model on Opus. It matters only for many small runs separated by idle gaps longer than 5 minutes.
  - **Orchestrator:** each session cost $2.65–3.23 on Sonnet for 87–93 calls, more than its subagents. It writes at the 1-hour price.

  **Budget re-estimate against $150: it does not hold as drafted.** Fixed cost and caching add only about $5–20 across E2–E8. Page reads dominate: an Opus page costs about $0.026–0.073, $0.045 at the midpoint. The corpus (66 documents, 1,061 pages) puts E3(a) at about $48 per pass, $143 with 3 repeats, and E3(c) adds about $100. E2 is about $38. E2–E8 as drafted comes to about $280, in a range of $170–450. Choosing the cells that fit $150 is its own ticket, decided before E2.

  **Plan within $150 (decided 2026-10-18, map #100 ticket #112).**

  This plan replaces the cells, repeats and order of E2–E8 below wherever they differ. Projected spend is about $128 for E2–E8, about $138 with the $10 spent on E0–E1. Brahm approved it.

  - **Accuracy runs and repeats use the 12 keyed documents only** (143 pages, 10 of them 11 pages or fewer). Cost per page is near-deterministic in its input tokens, so cost-only cells run once.
  - **Dropped:** E6's fork arm (a fork reads the parent's whole context, about 150k tokens against an extractor's 9k), its resume-after-5-minutes arm (a lapsed cache rewrites the whole history), and rewind (not available). E3(b)'s 5- and 10-page batches (they can save at most the $0.012 warm fixed cost, already measured). E8's full-return against write-to-file arm (the extractors hold only Read, so it needs a changed agent). It moves to the map's fog for the spec. Orchestrator cost is still read from every session's ledger.
  - **Agent names:** `lawyer:extract-facts`, `lawyer:extract-affidavit`, `lawyer:extract-caselaw`, `file-manager:housekeeping-namer`. Each run sheet confirms they are listed before its first run.

  | Session | Cells | Documents | Repeats | Est. |
  |---|---|---|---|---|
  | 1 | E3(a) keyed, Opus medium, one extractor per document. E5-A: SendMessage resume of each extractor within 5 minutes to name its file. E5-B: Haiku namer from page 1. E5-C: Haiku namer from the extractor's JSON. E3(b): keyed small documents batched to 20 and 40 pages. E6: one resume within 5 minutes with a second small document, against a fresh extractor | 12 keyed | 3 on the 10 small ones, 2 on D044 and D058 | ~$25 |
  | 2 | E3(a) ladder: the median unkeyed document of each format × size cell, for cost per page against size. E3(c): D044 and D058 in 20-page reads, 5-page reads and chunk subagents | 22 + 2 | 1 | ~$29 |
  | 3 | E7: Opus low and high, Sonnet low, medium and high, Haiku medium and high (Opus medium from session 1). E8: compact JSON | 10 small keyed + D058; E8 small keyed | 1 | ~$18 |
  | 4 | E4: OCR native against text layer (D037, D048, D044); scanned at 150 and 100 dpi (D055, D066, D058); .msg whole against quoted history stripped (D027, D028, D024); attachments in the same subagent against a separate one | keyed | 1 | ~$7 |
  | 5 | E2: a reader on Haiku or Sonnet reads 1, 2 or 5 pages and builds the naming-evidence block, then `housekeeping-namer` names the file. The all-pages arm is E5-A | 12 keyed + 2 settled | 1 | ~$6 |
  | all | Fixed cost ~$5, Opus scorer for about 150 keyed runs ~$20, 5 Sonnet orchestrators ~$20 | | | ~$45 |

  **Budget gate.** After each session, ledger spend plus the remaining estimate is checked against $150. If it would exceed the ceiling, cut in this order: E8 compact JSON, then the ladder's 1–5-page cells, then E7's Haiku-high and Opus-low cells. Sessions 1 and 2 are never cut.

  **Gate after session 1 (2026-10-19): passes, nothing cut.** Measured spend is $31.3: E0–E1 $9.6, session 1's subagents $20.84, and its orchestrator's partial transcript $0.91. Unmeasured, estimated at about $8: the rest of that orchestrator, two setup attempts that stopped before any measurement, and the 12 Opus scorers, which ran in Claude Code. Remaining estimates are $60 for sessions 2–5 and about $37 of the shared row. Projected total: about $136.

  **Gate after session 2 (2026-10-19): passes, nothing cut.** Session 2's subagents cost $13.33 ($5.05 ladder, $8.28 E3(c), $0.002 read check, and $0.07 added for D064's undercount), against its $29 estimate. Measured spend is now $44.6. Unmeasured: session 1's $8 as above, and session 2's orchestrator (its main transcript was not copied, because Cowork's auto mode blocked the copy) and its 6 Opus scorers in Claude Code, both inside the shared row. Remaining estimates are $31 for sessions 3–5 and about $37 of the shared row. Projected total: about $121.

  **Gate after session 3 (2026-10-19): passes, nothing cut.** Session 3's subagents cost $12.2–13.4 after correcting truncated calls (the ledger says $9.85), against its $18 estimate, and its orchestrator's copied transcript $3.58 on Sonnet. Taking the high end, measured spend is now $61.6. Unmeasured: session 1's $8 as above, the part of session 3's orchestrator before its transcript's compaction, and its 87 Opus scorers in Claude Code, both inside the shared row. Remaining estimates are $13 for sessions 4–5 and about $33 of the shared row. Projected total: about $116.

  **Gate after session 4 (2026-10-19): passes, nothing cut.** Session 4's subagents cost $4.96 ($4.95 for the 14 E4 runs and $0.002 for the read check), and its orchestrator $1.30 on Sonnet, with its transcript copied whole this time: $6.26 against the $7 estimate. Measured spend is now $67.9. Unmeasured: session 1's $8 as above, and session 4's 13 Opus scorers in Claude Code, inside the shared row. Remaining estimates are $6 for session 5 and about $27 of the shared row. Projected total: about $109.

  **Gate after session 5 (2026-10-19): passes, nothing cut, and no run session remains.** Session 5's subagents cost $3.75–4.10, and the copied part of its orchestrator $1.05 on Sonnet: $4.80–5.15 against the $6 estimate. Taking the high end, measured spend is now $73.1. Unmeasured: session 1's $8 as above, and session 5's orchestrator before its compaction, inside the shared row. About $26 of the shared row remains. Projected total: about $107 of $150.
- **E2. Housekeeping pages needed and model (Q10, Q9).**
  - A naming subagent (general-purpose, with the housekeeping naming instructions) reads 1, 2, 5 or all pages, on Haiku and on Sonnet, over the whole corpus.
  - Measure: name and folder accuracy against cost.

  **Session 5 results (run 2026-10-19, map #100 ticket #117, $3.75–4.10 of subagents).** A reader (`lawyer:extract-facts`) built the naming evidence from the first 1, 2 or 5 pages, then `file-manager:housekeeping-namer` on the same model named the file, both at medium effort, 1 run per cell. Each cell's input was cut to its pages: a page-subset PDF, or a .docx or .msg rendering cut to that share of its characters (the renderings have no page breaks). A cell whose cut equals a smaller cell's was not run: a 2-page document's 5-page cell is its 2-page run. Every reader read only its own cut, and every namer got its reader's evidence unchanged, both checked against the transcripts. One run is invalid: the orchestrator gave E2R-sonnetp2-D066-1 a wrong path, so D066 is left out of that cell. Names are scored as in E5, and the session 1 rows are E5's.

  | Reader and namer | Pages | Cost per document (reader + namer) | Date | Code | Author or recipient | re/encl/srv | All four | Folder |
  |---|---|---|---|---|---|---|---|---|
  | Haiku | 1 | $0.0084 ($0.0019 + $0.0065) | 10 | 11 | 8 | 10 | 8 | 6 of 9 |
  | Haiku | 2 | $0.0095 | 9 | 9 | 6 | 8 | 3 | 7 of 9 |
  | Haiku | 5 | $0.0091 | 10 | 8 | 4 | 6 | 2 | 6 of 9 |
  | Sonnet | 1 | $0.098 ($0.020 + $0.078) | 10 | 11 | 9 | 9 | 9 | 7 of 9 |
  | Sonnet | 2 (11 documents) | $0.100 | 10 | 11 | 10 | 9 | 8 | 7 of 8 |
  | Sonnet | 5 | $0.109 | 11 | 11 | 8 | 9 | 6 | 7 of 9 |
  | Session 1, E5-A: Opus, all pages, same context | all | $0.36 | 11 | 12 | 9 | 9 | 7 | 7 of 9 |
  | Session 1, E5-B: Haiku, first 80 lines or page 1 | 1 | $0.009 | 10 | 10 | 8 | 7 | 5 | 7 of 9 |
  | Session 1, E5-C: Haiku, from the whole-document extraction | all | $0.008 | 10 | 9 | 5 | 7 | 3 | 7 of 9 |

  - **Page 1 is enough, and more pages make names worse.** Right on all four components: Haiku 8, 3 and 2 of 12 at 1, 2 and 5 pages, and Sonnet 9, 8 and 6. With more pages the reader names something inside the document instead of the document itself: the enclosed pleading instead of the fax cover (D044, Haiku at 5 pages), the sender and type of a quoted email (D024, Haiku at 2 and 5), or an enclosure with a wrong date (D058, 2 and 5 pages). Session 1 fits: E5-C's whole-document evidence got 3 of 12, and E5-B's "first 80 lines" was more than half of some renderings.
  - **Sonnet buys one document of 12 at about 12 times the cost.** At page 1 Sonnet got 9 of 12 and 7 folders of 9, against Haiku's 8 and 6, for $0.098 against $0.0084. Haiku's extra misses are D027 and D037, where it took the firm's own lawyer as the author or recipient. The namer is about 80% of each document's cost on both models, mostly for reading the naming convention and its references.
  - **Haiku at page 1 matches the Opus shared context at 1/40 of the cost:** 8 of 12 on all four against E5-A's 7, and 6 folders against 7. Its 8 against E5-B's 5 with the same models comes from the shorter cut, or from run-to-run spread, which one run per cell cannot separate.
  - **No cell fixes these.** D066 (photographs of text messages, 7 scanned pages) got no usable name in any valid cell, except a partial one from Sonnet at 5 pages. The three drafts' key folder is `0. DRAFT`, which the namer is never offered. The free-text subject matched exactly on 1–2 documents of 12 in every cell, as in session 1.
  - **Settled names (D032, D051, page 1 only):** both models gave the same marks. D032 was right on everything but its author or recipient, and D051 on all four but its subject, with no folder proposed.
  - **Cost.** The ledger gives $3.69 for the 136 runs. The 17 completion notices that survived are all Sonnet namers, and 15 of them match the record exactly. They add $0.015, and the visible output of 59 flagged calls adds $0.05, for $3.75. If every flagged call also lost thinking as large as the one noticed miss (1,513 tokens), the total is about $4.10. The orchestrator's context was compacted before its last message, and its copied main transcript holds only the 9 calls after that ($1.05 on Sonnet).
  - **Caveats.** One run per cell, on 12 keyed documents and 2 settled ones. Ten key names were drafted by an Opus delegate, not by Brahm (see the key's README).
- **E3. Ingest pages per subagent, by format (Q2–Q5, Q15) ★.** Opus at medium effort with the real extractor.
  - (a) One document per subagent across every size bucket gives cost per page against size.
  - (b) Small documents batched into one subagent at 5, 10, 20 and 40 total pages, against one document per subagent. This tests your "about 20 pages" result.
  - (c) Large documents read in one subagent, in 20-page reads against 5-page reads, against splitting into chunk subagents.
  - Measure: cost per page, and cost per correct fact on keyed documents.

  **Session 1 results, E3(a) and E3(b) (run 2026-10-19, map #100 ticket #113, about $21 of subagents).** All runs used `lawyer:extract-facts` on Opus 5.5 at medium effort, the agent the key was built with. Facts were marked found, wrong or missing against the key by one Opus scorer per document. Recall is gold facts found over gold facts. Every run read its whole document, and the scorers marked 1 fact wrong and 0 extra claims unsupported in all 59 runs. Brahm's 10% spot-check of the marks is not done yet. A sample of 6 "found" marks on D044 was checked against the run's text, and all held.

  E3(a), one document per extractor (3 repeats; 2 for D058 and D044):

  | Doc | Pages | Gold | Recall, mean (range) | Cost per run | Cost per page | Cost per correct fact |
  |---|---|---|---|---|---|---|
  | D009 | 2 | 13 | 0.72 (0.69–0.77) | $0.106 | $0.053 | $0.011 |
  | D027 | 2 | 16 | 0.60 (0.38–0.75) | $0.097 | $0.048 | $0.010 |
  | D037 | 2 | 7 | 1.00 (1.00–1.00) | $0.115 | $0.058 | $0.016 |
  | D055 | 2 | 5 | 0.93 (0.80–1.00) | $0.088 | $0.044 | $0.019 |
  | D028 | 6 | 43 | 0.64 (0.60–0.65) | $0.188 | $0.031 | $0.007 |
  | D066 | 7 | 28 | 0.80 (0.71–0.86) | $0.194 | $0.028 | $0.009 |
  | D048 | 8 | 45 | 0.89 (0.89–0.89) | $0.402 | $0.050 | $0.010 |
  | D017 | 9 | 64 | 0.97 (0.95–0.98) | $0.314 | $0.035 | $0.005 |
  | D004 | 11 | 64 | 0.96 (0.95–0.97) | $0.480 | $0.044 | $0.008 |
  | D024 | 11 | 60 | 0.37 (0.32–0.42) | $0.309 | $0.028 | $0.014 |
  | D058 | 29 | 92 | 0.63 (0.57–0.70) | $0.595 | $0.021 | $0.010 |
  | D044 | 54 | 161 | 0.94 (0.93–0.96) | $1.550 | $0.029 | $0.010 |

  - **In all:** $11.17 for 34 runs, recall 0.79 (1,219 of 1,541), $0.0092 per correct fact.
  - **Cost per page** is $0.02–0.06, at or below E1's midpoint of $0.045. Even a 2-page document costs about $0.09–0.12.
  - **Output dominates.** Output tokens, thinking included, are 39–89% of each run's cost, mostly 60–80%. Page reads are the smaller part, so extracting fewer, shorter facts would save more than reading fewer pages per extractor.
  - **Low recall is per document, not per size.** D024 (an email chain with an attached appointment, 0.37) and D027 (0.38–0.75) are the weak ones, so Q17's spread is widest on short emails. Their keys may hold more facts than an Opus-medium pass ever extracts, which E7 will show.

  E3(b), small documents batched into one extractor (1 run each), against the E3(a) means of the same documents:

  | Batch | Documents | Pages | Batch cost | Single-document cost | Recall, batch / single | Cost per correct fact, batch / single |
  |---|---|---|---|---|---|---|
  | B20a | D037, D048, D055, D066 | 19 | $0.765 | $0.798 | 0.86 / 0.87 | $0.0105 / $0.0108 |
  | B20b | D009, D017, D027, D028 | 19 | $0.799 | $0.705 | 0.76 / 0.80 | $0.0078 / $0.0065 |
  | B20c | D004, D024 | 22 | $0.689 | $0.789 | 0.69 / 0.68 | $0.0080 / $0.0094 |
  | B40a | D009, D017, D027, D028, D037, D048, D055, D066 | 38 | $1.433 | $1.503 | 0.78 / 0.83 | $0.0083 / $0.0082 |
  | B40b | D004, D017, D024, D048 | 39 | $1.160 | $1.504 | 0.70 / 0.80 | $0.0071 / $0.0081 |

  - **About 20 pages:** cost within −13% to +13% of one document per extractor, recall within 4 points. No gain either way.
  - **About 40 pages:** cost 5% and 23% lower, and recall 5 and 10 points lower. The loss sits in particular documents: D028 fell from about 27 to 16 facts found, D048 from 40 to 33 and D004 from 62 to 53. So batching to 40 pages saves money only by finding fewer facts, and cost per correct fact barely moves.

  **Session 2 results, the E3(a) ladder (run 2026-10-19, map #100 ticket #114, $5.05 of subagents).** One run of `lawyer:extract-facts` on Opus 5.5 at medium effort per document. In each format × size cell the document is the median unkeyed one by pages, the shorter of two. Each got only its matter's folder name as context. .docx and .msg went in as `render_document.py` renderings, and a .msg as its body without attachments, since its pages were counted from the body. All 22 runs read their whole document. Four are not litigation documents of the kind /ingest extracts facts from: D010 and D014 are Westlaw research memos, D005 an AI research memo and D041 a judgment.

  | Doc | Format | Pages | Facts | Cost | Cost per page | Output share |
  |---|---|---|---|---|---|---|
  | D002 | .docx | 1 | 7 | $0.106 | $0.106 | 46% |
  | D007 | .docx | 3 | 26 | $0.120 | $0.040 | 79% |
  | D018 | .docx | 7 | 31 | $0.196 | $0.028 | 80% |
  | D005 | .docx | 14 | 3 | $0.123 | $0.009 | 28% |
  | D010 | .docx | 29 | 0 | $0.158 | $0.005 | 12% |
  | D014 | .docx | 43 | 0 | $0.241 | $0.006 | 13% |
  | D020 | .msg | 1 | 0 | $0.042 | $0.042 | 48% |
  | D026 | .msg | 2 | 4 | $0.078 | $0.039 | 64% |
  | D029 | .msg | 6 | 23 | $0.169 | $0.028 | 67% |
  | D022 | .msg | 16 | 34 | $0.336 | $0.021 | 49% |
  | D032 | OCR PDF | 1 | 1 | $0.045 | $0.045 | 42% |
  | D038 | OCR PDF | 2 | 4 | $0.140 | $0.070 | 77% |
  | D046 | OCR PDF | 6 | 33 | $0.260 | $0.043 | 70% |
  | D035 | OCR PDF | 12 | 39 | $0.284 | $0.024 | 66% |
  | D041 | OCR PDF | 29 | 18 | $0.327 | $0.011 | 36% |
  | D043 | OCR PDF | 58 | 23 | $0.619 | $0.011 | 35% |
  | D050 | Scanned PDF | 1 | 3 | $0.059 | $0.059 | 53% |
  | D057 | Scanned PDF | 2 | 8 | $0.094 | $0.047 | 65% |
  | D064 | Scanned PDF | 9 | 17 | $0.160* | $0.018* | about 44%* |
  | D052 | Scanned PDF | 15 | 56 | $0.566 | $0.038 | 80% |
  | D059 | Scanned PDF | 33 | 24 | $0.353 | $0.011 | 33% |
  | D063 | Scanned PDF | 57 | 39 | $0.569 | $0.010 | 32% |

  \* D064's final call is logged with 10 output tokens for about 10.6k characters of reply and thinking, so its row is corrected by about $0.068, at 3.1 characters a token. See "Undercounted calls" below.

  - **Cost follows facts, not pages.** A least-squares fit over the 22 runs gives cost ≈ $0.02–0.04 per run + about $0.005 (text renderings) or $0.006 (PDFs) per page + about $0.005–0.006 per fact extracted, worst error $0.11. Reading a page costs about as much as writing one fact.
  - **Cost per page falls with size in this sample** ($0.04–0.11 at 1 page, $0.005–0.011 at 21–80 pages), but mostly because the long documents here (memos, a judgment, leases, a bundle of records) give few facts per page. A dense long document costs more: D044 is $0.029 a page, and D052 (15 pages, 56 facts) $0.038.
  - **Format matters little once facts are counted.** A rendered .docx or .msg page costs about $0.005, a PDF page about $0.006, scanned or OCR alike. The floor for a 1-page document is $0.04–0.11.

  **Session 2 results, E3(c) (run 2026-10-19, ticket #114, $8.28 of subagents).** D044 (54 pages, OCR) and D058 (29 pages, scanned), 1 run per arm, `lawyer:extract-facts` on Opus 5.5 at medium effort. The 20-page arm is the extractor's own default, so it repeats E3(a). The 5-page arm read the same document in 11 and 6 reads. The chunk arm split each document into even chunks of up to 20 pages, one extractor per chunk (1–18, 19–36 and 37–54; 1–15 and 16–29), and its facts were joined before scoring. Every run read exactly its planned pages. One Opus scorer per run marked them as in session 1. No claim was marked unsupported.

  | Doc | Arm | Cost | Recall | Cost per correct fact | Session 1, 20-page reads: mean cost, recall (range) |
  |---|---|---|---|---|---|
  | D044 | 20-page reads | $1.609 | 0.89 | $0.0112 | $1.550, 0.94 (0.93–0.96) |
  | D044 | 5-page reads | $1.686 | 0.91 | $0.0115 | |
  | D044 | 3 chunk extractors | $3.227 | 0.93 | $0.0217 | |
  | D058 | 20-page reads | $0.499 | 0.61 | $0.0089 | $0.595, 0.63 (0.57–0.70) |
  | D058 | 5-page reads | $0.548 | 0.57 | $0.0105 | |
  | D058 | 2 chunk extractors | $0.711 | 0.71 | $0.0109 | |

  - **Read size makes no difference.** 5-page reads cost 5–10% more than 20-page reads, and recall stayed within session 1's spread.
  - **Chunk extractors cost more and gain little.** D044's chunks cost twice as much, for recall inside the single extractor's range. Each chunk writes its own long output (294 facts across three chunks, against 131), much of it repeated. D058's chunks cost 1.4 times as much, for recall 0.71, just above the single extractor's best of 0.70 in three runs. With one run per arm, that gain is not a measurement.
  - **For /ingest:** one extractor per document, reading 20 pages at a time, up to at least 54 pages. Splitting a long document across subagents pays only if it buys recall, and here it did not.

  **Undercounted calls.** In a few transcripts the last call's `usage` is written before its output finishes: D064 here, and 12 Haiku calls in session 1's E5-B and E5-C runs (about $0.02 in all, so E5-B and E5-C's naming cost of about $0.009 per document is about 20% low). `token_ledger.py` counts what the transcript says, so it reports these low. A check: a call whose content is more than 12 characters per recorded output token.

  In session 3 this hit most Sonnet and Haiku runs (50 of 55, against 2 of 32 on Opus): the last call records 2–24 output tokens, and its thinking is logged as about 60 characters, so even a character count misses the thinking. The ledger put session 3's subagents at $9.85; corrected, they are $12.2–13.4. One source gives the true figure: in the main transcript, each background subagent's completion notice carries `totalTokens`, which equals the last call's input plus its true output. That held exactly on all 8 complete runs that had a notice. Only 22 notices survived, because the copied main transcript starts after an automatic compaction, so a future run sheet should copy the main transcript before the orchestrator's context fills.
- **E4. Input format (Q11, Q16).**
  - OCR PDF read natively, against its extracted text.
  - Scanned PDF at the default resolution, against 150 dpi and 100 dpi page images.
  - `.msg` whole, against the same message with quoted history stripped.
  - Attachments read in the same subagent, against a separate one.
  - Measure: cost per correct fact.

  **Session 4 results (run 2026-10-19, map #100 ticket #116, $4.96 of subagents).** One run per cell of `lawyer:extract-facts` on Opus 5.5 at medium effort, with session 1's matter context. No original PDF was shipped, so each run read only its variant, and every run read the whole of it. One Opus scorer per run marked facts as in session 1. Each row is compared with session 1's native E3(a) runs of the same document (mean, and recall range over 2–3 repeats). "New input" is input plus cache writes: what the run paid to read, before the shared cached prefix.

  | Doc | Arm | Cost | New input | Recall | Cost per correct fact | Native: cost, new input, recall (range), cost per correct fact |
  |---|---|---|---|---|---|---|
  | D037 | text layer | $0.123 | 11.7k | 0.71 | $0.0246 | $0.115, 11.2k, 1.00 (1.00–1.00), $0.0164 |
  | D048 | text layer + 6 page images | $0.438 | 21.9k | 0.87 | $0.0112 | $0.402, 15.7k, 0.89 (0.89–0.89), $0.0100 |
  | D044 | text layer + 13 page images | $1.616 | 69.3k | 0.91 | $0.0110 | $1.550, 71.7k, 0.94 (0.93–0.96), $0.0102 |
  | D055 | 150 dpi | $0.112 | 9.1k | 1.00 | $0.0225 | $0.088, 6.0k, 0.93 (0.80–1.00), $0.0188 |
  | D055 | 100 dpi | $0.081 | 6.1k | 0.60 | $0.0271 | |
  | D066 | 150 dpi | $0.235 | 21.1k | 0.79 | $0.0107 | $0.194, 13.9k, 0.80 (0.71–0.86), $0.0087 |
  | D066 | 100 dpi | $0.200 | 16.1k | 0.86 | $0.0083 | |
  | D058 | 150 dpi | $0.898 | 86.8k | 0.58 | $0.0169 | $0.595, 40.2k, 0.63 (0.57–0.70), $0.0103 |
  | D058 | 100 dpi | $0.682 | 42.7k | 0.63 | $0.0118 | |
  | D027 | quoted history stripped | $0.060 | 4.0k | 0.19 (0.75 of facts left in the input) | $0.0200 | $0.097, 4.9k, 0.60 (0.38–0.75), $0.0100 |
  | D028 | quoted history stripped | $0.063 | 4.0k | 0.05 (0.50) | $0.0313 | $0.188, 11.1k, 0.64 (0.60–0.65), $0.0069 |
  | D024 | quoted history stripped, attachment kept | $0.126 | 7.5k | 0.05 (0.50) | $0.0419 | $0.309, 21.5k, 0.37 (0.32–0.42), $0.0138 |
  | D024 | attachment in a separate extractor | $0.319 | 24.8k | 0.33 | $0.0160 | |

  - **OCR PDFs: read them natively.** The text layer saved no input on D037 or D044, because a native read of a text page costs little more than its text. On D048 it cost more, because only 2 of its 8 pages have a text layer (and 13 of D044's 54), and the rest went in as 150-dpi images. Recall was at or below native's range on all three, and D037's garbled text layer produced its one wrong fact, which 3 native runs never made. A PDF flagged as OCR can still lack text on most pages, so a text-layer-first design must also handle images.
  - **Scanned PDFs: native already reads at about 100 dpi.** The 100-dpi images took the same new input as native (6.1k against 6.0k, 16.1k against 13.9k, 42.7k against 40.2k), and 150 dpi took 1.3–2.0 times as much (about 1,500 more tokens a page on D058) and cost 21–51% more than native, with no gain in recall. Pre-rendering pages buys nothing. D055 at 100 dpi found 3 of 5 facts, but one of its two misses is a fax number the 150-dpi run's scorer accepted and its own marked wrong, which is scorer spread on a 5-fact key.
  - **Stripping quoted history cuts cost 38–66% and loses most facts.** The key was built from the whole email, and 12 of D027's 16 gold facts, 39 of D028's 43 and 54 of D024's 60 lie only in the quoted messages. Even on the facts left in the input, recall was 0.50–0.75, against native's 0.37–0.64 on the whole thread. So stripping pays only if each quoted message is also ingested as its own document, and then the saving is avoiding the same message's facts twice. Whether /ingest can rely on that is a design question for the spec, not a cost result.
  - **Attachments: no difference.** D024's email and its attached PDF in two extractors cost 3% more than in one, with recall 0.33, inside the single extractor's range. D024 is the only keyed email with a real attachment, so this is one run on one document.
  - **Undercounted calls.** 3 of the 14 Opus runs (D058 at both resolutions, D066 at 100 dpi) end with a short handback logged at 16 output tokens. No completion notice survived for them, and each adds at most $0.007, so they are left as recorded.
- **E5. Shared context (Q1).** On the same documents, three designs:
  - (A) one Opus subagent extracts, then names, in the same context;
  - (B) Opus extracts, and a separate Haiku namer reads page 1;
  - (C) Opus extracts, and a Haiku namer works only from the extractor's JSON, reading no pages. This is close to what /housekeeping does today for already-ingested files.
  - Measure: total cost and name accuracy per document, by size and format. That shows where the crossover lies.

  **Session 1 results (run 2026-10-19, ticket #113), on the 12 keyed documents, 1 run each.** Every design shares the E3(a) rep-1 Opus extraction, so only its naming cost is counted here. In A, the extractor was resumed by SendMessage within 5 minutes, read a 22k-token naming pack (the namer's procedure and every reference it fetches, all folder notes included) and named the file. In B, `lawyer:extract-facts` on Haiku read page 1 (or a rendering's first 80 lines) for naming evidence, then `file-manager:housekeeping-namer` on Haiku named it. In C, the namer on Haiku named it from the Opus extractor's `naming_evidence`.

  | Design | Naming cost per document | Date | Code | Author or recipient | re/encl/srv | All four | Folder |
  |---|---|---|---|---|---|---|---|
  | A, same context | $0.36 ($0.17–0.97) | 11 | 12 | 9 | 9 | 7 | 7 of 9 |
  | B, Haiku from page 1 | $0.009 | 10 | 10 | 8 | 7 | 5 | 7 of 9 |
  | C, Haiku from the extractor's evidence | $0.008 | 10 | 9 | 5 | 7 | 3 | 7 of 9 |

  - **How names were scored.** Each component is matched exactly against the key (`score.py names`). The free-text subject almost never matches exactly (2 whole names of 36 were exact), so it is left out above. The folder count leaves out D009, D017 and D004, whose key folder is `0. DRAFT`, which the namer is never offered.
  - **A is about 40 times the cost of B or C** and gets 2 to 4 more documents of 12 right on all four structured components. Its cost is the naming pack, read at Opus prices. D044's resume ($0.97) rewrote its 170k-token history, because its cache had lapsed.
  - **B beats C at the same price.** C's evidence comes from a whole-document read, yet C's author or recipient is right on only 5 documents of 12. B fails where page 1 is not enough: D066's page-1 read gave no usable evidence, so B proposed no name.
  - **Caveats.** One run per design, 12 documents, and matter context written for the test rather than taken from the case database.
- **E6. Recycling the fixed cost (Q6, Q7)**, only for what E0 found available. One primed extractor gets a second document:
  - by `SendMessage` within 5 minutes and after 5 minutes;
  - by a fork of a primed parent;
  - by rewind, if it exists.

  Compare each against a fresh subagent. Measure: cost, and whether accuracy drops as context grows.

  **Session 1 results (run 2026-10-19, ticket #113): resuming within 5 minutes saves nothing worth having.** Three E3(a) rep-2 extractors, each just finished on a 2-page document, were resumed by SendMessage with a second 2-page document. Each is compared with the 3 fresh E3(a) runs of that document.

  | Second document | Resumed: cost, recall | Fresh: mean cost, mean recall (range) |
  |---|---|---|
  | D027 (after D037) | $0.092, 0.69 | $0.097, 0.60 (0.38–0.75) |
  | D009 (after D055) | $0.112, 0.69 | $0.106, 0.72 (0.69–0.77) |
  | D037 (after D009) | $0.098, 0.71 | $0.115, 1.00 (1.00–1.00) |

  - **Cost:** −$0.017 to +$0.006 per document. The history is read from cache, but each run's cost is mostly output, which a resume does not change.
  - **Accuracy:** within the fresh range twice, and below it once. D037 lost 2 of its 7 facts, where all 3 fresh runs found every one. With 3 pairs, this is a warning, not a measurement.
- **E7. Model and effort for ingest (Q13, Q9).** On the keyed documents: Haiku, Sonnet and Opus, each at low, medium and high effort. Measure cost per correct fact and the error rate.

  **Session 3 results (run 2026-10-19, map #100 ticket #115).** One run per cell of `lawyer:extract-facts` on the 10 small keyed documents and D058 (437 gold facts), with session 1's inputs unchanged. Opus medium is session 1's E3a, the mean of its repeats on the same 11 documents. One Opus scorer per run marked them as before. Most Sonnet and Haiku runs end with a truncated call (see "Undercounted calls"), so their cost is a range: low counts only the visible output, and high adds thinking at Opus's rate for the same effort.

  | Model, effort | Cost of 11 runs | Recall | Facts wrong | Extra claims unsupported | Cost per correct fact |
  |---|---|---|---|---|---|
  | Opus low | $1.85 | 0.52 | 0 | 0 | $0.0081 |
  | Opus medium (session 1) | $2.89 | 0.74 | 1 in 32 runs | 0 | $0.0089 |
  | Opus high | $3.74–3.79 | 0.82 | 0 | 0 | $0.0104–0.0106 |
  | Sonnet low | $1.03–1.04 | 0.55 | 0 | 4 | $0.0043 |
  | Sonnet medium | $1.34–1.87 | 0.59 | 2 | 0 | $0.0052–0.0072 |
  | Sonnet high | $1.74–2.27 | 0.67 | 0 | 0 | $0.0059–0.0078 |
  | Haiku medium | $0.11–0.14 | 0.52 | 1 | 5 | $0.0005–0.0006 |
  | Haiku high | $0.23–0.24 | 0.58 | 3 | 6 | $0.0009–0.0010 |

  - **Cheapest per correct fact: Haiku, by a factor of 8–15 over Sonnet and Opus.** But it finds only 0.52–0.58 of the facts, and it makes the errors Opus never made at any effort: facts stated wrongly, and extra claims that reverse a party's position (D048: "the Defendants denied that obvious vandalism was merely wear and tear", from both Haiku cells and Sonnet low). Haiku medium returned no facts at all for D037.
  - **Recall rises with effort on every model, and cost per correct fact rises with it.** Opus low finds 0.52 at $0.0081, Opus high 0.82 at $0.0105. Sonnet high (0.67) costs about 60–80% of Opus medium and finds fewer facts.
  - **No cell beats Opus medium on both cost per correct fact and recall.** Opus high buys 8 points of recall for about 30% more. So the choice between Opus medium, Opus high and a cheaper model is a recall floor for /ingest, not a cost result.
  - **Caveats.** One run per cell, and Q17's spread at Opus medium was up to 37 points on one document. The key was built from an Opus-high extraction, so it may favour Opus's choice of which facts to state. Sonnet medium's D055 reply was valid JSON followed by a stray `}`, which an /ingest parser would reject.
- **E8. Output and orchestrator (Q12, Q14).**
  - The output and thinking share comes from every run's ledger rows.
  - Run the extractor's current JSON against a compact form with short keys, no nulls and no repeated quotes.
  - Run an orchestrator that receives full JSON returns against one that has results written to a file and gets a one-line summary back.
  - Measure: the orchestrator session's own cost per document.

  **Session 3 results, compact JSON (run 2026-10-19, ticket #115).** `lawyer:extract-facts` on Opus medium, one run on each of the 10 small keyed documents, told to keep the contract's content but write one line of minified JSON with short keys (`f`, `s`, `l` …), no null or empty fields and no repeated quotes. All 10 replies used the short keys. Cost was $2.20 against $2.28–2.29 for session 1's E3a on the same documents (rep 1 and the mean of 3), and recall 0.79 against 0.77–0.79. Compact output saves about 4%, inside the run-to-run spread, because most output is the facts' own sentences and thinking, not keys or whitespace. It is not worth a contract change.

  **Full-JSON returns against write-to-file returns, priced from the ledgers (2026-10-19, map #100 ticket #147, no new runs).** The orchestrator arm was not run (see the plan within $150), so this prices it from what sessions 1–5 recorded.
  - **No test orchestrator received an extractor's JSON.** Every background extractor's completion notice says its reply is in the output file and "is not repeated here", and no orchestrator read those files into its context (session 5 checked them with a script). So the measured orchestrator costs are already the file route. The full-JSON route is priced from the replies' sizes.
  - **Reply size.** From the handback of each `lawyer:extract-facts` run on Opus medium over whole documents (session 1's E3a and session 2's ladder, 34 documents, repeats averaged), at 2.57 characters a token (the median over 128 Opus extractor replies whose last call held the handback): mean 6.1k tokens, median 4.0k, range 0.5k (D010) to 41.2k (D044). That is about 420 tokens a page overall, but it follows facts, not pages: 14–65 a page on the research memos, 1.0k–2.0k on dense short documents.
  - **Turns.** A reply received for one document is re-read from cache on every later orchestrator call in the session. With c calls per document and r calls after the reply within its own document, document k of 30 is re-read (30 − k)·c + r times, an average of (435c + 30r) / 30. Measured: c = 1.5, r = 1 from session 4, the only orchestrator transcript copied whole (22 calls for 15 extractor runs), giving 22.8 re-reads. Assumed, not measured: c = 5, r = 2 for a real /ingest, from `ingest-extract.md`'s steps per document (gate query, page-1 read, dispatch, one `matter_data__execute`, report), giving 74.5.
  - **Price.** A full reply costs its 1-hour cache write once, then a cache read per re-read (E0). The file route's ~50-token summary costs the same per token. At the mean reply:

    | Orchestrator | Turns | Full JSON, per document | Full JSON, 30 documents | File + summary, 30 documents |
    |---|---|---|---|---|
    | Sonnet | measured, 22.8 re-reads | $0.038 ($0.024 write + $0.014 reads) | $1.14 | $0.01 |
    | Sonnet | assumed, 74.5 | $0.070 ($0.024 + $0.045) | $2.09 | $0.02 |
    | Opus | measured, 22.8 | $0.076 ($0.049 + $0.028) | $2.29 | $0.02 |
    | Opus | assumed, 74.5 | $0.139 ($0.049 + $0.091) | $4.18 | $0.03 |

  - **Against extraction.** Extraction averaged $0.279 a document over the same 34 documents, so carrying full replies adds 14–50% on top of it. Cost scales with reply size: D044's reply alone costs 6.8 times the mean.
  - **Context.** Thirty mean replies put about 182k tokens into the orchestrator's context, before its own prompt and SQL. On a long ingest that can force a compaction, which the file route avoids.
  - **What the file route needs for facts.** The extractor writes the same output tokens either way, so the extractor's cost does not change. But the orchestrator today writes every fact into one `matter_data__execute` script by hand. Writing the reply's content again as SQL costs at least its own size in output, $0.061 a document on Sonnet and $0.122 on Opus ($1.82 and $3.65 for 30), and that script is then re-read like the reply. If the orchestrator reads the file back to write that SQL, the saving is lost. The file route saves both costs only with a tool that loads rows from the file, as `matter_data__ingest_authority` does for `lawyer:extract-caselaw`'s `RESULT_PATH`.
  - **Caveats.** Sizes come from one model's replies (Opus medium) on 34 documents. The real /ingest turn count is an estimate. The SQL figure assumes the script is no larger than the reply.

**Order:** E0, then E1, then the answer key, then E2–E8. E3 and E5 are the core. If the budget runs short, E4, E7 and E8 can be cut back to fewer cells.

**Rough cost:** about 350–450 subagent runs. The estimate is $60–150 in all, dominated by Opus reads of long PDFs in E3 and E7. E0 and E1 give real figures to re-estimate from before the expensive runs. The re-estimate after E1 is about $280 (under E1).

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
