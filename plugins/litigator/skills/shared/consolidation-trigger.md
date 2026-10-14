# Consolidation trigger — when a pipeline initiates a push

This file is the single source of truth for **when a pipeline initiates
consolidation of the matter's generalized legal principles into the shared pooled
layer**. Its caller is `/draft`'s retire flow; that skill references
this file, does not restate it, and does not name the consolidation skill in its
own text.

The point is a small one: the practitioner should not have to *remember* to
consolidate. At the moment a matter's legal thinking on a filing is finished, the
session offers a ready-to-confirm batch instead of waiting to be asked.

## The one event

**Filing retired.** The practitioner has retired a filing — early or terminal —
and the retire flow has written the retirement, superseded the filing's open
jobs, run the case-data bridge, and re-rendered the board. That filing's legal
research is done: it is as settled and as generalized as it is going to get, and
the authorities it deployed are exactly the set worth noting up.

Nothing else triggers. Drafting a filing, filing it, hearing it, and having it
decided all leave work in flight; only retirement ends it.

**At most once per retire.** One retire, one initiation. Re-entering the same
state without another retirement does not re-trigger; the push queue would be
unchanged anyway and a repeated offer reads as nagging.

**Recovery never triggers.** Recovering a retired filing is the practitioner
reopening work, not finishing it. Nothing is initiated on recovery — and a later
re-retirement of that same filing is a fresh retire event, so it initiates once
more, on its own.

## What "initiate" means, exactly

**A new turn, after the retire flow's own ending is complete.**

Finish the retire flow exactly as `/draft` specifies it — including its
board re-render. Then, in the **next** turn, invoke `/consolidation-push` for the
matter, opening with the line naming the event:

```
Initiated by: filing retired — <title>
```

The skill runs its own preflight, reads its own push queue, and presents its own
preview.

Never initiate mid-flow, never inside a checkpoint, and never in place of a step
the pipeline mandates. The retire flow is an elicitation, not a checkpoint, but the
rule is the same: an elicitation in progress is not a place to start a second
skill.

## Initiation is not approval

Every safeguard downstream of the trigger stands, unchanged:

- The one **practitioner confirmation** on the push batch is still taken.
- Every **cloud permission prompt** still fires. Nothing is allowlisted — that
  includes every currency write the push's noting-up stage proposes.
- **Severance** — compression, the adversarial indirect-identifier screen, the
  mosaic screen — runs in full. Matter-identifying content structurally cannot
  cross.

The trigger changes *who remembers*, not *who decides*.

## Where the skill is not installed

The consolidation skill ships in an optional expansion. If `/consolidation-push`
does not resolve, the trigger is a no-op: **do nothing and say nothing.** Do not
report a missing skill, do not suggest installing anything, and do not let the
absence alter how the retire flow ended. A pipeline that announces the absence of
an optional component has turned an expansion into a dependency.

Likewise where it resolves but the push queue is empty: the skill says "nothing
to push" in its own words and ends. That is a complete and correct outcome, not a
failure to report.
