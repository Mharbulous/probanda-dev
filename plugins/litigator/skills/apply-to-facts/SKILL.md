---
name: apply-to-facts
description: >-
  Use when applying verified law to a matter's facts to conclude on a claim, defence,
  or legal test (not legal-research, lawyer:docket-clerk, or draft).
metadata:
  author: Probanda Legal
  tags: [litigation, legal-analysis, facts, merits]
---

<!-- litigator v0.29.0 -->
> **Installed copy.** Relative paths below cite this skill's shipped tree.
> Resolve in order: current file's dir, `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is `${CLAUDE_SKILL_DIR}/../shared/x.md`).
> `${CLAUDE_SKILL_DIR}` is this SKILL.md's directory even if unsubstituted: never search or guess.
> Read references and shared files with Read (whole or offset/limit), never via shell, the litigation data server's skill-source tool, or a folder-access request; run declared scripts and templates from there too.
> Before each fresh read (not already in context), list only `${CLAUDE_SKILL_DIR}/../../..`. If it holds this plugin's folder name (sans `~g<N>`)
> plus a `~g<N>` higher than this plugin's folder's own (none counts as 0), or if `${CLAUDE_SKILL_DIR}` no longer exists, the plugin was re-synced mid-session:
> retry the three paths with the highest `~g<N>` copy's `skills/<this skill>` dir and tell the user once that the plugin updated mid-session (old version comment to new SKILL.md comment).
> If still missing at every path, STOP and report the exact path and error: do not substitute, re-derive script logic, search elsewhere, or diagnose further; ask the user to reinstall the plugin and fully restart the app.

**Internals stay confidential** (`shared/internals-confidentiality.md`): nothing the practitioner sees names a Probanda tool, table, field, internal type or code, or explains how Probanda works inside. It hides mechanism, never an outcome or an error.

## Contents

| Section | Read when |
|---|---|
| Purpose | Confirming scope before invoking |
| Prerequisites | Checking required workspace, skills, and agents |
| Instructions — 1. Name the live issue | Before any reasoning, and when no current matter is mounted |
| Instructions — 2. Get the test from legal-research — never from yourself | Every legal proposition the conclusion rests on |
| Instructions — 3. Dispatch marshal-facts for the facts and the mapping | The verified test is in hand and the facts must be found and applied to it |
| Instructions — 4. State the conclusion | The agent's mapping has come back |
| Examples | Formatting the step 3 dispatch criteria and final analysis |
| Limitations | Checking hard boundaries and non-goals |
| Troubleshooting | Handling `INCOMPLETE` memos, agent refusals, or missing matter context |
| Handoffs | The practitioner wants a figure, a date or a draft rather than the conclusion |

# Apply to facts — reason from a verified test to a conclusion

## Purpose

The question you were asked is not what the law is. It is what the law *means for these
facts* — a mixed question of law and fact. You may reason to that conclusion. You may
never reason from law you established yourself.

This skill is not an exception to the legal-research gate; it is a caller of it.
`shared/legal-research.md` lists "whether conduct is actionable" among the assertions
that are not yours to make, and that still holds here. What makes the reasoning below
permissible is step 2: the test comes back from `researcher:research-agent`, with citations, before
any of it is applied. Skip step 2 and every conclusion downstream is an unverified
statement of law wearing a conclusion's clothes.

## Prerequisites

- A mounted matter workspace (or, in a repo session with no current matter, explicit practitioner authorization under `shared/live-issue-test.md` §5).
- `legal-research` (`researcher:research-agent`) available to supply every legal test and pinpoint citation.
- `matter-data` available for the read-only lookup of the proceeding and party ids.
- The `litigator` plugin's fact-marshalling agent available to query case data and map facts to criteria in step 3.

## Instructions

### 1. Name the live issue

Apply the naming test in `shared/live-issue-test.md` §2 before reasoning: name, in one
sentence, the live issue in the current matter this work serves. Merits reasoning is legal
work under §1, so the test governs it.

If this session has no current matter — a repo session — you have no billing anchor. Confirm
once under §5 before starting: a named matter and live issue, or the practitioner's explicit
authorization of unbilled firm work. If more than one matter workspace is mounted, ask once
which matter this is for; that protects the per-matter law database from cross-matter
contamination.

