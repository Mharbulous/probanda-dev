---
name: apply-to-facts
description: >
  Apply established law to this matter's own facts and reach a conclusion -- whether the client
  has a claim, whether a defence or a limitation argument holds, whether the facts on the record
  satisfy a legal test, what follows for this file. Counterpart to `legal-research`,
  which owns what the law IS. Where the artifact rather than the conclusion is what's wanted: a
  date -> the `docket-clerk` agent; the application itself -> `draft`.
---

<!-- litigator v0.3.2 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: it means the directory containing this SKILL.md, not a placeholder to search for or guess. Read references and shared files natively from there, never over the litigation data server's skill-source tool and never by requesting folder access; scripts and templates the text declares are executed and read from there too. If `${CLAUDE_SKILL_DIR}` itself no longer exists, the plugin was re-synced mid-session: list only `${CLAUDE_SKILL_DIR}/../../..` (the folder that held this plugin's folder), take the folder named as this plugin's folder with any `~g<N>` suffix removed plus the highest `~g<N>`, and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, stages, authors or requests a screenshot of one, but may present one to a human user to view, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

## Contents

| Section | Read when |
|---|---|
| 1. Name the live issue | Before any reasoning, and when no current matter is mounted |
| 2. Get the test from legal-research — never from yourself | Every legal proposition the conclusion rests on |
| 3. Dispatch marshal-facts for the facts and the mapping | The verified test is in hand and the facts must be found and applied to it |
| 4. State the conclusion | The agent's mapping has come back |
| Handoffs | The practitioner wants a figure, a date or a draft rather than the conclusion |

# Apply to facts — reason from a verified test to a conclusion

The question you were asked is not what the law is. It is what the law *means for these
facts* — a mixed question of law and fact. You may reason to that conclusion. You may
never reason from law you established yourself.

This skill is not an exception to the legal-research gate; it is a caller of it.
`shared/legal-research.md` lists "whether conduct is actionable" among the assertions
that are not yours to make, and that still holds here. What makes the reasoning below
permissible is step 2: the test comes back from `research-agent`, with citations, before
any of it is applied. Skip step 2 and every conclusion downstream is an unverified
statement of law wearing a conclusion's clothes.

## 1. Name the live issue

Apply the naming test in `shared/live-issue-test.md` §2 before reasoning: name, in one
sentence, the live issue in the current matter this work serves. Merits reasoning is legal
work under §1, so the test governs it.

If this session has no current matter — a repo session — you have no billing anchor. Confirm
once under §5 before starting: a named matter and live issue, or the practitioner's explicit
authorization of unbilled firm work. If more than one matter workspace is mounted, ask once
which matter this is for; that protects the per-matter law database from cross-matter
contamination.

## 2. Get the test from legal-research — never from yourself

Invoke ``legal-research`` for every legal proposition the conclusion rests on: the elements
of the test, the effect of the statute, what the authorities hold. Do not answer any of it
from training knowledge, web search, or secondary commentary, and do not proceed on a test you
recall rather than received.

Two things carry over from `shared/legal-research.md` and bind you as the caller:

- **The pre-spawn duties are yours.** Run the tier-2 pooled-layer lookups the agent cannot
  reach, and extract any `6. LAW\` `.docx` memo text it cannot open, and pass both into the
  spawn. Read `shared/research-priority.md` and follow its order.
- **A closed gate is the answer.** If the agent declines, reports layers unavailable, or
  offers only a preliminary impression, relay its confidence summary and its research offers
  and stop. You do not have a test to apply, so there is no conclusion to reach. Reasoning on
  from a preliminary impression, or reasoning "in the alternative" around a closed gate, is
  the failure this skill exists to prevent.

An ingested primary authority or output of `/verify-law` with `verify-authorities` may be quoted without a fresh spawn,
on the terms of item 2 in `shared/legal-research.md`, which is the canonical rule. It may not be
reasoned from: the test you apply still comes back from `research-agent`. A research memo or case brief is a lead:
pass it into the spawn, or relay it labelled unverified and conclude nothing on it.

Turn the returned test into the criteria the step 3 dispatch needs, one per element or factor,
in the order the authority states them. Each carries a short `ref`, the criterion `text` as
returned, whether it is an `element` or a `factor`, its `citation` with pinpoint, and its
`source`: the research-agent return, or the stored criterion ids it named. If the research
did not cite every criterion, the test is not verified: that is a closed gate, so stop as
above and dispatch nothing.

## 3. Dispatch marshal-facts for the facts and the mapping

Invoke ``case-data`` once, as a read-only lookup of the proceeding and the party ids only, not
for facts: which proceeding this issue sits in, the client's party id, and the ids of the
parties the question is tested against. Decline any backfill or profile-completion offer it
makes; that is separate work for the practitioner to start.

Then dispatch the `marshal-facts` agent. It finds the facts in case data itself and applies
each criterion to them, so the facts never pass through this session. Give it:

- `matter_root`, the live host path of the matter folder (never a sandbox mount path), and
  `proceeding_id`
- `live_issue`, the one sentence from step 1
- `question`, the contention, claim, defence or submission being tested, verbatim
- `for_party` and `against_parties`, the party ids
- `criteria[]`, from step 2
- `scope_hints`, optional source titles or categories to start from
- `mode: map`

A closed gate at step 2 dispatches nothing. Documents read earlier do not replace or add to
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

## 4. State the conclusion

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

## Handoffs

When the practitioner wants the artifact or the figure rather than the conclusion, this is the
wrong skill and the work belongs to its owner:

| Wanted | Owner |
|---|---|
| Interest owed under a judgment or statute | ``/calculate`` with ``court-interest-calculator`` |
| Interest owed under a contract's own term | ``/calculate`` with ``contract-interest-rates`` |
| A date, a deadline, or the deadline register | the ``practice:docket-clerk`` agent (spawn it, relay its open items, re-spawn with the answers: `shared/deadline-isolation.md`, "Calling docket-clerk") |
| The application itself, or a response to one | ``draft`` |

These run in both directions. A conclusion this skill reaches often needs one of them to turn
into a work product, and one of them will send a merits question back here. Hand over the
verified test and the agent's mapping so the work is not done twice.
