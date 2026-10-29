<!-- REGRESSION-PRONE: CanLII-first research has recurred repeatedly. See docs/design/2026-09-24 research-lawyer Westlaw-first fix plan.md before editing. Tests: legal-research/tests/. -->

# Statements of law — defer to research-agent

(This doctrine is read via the `/legal-research` gate; the file was formerly `shared/statements-of-law.md`.)

Never make a statement or give an opinion about the law; instead, frame your
statement explicitly as a hunch or offer to invoke the research-agent. A hunch is
never cited, built into work product or used to settle a decision. The moment
anything will depend on it, it goes to the research-agent. A "statement of law" is
any assertion about what the law requires, permits, or provides: the elements of a
test, the effect of a statute, what courts have held, whether conduct is actionable.

**Not statements of law (answer normally):**

1. *Procedural mechanics and arithmetic* — filing steps, form requirements,
   deadline computation via docket-clerk's rules, registry practice.
2. *Quoting an authority's own text* — repeating an authority's own words at a
   pinpoint, from its text on file as an ingested primary authority in this
   matter or as `/verify-law`'s `verify-authorities` review recorded it, identified as such
   ("per *X* at para N"). No new legal assertion may be added around the quote. Ingestion
   and that review make a passage quotable, never reliable: no
   conclusion, advice or filed content rests on the authority until
   `research-agent` has returned it, because only its audit notes it up and
   compares its facts. A research memo or case brief is a lead, not an authority.
3. *A party's own positions* — restating what a pleading, submission, or the
   client asserts, attributed as an assertion, not endorsed as law.
4. *In-pipeline research stages* — components with their own citation-gated
   research discipline (`/researcher`, `/case-brief`,
   `/verify-law` with `verify-authorities`) are compliant implementations of this rule, not
   violations: they forbid training-knowledge citations and flag unsupported
   propositions.

When deferring, say so: "That's a question about the law — I'll put it to the
research-agent agent."

**Checking a claim against its cited source is not asking what the law is.** A claim-level
verification request — "is this specific quote/citation/proposition accurate against its cited
source?" — routes to `/verify-law`. A rejected or ambiguous verdict that leaves the practitioner
needing the correct proposition comes back through this gate.

**Asking what we already hold is not asking what the law is.** A holdings question —
"which of these criteria already have a recorded authority?" — goes to the same audit
agent as a *scoped* dispatch: `mode: inventory`, the named criteria, `report: brief`
(contract: `shared/legal-audit-scoped.md`). It costs a fraction of an opinion-grade
audit because the question is narrower, not because a check was skipped. It states no
law — never build a conclusion on it; re-dispatch in opinion mode over any criterion
you intend to rely on.

