---
name: prepare
description: >
  Open a BCSC application at bundle level and outline its surrounding work as jobs: the forum,
  the lead Writing (a Notice of Application or an Application Response), its drafting jobs, and
  the stock jobs for the availability letter, filing and service, and the application book.
  Re-run in stages: at the opening, after the pre-filing gate job completes, and after responses
  arrive. Outlining only: it drafts no document, is never assigned a job, and never touches
  dates. Drafting a Writing's substance or working a job -> /draft. A date or deadline ->
  the docket-clerk agent, in a separate session.
---

<!-- litigator v0.7.2 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: it means the directory containing this SKILL.md, not a placeholder to search for or guess. Read references and shared files natively from there, never over the litigation data server's skill-source tool and never by requesting folder access; scripts and templates the text declares are executed and read from there too. If `${CLAUDE_SKILL_DIR}` itself no longer exists, the plugin was re-synced mid-session: list only `${CLAUDE_SKILL_DIR}/../../..` (the folder that held this plugin's folder), take the folder named as this plugin's folder with any `~g<N>` suffix removed plus the highest `~g<N>`, and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, stages, authors or requests a screenshot of one, but may present one to a human user to view, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

## Contents

| Section | Read when |
|---|---|
| 1. What it never does | Always |
| 2. Enter the matter | Every session, first |
| 3. What it writes, in this order | Writing the forum, the lead Writing or the jobs |
| 4. Stages | Deciding which stage this session is |
| 5. The outlining interview | Interviewing the practitioner about the application |
| 6. Stock bundle jobs | At the closing read-back, offering the stock jobs |
| 7. Persistence rule | Always: any job text, rank, idea or handover |
| 8. Close | Writing the chosen jobs at the end |
| 9. Doctrine bindings | Before pausing for input, or asserting law, a deadline or a billing anchor |

# Prepare an application

`/prepare` outlines an application as a whole: the lead Writing and the work around it. Every session is an **outlining session at bundle level**. It writes structure and jobs, and nothing else. The jobs it leaves are worked later, one per session, in `/draft` sessions the practitioner opens.

Built for the BCSC **Notice of Application** and **Application Response** only. The other Writing kinds (VanIAC submissions package, requisition, BCCA stay response, BCCA factum) are not covered: say so in one line and stop, and the practitioner can open them in `/draft`.

## 1. What it never does

- Never drafts any document, never writes substance, and never invokes `/draft` per document. Each surrounding piece is a job, or a Writing of its own, that a later session works.
- Is never assigned a job. An outlining session never assigns itself one.
- Never calls a deadline tool, for any purpose, including recording a past event. A hook on the drafting lane refuses it, but the hook fails open and is only the backstop. This rule is the rule. To record a date the practitioner gives, spawn `lawyer:docket-clerk` once and relay its reply verbatim; it returns only a count (`shared/deadline-isolation.md`, "Calling docket-clerk").
- Spawns no sessions and no chips, and hands nothing off inside the session.
- Is not the triage seat. Whether and when to start or file stays with `task-prioritization`, `/executive-assistant` and the practitioner, before the session opens.
- Never touches the database except through `/drafting-data`. This skill names no table, column or query. Every write follows `.claude/skills/drafting-data/SKILL.md` "Job and scrutiny operations", cited by section below, and the gatekeeper's own references for the forum and the Writing.

## 2. Enter the matter

Enter exactly as `/draft` enters (`.claude/skills/draft/SKILL.md` §6): the same single session-entry call, the same refusals and response handling, and the same values kept for the whole session, including the session identity token. Then find the lead Writing:

- **No proceeding exists, or a proceeding has no Writing:** start the proceeding or Writing as `/draft` §7 allows ("section 8 also runs when the practitioner asks to start a proceeding or Writing") and run `/draft` §8's proceeding-identification step as written (ADR 0018). Nothing is restated here.
- **The lead Writing already exists:** open it by name, as `/draft` §7 does, and render its Job Board (`/draft` §11). Where the Writing session entry opens first is not the lead Writing, use the named-Writing path or the Writing picker of `/draft` §7 to reach it.
- **No Notice of Application or Application Response is in view, and the practitioner is not starting one:** stop, as the introduction says.
- **The practitioner asks for a Job Board with no Writing** (work that is not a document, on a proceeding that has a Writing): `/prepare` opens none. Say in one line that `/draft` opens it (`/draft` §8), and stop.

## 3. What it writes, in this order

Structure only, each written through `/drafting-data`:

1. **The forum, when the proceeding has none.** A type that needs forum parts needs a forum, and both Writing kinds `/prepare` handles need forum parts, so neither can be created until the forum is chosen. It is set by updating the same proceeding, per `/draft` §8 "Before the forum is chosen".
2. **The lead Writing,** with `/draft` §8's recovery check first. On recover, no Writing is created: continue at stage 1 on the recovered Writing, from its rendered Job Board. `/draft` §8's response seam captures substance, so `/prepare` does not run it. Where the practitioner wants it done, it is work to outline as a job. §8's kind-specific specifics apply to no kind `/prepare` handles.
3. **The jobs,** through `/drafting-data` §3's create idiom, only after the closing read-back.

Anything else the practitioner raises is a job to outline, or an idea to capture, never a write.

## 4. Stages

Post-gate work cannot sit on the board from the start. A waits-on link to a gate job that does not exist yet cannot be written, and file and serve has nothing to follow until a gate has passed. So `/prepare` is re-run in stages, each one its own outlining session. Each stage offers only the stock job for its stage (section 6).

