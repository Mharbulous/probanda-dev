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
agent as a *scoped* dispatch: `mode: inventory`, `Matter root:`, the named criteria, `report: brief`
(contract: `shared/legal-audit-scoped.md`). It costs a fraction of an opinion-grade
audit because the question is narrower, not because a check was skipped. It states no
law — never build a conclusion on it; re-dispatch in opinion mode over any criterion
you intend to rely on.

**Research runs only under a job.** Legal research runs only for a job this session holds
whose title opens `Legal research: `, and it ends only in a saved memo, never in a reply in chat.
The job reads `Legal research: <issue>`: its intent is the issue, and its title is the prefix
followed by the intent, character for character. The issue is at most two context sentences, then
one question, the only sentence ending in `?`. A plainly labelled hunch is no research and
needs no job.

- **No job held.** Propose the issue in the form, quoting the question, and on the
  practitioner's approval write it by `drafting-data/references/jobs-stock.md` §3l, plan it (`shared/job-planning.md`
  section 2) and assign it to this session. Without `/drafting-data` installed, write it with
  `drafting_data__create_job`: guard `research_title`, `filing_id` null, `kind` `work`, `priority`
  `bottom`, `billing_anchor` `<matter>|<its forum and file number>`, and the plan marker as its step. With no
  board it goes on the proceeding that persist step 1 below names. With no matter named, ask which
  matter and run nothing until told. An unattended run reports and stops.
- **A held job not in the form.** Run the review in `shared/research-job-migration.md` first.
- **Under their own routes, with no such job:** a held note-up, scrutiny or case brief job, a
  `Note up paragraphs:` run, a currency check asked on its own and a scoped holdings dispatch.

**A research question holds one question.** It makes sense on its own and names nothing of
the working matter (`shared/research-memo-template.md` rules A to D,
`shared/legal-audit-protocol.md` Step 6). Context sentences are allowed, a second question or
a list of questions is not, and a part that depends on the one before it ("If so, ...") stays
with it. A question that fails is never split or researched as it stands: in one proposal,
quoting it, propose one rewording narrowed to a single question. On a yes, reword a held job
to it (`drafting-data/references/jobs-stock.md` §3m, "Rewording a held job") and research that. On a no, research
nothing. Each other question it held is one the practitioner raised (below). An unattended
run reports and stops.

**A new question is a new job or a new scope.** When the practitioner raises a question this
research does not hold, ask exactly one question: "Do you want this investigated as an
additional issue (a new research job), or are you changing the scope of this job?" On the
first, write it as a research job by `drafting-data/references/jobs-stock.md` §3l, on their approval of its issue. On the second, reword the question (a held job by §3m) and
research that. Offer no third path.

**Before spawning, run what the agent cannot.** `shared/research-priority.md` is
the binding order for every legal lookup — read it and follow it. Five duties fall
on the caller specifically, because the agent's own grant cannot discharge them:

**A statutory-text question runs duty 4 before duty 3.** A question is
*statutory-text* when it names a statute, regulation or bylaw and asks what that
instrument provides, requires, permits or lacks. For it, run duty 4 first, so the
instrument's full text is on disk before Westlaw runs. Then run duty 3, telling
`westlaw-query-optimizer` that the instrument's text is on file, so the query seeks
judicial consideration and commentary rather than the text. Then dispatch
`researcher:law-getter` with `mode: legislation` for each `legislation_skipped` title not yet on disk, with one
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
2. **Tier 3 text, from `research_filing__law_folder_text`.** The tool extracts
   text-layer PDFs, `.docx` and
   `.doc` inside the data server, with no host Python or package; a PDF with any
   scanned or OCR'd page comes back `ocr_unavailable`, even when its other pages
   are born-digital, because a scanned page's text layer is never read.
   Before each spawn
   or re-invocation, call `research_filing__law_folder_text` with the matter root
   and each issue's `6. LAW\<issue>\` folder. Pass its rows verbatim in the spawn
   prompt's `6. LAW listing and extracted text:` field, and, but for an
   `ocr_unavailable` row, name every
   `status: unread` row there as UNREAD with its reason. A PDF's `status: ok` row
   is its page manifest: every page is born-digital (`scanned_pages: []`). The
   agent reads each `text_path`, and the PDF of each `ocr_unavailable` row, through
   `research_filing__research_folder`, whichever host it runs on. The agent reads a
   scanned page only from its images, and records a file it cannot read UNREAD, never
   absent, with capped confidence. When only some lines of one filed file are needed,
   such as one
   provision to quote into the spawn prompt, call `law_folder_text` with `file`
   and a `pattern` instead of extracting the folder: the matching
   lines come back inline with their line numbers and context, beside the file's
   first lines and its manifest currency marker, and nothing is written.
   Pass that currency marker on with the lines. An HTML page is never
   matched: the tool searches its `.md` or `.txt` sibling or refuses.
