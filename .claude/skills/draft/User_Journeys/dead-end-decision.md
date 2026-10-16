---
journey: Dead-end decision
kind: ux journey — describes the interaction the practitioner experiences, not the data model. Data-focused journeys use a different format and live in `.claude/skills/drafting-data/User_Journeys/`.
actor: practitioner
trigger: research on a basis slot comes back exhausted — no supporting authority found — and 🚧 dead end lands on the mockup
outcome: the practitioner chooses the point's fate — reframe, drop, or proceed unsupported — the choice is written and the mockup re-rendered to reflect it
path: decision (this journey is a decision point, not a happy path — the one place drafting must stop and ask)
status: aspirational (desired UX — not yet verified against the implementation)
source: effort owner's flow selection, 2026-08-23
---

# Dead-end decision

## The journey

1. **Assistant:** an earlier basis slot (🏛️ jurisdictional basis needed, or 📖 doctrinal basis needed) went out through `/legal-research`. The research-agent reports back: the search is exhausted, nothing found. The assistant records the dead end through `/drafting-data`, re-renders, and presents the mockup file card (`shared/present-files.md`) — the affected line now carries 🚧 dead end.

2. **Assistant:** states the dead end once, plainly, in chat — never folded into a task list, never queued behind other work. Unlike every other marker, no further research or drafting clears 🚧; only the practitioner's decision does, so the assistant asks and stops:

   > Research on "a strata corporation may recover legal costs as damages" came back empty — no BC authority supports it. That point is at a dead end. Your call:
   >
   > 1. **Reframe the point** — restate it and I open a new research question.
   > 2. **Drop the point** — remove it, or hold it in reserve.
   > 3. **Proceed unsupported** — advance it without authority, recorded as your tactical call.

3. **Practitioner (reframe):** restates the point more narrowly.

4. **Assistant:** writes the reframed point through `/drafting-data` and dispatches a fresh research question through `/legal-research` — never supplying a replacement authority itself. The new point opens its own basis slot with its own marker; re-render, present the mockup.

5. **Practitioner (drop):** says to drop it.

6. **Assistant:** asks the one follow-up this choice needs — remove outright, or hold in reserve (🂡 held in reserve)? Reserved material keeps rendering in the mockup's *Held in reserve* section for the practitioner and is withheld from the forum; removed material goes entirely. Write, re-render, present.

7. **Practitioner (proceed unsupported):** decides to run the point anyway.

8. **Assistant:** records the decision as the practitioner's tactical call — the point is never dressed up as supported, and the assistant neither endorses nor argues against the choice beyond having presented it. Write, re-render, present.

## Principles this journey encodes

- **The decision is the work.** 🚧 is the one terminal marker: research ran dry, and what remains is a choice only the practitioner can make. The assistant presents the three options and stops — it never picks, nudges, or defaults.
- **Present once, plainly.** A dead end is surfaced as a direct question the moment it lands, not buried in a task list or duplicated into a separate to-do — the marker on the mockup is its only record.
- **Reframe re-enters the gate.** A reframed point is a new research question for `/legal-research`; the assistant never fills the gap with legal content of its own.
- **A dead end is not a denial and not a gap.** 🚧 renders only when research or investigation actually ran dry; a refusal to admit, or a slot not yet researched, stays on its own marker.
- **Rendered for the human, withheld from the forum.** A dropped-to-reserve point stays visible in *Held in reserve* on the mockup; an unsupported point is carried as the practitioner's recorded call, never as verified law.

Paired data journeys: `.claude/skills/drafting-data/User_Journeys/two-kinds-of-legal-basis.md` (the two basis slots and how each dead-ends), `.claude/skills/drafting-data/User_Journeys/broad-sweep-to-verified-authority.md` (the research path that ends at filled or 🚧).
