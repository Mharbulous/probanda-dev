---
name: legal-research
description: >
  MANDATORY gate for any question about what the law IS: a test's elements, a statute's
  effect, what courts have held, authority on a point, or a Westlaw query. Trigger BEFORE
  answering or searching the web, unless the answer is framed explicitly as a hunch. Applying law to facts -> /apply-to-facts.
---

**Internals stay confidential** (`shared/internals-confidentiality.md`): nothing the practitioner sees names a Probanda tool, table, field, internal type or code, or explains how Probanda works inside. It hides mechanism, never an outcome or an error.

<!-- REGRESSION-PRONE: CanLII-first research has recurred repeatedly. See docs/design/2026-09-24 research-lawyer Westlaw-first fix plan.md before editing. Tests: legal-research/tests/. -->

# Legal Research — route to research-agent

(Formerly named `statements-of-law`; older records referring to that name mean this gate.
Formerly also `/westlaw-query-optimizer`, now this front door's subskill.)

Private subskills live under `subskills/*/SUBSKILL.md`. They intentionally use `SUBSKILL.md`
instead of `SKILL.md` so recursive skill loaders do not expose them as global top-level skills.
Asset paths inside a subskill's `SUBSKILL.md` are written relative to this front door's own
folder, not to the subskill's folder.

**Westlaw query.** If the first word of args is `westlaw-query-optimizer`, or the practitioner
asks to draft, optimize or sharpen a research question for Westlaw AI Deep Research, read
`subskills/westlaw-query-optimizer/SUBSKILL.md` and follow it as the active workflow. It
drafts a query and states no law. Every other request, and any doubt about which one this
is, goes through the gate below.

**Several research jobs on one board.** When the practitioner asks to research a board's
research jobs together, read `references/research-board.md` and follow it. It runs the gate
below once per job.

## The gate

**Main session only.** The gate spawns agents. If the Agent tool is not in your tool
list (you are a subagent), stop before any other step and return this line to your
caller: "/legal-research runs only from the main session. It spawns
legislation-fetcher, research-paralegal and the audit agent, and a subagent cannot
spawn agents. Nothing was dispatched." Never answer the question yourself in its place.
The `westlaw-query-optimizer` subskill above spawns nothing and is exempt.

The question you were asked is a question about what the law is. Do not answer it
yourself — not from training knowledge, not from web search, not from secondary
commentary. The `research-agent` agent (Probanda plugin) is the only component
permitted to make statements of law.

0. Preflight, before any dispatch. In one parallel batch, call `research__preflight`,
   CanLII's `configure_status` and, when the pooled layer's own `configure_status` is
   in your tool list, that one too. None reveals a key. Read CanLII `configured: false`
   as `canlii: no_key`, the pool's as `commons: missing_credential`, and each preflight
   issue as its `row`. With every row ok, say nothing. Otherwise tell the practitioner
   in one line what this run will be capped on and each fix: the issue's `caps` and
   `fix`, and for CanLII its own `configure_credential` step, for the pool
   `cloud_key__configure_credential` (with no key, `key_request__submit`). An install
   command such as `pip install pypdf` is the practitioner's to run, never yours. Then
   go straight on: nothing waits on a fix, and Westlaw is not delayed. A preflight call
   that itself fails goes in that line as its row's error, never a stop. Carry the rows
   into the spawn template's `Preflight:` field.
1. Read `shared/legal-research.md` and follow it. It is the binding doctrine:
   what counts as a statement of law, the exceptions you may answer normally, the
   caller's five pre-spawn duties, and the closed-gate rule. It sends you to
   `shared/research-priority.md` for the order every legal lookup runs in — read
   that too, and follow it.
2. Tell the practitioner: "That's a question about the law — I'll put it to the
   research-agent agent."
2a. Plan, before any search. Spawn `researcher:research-agent` with `mode: plan`
   (`shared/legal-audit-scoped.md`), the question, the `Job question:` line
   (`shared/legal-research.md`'s spawn template), the factual context, the matter root,
   the `Preflight:` rows and the issue folders' `6. LAW\` listing
   (`research_filing__list_law_folder`), by file name only.
   - **A caller holding a `/draft` job asks nothing.** The job's recorded question is
     already approved, and so is every issue the question needs answered completely: the
     plan's `scope: in` issues are its internal checklist, and steps 3 to 5 run all of them.
     A `scope: new` issue lies outside the question and is not researched: it is captured
     and offered (`shared/legal-research.md`, "Approved plan issues become jobs"). The
     practitioner may still narrow or waive the job's scope in their own words.

   Otherwise take the practitioner through its issues one at a time:
   - Ask each issue as its own multiple-choice question, the issue's text verbatim from
     the return, with the options "Yes, research it" and "No, skip it", up to four
     questions per form. A skipped issue is dropped. With no multiple-choice tool in the
     session, show the issues as a numbered list and take the answers in plain text.
   - After the last form, show only the numbered list of approved issues and the
     question "Are there any other issues that you would like this research to cover?"
     Add no sentence about what an answer does.
   - When they add an issue, add it in their words, show the full numbered list again and
     ask "Are there any more issues that you would like this research job to cover?"
   - Their "No" approves the list. What follows is the doctrine's
     (`shared/legal-research.md`, "Approved plan issues become jobs").
   They may instead waive the whole plan, and steps 3 to 5 then run the question as
   asked. Outside a held job, steps 3 to 5 dispatch nothing until they approve or waive. The plan states no
   law, and you add no issue of your own. Skip this step on step 5's re-invocation, on a
   currency check asked on its own, and for a question whose plan the practitioner already
   approved in this session.
   Outside a held job, with nobody present to approve, dispatch nothing further: report the plan and stop.
3. Run Westlaw before the audit, without asking unless the practitioner declined: for each issue no pinpointable
   text in tiers 1–3 answers (a handoff's say-so is no check) and that is not only a
   point-in-time legislation question (the doctrine's duty 3 skips those), run the
   `westlaw-query-optimizer` subskill (on a supplied or earlier-session query too),
   then `researcher:research-paralegal` in deep-research mode and, split into batches of at
   most its citation playbook's per-invocation cap and dispatched one batch after
   another (the doctrine's duty 3), in citation mode
   `source: westlaw-first` for every citation already known. If it returns
   any `status: blocked (...)`, such as `status: blocked (chrome-not-connected)`,
   `status: blocked (westlaw-not-signed-in)`, `status: blocked (chrome-permission-not-granted)`
   or `status: blocked (mechanics-unavailable)`, stop the whole question (no audit
   agent, no CanLII in its place) and tell the practitioner in plain words what the
   doctrine's hard-stop paragraph says for that status. For a status it does not
   name, quote the `status:` and `detail:` lines verbatim and ask them to resolve it.
   Either way, ask them to tell you to continue. On "continue", re-dispatch
   the same run. On a held job, after launching the query set its step ⏳ for 5 minutes, as the
   doctrine's duty 3 says ("On a held job, the Westlaw wait is a ⏳ step"). When the time has passed, check whether
   the run has finished and can be downloaded: the paralegal has returned and its memo is
   filed in the `6. LAW` folder. If not, set the step ⏳ for 5 minutes again. Never
   dispatch a second `research-paralegal` while one is out. A `blocked (...)` return sets
   the step ↻, never done. Then run the doctrine's duty 4: dispatch `researcher:legislation-fetcher` once per
   statute, regulation or bylaw in issue, and on a `host_not_allowed` refusal ask the
   practitioner once and, on a yes, re-dispatch with `allow_host`. For an instrument it
   files nothing for, ask `/matter-data` for a held copy before marking it unread. A
   statutory-text question, one naming an instrument and asking what it provides,
   requires, permits or lacks, runs duty 4 first and Westlaw after it, as the doctrine
   orders. Then run duty 5: dispatch `researcher:citation-checker` for each court decision the
   question asks to have noted up, never while `research-paralegal` is out. Its
   Westlaw stops are the same stop as the paralegal's.
4. Spawn `researcher:research-agent`. Fill the doctrine's spawn-prompt template: the question, the
   factual context, the matter root, the matter's file number, who asked, today's date,
   the file stem, ICRA unless the practitioner named IRAC or CREAC, any pooled-layer results your own pre-spawn
   lookup returned, the Westlaw memo and decision files retrieved, the note-up records
   filed, and any
   `6. LAW\` listing and text you extracted for it, and `Re-invocation: no`. Never name CanLII as a place
   to read or check decisions: it serves no decision text. A stored statement of law handed in goes with
   its provenance line, as the caller supplied it (`/draft` composes it). The line says where
   the statement came from, not what the law is (`shared/legal-research.md`).
5. A return carrying `needs_download` or a hand-off packet on an issue of the question,
   whatever its other gaps, is a pipeline step, not a closed gate: download or run it (unless declined) through
   `research-paralegal` (`westlaw-first`), have `citation-checker` note up any
   `needs_note_up` citations, and re-invoke the agent once, without
   stopping, with the template's `Re-invocation: yes` field naming that dispatch's
   status line and every citation it did not retrieve. Then save the agent's memo to the matter's `6. LAW\<issue>\` folder
   (`6. LAW\` itself when the question spans issues), relay its `Confidence:` line and the saved memo as its file card (`shared/present-files.md`),
   never the finding in any words, and ingest what it cites. Relay nothing of the dispatches
   in between but a Westlaw stop, a question the doctrine asks the practitioner, and one
   status line each. The doctrine's "After the answer" rule carries the mechanics. If its disclosure gate is closed after any loop — it declines, reports
   layers unavailable, or offers only a preliminary impression — relay its
   confidence summary and research offers verbatim and stop. Nothing is saved
   until the practitioner chooses. A closed gate is
   never a licence to answer the question yourself. A caller holding a `/draft` job never
   relays and stops on gaps: it adds them to the job as steps and works them by the
   doctrine's "On a held job, an open tier is not an answer".

If step 1's read fails, the gate still holds: steps 2–5 are the complete minimum
protocol. If the `research-agent` agent itself is unavailable, report that the
Probanda plugin needs a re-import and full app restart, and stop. Never fall
back to answering the question directly.