**Approved plan issues become jobs.** The practitioner's "No" at the end of the
`/legal-research` gate's step 2a approves the numbered list it answers. In a session
holding no job, where a board resolves, write one research job per listed issue by
`/drafting-data` §3l: its title and intent are the issue's text as the list showed it,
and its one step is the plan marker (`/drafting-data`'s `jobs-create.md` §3, "The plan
marker"). A skipped issue gets no job, and the jobs need no further approval: the "No"
is the request. Then re-render the Milestone and stop. Writing the jobs dispatches
nothing: each job's research runs through the gate when the job is worked. A session
holding a `/draft` job asks no approval and writes no job. Approving the job approved
every sub-issue its question needs, so the plan's `scope: in` issues are the issues steps
3 to 5 run. A `scope: new` issue is not researched: capture it as a loose thread by the
duplicate test below (`/drafting-data` §8 with a job held), relay it word for word, and
say in one line that it is researched only if they name it. With no board, write nothing, say in one line that the matter has no board to add
jobs to, and run steps 3 to 5 on the approved issues.

**A caller working a `/draft` job checks its lock before every dispatch.** Immediately
before each `research-paralegal` or `citation-checker` dispatch and each audit-agent spawn or re-invocation
below, run `/drafting-data`'s lock read before a dispatch on that job. Only the caller's
own session token on the job dispatches. Anything else dispatches nothing: stop and
report. A caller holding no job skips this.

**Before spawning, run what the agent cannot.** `shared/research-priority.md` is
the binding order for every legal lookup — read it and follow it. Five duties fall
on the caller specifically, because the agent's own grant cannot discharge them:

**A statutory-text question runs duty 4 before duty 3.** A question is
*statutory-text* when it names a statute, regulation or bylaw and asks what that
instrument provides, requires, permits or lacks. For it, run duty 4 first, so the
instrument's full text is on disk before Westlaw runs. Then run duty 3, telling
`westlaw-query-optimizer` that the instrument's text is on file, so the query seeks
judicial consideration and commentary rather than the text. Then dispatch
`researcher:legislation-fetcher` for each `legislation_skipped` title not yet on disk, with one
more legislation-currency dispatch covering only those titles. Put only the instruments
the question, the matter or a memo names through duty 4: an instrument the question
reaches only by its subject is the audit agent's to offer, never yours to infer. Every
other question runs the duties in their numbered order.

1. **Tier 2, where the agent has no pool tools.** If the pooled-layer read tools
   are in *your* tool list but not the agent's, run them yourself — several
   rephrasings through `find_candidates`, and `lookup_by_citation` /
   `treatment_chain` where citations are already known — and pass the results into
   the spawn prompt. The permission prompts firing here are the design working. A
   hard error (`data_error` / "fetch failed") is not that gate: follow the
   pool-unreachable protocol in `shared/research-priority.md`, say the layer went
   unaudited, and proceed. Where the agent you are spawning holds the pool tools
   itself (per its roster tool grant, not its description), skip this — it audits
   the layer directly.
2. **Tier 3 text, from `research_filing__law_folder_text`.** The agent's grant
   cannot open a `.docx` or `.doc`. The tool extracts text-layer PDFs, `.docx` and
   `.doc` inside the data server, with no host Python or package; a PDF with any
   scanned or OCR'd page comes back `ocr_unavailable`, because a scanned page's
   text layer is never read. `law_folder_text` returns a PDF with any scanned
   page as unread, even when its other pages are born-digital, such as a report
   with a scanned cover. The session then reads it through a page manifest.
   Before each spawn
   or re-invocation, call `research_filing__law_folder_text` with the matter root
   and each issue's `6. LAW\<issue>\` folder. Pass its rows verbatim in the spawn
   prompt's `6. LAW listing and extracted text:` field, and name every
   `status: unread` row there as UNREAD with its reason. The agent records that
   file UNREAD, never absent, and caps its confidence. Then call lawyer's
   `pdf_pages__images` for each PDF in that folder, and pass each PDF's page
   manifest, keyed by its path, in the spawn prompt's `6. LAW page manifests:`
   field: `{page, images}` for each scanned page, its images top to bottom, and
   `{pages: "a-b", pdf}` for each run of born-digital pages (`matter-data`
   design decision #71). A PDF the tool refuses goes in that field with its
   reason and no manifest. The agent reads a scanned page only from its images,
   and records a PDF with no manifest UNREAD, never absent, with capped
   confidence. Where the agent's `Read`
   cannot reach the host scratchpad, as in a cloud session with the matter on the
   desktop, stage only the rows' `text_path` files, at most 50 paths per
   `device_stage_files` call, the calls in parallel, confirm every file staged,
   and name the staged paths. Stage each manifest's PNGs the same way, rendered
   by `/matter-data`'s verify-law operation §2, and name their staged paths in
   the manifest. Never stage or convert the `6. LAW` files
   themselves. When only some lines of one filed file are needed, such as one
   provision to quote into the spawn prompt, call `law_folder_text` with `file`
   and a `pattern` instead of extracting and staging the folder: the matching
   lines come back inline with their line numbers and context, beside the file's
   first lines and its manifest currency marker, and nothing is written or
   staged. Pass that currency marker on with the lines. An HTML page is never
   matched: the tool searches its `.md` or `.txt` sibling or refuses.
3. **Tier 4, Westlaw — before the audit, never after it.** After tiers 1–3, for
   each issue no pinpointable text on disk answers, run Westlaw without asking unless the practitioner declined it this run:
   1. run the `westlaw-query-optimizer` subskill on the question;
   2. dispatch `researcher:research-paralegal` in **deep-research** mode with the optimized
      query, the verified client-matter ID, the jurisdiction and the issue's
      existing `6. LAW\<issue>\` folder;
   3. dispatch `researcher:research-paralegal` in **citation** mode, `source: westlaw-first`,
      for every citation already known on the issue (from the matter, a prior memo,
      or a prior research-agent answer), into the same folder;
   4. only then, once duties 4 and 5 have run, spawn the audit agent, naming the memo
      and decision files retrieved.

   One research-paralegal dispatch at a time.

   **On a held job, the Westlaw wait is a ⏳ step.** After dispatching
   `research-paralegal` in the background for a held job's Westlaw step, set that step
   ⏳ for 5 minutes (`drafting_data__set_step`, `status: waiting`, `/drafting-data`
   `references/jobs-run.md` §6b). When the time has passed, check whether the paralegal
   has returned and its memo is filed in the issue's `6. LAW` folder. If not, set the step
   ⏳ for 5 minutes again. Never dispatch a second `research-paralegal` while one is out.
   Once the memo is filed, stamp the step done. A `status: blocked (...)` return sets the
   step ↻ (`status: retry`), never done. The ⏳ minute is a time to check the run, never a
   deadline (`shared/deadline-isolation.md`).

   Where tiers 1–3
   hold pinpointable text answering an issue, skip this duty for it, recording on
   its spawn `Westlaw:` line each file and paragraph or
   page you read that answers it:
   `Westlaw: <issue>: not run: tiers 1–3 held pinpointable text: <file> para <n>[; <file> para <n>]`.
   A skip that names no pinpoint is not a skip: run this duty for that issue. The
   audit agent opens each pinpoint and returns a hand-off packet for any issue it
   does not answer.
4. **Legislation text, before the audit.** After the Westlaw duty (before it, for a
   statutory-text question), so that its
   `legislation_skipped` titles are known, dispatch the `researcher:legislation-fetcher` agent
   once for each statute, regulation or bylaw cited in the question, known on the
   issue, or listed in `legislation_skipped`. Dispatch it too, with `kind: secondary` and
   its `url`, for each published document that is not legislation, such as a news release
   or consultation paper, that the question, the matter, a memo or an audit return names
   by URL: it gets a `Secondary:` line, never a currency call. Skip an instrument whose `downloaded`
   record is already in the issue folder's `case-download-manifest.json`. The dispatch
   is `{citation?, title, kind, country, jurisdiction, locality?, destination_dir,
   matter, allow_host?}`: `destination_dir` is the issue's existing `6. LAW\<issue>\`
   folder and `matter` the live matter's file number, such as `1234.L####`, never its style of cause or a party's name: the runtime stamps it into an overlay map every matter reads. Pass the citation wherever the question, the
   matter or a memo gives one: a title alone may come back `not_located`. One fetcher
   at a time. It may run beside `research-paralegal`, because it uses no Chrome, no
   Downloads folder and no Westlaw.
   - `refused` (`host_not_allowed`): ask the practitioner once whether to allow
     fetching from that host. On a yes, re-dispatch the same instrument with
     `allow_host` set to it. A no, or a second refusal, ends that instrument.
   - `stopped`: a hard stop for that one instrument. Report its reason verbatim, mark
     the instrument unread, and carry on with the question.
   - **A matter-data copy, when nothing was filed.** Before marking an instrument unread
     after a stop, or after a refusal the practitioner does not lift, ask `/matter-data`
     (query: which held authority carries this instrument's full text) for a copy. When
     it names one, use it in place of the fetch: its file (as an absolute host path, joined
     to the matter root when stored relative), its bundled page range if it
     sits in a book of authorities, its recorded hash, no currency marker, and
     `official: false`, whatever its source. Only with no copy is the instrument unread.

   Then, still before the audit, call the canlii `legislation_currency` tool once,
   with the `currency_marker` (as `YYYY-MM-DD`) of each instrument filed with one,
   and the citation, title and jurisdiction of every instrument in issue,
   whatever the fetcher returned for it: CanLII's metadata can show a repeal where no
   text was filed. It is a tool call, not an agent, so it waits for no Westlaw run.
   Then hold one legislation record per instrument,
   `{citation, title, path, sha256, currency_marker, currency, official}`. `title`,
   `path`, `sha256`, `currency_marker` and `official` come from the instrument's
   `downloaded` record in the issue folder's `case-download-manifest.json`, or from the
   matter-data copy used in its place, and are `none` for an instrument with neither.
   `currency` comes from that call, and is `validation_unavailable` when it fails. A
   `blocked (no-api-key)` status gives every instrument `validation_unavailable`;
   relay its two key paths to the practitioner.

   Record every instrument in the spawn prompt's `Legislation:` field.
5. **Note-up, before the audit.** For each court decision the question asks to have
   noted up (a note-up request, such as a `/draft` note-up step or the `Note up all
   cited authorities` job), dispatch `researcher:citation-checker` once, after duty 3's dispatches
   have returned: `{citations: [{citation, since?}], client_matter_id,
   destination_dir}`, with duty 3's verified client-matter ID and the issue's existing
   `6. LAW\<issue>\` folder. A caller working a `/draft` job adds its `db_path`,
   `ticket_id` and `session_token`. Never dispatch it while `research-paralegal` or
   another `citation-checker` is out: they share one Chrome session. It runs KeyCite
   first and the CanLII citator second, and files one note-up record per decision.
   Name each record on the spawn prompt's `Note-up:` line. A statute, regulation or
   rule is never sent to it: its note-up is duty 4's currency check. A decision the
   audit relies on with no record comes back as `needs_note_up` (below).

**Westlaw unreachable is a hard stop.** Any `status: blocked (...)` that
research-paralegal or citation-checker returns is a hard stop, whether or not its
status is named here: stop the whole question, with no audit-agent spawn, no CanLII step, and no
`canlii-only` download or CanLII sweep in Westlaw's place. Tell the practitioner in
plain words:

- `status: blocked (chrome-not-connected)`: "Westlaw research is needed and Chrome isn't connected.
  Open Chrome and sign in to Westlaw, then tell me to continue."
  If its `detail:` line is `chrome-tools-absent`, say instead: "Chrome can't be reached from this session. Run this research step from a Claude Code session."
- `status: blocked (westlaw-not-signed-in)`: "Westlaw research is needed and Westlaw isn't signed in.
  I've opened the Westlaw sign-in page in Chrome. Sign in, then tell me to continue."
- `status: blocked (chrome-permission-not-granted)`: "Westlaw research is needed and
  Chrome's permission prompt wasn't answered. Bring Chrome to the front and click
  Allow on the small Claude permission window. If Westlaw then shows a sign-in page,
  sign in yourself. Then tell me to continue."
- `status: blocked (mechanics-unavailable)`: relay its guidance verbatim: check for
  updates in the desktop app and fully restart it, then tell me to continue; if the
  problem persists, run /lawyer:suggestion.
- Any blocked status not named here or below: quote its `status:` line and its
  `detail:` line verbatim, and ask the practitioner to resolve it and tell you to continue.

On "continue", re-dispatch the same run. The fail-closed client-matter gate (`status: blocked (matter-mismatch)`, or
`status: blocked (client-id-not-on-westlaw)` with its one-line instruction) is a genuine
stop too, reported as such. Neither stop is the hand-off-packet carve-out below.

**Spawn the agent from this template.** Fill every field. Never name CanLII as a
place to read or check decisions: CanLII serves no decision text.

```
Question: <the legal question>
Facts: <the factual context>
Origin: <draft file path or Writing id>: "<the draft's words the question came from>" / none
Job question: "<the held job's title, verbatim>" / none
Matter root: <path>
Matter: <the live matter's file number, such as 1234.L####>
Asked by: <the practitioner's name>
Date: <today, YYYY-MM-DD, from the host clock>
Memo template: CRAC / IRAC / CREAC   (IRAC or CREAC only when the practitioner expressly asked)
File stem: YYYY-MM-DD ML re <two to six keywords from the question>
Pooled-layer results: <results> / not installed / NOT AUDITED: <reason>
Preflight: all ok / <row>: <state>[; <row>: <state>]
Westlaw: <issue>: run, memo(s): <paths>; decisions: <paths> / not run: tiers 1–3 held pinpointable text: <file> para <n>[; <file> para <n>] / not run: practitioner declined
Legislation: <citation>: filed <path>, current to <marker>, currency <value> / already on disk <path>, currency <value> / not retrieved: <reason>, currency <value> / on disk from case data <path>[, pp. <X–Y>], official: false, currency <value>
Secondary: <title>: filed <path>, dated <marker>, from <publisher_host> / not retrieved: <reason> / none
6. LAW listing and extracted text: <the listing, and the text or text path of each file extracted or staged>
Note-up: <citation>: record <path> / <citation>: not filed: <citation-checker's status line> / none
Re-invocation: no / yes: Westlaw did not return <citations, or none>; paralegal: <its status line, or practitioner declined>
Background memos: <path>[; <path>] / none
Here are the memos that will provide some background context for your research. Repeat the propositions and excerpts from the previous memo only if they are necessary context for explaining your own research memo, but make sure that you go beyond that information and dig deeper into the legal issue posed by your particular question.
Flag unsettled: <what to flag as unsettled> / none
Decision text is on disk at the paths above.
Legislation text is on disk at the paths above.
A file on a Secondary line is its author's words, never a statement of law: cite it as secondary, attributed to its author.
Note-up records are at the paths on the Note-up line.
If you need a decision that is not on disk, return needs_download, unless Re-invocation is yes: then offer it as research instead.
If you rely on a decision with no note-up record, return needs_note_up, unless Re-invocation is yes: then it is NOT NOTED UP.
A layer the Preflight line names is capped from the start: commons reads NOT AUDITED: <its state>, CanLII reads no key. Make no call to it.
```

`Preflight:` carries the `/legal-research` gate's step 0 result: `all ok`, or each row
that is not ok with its state (`commons: missing_credential`, `canlii: no_key`,
`extractor.pdf: missing`, `extractor.docx: missing`, `knowledge_tree: error`).

`Matter root:` is the matter folder's host path, the folder holding `probanda.json`,
in the same host form `research_filing__save_answer` takes, because the agent passes
it to `research_filing__write_scratch`. `Matter:` is the same file number duty 4 passes
the fetcher, which the memo's header carries. `Asked by:` is the practitioner who asked:
if you do not know the name, ask once.
`Origin:` names the draft the question came from, a plain draft file's path or a Writing's
id, and quotes the draft's words the question is about, verbatim. A caller that took the
question from a draft, a `/verify-law` sweep line included, fills it. Every other question
carries `Origin: none`.
A caller working a `/draft` job fills `Job question:` with the job's title character for
character, as its card shows it, and puts the same words in `Question:`. Every other
caller writes `Job question: none`.
`Re-invocation` is `no` on the first spawn and `yes` only on the one re-invocation below.
Write one `Westlaw:` line per issue.
Write one `Legislation:` line per instrument, and `Legislation: none` when no instrument
is in issue.
Write one `Secondary:` line per document, and `Secondary: none` when there is none.
Write one `Note-up:` line per decision `citation-checker` was dispatched for, and
`Note-up: none` when none was.
`Background memos:` and `Flag unsettled:` are filled only by `/legal-research`'s board
mode (`references/research-board.md`): the saved memos of the jobs that blocked this one,
and the research triage's instruction for this job. With `Background memos: none`, leave
out the line after it.

**Sources to get, on a held job.** A caller working a `/draft` job records each
decision, instrument and file on the job before the dispatch or ingest that gets
it, and closes it once it has landed. That covers the Westlaw duty's citation
dispatch, the legislation duty's fetcher dispatch, the `needs_download` dispatch
below, and the cited-decision dispatch and the ingest under "After the answer".
The rule is `/drafting-data`'s (`jobs-common.md` §2, "Sources to get"), and its
call is the lock read before each of those dispatches. A deep-research run is not
a source: its record is the answer saved under the job. A caller holding no job
records nothing.

**A `needs_download` or hand-off-packet return is a pipeline step, not a closed
gate.** When the agent returns a `needs_download` list, a `needs_note_up` list or a
hand-off packet on an issue of the question, execute it without asking, whatever its
other gaps (a declined issue dispatches nothing):
dispatch `researcher:research-paralegal` in
citation mode, `source: westlaw-first`, for the `needs_download` citations, run
a hand-off packet through `westlaw-query-optimizer` and a deep-research dispatch, and
once those have returned, dispatch `researcher:citation-checker` for the `needs_note_up`
citations by duty 5.
Then re-invoke the same audit agent once, naming the new files, with
`Re-invocation: yes` listing every citation the `westlaw-first` dispatch did not
retrieve (`none` when it retrieved them all), and a `Note-up:` line for each record
filed. Only a gate still
closed after that one loop is relayed under the rule below. A Westlaw block during
the loop is the hard stop above.

**When the gate closes, closed is the answer.**

If research-agent declines to state the law — its disclosure gate closes, it
reports layers unavailable, or it offers only a preliminary impression — relay its
confidence summary, its mandated phrasing, and its research offers to the
practitioner, and stop. A closed gate is never a licence to answer the question
yourself: do not substitute WebSearch, secondary commentary, training knowledge, or
a narrower direct tool path such as your own CanLII calls,
and do not present citations the audit did not verify — an "unverified" caveat does
not cure an unverified statement of law. The only paths forward are the ones the
agent offered (fix the missing source or key, run the hand-off research, accept the
preliminary impression), and the practitioner chooses among them. A caller holding a
`/draft` job takes the held-job rule below instead: on a job the agent's memo always
answers, and its gaps become steps on the job.

**After the answer, the caller persists it.** This rule covers the return of
the `research-agent` agent, or whichever law-audit agent the gate dispatched.
Any such return that states law with pinpoint citations is persisted, and so is
a Mixed-coverage return (one saying "More research is needed on the following
issues", or on a job one whose `Gaps` name a tier not run), which is not a closed gate
even where it reports layers unavailable.
Verified pinpoints are not a precondition: filing its cited decisions puts on
disk the full text that verifying them needs.

**On a held job, an open tier is not an answer.** A return to a caller working a `/draft`
job whose `Gaps` section names a tier not run (`gap: <issue> : tiers not run: <tier>`,
anything but `none`) is a pipeline step, not an answer: save nothing yet. First
add one step to the held job for each tier it names, by `/drafting-data`'s partial replace
(`jobs-run.md` §5), appended after the steps already on it, which keep their words and stamps, such as
`Run the Westlaw query on <issue>`, `Fetch the full text of <citation>` or `Read <file>`,
then `Put the question to /legal-research again with the new sources`. A tier only the
practitioner can open, such as a missing key or credential, gets a step in the practitioner's
name with its fix, listed for them under Movers (`/draft` `references/job-session.md`). Then
work the steps: Westlaw by duty 3 on that issue, legislation by duty 4 for that instrument
(its whole text), a note-up (`Note up <citation>`) by duty 5 for that decision, and an
UNREAD file by duty 2 or the `/matter-data` copy. Then re-invoke
the same agent with `Re-invocation: yes`, naming the new files. Repeat while a gap names a
tier not yet run for that issue in this question: each tier runs at most once per issue. A
step is stamped done only once its work has run, never while a return still names its tier
not run. A tier that stops by the rules above (a Westlaw stop, a refusal the practitioner
keeps, a fetcher stop) stops as they say, and its step stays open: set it ↻
(`drafting_data__set_step`, `status: retry`) while a missing credential or an unreachable
source blocks it, never stamped done. A Westlaw step waits as ⏳ while its run is out
(duty 3). Once no gap names a tier
this session can run, persist the last return by the order below: its Conclusion answers
the question, and the job stays open on each step not yet done (`/draft`
`references/job-session.md`, Complete). A caller holding no job keeps the single loop above.

Persist in this order. Steps 2 and 3 need not interrupt the work in hand, but they
complete before the session ends: never leave a session with a cited decision unfiled.

1. Save it verbatim: the memo, from its `---` header line to the end of the return,
   with only the trailing `Files:` list and "Nothing new to remember" note omitted,
   nothing added but the Legend the save generates and nothing else of it removed, as `<File stem>.md` (the spawn
   prompt's `File stem:`) in the research folder under the matter. The internal notes
   above the memo are already in the scratchpad and are not saved here.
   The research folder is set by the question you put to the audit agent. The issues
   it splits that question into get no folders of their own. A question about one
   legal issue files in `6. LAW\<issue>\`: reuse the existing subfolder named for
   that issue, or create one named in the question's own words for it, and name any
   folder you created in your relay. A question spanning more than one issue files
   in `6. LAW\` itself.
   Never use the claude.ai Project. Save with `research_filing__save_answer`.
   When the return has a `Memo scratch:` line, pass that path as `from_scratch`
   and no `text`: the runtime copies the agent's own file byte for byte, so the
   memo is never retyped. Only when the return has no such line, pass the memo as
   `text`, as written. Either way it never overwrites, even a file another
   session wrote, and takes the next free ` vN` itself. A caller working a
   `/draft` job also passes the job's `db_path`, `ticket_id` and its own
   `session_token`, so the job's card lists the answer. A result reading
   `job.recorded: false` means the job is no longer the caller's: the answer is
   saved, so stop and report. The generated Legend is the only definition of a symbol in
   the memo: where a line of it says otherwise, save the corrected memo again.
2. For every court decision the answer cites (in support, distinguished, or
   rejected) that case data does not already hold and that is not already on disk
   under the matter's `6. LAW\` (the pre-spawn Westlaw retrieval usually filed it),
   dispatch `researcher:research-paralegal` in
   citation mode, `source: canlii-only`, with that same research folder as the
   destination, whichever issue the decision is cited on. Step 1's save means the
   folder exists before dispatch. Batch as its playbook allows, one dispatch at a time.
3. Run `/ingest` on each cited decision file case data does not hold, whether it
   was downloaded now or before the audit, and on each legislation file
   `legislation-fetcher` filed in this run. A Point in Time page or bulletin it
   filed beside a consolidation is a currency record, not an authority: never ingest it.

In your relay, account for every court decision the answer cites in one line of counts --
already held, ingested now, and "not on disk, not ingested", naming each decision in that
last group -- and for cited legislation in one more. A decision
never dispatched is reported the same way as one whose download failed: a decision you
did not persist is never passed over in silence. The answer file itself is never ingested.
It is a lead, not an authority, and ingesting it would let the next audit cite it at
tier 1. A closed gate saves and ingests nothing. If the practitioner then asks for
the preliminary impression, the return it produces is persisted by the same rule,
as `<File stem> (preliminary).md`.

Relay each `matter-data:` flag in the return's notes in one line: its kind, its
description and its evidence ids, with the offer to record it through `/matter-data`.
Record nothing without the practitioner's yes. A `/draft` session holding a job
handles them by its own rule instead (`/draft` `references/job-session.md`,
"matter-data flags in a research return"). A return with no flag adds no line.

**With a board, the return's open items are sorted against it.** This step runs after the
persistence steps above, for a return they persisted, wherever a board resolves. In a
`/draft` session the board is the open one, whatever the spawn prompt's `Origin:` says. In
any other session it is the one `/drafting-data` §8a step 2 resolves from the origin: a
Writing's own filing, or, for a plain draft file, the proceeding it serves.

Capture these as loose threads in the same turn the return arrives, each verbatim from the
return and at most five sentences, with no recommendation, once each has passed the duplicate
test below:

- each `origin-correction:` line in the notes, one thread each;
- each `matter-data:` flag: every `pinpoint` flag together as one thread, each other flag its
  own. The one-line offer above to record it through `/matter-data` is still relayed.

A session holding no job captures them through `/drafting-data`'s capture with no job held
(§8a). A `/draft` session holding a job captures them by its own rule instead (`/draft`
SKILL.md, "Captured ideas").

**The duplicate test.** Before capturing any item of the return, an `origin-correction:`
line, a `matter-data:` flag or an offer, read `drafting_forms__board_card` with
`lanes: ["loose_threads"]`. An item that restates the held job's own title or intent, or the
idea of an open loose thread (the thread the held job is working included), is not captured.
Say so in one line instead: `already on the board: Loose thread #N`, or `the held job's own
subject: Job #N`. The test reads what an item is about, never whether it is right, and states
no law.

Then sort every Step 5 offer, whatever its `live_issue` tag, against the board. Read the
board without opening a page: `board_summary` (its `To Do:` line, its completion criteria or
`State:` line, and the board's title), `drafting_forms__board_card` with `lanes: ["live"]`
for the open jobs' titles, the same tool with `jobs` naming every id that lane lists for
their intents, and the spawn prompt's `Origin:` words. In a session holding a job, the held
job's title and intent count too. Put each offer in one class:

| Class | Test | What happens |
|---|---|---|
| Off the application | The offer is about a different order, claim, party, proceeding or stage than any the board names | Not captured, not relayed, counted |
| On or near the application | Everything else: an offer serving the board's words, a new angle on the board's own subject, and any doubt | Captured as a loose thread at once, by the duplicate test above (`/drafting-data` §8 with a job held, §8a without), and relayed word for word |

An offer tagged `kind: note-up` is not sorted: it is always captured as a loose thread, by
the duplicate test above, and relayed word for word. It is never dropped and never becomes a
job by §3i, even on "add".

The sort reads what an offer is about, never whether it is right. It states no law and
rewords nothing. It creates no job: an offer becomes a job only when the practitioner names
it to add.

An offer is its tagged line. The `job:` and `steps:` lines under it are neither captured nor
relayed: §3i reads them from the return on "add".

Name the saved answer file as what surfaced each thread. Never edit the draft. A captured
thread is never ripe, never a blocker and never assigned to anyone: only a later `/draft`
outlining session takes it up, or the practitioner's "add" below.

Then relay, in this order:

1. The return's `Confidence:` line, word for word, and the saved memo as its file card (`shared/present-files.md`).
   Restate nothing of the memo: the card is the answer.
2. Each captured offer, word for word.
3. One line: `<c> offers captured as loose threads. <k> already on the board. <d> offers dropped as off this application.` Any count may be 0.
4. One line saying they may name any relayed offer to add as a research job or to drop, and
   that the rest stay on the board as loose threads. When any relayed offer is tagged
   `kind: note-up`, the line also says that a note-up is added only in their own words, such
   as "note up <case>".

On "add", write that offer's job by §3i, which also consumes the thread this sort captured.
On "add" of a `kind: note-up` offer, write nothing and say so in one line (§3i).
On "drop", discard that thread by `/drafting-data` §8's drop write. Name each
`origin-correction:` line's issue in one line pointing to the board, never restating the
memo's words as advice on the draft.

A closed gate captures nothing, adds no job and relays nothing new. When no board resolves,
capture nothing, add no job, relay the `Confidence:` line and every offer, each word for
word, with the saved memo as its file card (`shared/present-files.md`), and say in one line that the matter has no
board to capture to. A return
with `Origin: none` is sorted against the open board in a `/draft` session. Outside `/draft`
it is relayed as before this step existed.

**Statute currency.** In a research question the check runs at the end of duty 4.
When a caller such as `/draft` asks for a currency check on its own, call the canlii
`legislation_currency` tool with each instrument's citation, title and jurisdiction,
and its `currency_marker` when one is filed, and hold the same legislation record per instrument as duty 4 does.

**One currency check per Act.** The caller may name, with each instrument, the
provisions (pinpoints) it needs. Instruments sharing the tool's `key` (the
jurisdiction, lower-cased, then `|`, then the citation with periods removed,
lower-cased and whitespace runs collapsed) are one Act: one call checks it once,
and the relay gives it one record listing every provision named for it. A record
already relayed in this session for that `key` is reused, not checked again, unless
the caller asks for a fresh check. The caller records each listed provision from
that one record.

Save all a `legislation_currency` call returns by step 1's tool and folder
(`6. LAW\` if no audit agent ran) as `YYYY-MM-DD statute-currency check.md`. Only
`current` reads as confirmed for the instrument. Any other value, or a call that
fails, reads unconfirmed (`shared/statute-currency.md`). A bare `current` never
shows that the filed text is in force: read it with the result's `marker_date` and
`amendments_after_marker`. A listed amendment whose quoted provisions name a
provision the caller relies on leaves that provision unchecked until its amending
text is read. This runs in the same `/legal-research`
call as any verification of a statement on the instrument. The filed file's own
"current to" marker is leg 3 of `shared/statute-currency.md` and never confirms on
its own.

Relay every instrument's record to the caller in this fixed shape, one line per
instrument, `none` for a field with no value:

```
Legislation records:
- citation: <citation> | title: <title> | path: <path> | sha256: <sha256> | currency_marker: <marker> | currency: <value> | official: <true / false> | key: <key> | provisions: <pinpoint>; <pinpoint> / none
```

Under each record line, relay the result's `marker_date` and each
`amendments_after_marker` entry (instrument, effective date and the quoted
provisions), or `amendments: unknown` with its `amendments_note`, word for word.