3. **Tier 4, Westlaw — before the audit, never after it.** After tiers 1–3, for
   each issue no pinpointable text on disk answers, run Westlaw without asking unless the practitioner declined it this run:
   1. run the `westlaw-query-optimizer` subskill on the question;
   2. dispatch `researcher:law-getter` in `mode: deep-research` with the optimized
      query, the verified client-matter ID, the jurisdiction and the issue's
      existing `6. LAW\<issue>\` folder;
   3. dispatch `researcher:law-getter` in `mode: citation`, `source: westlaw-first`,
      for every citation already known on the issue (from the matter, a prior memo,
      or a prior research-agent answer), into the same folder. Split the citations
      into batches of at most 5, the per-invocation cap of this mode and of
      `citation-checker`, and dispatch the batches one after another: a dispatch's
      citation list is never longer than the cap;
   4. only then, once duties 4 and 5 have run, spawn the audit agent, naming the memo
      and decision files retrieved.

   One Chrome-mode law-getter dispatch at a time.

   **On a held job, the Westlaw wait is a ⏳ step.** After dispatching
   `law-getter` in the background for a held job's Westlaw step, set that step
   ⏳ for 5 minutes (`drafting_data__set_step`, `status: waiting`, `/drafting-data`
   `references/jobs-run.md` §6b). When the time has passed, check whether law-getter
   has returned and its memo is filed in the issue's `6. LAW` folder. If not, set the step
   ⏳ for 5 minutes again. Never dispatch a second Chrome-mode `law-getter` while one is out.
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

   Skip this duty, too, for an issue that asks only what an amendment changed, such
   as whether amending instrument X changed provision Y or what Y said on a given
   date. Westlaw AI does not answer point-in-time legislation questions. Record
   `Westlaw: <issue>: not run: point-in-time legislation question`. The audit agent
   answers the issue from the legislation text duty 4 files. An issue that also asks
   how courts have read or applied the provision is not this skip: run this duty for
   it. The skip sends nothing to CanLII.
4. **Legislation text, before the audit.** After the Westlaw duty (before it, for a
   statutory-text question), so that its
   `legislation_skipped` titles are known, dispatch the `researcher:law-getter` agent with `mode: legislation`
   once for each statute, regulation or bylaw cited in the question, known on the
   issue, or listed in `legislation_skipped`. Dispatch it too, with `kind: secondary` and
   its `url`, for each published document that is not legislation, such as a news release
   or consultation paper, that the question, the matter, a memo or an audit return names
   by URL: it gets a `Secondary:` line, never a currency call. Skip an instrument whose `downloaded`
   record is already in the issue folder's `case-download-manifest.json`. The dispatch
   is `{mode: legislation, citation?, title, kind, country, jurisdiction, locality?, destination_dir,
   matter, allow_host?, amending_instrument?, url?}`: `destination_dir` is the issue's existing `6. LAW\<issue>\`
   folder and `matter` the live matter's file number, such as `1234.L####`, never its style of cause or a party's name: the runtime stamps it into an overlay map every matter reads. Pass the citation wherever the question, the
   matter or a memo gives one: a title alone may come back `not_located`. One legislation-mode run
   at a time. It may run beside a Chrome-mode `law-getter` run, because it uses no Chrome, no
   Downloads folder and no Westlaw.
   - **An amending instrument.** When an issue turns on what an amending instrument
     did, such as whether an amending regulation changed a rule, and you hold the exact
     address of that instrument's own page on its publisher's host (from the matter,
     the practitioner or a memo), dispatch it as its own instrument with
     `amending_instrument: true` and `url` that address, `kind` its own kind. Never
     build or guess the address, and never set the field without one. Dispatch the
     consolidation it amends as usual: the consolidation stays the currency source.
     Law-getter files the page as made, `currency_marker` `none`, and returns
     `made_on`. Leave it out of the `legislation_currency` call
     (`shared/statute-currency.md` sends no amending regulation to it): its record's
     `currency` is `not checked: as made`.
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
   and the citation, title and jurisdiction of every instrument in issue, whatever
   law-getter returned for it, but an amending instrument dispatched as one: CanLII's metadata can show a repeal where no
   text was filed. It is a tool call, not an agent, so it waits for no Westlaw run.
   Then hold one legislation record per instrument,
   `{citation, title, path, sha256, currency_marker, currency, official}`. `title`,
   `path`, `sha256`, `currency_marker` and `official` come from the instrument's
   `downloaded` record in the issue folder's `case-download-manifest.json`, or from the
   matter-data copy used in its place, and are `none` for an instrument with neither.
   An instrument law-getter filed in parts (its return lists `parts`) has one
   `downloaded` record per part under the same citation and `kind`, and still gets one
   legislation record: its `path`, `sha256` and `currency_marker` each list the parts'
   values in the return's part order, separated by `; `.
   `currency` comes from that call, and is `validation_unavailable` when it fails. A
   `blocked (no-api-key)` status gives every instrument `validation_unavailable`;
   relay its two key paths to the practitioner.

   Record every instrument in the spawn prompt's `Legislation:` field.
