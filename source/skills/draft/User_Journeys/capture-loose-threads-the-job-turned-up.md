---
journey: Capture the loose threads the job turned up
kind: ux journey — describes the interaction the practitioner experiences, not the data model. Data-focused journeys use a different format and live in `source/skills/drafting-data/User_Journeys/`.
actor: practitioner
trigger: while a claimed job's approved work runs, that work turns up something outside the job's scope — a defect in a neighbouring record, a discrepancy between two stored facts
outcome: each surfaced item is recorded as a loose thread of the matter in the same turn it surfaces, acknowledged in one line, and found by a later outlining session on the Loose Threads page — nothing lives only in chat
path: happy
status: aspirational (desired UX — not yet verified against the implementation)
source: practitioner instruction at `/reflect` on the L8212 `/draft-submission` session (Job #17), 2026-09-13; E2E report `docs/E2E-tests/2026-09-13-2227 draft-submission-e2e-test.md`, findings 4.1 and 4.5
---

# Capture the loose threads the job turned up

## The journey

1. **Practitioner:** is working a claimed job — research authority for two unsupported propositions. A `/legal-research` audit comes back and, alongside its answer, reports two things the job never asked about: a stored criterion that cites a case for the opposite of what the case's own stored edge says, and a stored fact recording one section of the agreement as pleaded where the demand letter and this Writing invoke the neighbouring section.

2. **Assistant:** records both as loose threads in the same turn, through `loose_threads__capture` — each verbatim, five sentences or fewer, no options — and acknowledges in one line:

   > Two things surfaced that are outside this job — both recorded as loose threads. Carrying on.

   It does not litigate them, rank them, or propose fixes. That is outlining, and this session holds a job. Ranking belongs to an outlining session's loose-thread triage (`work/references/loose-thread-triage.md`).

3. **Assistant:** carries on with the job's approved plan. The loose threads cost no scope and no tangent turn.

4. **Assistant:** before completing the job, retiring its Writing, or leaving it `wip`, sweeps once more: anything surfaced since the last loose thread, and any work idea the job leaves undone, is written now. It reads the loose threads this job already wrote off its own card, never the matter's whole set.

5. **Later session:** an outlining session (Branch B) reads the matter's threads by `loose_threads__read`, quotes each, and asks the practitioner whether to outline it now, leave it as an idea, or drop it.

## Principles this journey encodes

- **Capture at the moment of sight.** The item is recorded as a loose thread when and where it surfaces, because that is when the context is free. The principle comes from `flag-now-decide-later.md`; this journey extends it from evidence-link concerns to loose threads.
- **Surfacing is not capturing.** A chat report dies with the session; a loose thread is what the next outlining session reads.
- **A loose thread is capture, not decision.** Verbatim, at most five sentences, no options or recommendations — the appearance of alternatives means outlining has started.
- **Loose threads cost no scope.** Writing one is always in scope and never counts as a tangent turn.
- **The assistant records its own tangents as loose threads instead of taking them.** Only a tangent the practitioner starts counts toward the three-turn limit. Something the assistant notices outside the job is recorded as a loose thread, not pursued, so it never becomes a tangent at all.
- **A forum-procedure change is more than a loose thread.** When the return reports an amendment in force to a rule or form the open Writing's type file or `venue.md` names, the loose thread is still written first, then the assistant re-runs the source check on both files, offers a `/localize` refresh on an overlay file, and puts a job on the board, by `SKILL.md` section 14, "Forum-procedure change".
- **The end-of-job sweep is the backstop, not the rule.** It catches what the moment of sight missed; it never licenses waiting until the end.
