---
journey: Work the worklist
kind: ux journey — describes the interaction the practitioner experiences, not the data model. Data-focused journeys use a different format and live in `source/skills/drafting-data/User_Journeys/`.
actor: practitioner
trigger: the practitioner asks to work through what's outstanding on a submission — from any starting point (after a first draft, after a revision burst, mid-session), not only the resume flow
outcome: every work marker on the mockup is either worked as the practitioner directed, under their own list read back and approved, or listed for the practitioner where only a human can do it, and a revised mockup (revision bumped) is presented as a file card when the dispatched work finishes
path: happy
status: aspirational (desired UX — not yet verified against the implementation)
source: effort owner's flow selection, 2026-08-23; steps 3–4 amended 2026-09-13 so the practitioner, not the assistant, says what is done about each marker (`Engineering/1. Design/2026-09-13_paralegal-posture-and-outline-vocabulary-design.md` §5.1)
note: superseded in part by schema v15 / ADR 0009 (2026-09-02) — a session is now job-driven; the "one approval, of the practitioner's own list" model below describes work done *inside* an approved job's plan, not a standalone flow entered without a claimed job.
---

# Work the worklist

This is the marker-driven orchestration flow as a standalone journey. Steps 5–8 of `source/skills/draft/User_Journeys/pick-up-where-you-left-off.md` are one instance of it, entered from a session resume; this journey can be entered from anywhere.

## The journey

1. **Practitioner:** at any point in a drafting session, says something like:

   > Work through what's outstanding on the Notice of Application.

2. **Assistant:** reads the current mockup's work markers (the emojis — see the mockup's closing Legend). The markers **are** the worklist: there is no separate task list to build or maintain, so the plan can never drift from the document. Each marker names its own task:
   - 📜 📑 💬 excerpt needed → retrieve the verbatim passage from the source already identified; the glyph says which kind of source it is — an authority, an exhibit, or a witness's own words
   - 📍 📌 🧷 pinpoint missing → locate that passage in that source, split the same three ways
   - 🏷️ not recorded → look up the missing label, date, or description — a lookup, not drafting
   - 🏛️ jurisdictional basis needed, 📖 doctrinal basis needed, 🔬 scrutinize, 📇 note up → dispatch through the `/legal-research` gate; nothing else may supply the law. 🔬 is not more research: a lead is already in hand, and what is asked is whether its excerpt supports the proposition and is the court's own reasoning
   - 🧩 gap → ask the practitioner, or search the matter's own record first and confirm what's found
   - ✒️ swear it, 🖋️ sign it → a deponent swears, a witness signs; no subagent can do this, so it is listed for the practitioner, never dispatched

3. **Assistant:** puts the outstanding markers to the practitioner one at a time and asks what they want done about each — work it now and how, or leave it — recording each answer in their words:

   > Paragraph 14's authority has no pinpoint. Do you want that located now, and is there a copy of the decision on file you'd rather I work from?

   Human-only work (✒️ 🖋️) is named as the practitioner's to do, not asked about. When every marker has an answer, the assistant reads the practitioner's list back and asks whether it stands. How the list runs is mechanical and stated in one line: items on independent slots run in parallel, items touching the same passage run one after another, and an item waiting on another's answer (a 📍 behind its 📜 on the law side, where capture comes before locating) runs once that answer lands.

4. **Practitioner:** confirms the list as read back and approves it. Writing and rendering individual changes never pause for approval.

5. **Assistant:** dispatches the subagents. Legal slots go through `/legal-research`: drafting writes only unverified leads, and only the research-agent's verification upgrades an authority's standing. Each completed task comes back as a TLDR summary; a question surfaces only when a task is genuinely stuck. The practitioner watches progress without supervising it, and works the human-only list on their own schedule.

6. **Assistant:** when the dispatched work is done, regenerates the mockup once — revision bumped, superseded copy archived — and presents it as a file card (`shared/present-files.md`) the practitioner opens in one click. Markers whose work finished are gone; the human-only markers remain until the practitioner clears them.

## Principles this journey encodes

- **The markers are the worklist.** Planning reads the same emojis the practitioner sees on the mockup; there is no second task list to drift out of sync with the document.
- **Every marker maps to a mover.** Retrievable work goes to subagents, statements of law go through the `/legal-research` gate, and human-only work (✒️ 🖋️) is surfaced to the practitioner — never dispatched, never silently dropped.
- **The practitioner says what is done.** Each marker names what is missing; what to do about it is asked, never decided by the assistant. The list that runs is the practitioner's, read back in their words.
- **One approval, of the practitioner's own list.** The only pause is approval of that list as read back. How it fans out is a mechanical choice the assistant states and makes; individual writes and renders never block, consistent with `SKILL.md`'s no-blocking-checkpoint rule.
- **Report by TLDR, interrupt only when stuck.** Completions arrive as short summaries; questions surface only when a task cannot proceed without the practitioner.
- **One regeneration at the end.** The loop closes with a single revision-bumped mockup presented as a file card — the same surface the worklist was read from.