5. **Note-up, before the audit.** For each court decision the question asks to have
   noted up (a note-up request, such as a `/draft` note-up step or the `Note up all
   cited authorities` job), dispatch `researcher:citation-checker` in batches by duty 3's rule, after duty 3's
   dispatches have returned: `{citations: [{citation, since?}], client_matter_id,
   destination_dir}`, with duty 3's verified client-matter ID and the issue's existing
   `6. LAW\<issue>\` folder. A caller working a `/draft` job adds its `db_path`,
   `ticket_id`, `session_token` and `claim_no`. Never dispatch it while a Chrome-mode `law-getter` or
   another `citation-checker` is out: they share one Chrome session. A citation it
   returns as `not reached: batch cap` goes in the next batch. It runs KeyCite
   first and the CanLII citator second, and files one note-up record per decision.
   Name each record on the spawn prompt's `Note-up:` line. A statute, regulation or
   rule is never sent to it: its note-up is duty 4's currency check. A decision the
   audit relies on with no record comes back as `needs_note_up` (below).

**Westlaw unreachable is a hard stop.** Any `status: blocked (...)` that
law-getter or citation-checker returns is a hard stop, whether or not its
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
Job question: "<the job's intent, verbatim>" while you hold the job's lock / none
Job: <the held job's number> / none
Matter root: <path>
Matter: <the live matter's file number, such as 1234.L####>
Asked by: <the practitioner's name>
Date: <today, YYYY-MM-DD, from the host clock>
Memo template: ICRA / IRAC / CREAC   (IRAC or CREAC only when the practitioner expressly asked)
File stem: YYYY-MM-DD ML re <two to six keywords from the question>
Pooled-layer results: <results> / not installed / NOT AUDITED: <reason>
Preflight: all ok / <row>: <state>[; <row>: <state>]
Westlaw: <issue>: run, memo(s): <paths>; decisions: <paths> / not run: tiers 1–3 held pinpointable text: <file> para <n>[; <file> para <n>] / not run: practitioner declined / not run: point-in-time legislation question
Legislation: <citation>: filed <path>, current to <marker>, currency <value> / already on disk <path>, currency <value> / not retrieved: <reason>, currency <value> / filed <path>, as made, not current law, no currency marker, made on <made_on>, currency <value> / on disk from case data <path>[, pp. <X–Y>], official: false, currency <value>
Secondary: <title>: filed <path>, dated <marker>, from <publisher_host> / not retrieved: <reason> / none
6. LAW listing and extracted text: <the listing, and the text or text path of each file extracted>
Note-up: <citation>: record <path> / <citation>: not filed: <citation-checker's status line> / none
Re-invocation: no / yes: Westlaw did not return <citations, or none>; law-getter: <its status line, or practitioner declined> / yes: review
Review: <memo-reviewer's last JSON, verbatim> / none
Last status: <the saved memo's Status value> / none
Approve: yes / no
Note up paragraphs: <the saved memo's path>: <n>[, <n>] / none
Citing reads: <citation>: <the note's path> / <citation>: UNREAD: <reason> / <citation>: not located by citation search / none
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
law-getter. `Asked by:` is the practitioner who asked:
if you do not know the name, ask once.
`Origin:` names the draft the question came from, a plain draft file's path or a Writing's
id, and quotes the draft's words the question is about, verbatim. A caller that took the
question from a draft, a `/verify-law` sweep line included, fills it. Every other question
carries `Origin: none`.
Before any dispatch, check `Job question:` by "A research question holds one question", and
put the same words in `Question:`.
`Re-invocation` is `no` on the first spawn and `yes` on every re-invocation below: `yes: review`
when no Chrome-mode law-getter ran for it. `Review:` is `none` until memo-reviewer has returned on this question.
`Last status:` is the Status of the memo last saved for this question, or `none`. `Approve:` is
`yes` only when the practitioner has explicitly approved this memo (`shared/research-memo-template.md`, "Status").
`Note up paragraphs:` and `Citing reads:` are `none` except on a proposition-level note-up (below).
Write one `Westlaw:` line per issue.
Write one `Legislation:` line per instrument, and `Legislation: none` when no instrument
is in issue. For an instrument filed in parts, `<path>` lists every part's path, separated by `; `.
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
dispatch, the legislation duty's law-getter dispatch, the `needs_download` dispatch
below, and the cited-decision dispatch and the ingest under "After the answer".
The rule is `/drafting-data`'s (`jobs-common.md` §2, "Sources to get"): dispatch only
what its call lists under `dispatch`. A deep-research run is not
a source: its record is the answer saved under the job.

**A `needs_download` or hand-off-packet return is a pipeline step, not an
answer.** When the agent returns a `needs_download` list, a `needs_note_up` list or a
hand-off packet on an issue of the question, execute it without asking, whatever its
other gaps (a declined issue dispatches nothing):
dispatch `researcher:law-getter` in
`mode: citation`, `source: westlaw-first`, for the `needs_download` citations, run
a hand-off packet through `westlaw-query-optimizer` and a deep-research dispatch, and
once those have returned, dispatch `researcher:citation-checker` for the `needs_note_up`
citations by duty 5.
Then re-invoke the same audit agent once, naming the new files, with
`Re-invocation: yes` listing every citation the `westlaw-first` dispatch did not
retrieve (`none` when it retrieved them all), and a `Note-up:` line for each record
filed. The rules below then take the return. A Westlaw block during
the loop is the hard stop above.

**An incomplete memo is never a licence.** A memo saved `INCOMPLETE`, or a question a
stop above ended, is never a licence to answer the question yourself: do not substitute
WebSearch, secondary commentary, training knowledge, or
a narrower direct tool path such as your own CanLII calls,
and do not present citations the audit did not verify — an "unverified" caveat does
not cure an unverified statement of law. The only path forward is the research the memo
names.

**After the answer, the caller persists it.** This rule covers the return of
the `research-agent` agent, or whichever law-audit agent the gate dispatched.
The memo that memo-reviewer's loop below ends on is persisted, an `INCOMPLETE` one included.
Verified pinpoints are not a precondition: filing its cited decisions puts on
disk the full text that verifying them needs.

**On a held job, an open tier is not an answer.** To a caller working a `/draft` job, the
`required` items memo-reviewer returns on a memo (below) are a pipeline step, not an answer:
save nothing yet. A `gap:` line it does not confirm as `required` adds no step. First
add one step to the held job for each tier they name, by `/drafting-data`'s partial replace
(`jobs-run.md` §5), appended after the steps already on it, which keep their words and stamps, such as
`Run the Westlaw query on <issue>`, `Fetch the full text of <citation>` or `Read <file>`,
then `Put the question to /legal-research again with the new sources`. A tier only the
practitioner can open, such as a missing key or credential, gets a step in the practitioner's
name with its fix, listed for them under Movers (`/draft` `references/job-session.md`). Then
work the steps: Westlaw by duty 3 on that issue, legislation by duty 4 for that instrument
(its whole text), a note-up (`Note up <citation>`) by duty 5 for that decision, and an
UNREAD file by duty 2 or the `/matter-data` copy. Then re-invoke
the same agent with `Re-invocation: yes` and `Review:`, naming the new files. Each tier runs at
most once per issue: the tier is its kind and object as a `gap:` line names it (Westlaw,
`Legislation: <citation>`, `6. LAW: <file>`, Commons, `Note-up: <citation>`), never the
Westlaw query's subject, and the issue is the memo's one Issue. A
step is stamped done only once its work has run, never while a return still names its tier
not run. A tier that stops by the rules above (a Westlaw stop, a refusal the practitioner
keeps, a legislation-mode stop) stops as they say, and its step stays open: set it ↻
(`drafting_data__set_step`, `status: retry`) while a missing credential or an unreachable
source blocks it, never stamped done. A Westlaw step waits as ⏳ while its run is out
(duty 3). The job stays open on each step not yet done (`/draft` `references/job-session.md`,
Complete).
A return with a rewording proposal and no memo saves nothing: put that proposal to the
practitioner as "A research question holds one question" says.

**memo-reviewer checks every memo before it is saved.** Spawn `researcher:memo-reviewer`
on every return that carries a memo, with the spawn prompt's `Question:`, `Job question:`,
`Facts:`, `Matter:`, `Asked by:` and `Origin:` lines, `Matter root:` the matter folder's host path,
`Memo:` the return's `Memo scratch:` path and `Notes:` its `Notes scratch:` path. It reads both
itself. Where a save was refused and the return gives that section in place of its path, give
that section. It reviews one question at most three times. A return that is not its
JSON object (`verdict`, `required`, `out_of_scope`, `identifiers`, `findings`), `rules unavailable`
included, saves nothing: stop and relay it verbatim. On the object, re-invoke the agent with
`Review:` the reviewer's JSON:

- `send_back` with `required` items: each is research the Issue cannot be answered without,
  run by the rule above first.
- `send_back` with `identifiers` or `out_of_scope` items: to rewrite the memo without them.
- `send_back` with `findings` items: to rewrite each as one finding, or cut the item, and to
  give each case named as missing a tag that finding from that court's reasons, or cut the case.
- `send_back` whose only items are `required` research this session cannot run: to name it
  in the open-issues paragraph, unless the memo already does.

Spawn memo-reviewer again on each new return. Save a return only once a review accepts it:
`complete`, or a `send_back` whose only items are `required` research this session cannot
run, each named in the memo's open-issues paragraph. When the
third review accepts nothing, re-invoke the agent once with it to write the memo `INCOMPLETE`,
naming what that review still asks, and save that return. Only the memo the loop ends on is
persisted; earlier returns stay in the scratchpad. Never edit the memo yourself: it is saved
verbatim. On saving an `INCOMPLETE` memo, tell the practitioner in one line which research it
still needs.

Persist in this order. Steps 2 and 3 need not interrupt the work in hand, but they
complete before the session ends: never leave a session with a cited decision unfiled.

1. Save it verbatim, nothing added but the Legend the save generates, as a research memo
   Writing and its readable copy. Copy every field from the `Memo scratch:` file (or the memo
   the return gives in its place) character for character, an excerpt without its `> ` marks.
   The internal notes are already in the scratchpad and are not saved here. These are
   lawyer's own `drafting_*` tools:
   - **Database.** A caller holding a job uses its `db_path` and the job's proceeding. Any other
     caller, a job the gate is about to write or a run with no job under "Research runs only
     under a job", takes `db_path` from `drafting_forms__open_session` on the matter root, and the
     matter's lowest-id proceeding, or inserts one with `drafting_data__execute`
     (`INSERT INTO proceedings (matter_reference) VALUES ('<Matter:>');`).
   - **Writing.** `drafting_data__create_writing` with `tree` `{country: "CAN", jurisdiction:
     "BC", venue: "_NoVenue"}`, `recipient: "internal"`, `title` the `File stem:`, and `kind`
     `research_memo`, `research_memo_irac` or `research_memo_creac` by the spawn prompt's `Memo template:`.
   - **Items.** Read `B`, `SELECT coalesce(max(id), 0) FROM statements_of_law`. Then one
     `drafting_data__execute` script: for each item `n`, its authority unless the proceeding
     already holds one with that `citation` (`INSERT INTO authorities (proceeding_id,
     style_of_cause_or_title, citation, kind) SELECT ... WHERE NOT EXISTS (...)`), then
     `INSERT INTO statements_of_law (id, proceeding_id, authority_id, pinpoint, excerpt, source,
     verification)` with id `B + n`, the authority's id by its citation, and `'lead'`, then
     `INSERT INTO filing_law (filing_id, statement_id)`. The same script writes one
     `filing_prose` row per section, slot `memo-header` (the header, both `---` lines
     included), `issue`, `conclusion`, `rule`, `explanation`, `application`,
     `closing-conclusion` (CREAC's last Conclusion) and `sources`: a prose section as written, a
     numbered section as its items' sentences, one per paragraph, each ending
     ` <!-- statement_of_law_id <B + n> -->`.
   - **Copy.** `drafting_forms__render` with the Writing's `filing_id` and `documents:
     ["General_writing"]`, then `research_filing__save_answer` with that document's `path` as
     `from_render`, `filename` `<File stem>.md` (the spawn prompt's `File stem:`), and as
     `destination_dir` the research folder: `6. LAW\<issue>\`, the existing subfolder named for
     that issue, or one created in the question's own words, named in your relay. A caller
     holding a job also passes the job's `db_path`, `ticket_id` and `claim_no` and its
     own `session_token`, so the job's card lists the answer. A result reading
     `job.recorded: false` means the job is no longer the caller's: the answer is saved, so stop
     and report. A result holding `mockup_only_lines` lists notes the saved file leaves out, such
     as a citation not tracked, and nothing else shows them: relay each in plain words.

   When a `drafting_*` tool refuses, write nothing more to the Writing: save the `Memo scratch:`
   path as `from_scratch` (the memo as `text` only when the return has no such line) and name
   the refusal in your relay. `save_answer` never overwrites, even a file another session
   wrote, and takes the next free ` vN` itself. The generated Legend is the only definition of a
   symbol in the memo. Never use the claude.ai Project.
2. For every court decision the answer cites (in support, distinguished, or
   rejected) that case data does not already hold and that is not already on disk
   under the matter's `6. LAW\` (the pre-spawn Westlaw retrieval usually filed it),
   dispatch `researcher:law-getter` in
   `mode: citation`, `source: canlii-only`, with that same research folder as the
   destination, whichever issue the decision is cited on. Step 1's save means the
   folder exists before dispatch. Batch the citations by duty 3's rule.
3. Run `/ingest` on each cited decision file case data does not hold, whether it
   was downloaded now or before the audit, and on each legislation file
   `law-getter` filed in legislation mode in this run. A case brief file names the decision's citation
   and is never the decision: never ingest one. A Point in Time page or bulletin it
   filed beside a consolidation is a currency record, not an authority: never ingest it.

In your relay, account for every court decision the answer cites in one line of counts --
already held, ingested now, and "not on disk, not ingested", naming each decision in that
last group -- and for cited legislation in one more. A decision
never dispatched is reported the same way as one whose download failed: a decision you
did not persist is never passed over in silence. The answer file itself is never ingested.
It is a lead, not an authority, and ingesting it would let the next audit cite it at
tier 1. If the practitioner asks for
a preliminary impression, the return it produces is persisted by the same rule,
as `<File stem> (preliminary).md`.

Relay each `matter-data:` flag in the return's notes in one line: its kind, its
description and its evidence ids, with the offer to record it through `/matter-data`.
Record nothing without the practitioner's yes. A `/draft` session holding a job
handles them by its own rule instead (`/draft` `references/job-session.md`,
"matter-data flags in a research return"). A return with no flag adds no line.

**With a board, the return's open items are sorted against it.** This step runs after the
persistence steps above, for a return they persisted, wherever a board resolves. In a
`/draft` session the board is the open one, whatever the spawn prompt's `Origin:` says. In
any other session it is the one `drafting-data/references/jobs-run.md` §8a step 2 resolves from the origin: a
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
line, a `matter-data:` flag or an offer, read the open loose threads that match it, by
`loose_threads__read` with `mode: "duplicates"` and the item as `text` (`drafting-data/references/jobs-run.md` §8). An item that restates the held job's own
title or intent, or the idea of an open loose thread, is not captured.
Say so in one line instead: `already on the board: Loose thread #N`, or `the held job's own
subject: Job #N`. The test reads what an item is about, never whether it is right, and states
no law.

