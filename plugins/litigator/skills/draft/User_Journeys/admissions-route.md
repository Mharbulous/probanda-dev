---
journey: Run an admission route end to end
kind: ux journey — describes the interaction the practitioner experiences, not the data model. Data-focused journeys use a different format and live in `.claude/skills/drafting-data/User_Journeys/`.
actor: practitioner
trigger: practitioner asks to seek admissions of chosen facts and documents by Notice to Admit
outcome: every requested item climbs its ladder — drafted, served, waited on, classified or deemed, surviving a strike where one lands — until the admission is entered before the tribunal and the line goes clean
path: happy
status: aspirational (v2 machinery — the admissions storage and markers are not yet in v1)
source: effort owner's flow selection, 2026-08-23; steps 2, 6 and 10 amended 2026-09-13 so requests are recorded, classifications read back and proof asked for (`Engineering/1. Design/2026-09-13_paralegal-posture-and-outline-vocabulary-design.md` §5.2)
---

# Run an admission route end to end

## The journey

1. **Practitioner:** picks the facts and documents opposing counsel should be made to admit and asks for a Notice to Admit.

2. **Assistant:** records the facts and documents the practitioner named, in their words, as the Notice to Admit's requests through `/drafting-data` — asking for the wording wherever the practitioner's naming leaves a request open, never drafting around it — renders the mockup, and presents the mockup file itself (`shared/present-files.md`) for the practitioner to open — no approval pause before writing or rendering. Every requested item carries 🎾 serve it: the notice is paper until it is served, and service is the practitioner's act, never the assistant's.

3. **Practitioner:** (days later) has the notice served and reports it.

   > Served on opposing counsel today.

4. **Assistant:** records that service happened; diarizing the response period is the practitioner's step in a separate session. The mockup re-renders with every item on ⏳ waiting on others — the next move belongs to the other side, and practitioners do not wait on themselves. Nothing nags in the meantime.

5. **Practitioner:** (weeks later) the response has arrived and hands it over.

6. **Assistant:** records the response and reads back, item by item, how the response appears to answer each — 🤝 admitted, 🙅🏻‍♂️ denied, 🫸 refused, 🤷 no knowledge — quoting the response's own words for each, and asks the practitioner to confirm or correct the classification before it is recorded. An item the response is silent on counts as unanswered on that item, so it lands ⏰ deemed admission, and the assistant says which items those are. Once the practitioner has confirmed each, the mockup re-renders and the ladder is legible at a glance — each 🤝 and ⏰ now shows the capture work it routes (📑 the passage, 📌 the pinpoint into the notice and response — the exhibit pair, because a Notice to Admit and its response are answers drafted by counsel, where interrogatories or an examination would owe 💬 and 🧷 for the party's own words), while each 🙅🏻‍♂️ 🫸 🤷 hands its fact to the evidence branch (see `.claude/skills/drafting-data/User_Journeys/fact-work-on-the-witness-statement.md`).

7. **Practitioner:** (later) opposing counsel applied and one deemed admission was struck; a fresh response period was ordered. Separately, a late answer to another item arrived, and the practitioner asks whether it displaces that item's deemed admission.

8. **Assistant:** records the strike — that item shows ⚡️ struck, and because the tribunal reset the clock it runs ⏳ again; had no new period been ordered, the proof problem would reopen on the evidence branch instead. The late answer is recorded but moves nothing on its own, and whether a late response can displace an accrued admission is a question of law — the assistant invokes `/legal-research` and relays the research-agent's answer rather than supplying one. Until that comes back, the item keeps ⏰.

9. **Practitioner:** asks to put the surviving admissions before the tribunal in the submissions package.

10. **Assistant:** each admission shows 🕹️ enter it until a Writing selects its proof. For each admission, the assistant asks which proof the practitioner wants put before the tribunal (for an express admission the response is on file; for a deemed one, the notice and the affidavit of service), selects what they name into the Writing, and re-renders. Entered items go clean: an admission is proof only once it is put before the tribunal; until then it is paper. The mockup is presented one last time, every line either clean or naming its remaining work.

## Principles this journey encodes

- **The ladder is visible, never narrated.** At every beat the mockup shows each item's rung by its marker — 🎾 ⏳ 🤝 🙅🏻‍♂️ 🫸 🤷 ⏰ ⚡️ 🕹️ — so the state of every requested admission is read off the review surface, not reconstructed from chat.
- **The practitioner names and confirms; the assistant records.** The requests are the facts and documents the practitioner named, each response's classification is read back for confirmation rather than asserted, and the proof put forward for each admission is asked.
- **The practitioner acts on the world; the assistant keeps the record.** Serving the notice and entering proof at the hearing are the practitioner's acts. The assistant records them and re-renders — it never blocks on approval to write or render.
- **An event routes work; it is not a status.** A response landing, a deadline expiring, a strike — each lands as an event whose marker prefixes the work it routed: admissions to capture and enter, denials to the evidence branch, a strike back to waiting or to proof.
- **Deemed is earned by the calendar, not asserted.** ⏰ follows from service, the deadline, and silence. Whether anything later defeats it is a question of law that passes through `/legal-research`; the assistant never resolves it from its own impression.
- **Admitted is not yet proved.** The route ends at 🕹️ enter it — selection into a Writing is what turns the admission from paper into proof, and only then does the line go clean.
