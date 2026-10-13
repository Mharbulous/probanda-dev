<!-- REGRESSION-PRONE: CanLII-first research has recurred repeatedly. See docs/design/2026-09-24 research-lawyer Westlaw-first fix plan.md before editing. Tests: legal-research/tests/. -->

# Statements of law — defer to research-agent

(This doctrine is read via the `/legal-research` gate; the file was formerly `shared/statements-of-law.md`.)

Never answer a question about what the law is directly — always defer to the
`research-agent` agent. A "statement of law" is any assertion about what the law
requires, permits, or provides: the elements of a test, the effect of a statute,
what courts have held, whether conduct is actionable. If you cannot attach a
pinpoint citation to an already-verified authority, it is a statement of law and
it is not yours to make.

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
   compares its facts. A research memo or case brief is a lead (item 4).
3. *A party's own positions* — restating what a pleading, submission, or the
   client asserts, attributed as an assertion, not endorsed as law.
4. *A labelled hunch or recommendation, never relied on* — an unverified legal
   impression may be voiced when (a) it is explicitly labelled with its grade
   and as requiring legal research: a **hunch** when it rests on training
   knowledge alone ("that might collide with the contract-law term 'invitation
   to treat' — but that's a hunch that needs legal research"), a
   **recommendation** when something already in reach prompted it — the
   practitioner's own `6. LAW\` memo, an ingested authority, a passage in the
   matter file ("the 2026-06-30 memo suggests mitigation may not apply here —
   a recommendation, not yet verified"); (b) nothing relies on it — it is never
   cited, built into work product, or used to settle a decision — and (c) it
   carries its conversion path: the moment anything will depend on it, route
   it to `research-agent`, whose return is the only grade that may be relied
   on (advice, in the vocabulary of `shared/answer-grades.md`). Both grades
   pass through the same gate. Withdrawing the point into silence is worse
   than the labelled impression — it leaves the practitioner nothing to
   assess. The label licenses mentioning, not relying: neither label cures an
   unverified statement someone intends to act on, and the reliance path still
   runs through the gate below.
5. *In-pipeline research stages* — components with their own citation-gated
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

**A caller working a `/draft` job checks its lock before every dispatch.** Immediately
before each `research-paralegal` dispatch and each audit-agent spawn or re-invocation
below, run `/drafting-data`'s lock read before a dispatch on that job. Only the caller's
own session token on the job dispatches. Anything else dispatches nothing: stop and
report. A caller holding no job skips this.

**Before spawning, run what the agent cannot.** `shared/research-priority.md` is
the binding order for every legal lookup — read it and follow it. Four duties fall
on the caller specifically, because the agent's own grant cannot discharge them:

**A statutory-text question runs duty 4 before duty 3.** A question is
*statutory-text* when it names a statute, regulation or bylaw and asks what that
instrument provides, requires, permits or lacks. For it, run duty 4 first, so the
instrument's full text is on disk before Westlaw runs. Then run duty 3, telling
`westlaw-query-optimizer` that the instrument's text is on file, so the query seeks
judicial consideration and commentary rather than the text. Then dispatch
`legislation-fetcher` for each `legislation_skipped` title not yet on disk, with one
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
   `.doc` inside the data server, with no host Python or package; a scanned PDF
   holds almost no text and comes back `ocr_unavailable`. Before each spawn
   or re-invocation, call `research_filing__law_folder_text` with the matter root
   and each issue's `6. LAW\<issue>\` folder. Pass its rows verbatim in the spawn
   prompt's `6. LAW listing and extracted text:` field, and name every
   `status: unread` row there as UNREAD with its reason. The agent records that
   file UNREAD, never absent, and caps its confidence. Where the agent's `Read`
   cannot reach the host scratchpad, as in a cloud session with the matter on the
   desktop, stage only the rows' `text_path` files, at most 50 paths per
   `device_stage_files` call, the calls in parallel, confirm every file staged,
   and name the staged paths. Never stage or convert the `6. LAW` files
   themselves.
3. **Tier 4, Westlaw — before the audit, never after it.** After tiers 1–3, for
   each issue no pinpointable text on disk answers, run Westlaw without asking unless the practitioner declined it this run:
   1. run the `westlaw-query-optimizer` subskill on the question;
   2. dispatch `research-paralegal` in **deep-research** mode with the optimized
      query, the verified client-matter ID, the jurisdiction and the issue's
      existing `6. LAW\<issue>\` folder;
   3. dispatch `research-paralegal` in **citation** mode, `source: westlaw-first`,
      for every citation already known on the issue (from the matter, a prior memo,
      or a prior research-agent answer), into the same folder;
   4. only then, once duty 4 has run, spawn the audit agent, naming the memo and
      decision files retrieved.

   One research-paralegal dispatch at a time. Where tiers 1–3
   hold pinpointable text answering an issue, skip this duty for it, recording on
   its spawn `Westlaw:` line each file and paragraph or
   page you read that answers it:
   `Westlaw: <issue>: not run: tiers 1–3 held pinpointable text: <file> para <n>[; <file> para <n>]`.
   A skip that names no pinpoint is not a skip: run this duty for that issue. The
   audit agent opens each pinpoint and returns a hand-off packet for any issue it
   does not answer.
4. **Legislation text, before the audit.** After the Westlaw duty (before it, for a
   statutory-text question), so that its
   `legislation_skipped` titles are known, dispatch the `legislation-fetcher` agent
   once for each statute, regulation or bylaw cited in the question, known on the
   issue, or listed in `legislation_skipped`. Skip an instrument whose `downloaded`
   record is already in the issue folder's `case-download-manifest.json`. The dispatch
   is `{citation?, title, kind, country, jurisdiction, locality?, destination_dir,
   matter, allow_host?}`: `destination_dir` is the issue's existing `6. LAW\<issue>\`
   folder and `matter` the live matter's file number, such as `1234.L####`, never its style of cause or a party's name: the runtime stamps it into an overlay map every matter reads. Pass the citation wherever the question, the
   matter or a memo gives one: a title alone may come back `not_located`. One fetcher
   at a time. It may run beside `research-paralegal`, because it uses no Chrome, no
   Downloads folder and no Westlaw.
   - `refused` (`host_not_allowed`): ask the practitioner once whether to allow
     fetching statutes from that host. On a yes, re-dispatch the same instrument with
     `allow_host` set to it. A no, or a second refusal, ends that instrument.
   - `stopped`: a hard stop for that one instrument. Report its reason verbatim, mark
     the instrument unread, and carry on with the question.
   - **A case-data copy, when nothing was filed.** Before marking an instrument unread
     after a stop, or after a refusal the practitioner does not lift, ask `/case-data`
     (query: which held authority carries this instrument's full text) for a copy. When
     it names one, use it in place of the fetch: its file (as an absolute host path, joined
     to the matter root when stored relative), its bundled page range if it
     sits in a book of authorities, its recorded hash, no currency marker, and
     `official: false`, whatever its source. Only with no copy is the instrument unread.

   Then, still before the audit, call the canlii `legislation_currency` tool once,
   with the citation, title and jurisdiction of every instrument in issue,
   whatever the fetcher returned for it: CanLII's metadata can show a repeal where no
   text was filed. It is a tool call, not an agent, so it waits for no Westlaw run.
   Then hold one legislation record per instrument,
   `{citation, title, path, sha256, currency_marker, currency, official}`. `title`,
   `path`, `sha256`, `currency_marker` and `official` come from the instrument's
   `downloaded` record in the issue folder's `case-download-manifest.json`, or from the
   case-data copy used in its place, and are `none` for an instrument with neither.
   `currency` comes from that call, and is `validation_unavailable` when it fails. A
   `blocked (no-api-key)` status gives every instrument `validation_unavailable`;
   relay its two key paths to the practitioner.

   Record every instrument in the spawn prompt's `Legislation:` field.

**Westlaw unreachable is a hard stop.** If research-paralegal returns
`status: blocked (chrome-not-connected)` or `status: blocked (westlaw-not-signed-in)`,
stop the whole question: no audit-agent spawn, no CanLII step, and no `canlii-only`
download or CanLII sweep in Westlaw's place. Tell the practitioner in plain words:

- `chrome-not-connected`: "Westlaw research is needed and Chrome isn't connected.
  Open Chrome and sign in to Westlaw, then tell me to continue."
  If its `detail:` line is `chrome-tools-absent`, say instead: "Chrome can't be reached from this session. Run this research step from a Claude Code session."
- `westlaw-not-signed-in`: "Westlaw research is needed and Westlaw isn't signed in.
  I've opened the Westlaw sign-in page in Chrome. Sign in, then tell me to continue."

On "continue", re-dispatch the same research-paralegal run. The paralegal's
fail-closed client-matter gate (`status: blocked (matter-mismatch)`, or
`status: blocked (client-id-not-on-westlaw)` with its one-line instruction) is a genuine
stop too, reported as such. Neither stop is the hand-off-packet carve-out below.

**Spawn the agent from this template.** Fill every field. Never name CanLII as a
place to read or check decisions: CanLII serves no decision text.

```
Question: <the legal question>
Facts: <the factual context>
Origin: <draft file path or Writing id>: "<the draft's words the question came from>" / none
Matter root: <path>
Asked by: <the practitioner's name>
Date: <today, YYYY-MM-DD, from the host clock>
Memo template: CREAC / IRAC / CRAC   (IRAC or CRAC only when the practitioner expressly asked)
File stem: YYYY-MM-DD ML re <two to six keywords from the question>
Pooled-layer results: <results> / not installed / NOT AUDITED: <reason>
Preflight: all ok / <row>: <state>[; <row>: <state>]
Westlaw: <issue>: run, memo(s): <paths>; decisions: <paths> / not run: tiers 1–3 held pinpointable text: <file> para <n>[; <file> para <n>] / not run: practitioner declined
Legislation: <citation>: filed <path>, current to <marker>, currency <value> / already on disk <path>, currency <value> / not retrieved: <reason>, currency <value> / on disk from case data <path>[, pp. <X–Y>], official: false, currency <value>
6. LAW listing and extracted text: <the listing, and the text or text path of each file extracted or staged>
Re-invocation: no / yes: Westlaw did not return <citations, or none>; paralegal: <its status line, or practitioner declined>
Decision text is on disk at the paths above. Use CanLII for citator note-up only.
Legislation text is on disk at the paths above.
If you need a decision that is not on disk, return needs_download, unless Re-invocation is yes: then offer it as research instead.
A layer the Preflight line names is capped from the start: commons reads NOT AUDITED: <its state>, CanLII reads no key. Make no call to it.
```

`Preflight:` carries the `/legal-research` gate's step 0 result: `all ok`, or each row
that is not ok with its state (`commons: missing_credential`, `canlii: no_key`,
`extractor.pdf: missing`, `extractor.docx: missing`, `knowledge_tree: error`).

`Matter root:` is the matter folder's host path, the folder holding `coclerk.json`,
in the same host form `research_filing__save_answer` takes, because the agent passes
it to `research_filing__write_scratch`. `Asked by:` is the practitioner who asked:
if you do not know the name, ask once.
`Origin:` names the draft the question came from, a plain draft file's path or a Writing's
id, and quotes the draft's words the question is about, verbatim. A caller that took the
question from a draft, a `/verify-law` sweep line included, fills it. Every other question
carries `Origin: none`.
`Re-invocation` is `no` on the first spawn and `yes` only on the one re-invocation below.
Write one `Westlaw:` line per issue.
Write one `Legislation:` line per instrument, and `Legislation: none` when no instrument
is in issue.

**A `needs_download` or hand-off-packet return is a pipeline step, not a closed
gate.** When the agent returns a `needs_download` list or a hand-off packet on an
issue of the question, execute it without asking, whatever its other gaps
(a declined issue dispatches nothing):
dispatch `research-paralegal` in
citation mode, `source: westlaw-first`, for the `needs_download` citations, and run
a hand-off packet through `westlaw-query-optimizer` and a deep-research dispatch.
Then re-invoke the same audit agent once, naming the new files, with
`Re-invocation: yes` listing every citation the `westlaw-first` dispatch did not
retrieve (`none` when it retrieved them all). Only a gate still
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
preliminary impression), and the practitioner chooses among them.

**After the answer, the caller persists it.** This rule covers the return of
the `research-agent` agent, or whichever law-audit agent the gate dispatched.
Any such return that states law with pinpoint citations is persisted, and so is
a Mixed-coverage return (one saying "More research is needed on the following
issues"), which is not a closed gate even where it reports layers unavailable.
Verified pinpoints are not a precondition: filing its cited decisions puts on
disk the full text that verifying them needs.
Persist in this order. Steps 2 and 3 need not interrupt the work in hand, but they
complete before the session ends: never leave a session with a cited decision unfiled.

1. Save it verbatim: the memo, from its `---` header line to the end of the return,
   with only the trailing `Files:` list and "Nothing new to remember" note omitted,
   nothing added and nothing else of it removed, as `<File stem>.md` (the spawn
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
   saved, so stop and report.
2. For every court decision the answer cites (in support, distinguished, or
   rejected) that case data does not already hold and that is not already on disk
   under the matter's `6. LAW\` (the pre-spawn Westlaw retrieval usually filed it),
   dispatch `research-paralegal` in
   citation mode, `source: canlii-only`, with that same research folder as the
   destination, whichever issue the decision is cited on. Step 1's save means the
   folder exists before dispatch. Batch as its playbook allows, one dispatch at a time.
3. Run `/ingest` on each cited decision file case data does not hold, whether it
   was downloaded now or before the audit, and on each legislation file
   `legislation-fetcher` filed in this run. A Point in Time page or bulletin it
   filed beside a consolidation is a currency record, not an authority: never ingest it.

**Without the `litigator` plugin.** `/case-data` and `/ingest` ship in `litigator`. When
the `case-data` skill is not available in this session, nothing in this file that asks
`/case-data` or runs `/ingest` applies: there is no held copy to ask for, nothing is
ingested, a cited decision is accounted for as "not ingested: needs the `litigator`
plugin", and a `case-data:` flag is relayed with no offer to record it.

In your relay, account for every court decision the answer cites -- already held,
ingested now, or "not on disk, not ingested" -- and for cited legislation. A decision
never dispatched is reported the same way as one whose download failed: a decision you
did not persist is never passed over in silence. The answer file itself is never ingested.
It is a lead, not an authority, and ingesting it would let the next audit cite it at
tier 1. A closed gate saves and ingests nothing. If the practitioner then asks for
the preliminary impression, the return it produces is persisted by the same rule,
as `<File stem> (preliminary).md`.

Relay each `case-data:` flag in the return's notes in one line: its kind, its
description and its evidence ids, with the offer to record it through `/case-data`.
Record nothing without the practitioner's yes. A `/draft` session holding a job
handles them by its own rule instead (`/draft` `references/job-session.md`,
"Case-data flags in a research return"). A return with no flag adds no line.

**With an origin, the return's open items go on the board.** This step runs after the
persistence steps above, for a return they persisted, when the spawn prompt's `Origin:` was
not `none` and the caller holds no `/draft` job. A `/draft` session holding a job captures by
its own rule instead (`/draft` SKILL.md section 14, "Captured ideas"). Capture these as loose
threads through `/drafting-data`'s capture with no job held, in the same turn the return
arrives, each verbatim from the return and at most five sentences, with no recommendation:

- each `origin-correction:` line in the notes, one thread each;
- each Step 5 offer, `live_issue: yes` or `no`, one thread each;
- each `case-data:` flag: every `pinpoint` flag together as one thread, each other flag its
  own. The one-line offer above to record it through `/case-data` is still relayed.

Name the saved answer file as what surfaced each one. Never edit the draft. A captured thread
is never ripe, never a blocker and never assigned to anyone: only a later `/draft` outlining
session takes it up. The board is the one `/drafting-data` resolves from the origin: a
Writing's own filing, or, for a plain draft file, the proceeding it serves. When none
resolves, capture nothing, relay as below with every offer, and say in one line that the
matter has no board to capture to.

Then relay the confidence summary and the `live_issue: yes` offers, each word for word, and
one line counting the rest: `<n> more offers are on the board as loose threads.` Name each
`origin-correction:` line's issue in one line pointing to the board, never restating the
memo's words as advice on the draft. Only offers that landed on the board are left out of
the relay. A return with `Origin: none` is relayed as before this step existed.

**Statute currency.** In a research question the check runs at the end of duty 4.
When a caller such as `/draft` asks for a currency check on its own, call the canlii
`legislation_currency` tool with each instrument's citation, title and jurisdiction,
and hold the same legislation record per instrument as duty 4 does.

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
`current` reads as confirmed. Any other value, or a call that fails, reads
unconfirmed (`shared/statute-currency.md`). This runs in the same `/legal-research`
call as any verification of a statement on the instrument. The filed file's own
"current to" marker is leg 3 of `shared/statute-currency.md` and never confirms on
its own.

Relay every instrument's record to the caller in this fixed shape, one line per
instrument, `none` for a field with no value:

```
Legislation records:
- citation: <citation> | title: <title> | path: <path> | sha256: <sha256> | currency_marker: <marker> | currency: <value> | official: <true / false> | key: <key> | provisions: <pinpoint>; <pinpoint> / none
```
