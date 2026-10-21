---
name: verify-law
description: >
  Only when the practitioner, or a skill doing work they instructed, asks, never on your own
  initiative: check a quote, pinpoint or proposition against its source, audit a draft's case
  citations (verify-authorities), sweep a plain draft file for statements of law with no
  citation (sweep-draft), or
  clear unverified legal edges. What the law is -> /legal-research.
---

<!-- researcher v0.7.5 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: it means the directory containing this SKILL.md, not a placeholder to search for or guess. Read references and shared files natively from there, never over the litigation data server's skill-source tool and never by requesting folder access; scripts and templates the text declares are executed and read from there too. If `${CLAUDE_SKILL_DIR}` itself no longer exists, the plugin was re-synced mid-session: list only `${CLAUDE_SKILL_DIR}/../../..` (the folder that held this plugin's folder), take the folder named as this plugin's folder with any `~g<N>` suffix removed plus the highest `~g<N>`, and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, stages, authors or requests a screenshot of one, but may present one to a human user to view, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

# verify-law

(Formerly also `/verify-authorities`, now this front door's `verify-authorities` subskill.)

Private subskills live under `subskills/*/SUBSKILL.md`. They intentionally use `SUBSKILL.md`
instead of `SKILL.md` so recursive skill loaders do not expose them as global top-level skills.
Asset paths inside a subskill's `SUBSKILL.md` are written relative to this front door's own
folder, not to the subskill's folder.

Four modes. Mode A checks one conversational claim against its source and writes nothing. A caller
holding several claims invokes Mode A once per claim. Mode B clears the matter's stored legal-edge
backlog by delegating to `/matter-data`.

**Document mode.** If the first word of args is `verify-authorities`, or the practitioner asks to
check the case authorities cited in a draft document, read
`subskills/verify-authorities/SUBSKILL.md` and follow it as the active workflow.

**Plain-draft sweep.** If the first word of args is `sweep-draft`, or the practitioner asks to
sweep a plain draft file for statements of law that have no citation or research behind them,
read `subskills/sweep-draft/SUBSKILL.md` and follow it as the active workflow. It states no
law and writes nothing.

**Not for "what is the law"** — that is `/legal-research`. This boundary is load-bearing routing,
not a stylistic preference.

## Mode A — claim-level (on request only)

1. **Resolve the source document** by delegating to `/matter-data`: invoke it with the intent of
   resolving the cited authority to a readable document (the routing row for "Resolve a cited
   authority to a readable document"). Loading its router and running that row in this
   session, conversion included, is delegating. This covers both a stored authority and a caller-named
   un-ingested file in the matter tree, including one held outside matter-data. A caller-named
   file's report says no hash identity exists, resolved or not.

   Do not read the file natively and hand the raw path to the verifier. Most authority documents
   in this practice are Westlaw `.doc` files that are actually RTF, which the file-read tool
   refuses as binary — the verifier would return `document_read: false` on a document it could
   have read. The RTF conversion discipline is matter-data's; resolution is delegated even for
   un-ingested files so this skill never learns that discipline.

   **If resolution fails, say so before anything else, and say it precisely,** relaying only what
   matter-data reported back. For a stored authority, that is the recorded path tried and why it
   failed (missing, or its hash did not match), and that the hash search over the matter tree
   found no match, or else the resolved path and its conversion failure. For a caller-named file,
   that is the named path and why it could not be read, never a hash or folder search. Never
   invent a folder or filename pattern matter-data did not report. "Not on file" without the path
   tried is not a report — the practitioner cannot check it. Then **offer** retrieval via the
   `research-paralegal` agent. Retrieval runs only on the practitioner's confirmation — one rule
   for CanLII and Westlaw alike — and never while another `research-paralegal` instance is in
   flight (it is the singleton owner of the shared Chrome session and Downloads folder). A caller
   holding a job on the Job Board records the citation on the job before that dispatch and closes it once
   it has landed (`/drafting-data`'s `jobs-common.md` §2, "Sources to get"). If
   matter-data's operation does not fit this citation, name the mismatch and ask. No other method.

   **Secondhand reproduction.** If the caller names another judgment on file that quotes the
   authority, the diff in step 2 may be run against that document instead. Its result is then
   labelled, in every onward report: *"matches the reproduction in \<case\> at para N — primary
   source not verified."* Never present a reproduction match as verification of the primary
   source, and never drop the label when relaying the result to a caller or a practitioner. No
   search logic lives in this skill: resolution stays delegated, and this step only names back
   what matter-data reported.

2. **Verbatim excerpt claim → run the script first, always.** Whenever the claim is that a
   passage reproduces the source word for word — a stored verbatim excerpt, a block quote, a
   pinpoint quotation — the deterministic diff runs before any reading, any comparison by eye,
   and any subagent dispatch.

   Write the excerpt to a temp file and run:

   ```bash
   python scripts/diff_excerpt.py --excerpt-file <excerpt.txt> --source <resolved document>
   ```

   From the repo root the same call is:

   ```bash
   python .claude/skills/verify-law/scripts/diff_excerpt.py --excerpt-file <excerpt.txt> --source <resolved document>
   ```

   The excerpt text is supplied by the caller as bare text. This skill never reads it from any
   database — a caller that holds the excerpt in stored data passes the text, not a row.

   A bilingual report (an official S.C.R. PDF, English and French in parallel columns) is
   detected by itself: the script compares the English column with its running headers dropped,
   and its JSON says `"layout": "bilingual"`. Add `--lang fr` for a French excerpt. `"layout":
   "plain"` means the column layout could not be checked (pdfplumber is missing); on a bilingual
   report, an exit 1 or 2 there is not a verdict on the quote — say so and stop. `--columns off`
   reads the PDF as one text, as before.

   The script emits JSON on stdout and a word-per-line unified diff on stderr. Interpret its
   exit code; the model's job here is reading opcodes, not judging sameness:

   | Exit | Meaning | What to report |
   |------|---------|----------------|
   | 0 | Identical after normalisation | The excerpt is verbatim. Give the page range when the JSON carries one. When `stitching` is set, give each entry in `parts` with its pages. A quote may stop before the source's `. , ; : ) ] "` or `…` (shown as `...`), or start after its `( [ " '`; each such edge is listed in `edge_punctuation` — say so, e.g. "verbatim; the source carries a full stop after the last word". |
   | 1 | Found, with differences | Read the `opcodes` and say in one sentence what differs — "the only difference is a dropped comma after word 41", "our excerpt omits the last sentence of para 18". When `stitching` is set, report each entry in `parts` with its pages, and name these opcodes as defects: `omission_unmarked` (text omitted without "[...]"; insert the marker), `order` (parts quoted out of source order), `unmatched` (excerpt words not located verbatim; the practitioner inserts "[...]" at the part boundaries and re-runs, so each part is diffed), `not_found` (a marked part absent from this document). |
   | 2 | Not in this document | Report the best window and its ratio, and stop. Do not go hunting for a better verdict. |
   | 3 | Read or usage error | Surface the error text verbatim. An unreadable source is not a failed quote. |

   Report the differing words from the JSON opcodes (`ours` against `source`) in a fenced block, never the stderr diff and never the whole excerpt. Never describe a difference in prose instead of giving the words. Diff each primary copy known to you. On a split, report each copy's result and no verbatim verdict.

   **No "verbatim" or "not verbatim" verdict without the script's JSON in hand.** A model reading
   the two texts side by side is not a verdict, however confident it sounds. This is the rule the
   whole step exists for.

3. **Proposition or pinpoint claim, even after step 2 → dispatch one fresh, session-isolated
   read-only `researcher:verify-claim` agent**, whose body mirrors [`agents/verify-claim.md`](agents/verify-claim.md).
   Provide the resolved document and the bare claim. No matter context,
   no party names, no dates — an incident or reference date is a matter fact under the
   anti-contamination rule, the same as party names.

   **Dispatch a path the verifier can open.** Its only tool reads its own session filesystem — it
   cannot list a directory, and in a bridged session it cannot see host files at all. Supply the
   explicit path of every file it must read. For a PDF, call lawyer's `pdf_pages__images` first
   and supply its page manifest as `PAGE_MANIFEST`: `{page, images}` for each scanned page and
   `{pages: "a-b", pdf}` for each run of born-digital pages, with no PDF path for a wholly
   scanned one (`/matter-data`'s design decision #71). Name each PNG individually rather than the
   render directory. Where host files arrive only over a bridge (Project Cowork) stage a
   byte-exact copy into the session first (`device_stage_files`) and dispatch that path.

   **A verifier that is unavailable — never substitute another agent — that fails, or that returns
   malformed JSON yields no verdict.** Report it as source-unresolvable under step 4; Mode A writes
   nothing either way, so the claim simply stays unverified.

   The verifier's four doctrines are proposition-level. It runs for a proposition or pinpoint
   claim, and after step 2 for the separate substantive question of whether the matched passage
   actually supports what the claim says it supports. It never substitutes for step 2, and
   neither step 2, even at exit 0, nor the caller's own reading or search replaces its support
   verdict.

4. **Report in conversation:** confirmed (anchor quote + locator), rejected, ambiguous
   (including a split between primary copies, naming each copy and its result), or
   source-unresolvable. A rejected or ambiguous verdict that leaves the practitioner needing the
   correct proposition escalates to `/legal-research`.

5. **Mode A writes nothing.** No verdict write, no `last_verified_at` stamp, no row of any kind.
   This holds on both paths: a paraphrase claim writes nothing because it was never the stored
   text, and an exact-quote pass writes nothing because a conversational check is not an applied
   batch pass. If the claim maps to a stored unverified edge, offer to run Mode B scoped to that
   authority instead. `last_verified_at` attests a completed, applied batch pass and stays
   confined to that discipline.

### Mode A anti-patterns

- **Diffing by eye.** Two passages compared by reading are not compared. Run the script.
- **Verifying a paraphrase as though it were the quote.** A restatement of the holding is not the
  stored excerpt, and a low ratio against one is not a misquotation finding — it is the wrong
  input. Check what was actually handed over before reporting anything.
- **Reporting a reproduction match as primary verification.** The "authority's own text not verified"
  label travels with the result, all the way to the practitioner.

### Statutory-currency questions are out of scope for Mode A

"Was that section in force on date X?" routes to `/legal-research`. This skill's verifier is
file-read-only, so it cannot establish instrument currency. The gate establishes it with the canlii
`legislation_currency` tool. In-force-at-a-past-date questions
can also exceed metadata (transitional provisions, commencement), which is gate territory regardless.
This is a routing decision on capability, not a restatement that currency is itself a statement
of law — a currency verdict is a report of metadata about the authority's own text
(`shared/statute-currency.md`).

### Live-issue posture

Mode A runs on request. The practitioner's own request always passes the live-issue test. A
skill doing work the practitioner instructed names that work's live issue. Mode A never proposes
a pass of its own motion. In a session with no current matter, confirm the billing anchor once
before running.

## Mode B — batch

Thin delegation: invoke `/matter-data` and follow its own edge-verification operation, the one
the router table names for "verify the legal edges". That operation owns worklist selection,
live-issue scoping, resolution, dispatch, apply, corrections routing, stamping, and the report.
Nothing relocates into this skill.

## Hard constraint for this skill tree

No MCP tool call into the shared legal-commons pool, and no invocation of the legal-commons or
drafting-data skills, or of the `drafting_data__*`/`drafting_forms__*` tools, anywhere under this tree — including references,
the agent file, and any planning prose stored here. The packager's dependency-direction check
scans this whole tree for the legal-commons tool and skill literals only, with a single exemption
(matter-data) that will not be widened. The drafting-data ban is this
skill's own rule: no mechanical check enforces it, so it holds only as written here. If a verdict
bears on pooled material, surface a one-line note to the practitioner and stop — the pool-aware
path is reached by description-based routing at runtime, never named here.
