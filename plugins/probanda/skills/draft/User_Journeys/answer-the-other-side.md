---
journey: Answer the other side
kind: ux journey — describes the interaction the practitioner experiences, not the data model. Data-focused journeys use a different format and live in `.claude/skills/drafting-data/User_Journeys/`.
actor: practitioner
trigger: an opposing point lands — in the other side's submissions, correspondence, or an application response — and the practitioner forwards or mentions it
outcome: every opposing point is recorded against the submission or order it attacks, and the package renders with zero silent ↩️ — each point answered or deliberately unanswered
path: happy
status: aspirational (desired UX — not yet verified against the implementation)
source: effort owner's flow selection, 2026-08-23; steps 2, 4, 7 and 8 amended 2026-09-13 so the practitioner places each point and supplies each answer (`Engineering/1. Design/2026-09-13_paralegal-posture-and-outline-vocabulary-design.md` §5.2)
---

# Answer the other side

## The journey

1. **Practitioner:** forwards the other side's application response as it arrives, mid-conversation about something else:

   > They're now saying the arbitration clause was never incorporated into the contract. Paragraphs 12–15.

2. **Assistant:** asks which submission or order sought the point attacks, offering the Writing's own submissions and orders as the choices — a fixed list from the record, never an inference of its own — then records the point against the one the practitioner names, re-renders, and presents the mockup as a file card. On the attacked submission's line, ↩️ rebuttal needed now shows the answer still owed. No summary in chat — the marker on the mockup is the record.

3. **Practitioner:** over the following weeks, more points land — a passage from the other side's written submissions, an assertion in counsel's letter. Each gets forwarded or mentioned the same way, some in sessions about other work entirely.

4. **Assistant:** asks the same question for each — which submission or order sought it attacks, from the Writing's own list — records it where the practitioner places it, and the mockup accumulates ↩️ markers in place. Nothing waits in anyone's head or in a side list; the work product itself shows every answer still owed.

5. **Practitioner:** sits down to respond:

   > What do we still owe them answers on?

6. **Assistant:** renders the mockup fresh and presents it — the ↩️ markers are the list, read in place (see the mockup's closing Legend). Then works through them at the practitioner's pace.

7. **Practitioner:** takes each ↩️ one of three ways: dictates the answer directly; asks what the matter already holds that bears on the point, picks from the facts the assistant offers, and says in their own words what those facts answer; or identifies a point of law to be answered.

8. **Assistant:** stores each answer in the practitioner's words as the answering submission, linked to any facts they picked, and re-renders — each answered point's ↩️ clears on the next mockup. Where an answer leaves part of the point unmet, the assistant asks about that part; it never composes the rest. For the point of law, it invokes `/legal-research`; until the research-agent returns, the legal slot stays open and renders its own marker on the mockup. The assistant never supplies the legal content itself.

9. **Practitioner:** makes one tactical call:

   > Draft the answer to their delay point, but hold it — I want to spring it at the hearing.

10. **Assistant:** stores the drafted answer held in reserve 🂡 — it renders in the mockup's *Held in reserve* section, for the practitioner's eyes, withheld from the forum. Where the practitioner instead decides a point deserves no answer at all, that decision is recorded too, so the point never reads as unfinished work.

11. **Assistant:** re-renders after the last point is dealt with. The mockup shows no ↩️ anywhere: every opposing point is answered, held in reserve, or deliberately declined — the responding package is ready.

## Principles this journey encodes

- **Capture at the moment of landing.** An opposing point is recorded the moment the practitioner forwards it, whatever the session was about — the cost of capture is one sentence, and nothing is carried in memory to a later drafting session.
- **The mockup is the response worklist.** ↩️ renders in place on the line it attacks; there is no separate list to maintain, and "what do we still owe?" is answered by rendering, not recalling.
- **The practitioner places the point.** Which submission or order a point attacks is asked, offered as the Writing's own fixed list, and never inferred.
- **The answer is the practitioner's; law goes through the gate.** A rebuttal is dictated or asked for. The assistant may offer facts the matter already holds for the practitioner to pick from, but never composes the answer. Its legal content comes only through `/legal-research`. An open legal slot renders as an honest marker, never as guessed law.
- **Deliberate silence is recorded, not implied.** A point held for the hearing (🂡, rendered for the human and withheld from the forum) or declined outright is a decision on the record — the finish line is zero silent ↩️, not zero unanswered points.
- **Same capture habit as the evidence side.** Recording a concern where it was seen, for a later fact-by-fact pass, mirrors `.claude/skills/drafting-data/User_Journeys/flag-inadmissible-evidence.md` — whose objection list serves the same responding flow.