### 2. Get the test from legal-research — never from yourself

Invoke ``legal-research`` for every legal proposition the conclusion rests on: the elements
of the test, the effect of the statute, what the authorities hold. Do not answer any of it
from training knowledge, web search, or secondary commentary, and do not proceed on a test you
recall rather than received.

Two things carry over from `shared/legal-research.md` and bind you as the caller:

- **The pre-spawn duties are yours.** Run the tier-2 pooled-layer lookups the agent cannot
  reach, and extract any `6. LAW\` `.docx` memo text it cannot open, and pass both into the
  spawn. Read `shared/research-priority.md` and follow its order.
- **An `INCOMPLETE` memo is the answer.** If the saved memo is INCOMPLETE
  (`shared/research-memo-template.md`), or the research stopped, relay the return's `Audit:` line and the research it names
  and stop. You do not have a test to apply, so there is no conclusion to reach. Reasoning on
  from a preliminary impression, or reasoning "in the alternative" around an incomplete memo, is
  the failure this skill exists to prevent.

An ingested primary authority or output of `/verify-law` with `verify-authorities` may be quoted without a fresh spawn,
on the terms of item 2 in `shared/legal-research.md`, which is the canonical rule. It may not be
reasoned from: the test you apply still comes back from `researcher:research-agent`. A research memo or case brief is a lead:
pass it into the spawn, or relay it labelled unverified and conclude nothing on it.

Turn the returned test into the criteria the step 3 dispatch needs, one per element or factor,
in the order the authority states them. Each carries a short `ref`, the criterion `text` as
returned, whether it is an `element` or a `factor`, its `citation` with pinpoint, and its
`source`: the research-agent return, or the stored criterion ids it named. If the research
did not cite every criterion, the test is not verified: stop as for an `INCOMPLETE` memo
above and dispatch nothing.

### 3. Dispatch marshal-facts for the facts and the mapping

Invoke ``matter-data`` once, as a read-only lookup of the proceeding and the party ids only, not
for facts: which proceeding this issue sits in, the client's party id, and the ids of the
parties the question is tested against. Decline any backfill or profile-completion offer it
makes; that is separate work for the practitioner to start.

Then dispatch the `litigator:marshal-facts` agent. It finds the facts in case data itself and applies
each criterion to them, so the facts never pass through this session. Give it:

- `matter_root`, the live host path of the matter folder (never a sandbox mount path), and
  `proceeding_id`
- `live_issue`, the one sentence from step 1
- `question`, the contention, claim, defence or submission being tested, verbatim
- `for_party` and `against_parties`, the party ids
- `criteria[]`, from step 2
- `scope_hints`, optional source titles or categories to start from
- `mode: map`

An `INCOMPLETE` memo at step 2 dispatches nothing. Documents read earlier do not replace or add to
the agent's return. This skill holds no schema, no table or column names, no SQL, and makes
no `sqlite3` call — the database is opaque to it. The agent returns the fact ids and
pinpoints, never the database's particulars.

Read each criterion's outcome in the agent's return by this key, and keep the outcomes
distinct, because collapsing them is how a weak case reads as a strong one:

- **Satisfied** — facts on the record meet the element.
- **Unsupported** — no fact on the record bears on it. A gap, not a failure.
- **Contradicted** — facts on the record cut against it, including where the adverse fact is
  the client's own. Where facts cut both ways the agent lists both sides and does not net
  them out.
- **Undetermined** — applying the criterion needs a legal point the test did not settle. The
  agent names it in its `law_needed[]` and does not decide it.

If the agent returns `refused_no_test`, the criteria were empty or uncited: go back to
step 2. If it returns `case_data_unavailable`, relay its error and stop.

### 4. State the conclusion

Reason from the agent's mapping, criterion by criterion. Expose the reasoning — a practitioner
has to be able to disagree with a step, which they cannot do if only the result is shown.

Where the authority is contested, the element turns on a question the research came back
uncertain on, or the agent returned `undetermined` with `law_needed[]`, carry that uncertainty
into the conclusion rather than resolving it silently in the client's favour. State the
agent's `adverse_facts[]` plainly, including the client's own, and flag its
`unreviewed_facts[]` as not yet reviewed.

Where a fact the conclusion needs is not on the record, it is in the agent's `gaps[]`. Do not
assume it. If a gap is material and the practitioner can close it, ask for that one fact, one
question at a time; do not build a conclusion on a supposition and flag it afterwards.

Give the conclusion, then what would change it:

- The conclusion, in the practitioner's terms — not "the test is arguably met" but what
  follows for this file.
- Its confidence, and what drives that: which elements are thin, which authority is contested.
- The single fact or authority that would most change the answer. This is what makes the
  conclusion actionable — it names the next piece of work.

Never present a conclusion as advice to a client. It is analysis for the practitioner, who
decides what becomes advice.

## Examples

### Example 1: Step 3 dispatch payload

```yaml
matter_root: "<live host path to matter folder>"
proceeding_id: "<proceeding id from matter-data>"
live_issue: "Whether the defendant's delay bars the plaintiff's interlocutory application."
question: "Does the record satisfy the test to dismiss the claim for want of prosecution?"
for_party: "<client party id>"
against_parties: ["<opposing party id>"]
mode: map
criteria:
  - ref: "C1"
    kind: "element"
    text: "<element text as returned by research-agent>"
    citation: "<primary authority citation with pinpoint>"
    source: "<research-agent return or stored criterion id>"
