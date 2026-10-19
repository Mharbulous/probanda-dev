# Spec: Token-efficient /ingest and /housekeeping

Status: draft, 2026-10-19, written from the findings report of map #100 ("Token-efficient /ingest and /housekeeping"), which Brahm approved on 2026-10-19. Brahm chose Opus at high effort for the extractors. The other decisions follow from the measurements or from the grilling session recorded in §8, including Brahm's answer on email attachments (§8 item 12).
Plugins: `lawyer` and `file-manager`.
Related: [the findings report](../Plans/2026-10-19_token-efficiency-findings.md) (the decisions and the figures they rest on), [the test protocol](../Plans/2026-10-17_token-efficiency-test-protocol.md) (every measurement), and `/matter-data` design decisions #51, #63 and #68.

---

## 1. Problem

The report settled how /ingest and /housekeeping should spend tokens, and left changing the skills to a spec. Today the extractors inherit the session's model and effort, the housekeeping namer runs on Sonnet from evidence the Opus extractor wrote, Path C pre-renders scanned affidavit pages at ~150 DPI, and every `extract-facts` reply lands whole in the orchestrator's context before the orchestrator rewrites it as SQL.

## 2. Evidence (verified at HEAD `7d95cfb`, 2026-10-19)

- The five extractors carry no `model:` line (`source/lawyer/agents/extract-*.md`), and `.claude/skills/matter-data/tests/test_plugin_agent_parity.py` (`test_model_pin_matches_the_558_split`) requires that they carry none.
- `source/file-manager/agents/housekeeping-namer.md` has `model: sonnet`. `/housekeeping` Step 1 says only the namer is pinned, and Step 11 dispatches it with `model: "sonnet"`.
- `/housekeeping` gets each row's naming evidence from the extractor's `naming_evidence` block (`ingest-unattended`'s `OUTPUT: full`), from the stored record plus a gap-fill page-1 read, or from its own Step 8 read. The report's E2 found a separate Haiku read of page 1 better than any of these (8 of 12 names right on all four structured parts, against 3 of 12 from the extractor's whole-document evidence in E5-C).
- `ingest-extract.md` Path C Pass 1 renders scanned pages at ~150 DPI, and `shared/bookmark-segmentation.md` §6 reads Pass 2's boundary batches (up to about 40 pages) and each Pass 3 stamp page from the same renders. Design decision #63 records the rule.
- `extract-caselaw` already writes its result to a `RESULT_PATH` file and replies one line, and `matter_data__ingest_authority` (`source/lawyer/mcp/src/case/ingest-authority.ts`, `.claude/skills/matter-data/references/scripts/ingest_authority.py`, decision #68) loads it. `extract-facts` replies its whole JSON, and the orchestrator reads it for routing (`document.category`) and for the after-completion passes as well as for the write.
- Claude Code honours `model` and `effort` in a plugin agent's frontmatter. The per-call `effort` parameter overrides the frontmatter, `CLAUDE_CODE_EFFORT_LEVEL` overrides both, and the per-call `model` parameter overrides the frontmatter (code.claude.com/docs/en/sub-agents, "Choose an effort level" and "Choose a model"; code.claude.com/docs/en/plugins/components, "Supported fields"). The docs say nothing about whether Cowork honours either frontmatter field. E0 confirmed that Cowork honours the per-call `model` and `effort` parameters.
- In Cowork a subagent's Read cannot see the connected folder (protocol, E0, "Getting files to subagents"). `ingest-extract.md`'s Universal rules therefore stage a byte-exact copy in a bridged session and dispatch its explicit path.
- The plugins' manifests list dependencies by name only (`source/file-manager/plugin.json`: `"dependencies": ["lawyer"]`), with no version floor.

## 3. Goal and non-goals

Goal: /ingest and /housekeeping run the configuration the report chose, and each change has a check that would fail if it were wrong.

Non-goals: implementing this spec; email quoted-history stripping, which the report handed to the spec as a design question and this spec's brief puts out of bounds, so it stays open for a later spec and whole-message extraction stays meanwhile; a file route for `extract-affidavit`, `extract-provision` or `extract-sought-orders`; a scorer agent type; `extract-caselaw`'s model (not measured).

## 4. Design

### 4.1 Extractors on Opus at high effort (report Q9, Q13)

`extract-facts` and `extract-affidavit` gain `model: opus` and `effort: high` in their frontmatter, in `source/lawyer/agents/`. Every skill step that dispatches either one also passes `model: "opus"` and `effort: "high"` on the Agent call, because the per-call parameters are the only route E0 verified in Cowork. The two settings agree, so neither overrides the other in practice. The pin is exact, as the report says ("runs on Opus at high effort"): a Fable session or one at `max` effort still extracts on Opus high. All three of `extract-affidavit`'s passes take the pin: Pass 2 locates only, but splitting the agent's effort by pass was not measured.

Dispatch sites: `ingest-extract.md` Path A step 2 and Path C Passes 1–3, and `operations/extract-facts.md` (the folder scan). Path E's evidence children run Path C, so they need no text of their own, and neither does `ingest-unattended.md`, which dispatches through `ingest-extract.md`.

The pin reverses the extractor half of the #558 split ("extractors inherit the session model"). Record that in a new `/matter-data` design decision (§4.7), and change `test_plugin_agent_parity.py` so its table pins `extract-facts` and `extract-affidavit` to `opus` and checks an `effort: high` line on both. `extract-caselaw`, `extract-provision` and `extract-sought-orders` keep no model line.

If `CLAUDE_CODE_EFFORT_LEVEL` is set on a machine, it overrides both settings. That is the user's own override, and the spec does not guard against it.

### 4.2 Housekeeping naming from a Haiku page-1 reader (report Q1, Q9, Q10)

**A new agent, `file-manager:housekeeping-reader`**, in `source/file-manager/agents/housekeeping-reader.md`, with `model: haiku`, `effort: medium` (the effort E2 measured), and `Read` alone. It reads page 1 of one file and returns one JSON object: that file's naming-evidence block. One instance per row, dispatched in parallel, as E2 ran it. It holds the naming-evidence contract, moved whole from `extract-facts.md`'s "Naming evidence" section and its `naming_evidence` output, plus facets that live elsewhere today:

- `filing_stamp` and `signature`, from `/housekeeping` Step 8's definitions (a blank "Per:" line or an unsigned name block is `absent`).
- The authority facets `decision_date`, `caption` and `court`, from `extract-caselaw.md` and `extract-provision.md`, for a row in a Law folder.

Page 1 means: `pages: "1"` on a PDF read; the image itself for an image file; for a `.docx`, `.eml` or `.msg`, the head of its rendering, cut by a new `render_document.py --head-chars N` option that writes `<name>.head.txt` beside the rendering. N starts at 3,000 characters, about one page, and the check below calibrates it. E2 cut renderings to one page's share of their characters, and E5-B's "first 80 lines" ran past half of some renderings and named things inside them. In a bridged session the reader gets a staged byte-exact copy by explicit path, by `ingest-extract.md`'s Universal rule. /housekeeping finds `render_document.py` the way it finds `hash_files.py` today, in the installed `lawyer` plugin's `matter-data` skill folder.

A reader reply that is missing or does not follow the contract is re-dispatched once. If it fails again, the row gets the signal "The reader returned an unusable report" (`uncertain_name`) and no proposal.

**Rows the reader never sees**, each keeping today's route:

- Privileged-store rows. This session builds their block from its own read (Step 8, or a page-1 read for a row ingested before this run), and no subagent sees them, as Path B and the namer's own constraint already require.
- Firm drafts Step 8 flags. Step 8 keeps recording their naming facets from its own read, as for privileged rows, because a draft the evidence shows final is filed with `final: true` and needs a name. No subagent sees a draft.
- Rows under a folder named `privileged` or `disclosed`, which are always `stuck`, so a read buys nothing.
- Duplicates, which Step 11 composes from the twin's record.
- Rows that could not be read, and rows held back by a remembered ingest failure.

**`/housekeeping` changes:**

- Step 1: reading runs on the session's model except the extractors (Opus high, §4.1), the reader (Haiku) and the namer (Haiku).
- Step 8 keeps its page-1 read for routing and for the four firm-draft facts, and stops recording naming facets, except for a row routed to the privileged store and a flagged draft.
- Step 9 drops `naming_evidence` and `naming_evidence_defect` from what `ingest-unattended` returns.
- Step 10 is replaced: every row the list above does not exclude gets a reader dispatch, whether or not it was ingested before this run. The gap-fill read goes, and so does the stored record as an evidence source.
- Step 11 dispatches the namer with `model: "haiku"` and `effort: "medium"`. The namer's `evidence_source` enum becomes `page_1` (a reader block) and `twin_record` (a duplicate's twin).
- Step 12 check 3 cross-checks every ingested row, not only those ingested this run, against its stored record: Step 7's `ingest-status` metadata for a row ingested earlier, Step 9's second call for one ingested now. With the stored record gone as evidence, this is where it still meets the name. Check 4 becomes the reader defect above.
- The Rows signal table's `uncertain_name` source drops "gap-fill leftovers" and keeps "a defective reader report". The Contents row for Step 10 and the interfaces list (the reader agent and `render_document.py`) are updated.

`housekeeping-namer.md` changes `model: sonnet` to `model: haiku`, adds `effort: medium`, and updates its Input section: `naming_evidence` is the block the reader emits, the authority facets come from the reader, and `evidence_source` takes the two values above. Its batch of about 15 stays: the report notes the namer is about 80% of each document's naming cost, mostly its references, which a batch reads once.

**The extractors stop producing naming evidence.** With naming apart from extraction, nothing reads their block. `extract-facts`, `extract-affidavit` (Pass 1), `extract-caselaw` and `extract-provision` drop their "Naming evidence" sections, their `naming_evidence` output and the `OUTPUT` input. `ingest-extract.md` drops its "`naming_evidence` is not extraction output" rule and every `OUTPUT` it supplies. `ingest-unattended.md` drops its `naming_evidence` and `naming_evidence_defect` outputs and the paragraph that sets `OUTPUT: full`. `test_ingest_unattended_contract.py`'s two naming-evidence tests go. `file-naming/SKILL.md`'s proposal-mode bullet ("whose ingest reads open the document and whose `housekeeping-namer` composes the name from the naming evidence those reads return") changes to say a page-1 read supplies the evidence, naming no file-manager agent, so `source/layering.json` needs no new ruling. `conformance-check.md`'s Callers entry says only "from each file's naming evidence" and stays.

### 4.3 One extractor per document, 20-page reads (report Q2–Q5)

No behaviour changes. The extractors already read "in chunks of no more than 20 pages", one document per dispatch. The spec only fixes the two designs E3 rejected out of the skill, so no later edit brings them back: add to `ingest-extract.md`'s Universal rules one line saying a dispatch carries one document, never two, and a long document is never split across extractors. Path C's per-exhibit Pass 3 and Path E's per-child dispatches read one exhibit or one child each, which is not a split.

### 4.4 Scanned affidavit pages read natively (report Q11)

`ingest-extract.md` Path C Pass 1 step 1 drops "For scanned pages, render to PNG at ~150 DPI … and read the images", and step 2 drops "Pass it each rendered PNG page by explicit path". The extractor reads the PDF natively, which E4 showed reads scans at about 100 dpi for the same recall at 21–51% less cost. `extract-affidavit.md`'s shared constraint "If a page has no text layer it has been rendered to a PNG image for you" is limited to stamp pages. Pass 1 still reports `scanned: true` for a scanned body, because §6 below keys off it.

Pass 2 scans its boundary batches natively too and returns the stamp pages it found. When Pass 1 reported `scanned: true`, the orchestrator then renders each of those stamp pages at ~150 DPI into the temp render directory and dispatches `extract-affidavit` once more with `PASS = 2` and a new `STAMP_RENDERS` input, the explicit path of each render. That dispatch reads only the renders and returns each stamp's `letter` and `ocr_uncertain`, the handwritten letter being read from a render as `shared/bookmark-segmentation.md` §6 requires today. E4 did not measure handwriting, and a stamp page is one page per exhibit. Pass 3 already skips the stamp page and needs no render. §6 is reworded to say this and to stand alone without "the same rule Pass 1 already applies to its own pages". `supersede-draft.md`'s pointer to "#63, Path C" for its ~150 DPI comparison renders is re-pointed to the new decision (§4.7), which keeps that rule.

### 4.5 A fresh extractor per document, in back-to-back waves (report Q6–Q8)

The existing "parallel batches of ≤10" stay: each batch is one wave of dispatches in one turn, and the next wave starts as soon as the previous one has returned. A running extractor's calls keep the shared prefix cached, so a wave that waits for its slowest member still starts the next one warm (E1). A lapsed cache costs about $0.035 per agent type on Opus, so nothing waits or pings to keep it warm.

Add one line to `ingest-unattended.md` Step 4, `operations/extract-facts.md` and `ingest-extract.md` Path C Pass 3: each document gets a fresh extractor, never a resumed one (SendMessage) and never a fork. E6 found a resume saved −$0.017 to +$0.006 and once lost 2 of 7 facts, and a fork reads the parent's ~150k-token context.

### 4.6 `extract-facts` writes a file, and `matter_data__ingest_facts` loads it (report, return format)

**Gate first.** Before any code, check that the route works in Cowork, with the caselaw route that already exists: in a Cowork session, dispatch `extract-caselaw` with a `RESULT_PATH` and call `matter_data__ingest_authority` on it against a scratch matter. If the data server cannot read the file the subagent wrote, stop §4.6 and report to Brahm, because the caselaw route then fails there too. The rest of the spec does not depend on §4.6.

**The agent.** `extract-facts` gains `Write` and `extract-caselaw`'s result delivery, the same in substance: an optional `RESULT_PATH`, the absolute path of a scratch file outside the matter root; with it, the agent writes exactly its output-contract JSON there, once, and replies `ok <RESULT_PATH> <byte count>`; without it, it replies the JSON. Its "Never write" constraint is narrowed to that one file. `test_plugin_agent_parity.py`'s `GRANTS` adds `extract-facts: ["Read", "Write"]`.

**The tool.** `matter_data__ingest_facts`, on decision #68's pattern: a `source/lawyer/mcp/src/case/ingest-facts.ts` wrapper that spawns `references/scripts/ingest_facts.py`, which opens no database, checks the result, and returns fixed statements run through `matter_data__execute`'s own lock, trigger layer, single transaction and dump. Registered in `dispatch.ts` and `schema-gen.ts` beside `ingest_authority`. No agent is granted it.

Input: `matter_root`, `result_path`, `file_path` (null for an email attachment child), `file_hash`, and optionally:

- `source_id`: a re-extraction's or an email attachment's existing row;
- `parent_source_id`;
- `category`: an unattended `classification` answer, which overrides the result's;
- `execution_status`: the gate's classification for a court document;
- `answered`: the opaque `fact_key` and `relief_key` the orchestrator put in `ANSWERED_FACTS` and `ANSWERED_RELIEF`, each mapped to its real id;
- `sought_orders`: the array `extract-sought-orders` returned, which is small and stays an inline reply;
- `witness`: for a witness statement or expert report, the `witnesses` and `proceeding_witnesses` values Path A's witness bullets set. The orchestrator recognises such a document from its page-1 routing read, as it recognises a Notice of Application, and passes the values it can establish there, NULL for the rest;
- `contradictions_pending`: `true` for a transcript, which makes the tool append `CONTRADICTIONS-PENDING: transcript contradiction check not yet run` (conventions §11) to the source in the same transaction.

**Routing stays with the orchestrator.** When the result's `document.category` (or the `category` input) is `privileged`, `authority` or `other`, the tool writes nothing and returns `route` with that category. The orchestrator then takes Path B, Path D or the `classification` stop, exactly as it does today on reading the reply.

**What it writes**, in one transaction, for every other category: the validation `pleading_positions.py` does today (the six arrays, keys, enums, range expansion, the stance-as-fact abort, the `UNCONFIRMED:` escalation); the source row (registered `partial`, or the reused row updated by the re-extraction rule); facts deduplicated by `(source_id, source_locator, description)`; positions resolved to fact and party ids and versioned on their full response identity; proof links; relief items and positions; source references; sought orders; the witness rows; the marker when asked; then `ingestion_status = 'complete'`. Dates are `date('now','localtime')`. A party name that matches no party, an unresolved reference or any other validation failure returns `ok: false` with `problems` and writes nothing. Running it again on the same file inserts nothing.

**What it returns:** `source_id`, `counts` (inserted and skipped, per table), `escalations` (each `UNCONFIRMED:` locator), and the written source's `category`, `title`, `description`, `date`, `author_or_filing_party` and `proceeding_file_number`, which the after-completion passes read: the proceeding linkage check, order effects, the date-setting check, the procedural-history entry, another-copy detection, the delivery check and the name check.

**A transcript's contradiction notes** (Path A step 7) compare its positions against every current pleading position, a judgment over stored rows. They run after the tool returns, in one `matter_data__execute` call that also removes the marker. A crash between the two leaves the marker, and `operations/extract-facts.md` §6's whole-matter arm, which already clears `LINKAGE-PENDING`, runs step 7 for every source carrying it and removes it. `ingest-unattended.md` sets the flag and runs no step 7, as it defers the other passes (Substitutions 1f–1h). /housekeeping files such a row normally, as it does a row with any pending marker.

**The callers.** `ingest-extract.md` Path A step 2 supplies a `RESULT_PATH` on every `extract-facts` dispatch, step 3's validation moves into the tool, and step 4 becomes one `matter_data__ingest_facts` call. The same holds for every `extract-facts` dispatch reached from `operations/extract-facts.md`, `ingest-unattended.md` and an email attachment child. The orchestrator never reads the result file. A reply other than `ok …`, or `ok: false` from the tool, is a failed extraction under the existing failure rules. `shared/conventions.md`'s tool list adds the tool, and `references/scripts.md` adds `ingest_facts.py` beside `ingest_authority.py`.

### 4.7 Design decisions

`.claude/skills/matter-data/references/design-decisions.md` gains:

- **#70.** The ingest extractors are pinned to Opus at high effort (reversing the extractor half of #558), get one document each, and are never resumed or forked. A scanned affidavit body and Pass 2's boundary scan are read natively. Stamp pages and `supersede-draft.md`'s comparisons keep ~150 DPI renders. #63's sentence on ~150 DPI renders points here.
- **#71.** `matter_data__ingest_facts` writes Path A from `extract-facts`'s result file, on #68's footing: routing stays with the orchestrator, and a transcript's contradiction notes stay with `matter_data__execute`.

## 5. Files to change

| File | Change | § |
|---|---|---|
| `source/lawyer/agents/extract-facts.md` | `model: opus`, `effort: high`, `Write`; drop naming evidence and `OUTPUT`; result delivery | 4.1, 4.2, 4.6 |
| `source/lawyer/agents/extract-affidavit.md` | `model: opus`, `effort: high`; drop Pass 1 naming evidence and `OUTPUT`; native Pass 1 and Pass 2; Pass 2's `STAMP_RENDERS` input | 4.1, 4.2, 4.4 |
| `source/lawyer/agents/extract-caselaw.md`, `extract-provision.md` | drop naming evidence and `OUTPUT` | 4.2 |
| `.claude/skills/matter-data/agents/` (the four templates above) | the same body changes, so the parity test holds | 4.1–4.6 |
| `.claude/skills/matter-data/operations/ingest-extract.md` | dispatch params; no `OUTPUT`; one-document rule; Pass 1 and 2 native; fresh-extractor line; Path A file route | 4.1–4.6 |
| `.claude/skills/matter-data/operations/ingest-unattended.md` | no naming outputs; fresh-extractor line | 4.2, 4.5 |
| `.claude/skills/matter-data/operations/extract-facts.md` | dispatch params; fresh-extractor line; file route; §6 runs step 7 for `CONTRADICTIONS-PENDING` | 4.1, 4.5, 4.6 |
| `.claude/skills/matter-data/shared/bookmark-segmentation.md` | §6: renders for stamp pages only, standing alone | 4.4 |
| `.claude/skills/matter-data/operations/supersede-draft.md` | re-point its render rule to #70 | 4.4 |
| `.claude/skills/matter-data/shared/conventions.md`, `references/scripts.md` | list `matter_data__ingest_facts` and `ingest_facts.py`; §11 adds the `CONTRADICTIONS-PENDING` marker | 4.6 |
| `.claude/skills/matter-data/references/design-decisions.md` | #70, #71; #63 points to #70 | 4.7 |
| `.claude/skills/matter-data/references/scripts/ingest_facts.py` (new), `render_document.py` | the planner; `--head-chars` | 4.6, 4.2 |
| `.claude/skills/matter-data/tests/` | parity table, grants and effort; unattended contract tests; new `test_ingest_facts.py` | 4.1, 4.2, 4.6 |
| `source/lawyer/mcp/src/case/ingest-facts.ts` (new), `dispatch.ts`, `schema-gen.ts`, `source/lawyer/mcp/test/ingest-facts.db.test.mjs` (new), the rebuilt bundle | the tool | 4.6 |
| `source/file-manager/agents/housekeeping-reader.md` (new) | the reader | 4.2 |
| `source/file-manager/agents/housekeeping-namer.md` | `model: haiku`, `effort: medium`; Input section | 4.2 |
| `.claude/skills/housekeeping/SKILL.md` | Contents, interfaces, Steps 1 and 8–12, Rows signal table | 4.2 |
| `.claude/skills/file-naming/SKILL.md` | proposal-mode evidence-source wording | 4.2 |
| `source/assignment.json`, `source/file-manager/README.md` | the reader agent | 4.2 |

Then `python scripts/build_plugin.py`, and `/release` for the versions in §6.

## 6. Versions (CLAUDE.md's rule)

- **`lawyer` 0.3.0 → 0.4.0, minor.** `ingest-unattended` drops its `naming_evidence` and `naming_evidence_defect` outputs and the extractors drop their `OUTPUT` input. `file-manager` 0.6.2's /housekeeping reads that block, so an updated `lawyer` beside a not-yet-updated `file-manager` would send every newly ingested row to care until the user updates it. That needs action, which is not a patch. The new tool, the pins and the native reads alone would be a patch.
- **`file-manager` 0.6.2 → 0.7.0, minor.** Its new /housekeeping needs `lawyer` 0.4.0 (`render_document.py --head-chars`, and no naming block to expect), which raises what it requires. The manifest's `dependencies` carries no version floor, so the release notes say both update together.
- `researcher`, `litigator`, `solicitor`, `timekeeper` and `developer`: unchanged. No file they ship relies on the changed contracts, and `.claude/skills/shared/` is untouched.

## 7. Checks

Run after each change. Every live run uses the local `~/token-test/` corpus and key, `scripts/token_test/token_ledger.py` and `score.py` (protocol, "What gets built"), and in Cowork ships its files as one attached zip (protocol, E0, "Getting files to subagents"). Any scorer is an agent type holding only `Read`. No client data is committed.

| Change | Check | Fails when |
|---|---|---|
| 4.1 pins | `python -m unittest discover -s .claude/skills/matter-data/tests` with the updated parity table; a grep that every `extract-facts` and `extract-affidavit` dispatch site names `model: "opus"` and `effort: "high"`; one extraction of a keyed 2-page document in the Code tab and one in Cowork, with the ledger showing `claude-opus-5-5` and thinking tokens in Opus high's range (E7) on both | the test, the grep, or either ledger row |
| 4.2 reader and namer | A grep or test that `housekeeping-reader.md` holds `model: haiku`, `effort: medium` and `Read` alone, that `housekeeping-namer.md` holds `model: haiku` and `effort: medium`, and that Step 11 dispatches `model: "haiku"` and `effort: "medium"`. Then the 12 keyed documents and the 2 settled ones (E2's set), one reader each and all 14 rows in one namer batch, scored by `score.py names`: at least 7 of 12 right on all four structured parts (E2's single run gave 8 and E5-B's same design 5, so 7 allows for spread), and naming cost under $0.015 a document. Then 3 settled Law-folder files (E2's set had no authority): each composes its settled name. `--head-chars` is calibrated on the `.docx` and `.msg` rows: the cut ends inside the rendering's first page. One /housekeeping run in Cowork on a scratch matter, whose reader rows read staged copies. The Step 12 cross-check run on the 14 rows against their stored records flags at most 2 of them; more, and the work stops and goes to Brahm, because each flag makes a row `stuck` and would undo what the reader gains. `test_ingest_unattended_contract.py` without its naming tests, and a grep that no file under `.claude/skills/` or `source/` still names `naming_evidence_defect` or `OUTPUT: full` | a pin grep miss, below 7 of 12, a Law name differs, a Cowork reader cannot read its file, more than 2 cross-check flags, a grep hit |
| 4.3 one document per extractor | a grep of `ingest-extract.md` for the new one-document line | the line is missing |
| 4.4 native affidavit reads | one scanned affidavit with exhibits from the corpus, Passes 1 and 2 natively and with ~150 DPI renders, one run each, marked by a scorer: Pass 1 reports `scanned: true` both ways; the deponent, the jurat date and the exhibit inventory agree; native finds at least the body facts the rendered run finds less 10% (the run-to-run spread E3 measured on documents of this size); Pass 2 finds the same stamp pages, and its `STAMP_RENDERS` dispatch reads the same exhibit letters as the rendered run. Then a grep that Pass 1 and Pass 2 name no render outside stamp pages | any condition, or a grep hit |
| 4.5 fresh extractors | a grep of the three dispatch sites for the fresh-extractor line and for no `SendMessage` or fork instruction | a grep miss |
| 4.6 file route | the Cowork gate above, first; `test_ingest_facts.py` on synthetic results: an originating pleading, a response with `answered` keys, an unresolved reference (writes nothing), a stance written as a fact (aborts), an `UNCONFIRMED:` escalation, an unknown party (refused), a re-run (inserts nothing), each of `privileged`, `authority` and `other` (writes nothing, returns `route`), a witness statement with `witness`, a transcript with `contradictions_pending` (marker written, source `complete`); `ingest-facts.db.test.mjs` against a scratch case database; 3 keyed documents ingested into two scratch matters, one by the tool and one by today's SQL route, giving the same rows apart from ids and dates | the gate, any test, or a row difference |
| all | `python scripts/build_plugin.py --check`, `python scripts/check_plugin.py`, `python scripts/check_layering.py`, `python scripts/check_file_ops.py`, `python scripts/check_publishable.py --new-since origin/main` | any failure |

## 8. Decisions taken in the grilling session

The report left these open. Each was decided under Brahm's grilling profile, which delegates technical and architecture questions to the model, and was then put to an independent Opus reviewer, whose changes are folded in above.

1. Effort is pinned in the frontmatter and passed on each dispatch (§4.1), because Cowork honours only the per-call parameters as far as anyone has checked. The pin is exact, as the report words it.
2. The page-1 reader is a new `file-manager` agent, not `extract-facts` on Haiku (§4.2). Reusing `extract-facts` would keep a fact contract the reader never uses in its prompt and reply, and would set its Haiku dispatch against the extractor's new Opus pin. The §7 rerun covers the change from E2's reader.
3. Every row that can get a name gets the page-1 read, the already ingested included, and the stored record becomes a cross-check on every ingested row (§4.2). E5-C's whole-document evidence scored 3 of 12 against page 1's 8, and the stored record is the same kind of evidence. A Haiku read costs about $0.002.
4. Privileged rows stay with the session, and drafts, privileged- or disclosed-folder rows and duplicates skip the reader (§4.2), as Path B, the namer's own constraint and the Rows table require.
5. The extractors' naming blocks go (§4.2), with no fallback. A reader that fails twice sends its row to care.
6. Waves stay as today's back-to-back batches of up to 10 (§4.5). The reviewer showed that a running sibling keeps the cache warm, so the rolling dispatch first drafted bought nothing.
7. Pass 1 and Pass 2 read natively, and only the stamp pages Pass 2 finds are rendered, for a letter-only dispatch (§4.4).
8. The file route covers `extract-facts` only (§4.6), the case the report measured. An affidavit file route is a follow-up.
9. Routing, witness rows and the transcript's second step are handled so that one document is still one transaction, with a pending marker for the one judgment that follows it (§4.6). The reviewer found the first draft would have let a privileged result reach the main store, and a crash leave a `complete` source without its witness rows.
10. The file route is gated on a Cowork check of the caselaw route that already exists (§4.6), and the gate stops the work rather than falling back.
11. `lawyer` and `file-manager` both take a minor bump (§6).
12. **Email attachments, decided by Brahm on 2026-10-19: decision #51 stands.** Each attachment keeps its own extractor, and nothing changes. The report's E4 row says "Keep an email's attachments in the same extractor". Design decision #51, which Brahm approved, makes each attachment a child source with its own extractor, and `ingest-extract.md` does that today. E4's one run found a separate extractor cost 3% more, with recall inside the single extractor's spread. The reason: putting an attachment in its email's extractor would change the extractor's contract to attribute each fact to the email or to one attachment, for a difference inside the noise.
