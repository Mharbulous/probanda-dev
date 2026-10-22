---
name: reflect
description: >
  Session retrospective in four phases -- improvement planning, drift analysis against
  the skills' current source, formal E2E documentation, and evidence preservation. Use for
  /reflect typed as a command or in message text, retrospective questions ("how did this session go"), or examining the
  session. Phase 3 alone is an E2E test report on an agentic workflow -- what skills
  triggered, what the agent did step-by-step, and what ambiguities, gaps, blockages,
  logical errors, inefficiencies, unauthorized interruptions, or optimizations
  occurred. Enter Phase 3 directly for /introspection, "document what just happened,"
  "E2E report," "E2E test report," "capture agent behavior," or "turn this session into an E2E
  test," at any point in a session. A witness, not a debugger: Phase 3 records what
  happened, never why. NOT for root-cause analysis, bug diagnosis, or source
  inspection.
---

<!-- lawyer v0.7.0 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: it means the directory containing this SKILL.md, not a placeholder to search for or guess. Read references and shared files natively from there, never over the litigation data server's skill-source tool and never by requesting folder access; scripts and templates the text declares are executed and read from there too. If `${CLAUDE_SKILL_DIR}` itself no longer exists, the plugin was re-synced mid-session: list only `${CLAUDE_SKILL_DIR}/../../..` (the folder that held this plugin's folder), take the folder named as this plugin's folder with any `~g<N>` suffix removed plus the highest `~g<N>`, and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, stages, authors or requests a screenshot of one, but may present one to a human user to view, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

## Contents