Then sort every Step 5 offer, whatever its `live_issue` tag, against the board. An offer of
research the scope test found not required is sorted like any other, so off the application
it is dropped. Read the
board without opening a page: `board_summary` (its `To Do:` line, its completion criteria or
`State:` line, and the board's title), `drafting_forms__board_card` with `lanes: ["live"]`
for the open jobs' titles, the same tool with `jobs` naming every id that lane lists for
their intents, and the spawn prompt's `Origin:` words. In a session holding a job, the held
job's title and intent count too. Put each offer in one class:

| Class | Test | What happens |
|---|---|---|
| Off the application | The offer is about a different order, claim, party, proceeding or stage than any the board names | Not captured |
| On or near the application | Everything else: an offer serving the board's words, a new angle on the board's own subject, and any doubt | Captured as a loose thread at once, by the duplicate test above (`drafting-data/references/jobs-run.md` §8 with a job held, §8a without) |

An offer tagged `kind: note-up` is not sorted: it is always captured as a loose thread, by
the duplicate test above. It is never dropped and never becomes a job by §3i.

The sort reads what an offer is about, never whether it is right. It states no law and
rewords nothing and creates no job. Captured offers are not relayed and invite nothing.

An offer is its tagged line. The `job:` and `steps:` lines under it are not captured.

Name the saved answer file as what surfaced each thread. Never edit the draft. A captured
thread is never ripe, never a blocker and never assigned to anyone: only a later `/draft`
outlining session takes it up.

Then relay the return's `Audit:` line, word for word, and the saved memo as its file card
(`shared/present-files.md`). Restate nothing of the memo: the card is the answer. Name each
`origin-correction:` line's issue in one line pointing to the board, never restating the
memo's words as advice on the draft.

When no board resolves, capture nothing and relay the same. A return
with `Origin: none` is sorted against the open board in a `/draft` session. Outside `/draft`
it is relayed as before this step existed.

**Proposition-level note-up.** On a request to note up the propositions or findings in
numbered paragraphs of a saved research memo, name exactly those paragraphs. Paragraph `n` is
the memo Writing's `n`th item, and its stored item is the `statement_of_law_id` its line ends
with. With `/drafting-data` installed, write the job by its §3k, "A research memo's
paragraphs", and work each step there; without it, run the steps here and say no job was
written. A step runs the gate on the memo's question with `Note up paragraphs:` naming the memo
and its paragraph: `citation-checker` notes up any authority without a record. Then, for each
authority, choose at most 5 citing decisions: the one the record's KeyCite banner names
`Most Recent`, then its KeyCite rows, then its CanLII rows, each decision once and the rest
unread. `law-getter` downloads those not on disk, in one citation-mode dispatch. Spawn
one `researcher:research-agent` with `mode: citing_read` (`shared/legal-audit-scoped.md`) per
decision, no more than 3 at once per authority, with that mode's fields, and another from the
page a return's `More:` line names.
Name each return on the audit spawn's `Citing reads:` line. research-agent
returns the memo with the same items, its Validity, `Audit:` line,
CanLII segment and Status updated (`shared/legal-audit-protocol.md` Step 2). Save it onto
the same Writing: replace its `memo-header` row, then render and save by persist step 1's
Copy. Record an authority's treatment, which clears its 📇, by `/drafting-data`
`references/note-up.md` only once every item citing it has a proposition-level note-up.

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