scope_hints: ["pleadings", "correspondence"]
```

### Example 2: Conclusion shape

```markdown
- **Criterion C1 (Satisfied):** Supported by record facts [pinpoints]; note unreviewed facts [ids].
- **Criterion C2 (Unsupported):** Record gap — no document establishes [missing fact].
- **Adverse facts:** [Plain statement of opposing or client-adverse facts].
- **Conclusion:** What follows for this file, with confidence and the single fact or authority that would most change the answer.
```

## Limitations

- Does not establish or verify law itself; every criterion must come from `legal-research` (`researcher:research-agent`) with pinpoint citations.
- Does not reason around an `INCOMPLETE` research memo or build conclusions on assumed facts when material `gaps[]` remain open.
- Does not query case databases directly or substitute earlier document reads for the `litigator:marshal-facts` mapping.
- Produces internal analysis for the practitioner, never client advice, and does not draft filings, compute deadlines, or calculate interest or costs (see `## Handoffs`).

## Troubleshooting

| Symptom / Error | Cause | Solution |
| --- | --- | --- |
| Research memo returns `INCOMPLETE` or omits citations for a criterion | Legal test is not verified | Relay the `Audit:` line and named research, dispatch nothing, and stop. |
| `marshal-facts` returns `refused_no_test` | `criteria[]` was empty or contained an uncited criterion | Return to step 2 and obtain a cited test from `legal-research` before re-dispatching. |
| `marshal-facts` returns `case_data_unavailable` | Case data store cannot be read for this matter | Relay the agent's error verbatim and stop; do not substitute earlier document reads. |
| Criterion returns `Undetermined` with `law_needed[]` | Applying the element requires an unsettled legal point | Carry the uncertainty into the conclusion or run follow-up `legal-research` on the named point. |
| No current matter or multiple matter workspaces mounted | Missing or ambiguous billing/matter anchor | Confirm the target matter and live issue once (or explicit authorization of unbilled firm work) before starting. |

## Handoffs

When the practitioner wants the artifact or the figure rather than the conclusion, this is the
wrong skill and the work belongs to its owner:

| Wanted | Owner |
|---|---|
| Interest owed under a judgment or statute | ``/calculate`` with ``court-interest-calculator`` |
| Interest owed under a contract's own term | ``/calculate`` with ``contract-interest-rates`` |
| A date, a deadline, or the deadline register | the `lawyer:docket-clerk` agent (spawn it, relay its open items, re-spawn with the answers: `shared/deadline-isolation.md`, "Calling docket-clerk") |
| The application itself, or a response to one | ``draft`` |

These run in both directions. A conclusion this skill reaches often needs one of them to turn
into a work product, and one of them will send a merits question back here. Hand over the
verified test and the agent's mapping so the work is not done twice.