| Section | Read when |
|---|---|
| Phase 1 — Improvement planning (when the practitioner observed a problem and proposed a fix) | The practitioner observed a problem and proposed a fix |
| Phase 2 — Drift analysis (actual session vs. the skills' current source) | Comparing the session against the skills' current source |
| Phase 3 — Formal documentation (the E2E introspection report) | An E2E report is requested, or "document what just happened" |
| Phase 4 — Evidence preservation (the CSI discipline) | Preserving chat-only evidence for a future session |
| Standing rules, all phases | Always |

<!-- REGRESSION-PRONE: CanLII-first research has recurred repeatedly. See docs/design/2026-09-24 research-lawyer Westlaw-first fix plan.md before editing. Tests: legal-research/tests/. -->

# Reflect

A retrospective on work already done in this session. The practitioner has stopped *doing the work* and wants to examine *how it went* — the session-so-far is now the object of study. Do not advance the underlying workflow except where a retrospective deliverable requires it.

Scope: the session's substantive work up to this invocation, or the narrower segment the practitioner names. The retrospective can run as a full pipeline (phases 1→4 below) or enter at whichever phase the practitioner's request matches. Successive retrospective turns build one arc — plan, then analyze, then document, then preserve — not restarts.

**Routing:** an introspection-style request (see the description's Phase-3 trigger list — "/introspection," "document what just happened," "E2E test report," "capture agent behavior," "turn this session into an E2E test") enters at Phase 3 directly and runs it alone, ending with the Step 7 handoff below. Phase 3 has no dependency on Phases 1/2 having run (its own Precondition is "None as to timing") — a bare Phase-3 request produces a complete report on its own. A bare `/reflect` or `/lawyer:reflect` invocation — no arguments and no phase-specific trigger phrase — defaults to the full pipeline (Phases 1→4, in order) rather than asking the practitioner which phase(s) to run.

## Phase 1 — Improvement planning (when the practitioner observed a problem and proposed a fix)

**Precondition:** the practitioner has already observed a problem and proposed a fix. In a full-pipeline run with no proposal on record, state in one line in chat that there was no proposal to plan against, skip the rest of this phase, and proceed to Phase 2 — do not ask the practitioner to supply one.

The practitioner's proposal is a hypothesis, not an instruction to execute.

- Restate the problem and the proposed fix. If the practitioner asks you to restate before acting, restate and stop until confirmed.
- Before planning, check whether the current behavior is a **deliberate design decision** (issue numbers, ADRs, design notes in the skill prose). Name the tension: reversing a documented decision is different work than fixing an oversight.
- Ask whether a cheaper solution exists that preserves the original design decision — e.g., use data a tool already returns rather than moving where the tool writes. Present both options with honest costs.
- If a written plan is requested: a dated file in the matter's `<matter-data folder>\reflect\` (or project workspace), the matter-data folder being the one `probanda.json`'s `case_data_dir` names (in Cowork, request access to that folder itself, never a parent or the firm root; never create it: if it is absent, name `/matter-data` initialize), comparing options, recording the recommendation and its rationale, listing out-of-scope defects noticed along the way as separate follow-ups. Present it as a file card (`shared/present-files.md`). Where the recommended fix can be demonstrated immediately without engine changes, demonstrate it.

## Phase 2 — Drift analysis (actual session vs. the skills' current source)

- Identify every skill invoked in the segment under review.
- Read each skill's current source — SKILL.md and the references it loads — via the Coclerk skill-source server (`skill_source__read`), or directly from `.claude/skills/<skill>/` when the repo tree is readable. That source, plus corrections and instructions the practitioner gave in the session, is the standard. Design docs such as `User_Journeys/` files may be read for context but are never the standard: they drift from source, so a session that departs from one while following the source has not drifted.
- Walk the actual session against that standard step by step. List each drift specifically: what the source or the practitioner prescribed, what actually happened, where in the session it occurred.
- Then classify causes: **ambiguous instructions** (guidance exists but doesn't resolve the case), **conflicting instructions** (two texts cannot both be followed — including skill-vs-skill and skill-vs-platform conflicts), **gaps** (the case is uncovered; the agent improvised), and **environment failures** (tool errors, missing config — not instruction defects).
- Include the agent's own non-compliance honestly, at the severity you'd apply to another agent's session. Drifts the practitioner had to correct mid-session rank highest.
- Deliver in chat unless a file is requested.

## Phase 3 — Formal documentation (the E2E introspection report)

**Scope reconciliation with Phase 2:** the witness rule below governs this phase's report artifact exactly as stated — record what happened, never why. Phase 2's four cause classes are not new diagnostic license; they are the same classification this phase's finding types already perform: *ambiguous instructions* → **Ambiguity**, *conflicting instructions* → **Logical error** (provable from the texts), *gaps* → **Gap**, *environment failures* → **Blockage** recorded as observed (exact error, recovery, outcome — cause uninvestigated). Both phases work from the same three sources: transcript, skill prose, prior reports. Drift observations from Phase 2 **do** enter the report — each maps to a typed finding below, per the coverage check at the end of Step 3. What never enters the report is cause narrative beyond that taxonomy: no code/runtime diagnosis, no "because" built from source the witness didn't read. That residue, if any, goes to chat or the Phase 4 evidence addendum, not into a finding.

**Output contract:** every run of this phase ends its final chat response with the Step 7 handoff — a
fenced code block the user can copy-paste into Claude Code, containing the absolute saved
report path. A response ending with anything else (including the Section 5 constraints
block) is an incomplete run. In a full-pipeline run, Phase 4 runs between Step 6 and Step 7:
save and present its exhibits after the report (Step 6's pointer line names the addendum
about to be written), then close with the Step 7 handoff as the final element of the final
response — the handoff ends the arc, not this phase alone.

### Scope — a witness, not an investigator

This phase answers **"what happened?"** It never answers **"why?"**

**In scope:** the factual, chronological record — which skills triggered, what the agent did in
what order, what each step returned, and what ambiguities, gaps, blockages, logical errors,
inefficiencies, or unauthorized interruptions were *observed* along the way. Findings describe
and locate; they do not explain. Whether the workflow's output was any good is a separate
question this phase does not ask.

**Out of scope — decline these; do not attempt them:**
- **Root-cause analysis.** "The reduce failed with `internal_error`" is an observation. "The
  reduce failed *because* the usage edge never cleared the use-adoption gate" is a diagnosis.
- **Source-code inspection.** Skill prose (`SKILL.md` and its `references/`) is readable — it
  is the artifact under review. Application, engine, runtime, and script source behind the
  tools is not, no matter how quickly it would settle the question. When a defect lives in
  that unreadable source, the duty is not a one-line disclaimer — it is the full Refactor
  brief (Step 3). Handing the fixing session everything this session could legitimately
  observe about such a defect is a core purpose of this report, not a step outside it.
- **Probing live state.** No querying databases or runtime state, re-running a failed
  operation, or exercising a tool to establish what a component "really" does.
- **Adjudicating someone else's diagnosis.** If the transcript contains a diagnosis — the
  agent's or a subagent's — record that it was stated and what followed from it. Do not rule
  on whether it was right.
- **Fixing anything**, or telling the fixing session what the fix is beyond what the record
  shows. When the record itself contains the fix — the user said in the transcript how they
  want a problem addressed — quoting that statement is within "what the record shows":
  capture it (Step 3, "User-stated resolutions"). Composing, completing, or improving a fix
  is not.

**When the session surfaced a bug or unexpected behavior:** record what was observed and when
— the exact tool call or command, the exact error, the recovery attempted, the outcome — and
stop there on the question of cause. Say in the finding that the cause was not investigated
because diagnosis is out of scope. When the defect lies in application, renderer, or engine
source rather than skill prose, the disclaimer is not the whole job: give the finding a
Refactor brief (Step 3), which records everything observed about the defect without naming a
cause. If the user wants the cause found, that is a different job: hand it to
`/diagnosing-bugs`, the `debugger` agent, `/troubleshooting` (for a known failure mode), or a
human engineer. Offer the handoff; do not perform it.

A witness who starts speculating about *why* stops being a reliable witness. The value of this
report is that everything in it demonstrably happened.

**Example — in scope:**

> **3.16** `validate_operation_result` on the 4-criterion result failed with
> `"order legal-basis observation requires components"`. The agent retried at 3.17 with 3
> criteria; that failed with `"...must return one observation for each criterion"`. Cause not
> investigated (out of scope).

**Anti-example — out of scope:**

> **3.16** The validator rejected the result *because* the observation handler requires a
> non-empty `components` array on every observation; reading the reducer confirms the
> atomicity check runs before the components check.

Same event. The first is testimony. The second is a diagnosis built from source the witness was
never asked to read — and if it is wrong, it is now wrong in the permanent record.

### Precondition

None as to timing. This phase may be invoked at any point in a session — before any workflow
has started, mid-workflow, or after one has completed — and always reports on the conversation
as it stands at the moment of invocation.

**Runtime fit — check before Step 1.** Delivery, unlike timing, has a precondition: Steps 1,
6, and 7 assume the Coclerk delivery environment — the `repo_docs__write` tool (full name
`mcp__plugin_lawyer_data__repo_docs__write`) is available, or the Coclerk repo's
`docs\E2E-tests\` tree is directly writable. Check whether either holds. If neither does —
the skill was invoked from an unrelated project (a different repo in Claude Code CLI, for
example) — still run the phase in full, taking the **non-Coclerk fallback** branches marked
in Steps 1, 6, and 7: local save, delivery via the environment's own file-send mechanism,
`Local / unversioned` version fields with the reason stated. Do not skip the report, and do
not improvise a delivery path outside those branches.

- **Invoked before any workflow activity:** say so plainly in the report rather than
  fabricating steps. Section 3 records that no workflow had begun, and the report is otherwise
  minimal — there is nothing yet to reconstruct or find.
- **Invoked mid-workflow:** report exactly what has happened so far, clearly labeled as a
  point-in-time capture of an in-progress (not completed) workflow. Do not speculate about
  steps that have not yet happened.

---

### Procedure

If this session resumed from a compaction summary mid-procedure, re-read Steps 6–7 of this
file before producing the final response.

#### Step 1 — Identify the workflow

From the conversation history, extract:
- The exact initial instruction the user gave
- Which skill(s) were triggered, in what order, and by what mechanism (user phrase, skill delegation, etc.)
- The plugin and exact plugin version that supplied each triggered skill
- The subject of the workflow (document, matter, file, etc.)
- The workflow's status as of the report timestamp — `completed`, `in progress`, or
  `not yet started`. For an in-progress workflow, note what step or checkpoint it was paused
  at.

Check the conversation and wrapper metadata for a version string first; call a plugin-roster
tool only if one may still appear — some return a large payload with no version field. Record
the version of the provider used for the run, never a newer version available when the report
is written. If a development wrapper delegates to mutable source, name that source in the
version evidence. Use `Local / unversioned` for a standalone source skill, or
`Unknown / unverified` with the reason when the runtime exposes no provider version. Never
guess. On `Unknown`, record each file's sha256 as the run's
version identity.

**Non-Coclerk fallback** (per the Precondition runtime-fit check): record `Local /
unversioned` in the plugin and version fields, and state the reason in the report's header
paragraph — the session runs outside the Coclerk plugin environment this skill assumes, so
no plugin roster or version string is available.

#### Step 2 — Reconstruct the workflow step by step

Walk through the conversation turn by turn. For each agent action record:
- What the agent did (skill invocation, file read, tool call, bash command, etc.)
- What instruction or rule drove that action
- What the result was (success, error, partial, skipped)

Number steps sequentially (`3.1`, `3.2`, …). If multiple tool calls happened in the same
turn, group them as one numbered step and note they ran in parallel.

Be specific: name the actual files read, the actual queries run, the actual errors received.
Generic summaries ("the agent checked for duplicates") are less useful than specific ones
("the agent ran `SELECT source_id FROM sources WHERE file_hash = ?` and found source_id=1").

User turns are part of the record: give a numbered step to any user turn that corrects the
agent or states how a problem should be fixed, so Step 3 can cite it.

#### Step 3 — Identify findings

Before writing any finding below, verify its factual claims rather than relying on conversation
memory: the file, instruction, or tool call it names exists, and says or returned what the
finding says it did. Verification confirms *the observation* and stops there — it is never a
licence to establish why something failed. Verify findings from three sources only: the
transcript, the skill prose under review, and prior E2E reports (Step 1's version capture is
separate and unaffected). Do not read application or script source, query live
state, or re-run an operation to work out a cause; if a finding cannot be verified from those
three, write it as unverified and say so. Record the check in the finding's **Verified:** line:
which file or transcript passage was read, and what it showed.

Additionally, enumerate every user-facing ask in the transcript (AskUserQuestion calls,
elicitation widgets, questions posed in chat text) and for each identify the skill text that
authorized it. Any ask with no authorizing text is an Unauthorized elicitation finding —
this is a checklist step, not a judgment call. You may be auditing your own conduct: apply
the same severity you would to another agent's session.

**User-stated resolutions.** Also enumerate every transcript turn in which the user stated,
in their own words, how they want a problem fixed — a correction, an instruction, or a
description of what should have happened instead — whether volunteered or given in answer to
a question (the question itself remains subject to the elicitation checklist above). Capture
is quotation, nothing more: the test for "the user stated a fix" is that the resolution can
be quoted from the user's own turns. Verbatim is the default; near-verbatim means trimming
with bracketed ellipses and bracketed referent substitutions only — never adding an operative
element (a skill name, a step, a mechanism, a choice) the user did not say. Where the user
left something open ("not sure which"), the quote keeps it open; resolving it belongs to the
fixing session. Attach each captured statement to the finding(s) it addresses via the
**User-stated resolution:** line defined in Step 4, citing the Section 3 step where it was
said. If a statement addresses only part of a finding, say which part; if it was built up
across several turns, quote each fragment with its step — do not merge fragments into one
composed paragraph. A captured statement that matches no finding means the finding set is
incomplete — the user flagged something the review missed; re-check the seven types below
before discarding it. Where the user stated nothing about a finding, omit the line entirely:
no "none," and no resolution inferred from context, tone, or what the user would probably
want. Inferring one is the Scope section's "Fixing anything" boundary, crossed.

**Example — capture:**

> **User-stated resolution:** "If `Interest Calculations.md` already exists, then it should
> have been presented with the other two markdown files […] If [it] does not already exist,
> then it should have been calculated using the appropriate skills (i.e.
> `/litigator:contract-interest-rates` skill or the `/litigator:court-interest-calculator`,
> not sure which)." (Stated unprompted at 3.14.)

**Anti-example — invention:**

> **User-stated resolution:** compute the missing interest figure with
> `/litigator:contract-interest-rates` before drafting, then present all three files
> together.

Same conversation. The first is the user's instruction on the record, uncertainty intact.
The second resolves a choice the user explicitly left open — a recommendation this report
has no authority to make, wearing the user's name.

**Refactor briefs.** When a finding's defect sits in application, renderer, or engine source
rather than skill prose — code this session cannot read, edit, or diagnose — the finding
carries a **Refactor brief** subsection. The brief is testimony, not diagnosis: every part of
it is something this session directly observed or was directly told, quoted or cited to where
it was read.

The brief is the raw material for the agent brief a later `/triage` session writes, and each
part has a landing spot there: 1 → **Current behavior**, 2 → **Desired behavior**, 3 → the
reproduction triage runs to verify the claim, 4 → **Key interfaces**, 5 → **Out of scope** and
the prior-decision check, 6 → triage's grilling or `needs-info` questions. Write each part to
be usable where it lands. Six parts:

1. **Current output, verbatim** — the exact passage(s) or error text showing the defect,
   quoted, with enough surrounding text to locate them. Not a paraphrase.
2. **Desired output, verbatim** — the target text. Where the user supplied a worked
   before/after example, quote it in full, under the same discipline as User-stated
   resolutions above: verbatim by default, bracketed ellipses and substitutions only,
   nothing composed or inferred.
3. **Reproduction path** — the exact tool call(s) and inputs that produced the current
   output, so the fixing session can re-render before and after its change.
4. **Source location, as attributed** — the source file that the skill prose or tool
   metadata itself names as home of this behavior, cited to where that attribution was read.
   Repeating a location the prose names is testimony; hunting for the defect in the code is
   not this session's job. If nothing readable names a location, say so — that absence is
   itself useful to the fixing session. Keep the literal path: an agent brief may not carry
   file paths (they go stale), but this report is dated testimony, and triage re-expresses the
   location durably when it writes the brief. Do not strip the path to match brief style.
5. **Governing-rule check** — whether any skill-prose rule, ADR, or issue governs the
   behavior, citing what was searched, so the fixing session knows whether it would be
   changing a documented decision or an unlabeled default.
6. **Open questions for the practitioner** — anything the user must settle before the
   change can be specified exactly. Where a question is already its own Ambiguity finding,
   cite that finding by number instead of restating it.

Review the reconstructed workflow for seven finding types:

**Inefficiency** — the agent did something unnecessary, premature, or redundant:
- Files or skills loaded into context before they were needed
- Duplicate tool calls (e.g., requesting an already-mounted directory)
- Extra bash runs caused by preventable errors or wrong assumptions
- Data queried or files read but never used because a prior check would have short-circuited
- Context loaded for a code path that was never reached

**Blockage** — the agent hit a hard stop requiring a recovery step:
- Missing packages or modules (required a separate install step)
- Wrong column names, schema assumptions that failed against the live database
- Tool calls that returned errors requiring retry or workaround
- Instructions the skill said to perform that the agent could not actually execute
Record the exact error text, what the agent did next, and whether it recovered — then stop.
Naming the underlying fault is diagnosis, not observation. A Blockage finding is complete
without one.

**Ambiguity** — skill instructions left the agent without clear guidance:
- Rules that cover a scenario but don't distinguish between two meaningfully different sub-cases
- Missing guidance for an edge case encountered (file renamed, column absent, stale path, etc.)
- Implicit knowledge the agent had to supply that should be in the skill (path translation,
  environment setup, column name inference)
- Instructions that are technically correct but predictably lead to a suboptimal agent decision

**Gap** — the workflow needed a step or capability the skill never provides:
- No verification, validation, or cleanup step where the output plainly required one
- No handling for a case that arose (the skill is silent on it, so the agent had to improvise)
- A capability the agent invented because no instruction covered it at all
Overlaps with Ambiguity — classify as Gap when the skill is *silent* on the needed step,
Ambiguity when an instruction exists but doesn't clearly resolve the case.

**Logical error** — the skill contradicts itself in a way provable from its own text, not
merely an instruction you *suspect* is wrong. You lack the full rationale for why a skill was
written as it is, so do not flag an instruction as a logical error just because it seems
mistaken — that belongs in the report only if a specific contradiction is demonstrable:
- Two instructions that directly contradict each other
- A step that depends on the output of a later step (unsatisfiable ordering)
- A rule whose stated condition can never be met, or that excludes the case it claims to cover
(Regardless of whether it also caused a hard stop; if it did, note the Blockage too.)

**Unauthorized elicitation** — the agent interrupted the workflow to ask the user something
no skill text designated as a user decision point. The test is authorization, not question
quality: a question is authorized only if (a) the workflow's own text defines that ask (a
gate, a mandated elicitation form, a hard-pause resolution), or (b) it is a genuine blocker
— the agent could not proceed correctly on any reading of the instructions and facts.
Pacing, batching, scope-of-effort, and continuation questions ("run all N or a subset?",
"keep going?", "do you want the full version?") are never authorized by silence. Common
signatures: permission-to-not-work; mid-run continuation checks; exporting a choice among
internal work items the user hasn't seen; proposing a reduced scope before attempting the
full task; dressing an ordinary resolvable situation up as a blocker. Every question a user
answers that the workflow didn't designate is a failure of automation, not a courtesy.

**Impact floor:** in any workflow with an automation goal (staged pipelines, CI-style
skills, unattended runs), Unauthorized elicitation is rated High. Downgrading to Medium/Low
requires a stated reason why the interruption did not break the automation contract; absent
that reason, High stands.

**Optimization** — lowest priority: fix this last, only after every correctness issue above
is addressed. For skills this is mostly **token efficiency**, and also: context engineering
(load the right context at the right time, nothing more), parallelizing independent workflow
steps, building reusable scripts, and replacing stochastic prompts with deterministic code
wherever a task can be done in code. Concretely:
- A one-off script that solved a real problem and could be saved as a reference for reuse
- An existing reference asset that's close but too narrow, and could be generalized
- A step done by prose/LLM judgment that a deterministic script or tool call could do reliably
- A concrete token, speed, cost, or robustness improvement with no correctness downside
Before recommending one, check whether it was already tried and deliberately rejected
(SKILL.md prohibitions, notes in the skill prose, prior E2E reports) — if so, cite the reason
instead. Check the prose, not the implementation.

For each finding: type, short title, specific description of what happened, the Section 3
step(s) that evidence it, a **Verified:** line, an impact rating (Low / Medium / High), a
triage category (below), and — where the defect sits in application, renderer, or engine
source — a Refactor brief (above).

**Triage category.** Each finding also carries the category role `/triage` requires alongside
its state role, derived from the type:

| Finding type | Category |
|---|---|
| Logical error, Blockage, Unauthorized elicitation | `bug` |
| Inefficiency, Optimization | `enhancement` |
| Gap, Ambiguity | `bug` where the finding records a wrong or missing output in this run; `enhancement` where the defect is latent |

Deriving it here, from the finding's own evidence, is why the intake session can label an
issue without classifying anything itself — it reads the column and applies the label.

**Impact rubric:** **High** — broke the workflow's practitioner-facing contract or required
user correction mid-session. **Medium** — correct this run, but fails under plausible
conditions (a different matter, runtime, or session state). **Low** — waste only (tokens,
latency, redundant work) with no correctness effect. Unauthorized elicitation findings carry
a High floor (see above).

**Recurrence check:** before finalizing findings, scan `docs/E2E-tests/` for prior reports
on the same skill (filenames embed the skill name); in a Cowork session, where the repo docs
tree is not readable, check auto-memory for prior defect notes instead. If a prior report or
memory documents the same defect, mark the finding **Recurring** in its heading and table
row, cite the prior report or memory in the **Verified:** line, and raise the impact one
level (Low→Medium, Medium→High) — a recurrence means the prior fix did not hold.

**CanLII-first canary (regression lock).** Check every law-audit agent return in the
transcript (`research-agent`). If it or its tool
calls show CanLII used beyond note-up, or `Westlaw: not run` with no reason or one
neither its spawn prompt nor its protocol gives, record a finding titled
**CanLII-first research recurred**, marked **Recurring**, impact High. That is the
recurring defect fixed under
`docs/design/2026-09-24 research-lawyer Westlaw-first fix plan.md`, and seeing it again
means the fix has regressed. Quote the coverage line and the spawn prompt's Westlaw field.
This is an observation of the transcript's own text, not a diagnosis.

**When Phase 2 ran in this arc**, verify coverage before finalizing: every drift from Phase 2
maps to a finding above; state explicitly which findings correspond and which go beyond the
drift list. Findings this phase's witness-only scope excludes (causes) are handled in Phase 4,
not smuggled into the report.

#### Step 4 — Write the report

Use this structure exactly:

```
# E2E Test — `/[skill-name]` Skill: [Brief Description]
**Date:** YYYY-MM-DD
**Matter / Project:** [context]
**Tester:** [user name if known, otherwise omit]
**Runtime:** [Cowork or Claude Code CLI, plus the model if known]
**Workflow status at capture:** [completed | in progress | not yet started]
**Primary plugin version:** [plugin-name@exact-version, or Local / unversioned]
**Purpose:** [one sentence — what this test was meant to observe]

---

## 1. Initial Instruction

[exact user prompt in a fenced code block]

---

## 2. Skills Triggered

| Order | Skill | How triggered | Plugin | Version tested |
|---|---|---|---|---|

**Version evidence:** [runtime wrapper or plugin metadata checked for each version; include
the delegated source for a development wrapper]

---

## 3. Workflow Followed (Step by Step)

### 3.1 [Step title]
[What happened, what drove it, what the result was]

### 3.2 …

---

## 4. Findings

| # | Type | Category | Step(s) | Description | Impact |
|---|---|---|---|---|---|

### 4.1 [Short title] (Type[, Recurring])
[What happened and why it's a finding, citing the Section 3 step(s) that evidence it.]
[**Implicates:** the file or component the defect sits in (e.g. `matter-data/SKILL.md`
step 2; the form-rendering tool's write path). Say `unknown` rather than guess — this
is the intake session's first-pass key for spotting a finding already on the issue queue, and
triage's starting point for the agent brief's **Key interfaces**. Its literal path is
deliberate, for the reason given at Refactor brief part 4.]
[**Verified:** how this was checked against live state; for a recurring finding, cite the
prior report or memory.]
[**User-stated resolution:** the user's stated fix, quoted, with the Section 3 step(s)
where it was said; omit this line when the user stated none. If one statement covers
several findings, quote it under the finding it most directly addresses and cite it by
number ("see 4.2") from the others.]
[**Refactor brief:** the six parts from Step 3, when this finding's defect sits in
application, renderer, or engine source; omit otherwise.]

### 4.2 …

---

## 5. Instructions for Claude Code

[generated in Step 5 — see below]
```

Section 4 opens with a summary table — one row per finding — followed by the detailed
discussion of each finding. Do not repeat the table anywhere else in the report.

#### Step 5 — Populate Section 5

Section 5 turns the report into an actionable brief for a future Claude Code session.
Generate its content as follows:

**Preamble (one or two sentences):** identify this as an E2E introspection report, name the
workflow, and give the folder path of each skill under review as the entry point. Do not
enumerate individual files — the session applying the fixes reads the skill source itself
and judges which files matter. If a skill's source is not directly editable from the fixing
session (e.g. it lives only in a plugin cache), say so and point at the plugin's own update
path instead of an `Edit` that won't persist. Tell the fixing session
to compare the recorded tested versions with the current plugin manifests before
investigating; an older-version finding is historical until it reproduces against current
source. Diagnosis belongs to that session, not this one: where a finding records a defect
whose cause was deliberately left uninvestigated, say so and let the fixing session
investigate — do not supply a cause this report has no basis for. Where a finding carries a
**User-stated resolution:** line, say that those lines are the user's own instructions on
what the fix should do: the fixing session verifies them against current source like any
finding, but does not substitute its own judgment where the user has already spoken. Where a
finding carries a **Refactor brief**, say that the brief is the specification for that fix:
the fixing session verifies it against current source but does not rebuild the requirements
from scratch — the current output, desired output, reproduction path, and attributed source
location were captured by direct observation. Close the preamble by saying that this report
is the evidence record behind the `e2e-finding` issues raised from it, so a fixing session
arriving from an issue link knows to open it.

**Constraints (copy these verbatim into every report):**

> - **No regression:** before proposing any change, read the full skill file and confirm the
>   edit does not remove or degrade guidance needed for other commands, document types, or
>   code paths the skill handles.
> - **Net +100 chars per finding:** only refactors of existing skills are capped. Each
>   confirmed finding gets its own budget of 100 net added characters across all existing
>   source files changed for that finding. Show each finding's net count. New skills and
>   their files are exempt. If a fix cannot fit, flag it for a larger design pass.

That is the whole section: preamble plus constraints. Do not add a procedure, a file
list, or a repeat of the findings table — the fixing session works from Section 4 and
the skill source directly.

Keep the constraints blockquote self-contained, so an intake session can quote it verbatim
into an issue body without editing. Copied into the issue, it is what carries these limits
into the agent brief `/triage` later writes — and that brief, not this report, is the contract
the fixing agent works from.

#### Step 6 — Save and present

Save to `YYYY-MM-DD-HHMM [skill-name]-e2e-test.md`, using the date and 24-hour
zero-padded time the session occurred (`date +%Y-%m-%d-%H%M` if it is current),
so repeated same-day runs don't collide. Where that file goes depends
on whether the repo is directly writable from this session:

- **Local repo session** (the repo tree is writable): save to
  `%USERPROFILE%\Git\Coclerk\docs\E2E-tests\`, as before.
- **Cowork session** (the repo is not mounted, and there is no repo folder
  grant): write the report
  into the repo directly with the `repo_docs__write` tool on the litigation
  data server (full name `mcp__plugin_lawyer_data__repo_docs__write`).
  The `path` argument is relative to docs/ — e.g.
  `E2E-tests/2026-07-19-2243 demo-skill-e2e-test.md`. If the call still fails
  with code `exists`, retry once with a numeric suffix before the extension. Do
  not request folder access to the repo. To present the report in-chat, also save
  a same-named copy in the session workspace and present that copy; the file written by
  the tool into docs/E2E-tests/ is the canonical one — no move or sweep step
  is needed.
- **Non-Coclerk fallback** (neither of the above — per the Precondition runtime-fit
  check): save the report into the host project's own session-logs or scratch area
  (an existing `session-logs\` or `.scratch\` folder; create `session-logs\` at the
  project root if none exists), same filename convention. This local file is the
  canonical copy for the run. State in the report's header paragraph that it is saved
  locally because the session runs outside the Coclerk delivery environment.

Present the file as `shared/present-files.md` says: `mcp__cowork__present_files` by default,
`SendUserFile` only when that is not in the tool list, or the environment's own file-send
mechanism where neither exists; ToolSearch it if deferred.

If Phase 4 ran (or runs after this step) in the same arc, add one pointer line into the
**saved report file itself** — its header area, alongside **Purpose:** — naming the evidence
addendum's filename. A line spoken only in chat is not enough: a reader who later opens just
the report file, with no chat to consult, must still be able to find the addendum.

#### Step 7 — Draft the Claude Code intake handoff

Immediately after presenting the file, end the response with a ready-to-paste
instruction for Claude Code, in a fenced code block (` ``` `) so it renders with
a one-click copy button in the Cowork chat window and is not confusable with the
Section 5 constraints blockquote. Do not just describe the handoff — produce the
literal text to paste. This is a standing part of the phase's output, not
something to ask permission for.

**The handoff files findings; it never fixes them.** Deciding what is new is cheap;
verifying and fixing is expensive. Fusing them into one paste means a second E2E run
cannot be filed while the first is still being fixed, so its report re-queues findings
already in flight and is discarded. Splitting them lets intake finish in a minute and
turns a duplicate finding into corroborating evidence on an open ticket instead of
wasted work. Do not "helpfully" restore fixing instructions to this paste.

The pipeline it feeds is: this report (witness) → intake (file or merge each finding) →
`/triage` (categorise, verify, write the agent brief) → an agent works `ready-for-agent`.
Only the last stage touches source. Intake stops at `needs-triage` and hands off.

For the absolute path, prefer the canonical repo copy
(`%USERPROFILE%\Git\Coclerk\docs\E2E-tests\...`) when the report was written via
`repo_docs__write`, since the handoff is consumed by a Claude Code session working
in the repo; fall back to the workspace copy only if the repo write failed. In the
non-Coclerk fallback, use the absolute path of the locally saved report. The
evidence addendum, when one exists, is saved beside the report — give its path the
same way.

Template (substitute the actual saved report path):

    ```
    I ran an E2E introspection test and generated a report. Read the report at
    "<absolute path to the E2E report file>".

    For each finding in Section 4, reconcile it against the open issues labelled
    `e2e-finding` on Mharbulous/CoClerk (see docs/agents/issue-tracker.md for gh
    usage). A finding's **Implicates:** line, where present, is your first-pass
    match key, but judge the underlying defect, not the wording — a later report
    often restates an earlier symptom with a better diagnosis.

    - If an open issue already covers the same underlying defect, comment on it
      with this report's path, the finding number, and what the finding adds: a
      better diagnosis, new evidence, or a User-stated resolution. Do not open a
      duplicate.
    - Otherwise draft a new issue titled "[e2e] <skill-name>: <finding title>",
      labelled `e2e-finding`, `needs-triage`, and the `bug` or `enhancement`
      value in that finding's Category column. Its body quotes the finding in
      full, links to the report, and reproduces Section 5's constraints
      blockquote verbatim so the limits travel with the issue.
    - Before filing any draft, dispatch the `sentinel` agent with all of them
      at once, each with `Kind: e2e-finding`, `Source: <report path> finding
      <n>`, and a note that the open-issue match is already done. Carry out
      each verdict as the Output section of `.claude/agents/sentinel.md`
      defines it. If no `sentinel` agent is available, apply that file's bar
      yourself and post the same verdict text.

    Open every issue and comment you post with this line, except a sighting
    comment, which starts with `Sighting.` exactly as the sentinel returns it:

        > *This was generated by AI from an E2E introspection report.*

    Do not verify findings against source and do not apply any fix. `/triage`
    owns verification — its step 3 reproduces the claim and its step 1 checks
    whether the behavior already exists. Doing it here pays for it twice.

    Finish by spawning a session chip whose prompt is a `/triage` instruction
    naming the open issues you filed or updated. If no chip tool is
    available, end your response with that instruction, ready to paste.
    ```

If Phase 4 ran in this arc, the handoff is the only place the intake session learns
the addendum exists, so it must name both files. Add the addendum's absolute path to
the first paragraph and one sentence telling the session to read its exhibits before
deciding whether a finding is new, and extend the "links to the report" clause to
name the addendum too. Change nothing else.

Keep the existing rules: literal text, actual absolute path(s) substituted, last
thing in the response, nothing after it.

Before sending, confirm all three — four when Phase 4 ran: (1) the report was saved
and its absolute path captured; (2) the report was presented per Step 6; (3) the response's
final element is the fenced intake handoff containing that exact path, and it
instructs no fixing; (4) when Phase 4 ran in this arc, the handoff also names the
addendum's absolute path. If any check fails, fix it before sending.

## Phase 4 — Evidence preservation (the CSI discipline)

A formal report will be consumed by a *future* session that cannot see this chat. Preserve the evidence relevant to root-cause analysis that **only this chat holds**:

- per-session hook and system-prompt texts the agent had in context at each decision
- exact tool error payloads, verbatim
- exact elicitation options offered, the user's exact answers, and the wrapper text around them
- ordering and adjacency of events — what happened immediately before and after each decision
- what was and was **not** loaded into context at each decision point ("instruction never in context" vs. "instruction overridden" is settled only by the transcript)
- live-artifact end-state the session leaves behind (forked files, un-bumped revisions)
- environment correlates: clock offsets, path discrepancies, parallel-session activity

Write these as numbered exhibits, each with a verbatim quote and a one-line "why preserved," keyed to the Phase 3 report's finding numbers when a report exists, saved beside the report (and cited from it). **Evidence only — no root-cause determinations.** You are the crime-scene investigator; the lab — a future session with current source — does the analysis.

## Standing rules, all phases

- **Quote, never invent, user-stated resolutions.** Where the practitioner said how something should be fixed, capture their words verbatim (bracketed ellipses/referent substitutions only). Where they left a choice open, the quote keeps it open.
- **Witness vs. analyst.** Observations and contradictions demonstrable from the texts themselves are in scope; diagnosing *why* code or infrastructure failed is not — record the defect, mark the cause uninvestigated, route diagnosis to the fixing session. A defect in application, renderer, or engine source is recorded at full strength — Phase 3's Refactor brief — never as a bare disclaimer.
- **Deliverables land where a future session finds them.** Plans → the matter's matter-data folder or the project workspace, presented as cards. Reports and evidence → the repo's E2E-tests tree via its write tool when available, with a workspace copy presented in chat. A formal-report arc ends with a ready-to-paste handoff block for the intake session, which files findings as issues and never fixes them.
- **Out-of-scope defects noticed while reflecting** (renderer bugs, tooling gaps) are recorded for follow-up, never silently fixed or dropped.
