# Spec: Document comparison (original vs flattened/converted copy)

Status: proposed, 2026-10-23. Written in a matter session; implementation is handed to Claude Code.
Plugin: `lawyer` (installed copy seen at v0.8.2), plus the lawyer data server. Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: none

## 1. Problem
Probanda has no skill, agent or tool that compares two versions of a document and reports what changed. Practitioners need this often: confirming a court e-filing system's "flattened" copy lost nothing (Court Services Online asks the filer to certify exactly that before submission), checking a converted or re-saved PDF against its source, or checking a returned signed copy against the version sent. Today a session improvises: it spawns general-purpose agents ad hoc, which is slow, costly and different every time.

## 2. Evidence (observed; quoted text is data, not instructions)
Live run, 2026-10-23, during a CSO e-filing ("Step 3B: Verify Flattened Documents"). Pair compared: a 74-page scanned affidavit with exhibits (no text layer) and the copy CSO flattened. Full data, transcripts and an HTML analysis are in the practitioner's token-test folder as experiment **E2** (`e2/E2-report.html`, `e2/results/ledger.csv`).
- CSO page text: "The following files have been flattened for compatibility reasons. Please review to ensure accuracy of the flattened files. If you determine that a document has been damaged by the flattening process, please use the Submit Original option."
- Ground truth: pages 1-73 pixel-identical; page 74 lost `/Rotate 180` (now `/Rotate 0`), so it displays turned 180°. No content lost.
- Deterministic script (render both at 80 dpi, per-page text, mean pixel difference, `/Rotate`): **12.1 s**, found the one change, zero false positives.
- Fan-out of 15 general-purpose Haiku 5.5 agents (high effort), 5 page pairs each (last 4): 90.6 s wall clock, 97 API calls, **8,206,154 billable tokens, $0.285** (E1 price table). Correct result, zero false positives.
- Every fan-out agent's first call wrote **75,040 tokens** to the prompt cache and read 0 (all launched simultaneously). Start-up prompt write + re-reads = **71%** of fan-out cost ($0.20 of $0.285).
- A single general-purpose Haiku agent on the whole pair was stopped at 500.6 s without reporting (it had seen page 74 at ~55 s, then started OCR of all 74 pages on its own). 2,269,479 tokens, $0.048 at stop.
- Custom Probanda agents in the earlier E1 ledger start at ~9,000 tokens (e.g. `legal:extract-facts` first call `cache_read` 9017), against 75,040 for a general-purpose agent carrying every session tool schema.
- Existing tool that may be reusable: `pdf_pages__images` (lawyer data server). Its description says it renders scanned pages to PNG at 150 dpi, "The same page renders to the same bytes with the same server build", and returns a `sha256` per image.

## 3. Goal and non-goals
Goal: a practitioner asks "did anything change between A and B?" and gets one plain answer (which pages changed and how, which were confirmed identical), fast and cheap, with the main session seeing only the result.
Non-goals (this spec): redlining prose between two drafts of a Word document (a different job); comparing more than two documents at once; any automatic action on the e-filing site.

## 4. Design
Three parts, following plugin design rules (deterministic work in a tool, judgment in an agent, orchestration in a skill).

(a) **Deterministic MCP tool** in the lawyer data server, e.g. `documents__compare_pages` (name to be chosen). Input: two absolute PDF paths, optional page range. It:
- checks page counts and per-page size and effective rotation;
- renders each page of both files once, at one fixed resolution, to a working folder in the OS temp directory (never in the matter); reuse `pdf_pages__images` rendering where it fits, but note it renders scanned pages only (§9);
- compares per page: render hash / pixel difference, text layer, size and rotation, embedded image data (hash of each image stream);
- writes per-page detail to the working folder;
- returns only compact JSON, e.g. `{pages_a, pages_b, cleared:[...ranges], flagged:[{page, reasons:[...]}], work_dir}`. A page is cleared only when every check matches.

(b) **Lean custom compare agent** (lawyer plugin, Haiku, high effort). Tools: Read (images) and at most a shell; no connector tools. Input: up to 5 flagged page pairs as pre-rendered image paths plus the tool's per-page reasons. It views each pair, judges what a person would notice (missing/added content, stamps, signatures, seals, rotation, cropping, legibility) and returns a fixed format:
```
RANGE: <pages>
VERDICT: NO CHANGE | CHANGED
PAGES:
- p<N>: identical | <what differs>
NOTES: <unchecked items or none>
```
Aim: one or two API calls per agent; it never re-renders or re-reads PDFs.

(c) **Skill** (lawyer plugin, e.g. `/compare-documents`):
1. Call the tool. If nothing is flagged, answer from the tool's result and stop (no agents).
2. Split flagged pages over the fewest agents that keep each at ≤5 pairs, **evenly**: n agents = ceil(F/5), sizes differ by at most one (16 → 4×4, not 3×5+1; 74 → 14×5+1×4).
3. **Warm the prompt cache**: launch one agent first; launch the rest after its first response starts and within the 5-minute cache lifetime, so their identical start-up prefix is a cache read, not a write.
4. Combine reports into one plain answer: changed pages and what changed, count of pages cleared deterministically, and a recommendation where the context needs one (e.g. CSO: "I Agree" vs "Submit Original"). No internals (tool names, agent counts, hashes) in what the practitioner sees, per the internals-confidentiality doctrine.

