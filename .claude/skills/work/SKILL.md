---
name: work
description: >
  Open a matter's Job Board and take, take over, release, shelve, restore or bring forward its jobs: drafting, research, delivery, filing and other work. Use when the practitioner asks to work the Job Board, take the next job, pick up or hand back a job, outline new jobs, or rank the loose threads. Hands each job to the skill that works it. Drafting a letter, email, memo or filing -> /draft.
---

## 1. What this skill is

<!-- atom id=work.what ops=always -->
The Job Board's entry. It enters the session, opens the matter's Job Board, chooses or takes a job, runs the checks before the assigning write, assigns it, and hands it to the skill that works it. It also outlines new jobs and applies the board's bookkeeping: shelve, restore, release, delete, bring forward, the statement of goals and the loose threads. It drafts nothing and works no job's steps itself.

These rules moved from `/draft` verbatim. A file, section or part of SKILL.md they name that this skill does not hold is `/draft`'s, in its file of the same name: section 14 is this skill's `references/dispatch.md`, sections 6 and 7 its `references/procedure.md`, and every other section number is `/draft`'s.

<!-- atom id=work.bounds ops=always -->
**What binds here.** `/draft`'s SKILL.md sections 2 and 3, its hard prohibitions and its doctrine bindings down to "Rules for each step", bind every turn of this skill as they bind `/draft`'s. Read them once, before the first act they bind, and never the rest of that SKILL.md. This skill never calls `skill_rules__applicable` with `skill: "draft"`.

<!-- atom id=work.hand-off ops=always -->
**Hand-off.** Once a job is assigned, a take-over included, and its premise check has run, hand it in the same turn, with the Skill tool, to the skill that works it, naming the job by its number. The session keeps its token and its rules position: the working skill reuses both and never re-enters. A job is never worked here.

| The job | Worked by |
|---|---|
| Work on a Writing: drafting, revising, assembling, a letter or its `Deliver` job, counsel's review, a scrutiny review | `/draft` |
| A research question | `/legal-research` |
| A job whose only step is the plan marker | `/job-planning`, then this table again |
| Any date: a deadline, a hearing date, a limitation, a date to record | the `lawyer:docket-clerk` agent. No date is worked out here |
| A step at a registry, such as e-filing | `/e-file` |
| Human-only work, such as a deponent swearing | the practitioner: listed for them, never dispatched |

## Rules for each step

<!-- atom id=work.each-step ops=always -->
Sections 6 and 7 are in `references/procedure.md`, section 14 in `references/dispatch.md`, and the claim side of a job with Branch B in `references/job-session.md`. `skill_rules__applicable` serves them, and `take-over.md` and `opening.md`, by operation: never Read those files whole. Load it first, in one ToolSearch that also loads every other tool the opening and the board need: the four rules-map tools below, `drafting_forms__open_session`, `drafting_forms__render`, `drafting_forms__board_card`, `drafting_data__query`, `drafting_data__execute`, `drafting_data__migrate`, `drafting_data__assign_job`, `drafting_data__release_job`, `drafting_data__delete_job`, `drafting_data__merge_jobs`, `drafting_data__set_board_goal`, `drafting_data__record_viewed`, `matter_data__procedural_history_append`, `practice_data__matter_lookup` and `practice_data__link_matter`, each of these and `skill_rules__applicable` under both prefixes, `mcp__plugin_lawyer_data__` and `mcp__remote-devices__plugin_lawyer_data__`. The same search loads the file-card tool (`mcp__cowork__present_files`, or `SendUserFile` only when that is not in the tool list: `shared/present-files.md`), and on a remote-device host `device_stage_files`, `get_device_info` and `device_request_folder_access`. One search, never one per tool. Before each operation below, call it with `skill: "work"`, the operation and each fact known, never a guessed one, and follow what it returns. A rule `conditional_on` a fact holds unless that fact rules it out. Quote a tool error and stop.

The rules map is `/draft`'s, and this session moves on it, since one session holds one map. Its four tools are `rules__at`, `rules__move`, `rules__branch` and `rules__provisional`. Before session entry, call `rules__at` with `skill: "draft"`, `path: ["draft", "draft/enter"]` and the facts known. Once session entry returns its token, the first `rules__move` is `to: "draft/session"`, with `db_path`, `session_token` and the facts `unattended` and `host`. Never pass `job_held` or `job_steps` to `rules__move` or `rules__branch`, which read them from the database. After that, `rules__move` to the node the practitioner's choice reaches, picked from `<likely_next>` by its `when` line: `up` when that position's work ends, and `takeover` as the first move after taking over a held job. When no `when` line on the map fits the turn, move `to: "out_of_bounds"` and do what its `<improvise>` line says. When it returns a `<reorient>` line, do what that line says, without waiting for the agent. A rule `<withdrawn>` no longer governs, and one `<kept>` still does. If `rules__move` refuses with `schema_behind`, say in one plain line that the matter's records need an update, naming no tool, and go on with `skill_rules__applicable` alone.

<!-- atom-vocabulary -->
| Operation | Call before |
|---|---|
| `enter`, `open`, `proposals`, `ingest_coverage`, `form_currency`, `idle_report`, `announce`, `route_reply` | the opening, in that order where each applies, then the practitioner's instruction or reply |
| `dispatch`, `skip_reasons`, `assign_refused`, `input_check`, `pre_claim`, `premise_check`, `plan_readback`, `change`, `execute` | a job, from choosing it to handing it over |
| `take_over` | a job named in progress elsewhere |
| `shelve`, `suppress`, `release`, `restore`, `bring_forward`, `new_work`, `tangent`, `triage`, `board` | that act |
| `counsel_review`, `scrutiny_review`, `filing_picker`, `tools_not_found`, `legacy`, `unattended_run`, `nightly` | the work each names |

| Fact | Values | Meaning |
|---|---|---|
| `job_held` | `true`, `false` | |
| `unattended` | `true`, `false` | |
| `host` | `cowork`, `code`, `remote_device` | `remote_device`: a remote-device-only host |
<!-- /atom-vocabulary -->
