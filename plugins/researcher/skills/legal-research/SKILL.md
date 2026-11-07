---
name: legal-research
description: >
  MANDATORY gate for any question about what the law IS: a test's elements, a statute's
  effect, what courts have held, authority on a point, or a Westlaw query. Trigger BEFORE
  answering or searching the web, unless the answer is framed explicitly as a hunch. Applying law to facts -> /apply-to-facts.
---

<!-- researcher v0.16.9 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). `${CLAUDE_SKILL_DIR}` is the directory holding this SKILL.md, even where it shows unsubstituted: never search for it or guess. Read references and shared files from there with the Read tool, a whole file or an offset and limit, never with a shell command, the litigation data server's skill-source tool or a folder-access request; scripts and templates the text declares are executed and read from there too. Before each fresh read (a file not already in context), list only `${CLAUDE_SKILL_DIR}/../../..` (the folder holding this plugin's folder). If it holds this plugin's folder name, with any `~g<N>` suffix removed, plus a `~g<N>` higher than this plugin's folder's own (none counts as 0), or if `${CLAUDE_SKILL_DIR}` no longer exists, the plugin was re-synced mid-session: take the highest `~g<N>` copy and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, authors or requests a screenshot of one, but may present one to a human user to view, staging it first where presenting needs that, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

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

**No arguments.** List the matter's unfinished research jobs by `references/research-board.md`,
"Unfinished jobs", then stop. Ask no question and start no research.

**Noting up a memo's paragraphs.** When the practitioner asks to note up the propositions or
findings in numbered paragraphs of a saved research memo ("note up the propositions in
paragraphs 4 and 5"), follow `shared/legal-research.md`, "Proposition-level note-up".

## The gate

**Main session only.** The gate spawns agents. If the Agent tool is not in your tool
list (you are a subagent), stop before any other step and return this line to your
caller: "/legal-research runs only from the main session. It spawns
law-getter and the audit agent, and a subagent cannot
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
   caller's five pre-spawn duties, and the memo-reviewer loop. It sends you to
   `shared/research-priority.md` for the order every legal lookup runs in — read
   that too, and follow it.
1a. Job, before any dispatch. Follow the doctrine's "Research runs only under a job": with no job
   held, propose the issue and write and assign the job on the practitioner's approval; on a held
   job not in the form, run the migration review. Skip this on step 5's re-invocations and on the
   routes that doctrine lists as their own.
2. Tell the practitioner: "That's a question about the law — I'll put it to the
   research-agent agent."
2a. Scope, before any search. Check the question by the doctrine's "A research question
   holds one question". Whenever the practitioner raises another question, here or at any
   later step, follow its "A new question is a new job or a new scope". A held job's
   recorded question is already approved: ask nothing else. Skip this on step 5's
   re-invocations and on a currency check asked on its own.
3. Run Westlaw before the audit, without asking unless the practitioner declined: for each issue no pinpointable
   text in tiers 1–3 answers (a handoff's say-so is no check) and that is not only a
   point-in-time legislation question (the doctrine's duty 3 skips those), run the
   `westlaw-query-optimizer` subskill (on a supplied or earlier-session query too),
   then `researcher:law-getter` in `mode: deep-research` and, split into batches of at
   most its citation playbook's per-invocation cap and dispatched one batch after
   another (the doctrine's duty 3), in `mode: citation`
   `source: westlaw-first` for every citation already known. If it returns
   any `status: blocked (...)`, such as `status: blocked (chrome-not-connected)`,
   `status: blocked (westlaw-not-signed-in)`, `status: blocked (chrome-permission-not-granted)`
   or `status: blocked (mechanics-unavailable)`, stop the whole question (no audit
   agent, no CanLII in its place) and tell the practitioner in plain words what the
   doctrine's hard-stop paragraph says for that status. For a status it does not
   name, quote the `status:` and `detail:` lines verbatim and ask them to resolve it.
   Either way, ask them to tell you to continue. On "continue", re-dispatch
   the same run. On a held job, run the Westlaw wait as the doctrine's duty 3 says ("On a held job,
   the Westlaw wait is a ⏳ step"): tell the practitioner how long a run takes, and stamp
   the step from law-getter's return. Never dispatch a second Chrome-mode `law-getter`
   while one is out. Then run the doctrine's duty 4: dispatch `researcher:law-getter` with `mode: legislation` once per
   statute, regulation or bylaw in issue, and on a `host_not_allowed` refusal ask the
   practitioner once and, on a yes, re-dispatch with `allow_host`. For an instrument it
   files nothing for, ask `/matter-data` for a held copy before marking it unread. A
   statutory-text question, one naming an instrument and asking what it provides,
   requires, permits or lacks, runs duty 4 first and Westlaw after it, as the doctrine
   orders. Then run duty 5: dispatch `researcher:citation-checker`, in duty 3's batches, for each court decision the
   question asks to have noted up, never while a Chrome-mode `law-getter` is out. Its
   Westlaw stops are the same stop as law-getter's.
4. Spawn `researcher:research-agent`. Fill the doctrine's spawn-prompt template: the question, the
   factual context, the held job's number, the matter root, the matter's file number, who asked, today's date,
   the file stem, ICRA unless the practitioner named IRAC or CREAC, any pooled-layer results your own pre-spawn
   lookup returned, the Westlaw memo and decision files retrieved, the citator lines citation-checker
   returned, and any
   `6. LAW\` listing and text you extracted for it, and `Re-invocation: no`. Never name CanLII as a place
   to read or check decisions: it serves no decision text. A stored statement of law handed in goes with
   its provenance line, as the caller supplied it (`/draft` composes it). The line says where
   the statement came from, not what the law is (`shared/legal-research.md`).
5. A return carrying `needs_download` or a hand-off packet on an issue of the question,
   whatever its other gaps, is a pipeline step, not an answer: download or run it (unless declined) through
   `law-getter` (`mode: citation`, `westlaw-first`), have `citation-checker` note up any
   `needs_note_up` citations, and re-invoke the agent once, without
   stopping, with the template's `Re-invocation: yes` field naming that dispatch's
   status line and every citation it did not retrieve. Then have `researcher:memo-reviewer`
   check the memo and run each piece of research it sends back, re-invoking the agent on each
   send-back, at most three reviews, by the doctrine's "On a held job, an open tier is not an
   answer" and "memo-reviewer checks every memo before it is saved": each piece of research
   becomes a step on the held job. Then save the
   memo the loop ends on to the matter's `6. LAW\<issue>\` folder, relay its `Audit:` line and the saved memo as its file card (`shared/present-files.md`),
   never the finding in any words, and ingest what it cites. Relay nothing of the dispatches
   in between but a Westlaw stop, a question the doctrine asks the practitioner, and one
   status line each. The doctrine's "After the answer" rule carries the mechanics. An
   `INCOMPLETE` memo is never a licence to answer the question yourself.

If step 1's read fails, the gate still holds: steps 2–5 are the complete minimum
protocol. If the `research-agent` agent itself is unavailable, report that the
Probanda plugin needs a re-import and full app restart, and stop. Never fall
back to answering the question directly.