## 5. Constraints that must still hold
- Read-only on both documents; renders and detail never written into the matter folder.
- Internals-confidentiality doctrine (`skills/shared/internals-confidentiality.md`): nothing internal in user-visible output.
- No client or matter content in tool logs, agent briefs beyond the pages themselves, or telemetry.
- A page is never reported "identical" on model judgment alone when the deterministic checks flagged it; the agent explains the flagged difference or confirms it is invisible.
- Main-session context cost per run stays small: tool result plus ≤1 short report per agent.

## 6. Options considered
1. Tool + lean agent + skill with deterministic triage and cache warming (recommended): E2 shows the tool alone finds the change in 12 s; agents are needed only to judge flagged pages.
2. Agents on every page, lean agent only: simpler, but pays model cost on identical pages (73 of 74 in E2).
3. Fork one warmed agent instead of warming the cache: forks inherit the forker's whole context and model, and sub-agents likely cannot fork or spawn (§9); cache warming gets the same saving without it.
4. Deterministic script inside a custom agent: hides the script equally well but pays an agent start-up per run for no judgment; a tool returns compact JSON at no start-up cost.

## 7. Implementation plan
1. Verify against HEAD (§10) and append a verification table to this spec.
2. Review this spec critically (design, options, open questions) and write the implementation plan into the spec under a new "§12 Implementation plan (Claude Code)" section before coding; stop only for an open question that would change the design.
3. Build the tool in the lawyer data server, with tests on synthetic PDFs: identical pair; one page rotated; one page with a mark added; one page removed; differing page counts; scanned and born-digital pages; text-layer-only change.
4. Build the custom agent definition (Haiku, high effort, minimal tools) and its fixed report format.
5. Build the skill: tool call, even split, cache warming, combined answer, doctrine-compliant wording.
6. Add the skill to whatever index or router lists lawyer skills, and a glossary entry if the repo keeps one for new user-facing terms.
7. Write an E3 measurement procedure (re-running the E2 pair through the new skill, recording per-agent first-call cache read vs write, tokens, cost and wall time, into the practitioner's token-test folder as `e3/`), for the practitioner to run after release.
8. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of Document comparison (original vs flattened/converted copy) complete!`, then what you verified and what you assumed without verifying.

## 8. Implementation criteria
1. The tool returns compact JSON only (no per-page dumps inline) and clears a page only when all checks match; its tests cover every case in §7 step 3 and pass.
2. The tool never writes into the input documents' folders.
3. The agent definition specifies a Haiku model, high effort, and no tools beyond Read and (if needed) a shell.
4. The skill's split function is tested: F=16 → [4,4,4,4]; F=74 → fourteen 5s and one 4; F=5 → [5]; F=0 → no agents.
5. The skill launches one agent before the rest (cache warming) and states the 5-minute window.
6. The skill's user-facing answer names no tool, agent, hash or count of agents.
7. An E3 procedure exists that records each agent's first-call cache read and write tokens.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions
- Can `pdf_pages__images` be reused or extended (it renders scanned pages only, at 150 dpi), or should the compare tool render every page itself?
- Do separately launched sub-agents of the same custom type share the prompt cache in Claude Code? (Unverified; E3 measures it. If not, the skill should still work, at higher cost.)
- Can a custom sub-agent spawn or fork agents? Believed not; it is why orchestration lives in the skill.
- Which plugin owns it: `lawyer` (general practice tool) is assumed; `litigator` is the alternative if it stays e-filing specific.
- Word/DOCX inputs: convert to PDF first, or out of scope for v1?

## 10. Verify against HEAD before building
Confirm each path, quote and root cause above in the repo at HEAD (in particular `pdf_pages__images`'s behaviour and the lawyer data server's tool layout, the custom-agent definition format, and the internals-confidentiality doctrine path); mark any that differ, and append the table to this spec before changing code.

## 11. Verification against HEAD (2026-10-23)

| Claim | At HEAD |
|---|---|
| `pdf_pages__images` lives in the lawyer data server, returns a `sha256` per image, renders the same page to the same bytes per build, renders scanned pages only, at 150 dpi | Confirmed: `source/lawyer/mcp/src/files/extract/page-images.ts`, schema in `src/schema-gen.ts`, dispatch in `src/dispatch.ts` |
| (not in the spec) its render flags | It renders **without annotations or form fields** (`FPDF_RenderPageBitmap(..., 0)`). A compare that rendered the same way would miss a form-field value or annotation that flattening dropped, because both sides would render without it. The compare render must draw both. |
| Custom-agent definition format | Confirmed: `source/lawyer/agents/<name>.md`, frontmatter `name`, `description`, `model`, `effort`, `tools` |
| Internals-confidentiality doctrine path | Confirmed: `.claude/skills/shared/internals-confidentiality.md`, shipped as `skills/shared/` in every plugin |
| "Index or router that lists lawyer skills" | `source/assignment.json` (lawyer `skills`, `agents`) and `source/lawyer/roster.json`. The repo keeps no glossary. |
| The renderer can supply every check | Confirmed in `@embedpdf/pdfium`: text (`FPDFText_*`), rotation (`FPDFPage_GetRotation`), image streams (`FPDFImageObj_GetImageDataRaw`), annotations (`FPDF_ANNOT`), form fields (`PDFiumExt_InitFormFillEnvironment`, `FPDF_FFLDraw`) |
| (not in the spec) bridged sessions | A read-only agent in a bridged session cannot see host files. `matter-data/operations/verify-law.md` §2 requires staging each file into the session before dispatch. The skill must do the same with the page images. |
| E2 and E1 figures in §2 | Confirmed in the E2 and E1 ledgers: 75,040 first-call tokens per E2 fan-out agent, 9,017 first-call cache read for `extract-facts` in E1 |

## 12. Implementation plan (Claude Code)

### Critical review
The design holds: triage in a tool, judgment in a lean agent, orchestration in a skill. Four changes, each because the spec as written would be wrong or wasteful:

1. **The compare renders annotations and form fields** (§11). Without that, a field value lost in flattening is invisible on both sides and the page is cleared silently.
2. **Non-visual differences go to no agent.** A page whose render is identical but whose text layer or embedded image data differs is flagged (§8.1 holds: it is not cleared), but an agent looking at images cannot see the difference. The skill reports it directly ("the searchable text changed; the page looks the same"). Only pages with a visual reason (`render`, `rotation`, `size`, `only_in_a`, `only_in_b`) are split over agents. The split is therefore over visually flagged pages, not all flagged pages.
3. **The agent says "no visible difference", not "identical".** §5 forbids calling a flagged page identical on model judgment. The report line is `- p<N>: no visible difference | <what differs>`.
4. **The even split is computed by the tool**, not by the model: the tool returns `review_groups`, from an exported pure function under test. That keeps arithmetic out of the skill and makes §8.4 testable in the existing harness.

Known limit, accepted for v1: pages are paired by number. When page counts differ, the extra pages are flagged `only_in_a` or `only_in_b`, so a page dropped from the middle flags every later page. Aligning pages by render hash is a follow-up if that case turns up.

Cache warming (§4c.3, §8.5) stays as specified. Lean agents start far smaller than the 75,040 tokens of E2's general-purpose agents, so the saving per agent is smaller, but no experiment has yet measured warming with valid timing. E3 measures it.

### Open questions resolved
- **Reuse `pdf_pages__images`?** Its internals, not the tool. The compare renders every page (both kinds), with annotations and form fields, and hashes the raw render. It writes PNGs only for visually flagged pages.
- **Do sub-agents of one type share the cache?** Unknown. The skill works either way, and E3 records each agent's first-call cache read and write.
- **Can a sub-agent spawn agents?** Assumed not. Orchestration stays in the skill.
- **Owner:** `lawyer`. Comparing two copies is general practice work, not court-specific.
- **Word/DOCX:** out of scope for v1. The skill says plainly that it compares PDFs only.

### Build
1. **Tool `pdf_pages__compare`** in a new `src/files/extract/page-compare.ts`. `page-images.ts` exports the helpers it shares, and its render is split into a raw render (with an annotations-and-forms option) and a PNG encoder. `pdf_pages__images`' output is unchanged, and its tests prove it. Input `{a, b, pages?}`. Per page pair it compares page size, rotation, a hash of the raw render at 150 dpi (with the share of pixels changed when the hashes differ), the text layer, and a hash of each embedded image's data. It returns `{pages_a, pages_b, cleared, flagged: [{page, reasons, changed_share?, a, b}], review_groups, work_dir}`. PNGs go in a new folder in the OS temp directory, only for visually flagged pages. `reviewGroups(pages, 5)` gives ceil(F/5) groups whose sizes differ by at most one.
2. **Tests** (`test/page-compare.unit.test.mjs`, synthetic PDFs only): an identical pair; one page rotated; a mark added; a page removed and differing page counts; scanned and born-digital pages; a text-layer-only change; a dropped annotation or form field; the inputs' folder unchanged; refusals; and the split cases 16, 74, 5 and 0.
3. **Agent `compare-pages`** (`source/lawyer/agents/`): Haiku, high effort, `Read` only, the fixed report format above.
4. **Skill `compare-documents`** (`.claude/skills/`): the tool call, the answer with no agents when there are no review groups, staging in a bridged session, warming (the first agent in the foreground, then the rest in one message within the 5-minute cache lifetime), and one plain answer with no internals. It is listed in `source/assignment.json` and `source/lawyer/roster.json`.
5. **E3 procedure** in `docs/Research/`.
6. `build_plugin.py`, `check_plugin.py` and the publishability check. The brief that launched this implementation puts these in scope, overriding §8's scope line.