| Stage | Triggered when | Notice of Application | Application Response |
|---|---|---|---|
| 1. Opening | The bundle is being opened: no lead Writing yet, or the practitioner opens the bundle on an existing one | Forum when unset, the Writing, its drafting jobs, `Availability letter` | Forum when unset, the Writing, its drafting jobs |
| 2. After the gate | The lead Writing's Job Board shows its pre-filing consistency gate job completed (`drafting_forms__board_card` with `lanes: ["completed"]`) | `File and serve` | `File and serve` |
| 3. After responses | The practitioner says the responses have arrived. Never inferred | `Application book` | None. The book is applicant-only |

Read the stage off `drafting_forms__board_card`, with `lanes: ["live"]` for the live lanes and `lanes: ["completed"]` for completed jobs, and the practitioner's own words, never off a date. A stage whose stock job the lead Writing's board already shows, in any state but superseded, does not offer it again.

## 5. The outlining interview

Run `/draft`'s outlining branch (`.claude/skills/draft/references/job-session.md` Branch B) at bundle level: the application as a whole, what is sought and against whom, what evidence is in hand, what must be in place before it is heard, and each captured idea. Its rules hold here unchanged: one question at a time, answers recorded in the practitioner's words, nothing proposed, a Proposal picked handled as Branch B says, legal views recorded as the practitioner's propositions, and the closing read-back as the only confirmation. Where Branch B's text and the one-session-one-role rule differ, take the stricter rule.

- **Past events** are read from the matter's `ProceduralHistory.md` and are content. Run its currency check as Branch B does (`.claude/skills/shared/procedural-history.md`), and never ask the practitioner to recount what happened. Never look a date up through deadline work.
- **What waits on what** is the session's call, recorded as waits-on links, as in Branch B. A link to a job is written only once that job exists.
- **Order** is never asked, as Branch B never asks it. Jobs that depend on each other take their order from the dependency, the rest are worked in parallel, and each job's place in the Ready order is set by `/drafting-data` §3's rule against what is already queued on the lead Writing, never computed from time remaining. An order the practitioner volunteers is recorded.
- **Billing anchor:** each job carries the live issue it serves, by the live-issue test, asked once only when it cannot be inferred from the Writing in hand (`/drafting-data` §3).

**Scope: every bundle-level job is scoped to the lead Writing** (the Notice of Application or the Application Response), never proceeding-wide. The lead Writing's Job Board and its completion criteria are the completeness tracker. There is no stored bundle record. A proceeding-wide bundle job would show on every later Writing's board and survive this Writing's retirement. A second Writing in the bundle, such as a requisition, has its own Job Board, and a waits-on link ties the two where they move in step.

## 6. Stock bundle jobs

Fixed-text jobs, offered per Writing kind and per stage:

| Writing kind | Stock jobs |
|---|---|
| Notice of Application | `Availability letter` (stage 1), `File and serve` (stage 2), `Application book` (stage 3) |
| Application Response | `File and serve` (stage 2) |

- **Their text is `/drafting-data` §3b's**, the whole record of each job's title, intent and steps. Take it from there at the moment of writing, character for character. Never reword, shorten or restate it, and never compose steps of your own for one. A practitioner who wants different words is outlining an ordinary job in their own words, which is not a stock job.
- **Offered at the closing read-back** as cards beside the practitioner's own jobs, each carrying its fixed title. The practitioner picks or declines each. The pick is the approval, as on the fast path. A declined stock job is not written. No card starts picked.
- **Written through `/drafting-data` §3b**, which fixes their scope to the lead Writing and how each is written.
- **The availability letter** is drafted by a `/draft` session that takes the job from the board. Sending it is the practitioner's step. `/prepare` never proposes hearing dates.

## 7. Persistence rule

No deadline, and no value derived from one, in any job's title, intent, plan or steps, in its place in the Ready order, in a captured idea, or in a handover. A job's place in the Ready order is never set from a date. A hearing date the practitioner gives as the Writing's own content is content, and this rule does not reach it, but it is never copied into a job.

If the practitioner states a deadline anyway, acknowledge it once in one sentence, per `shared/deadline-isolation.md`, and never restate it.

## 8. Close

Write the chosen jobs in dependency order, blocker before blocked, per Branch B's closing read-back. Then render the lead Writing (`/draft` §11); the lead Writing's own Job Board page updates. Close with one line, never a chat summary.

## 9. Doctrine bindings

The same shared doctrines `/draft` binds (`.claude/skills/draft/SKILL.md` §3), read at the point of use and not restated:

| Doctrine | Path | Binds where |
|---|---|---|
| Elicitation widget convention | `shared/elicitation-widget.md` | Every pause for practitioner input, including the stage question and the closing read-back form. |
| Paralegal posture | `shared/paralegal-posture.md` | The whole interview. The practitioner supplies everything the record cannot; the session proposes from the record and the practitioner approves or changes it. The session asks, records and reads back. |
| Deadline isolation | `shared/deadline-isolation.md` | Every turn. `/prepare` is in the drafting lane. |
| Statements of law | `shared/legal-research.md` | Any assertion about what the law requires goes to `/legal-research`. A legal view the practitioner states is recorded as their proposition. |
| The live-issue test | `shared/live-issue-test.md` | Each job's billing anchor. |
| Job planning | `shared/job-planning.md` | The steps of each job written at the closing read-back. A stock bundle job keeps `/drafting-data` §3b's fixed text. |
| HTML pages | `shared/html-pages.md` | Every turn. The lead Writing's board is read from `board_summary` and `drafting_forms__board_card`, never from a page, and no page is presented, staged or asked for as a screenshot. |

**No-blocking-checkpoint rule,** as `/draft` §3 states it: writing and rendering never pause for approval. The closing read-back is itself the confirmation, with no separate approve step after it.
