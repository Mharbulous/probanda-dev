---
journey: Research fills the open slots
kind: ux journey — describes the interaction the practitioner experiences, not the data model. Data-focused journeys use a different format and live in `source/skills/drafting-data/User_Journeys/`.
actor: practitioner
trigger: an order sought is added during drafting with no legal basis yet on file; later, every completion criterion printed above counsel's review holds
outcome: every basis slot holds a verified authority that entered through the /legal-research gate (or an honestly recorded dead end), every authority is noted up, and adverse treatments sit on the mockup for the practitioner to weigh
path: happy
status: aspirational (desired UX — not yet verified against the implementation)
source: effort owner's flow selection, 2026-08-23; step 2 amended 2026-09-13 so the argument is asked for, not written (`Engineering/1. Design/2026-09-13_paralegal-posture-and-outline-vocabulary-design.md` §5.2); trigger and steps 7–8 amended 2026-09-24 so the drafting conditions, not a declaration, start the sweep (#955)
---

# Research fills the open slots

## The journey

1. **Practitioner:** while drafting, adds an order sought — "an order that the respondent pay damages of $40,000."

2. **Assistant:** records the order exactly as dictated through the data gatekeeper, and asks for the argument rather than writing one:

   > What will you be telling the tribunal is the reason it should make that order?

   The practitioner answers — the respondent's late delivery cost the applicant the resale contract — and the assistant records that argument in the practitioner's words, renders, and presents the mockup as a clickable file card (`shared/present-files.md`) — never a paste of its contents into chat. The mockup shows two markers: 🏛️ *jurisdictional basis needed* on the order's own line (law for the power to grant the order) and 📖 *doctrinal basis needed* on the argument's line (law for the test applied in deciding). They are different deficiencies fixed by different research, so the assistant dispatches each as its own question through the `/legal-research` gate — it never supplies the law itself. (Paired data journey: `source/skills/drafting-data/User_Journeys/two-kinds-of-legal-basis.md`.)

   > Two research questions are out: whether the tribunal has the power to award these damages (🏛️), and the test it applies in deciding (📖). Both markers stay on the mockup until verified authority comes back.

3. **Practitioner:** offers what they already have.

   > I found an Ontario firm's article on this over the weekend, and our research memo from last year names a case on the damages test.

4. **Assistant:** records both as unverified leads. Neither is citable yet — not the out-of-province article, and not the case from the matter's own memo: only the research lawyer's verification upgrades an authority, whatever its provenance. The leads render on the mockup in the trailing *Held in reserve* section beside the slots they inform — rendered for the human, withheld from the forum. The two markers now part company. 📖 means *no statement of law at all*, so the memo's case clears it and the argument's line reads 🔬 *scrutinize* instead: a lead is in hand, and what is owed is checking its fit and its ratio, not more research. 🏛️ reads the order's own recorded basis, which an unverified lead does not fill, so it stands as it was. Neither line reads clean, because an honest gap is correct data. The assistant passes each lead along with its research question, so the research lawyer starts warm instead of cold. (Paired data journey: `source/skills/drafting-data/User_Journeys/broad-sweep-to-verified-authority.md`.)

5. **Assistant:** while research is out, nothing is faked. Any re-render in the meantime shows the same markers — 🏛️ on the order's line, 🔬 on the argument's — and the same held-in-reserve leads, because the mockup reports the true state of the work, not a hopeful one.

6. **Assistant:** the research lawyer returns a verified BC authority for each question. The assistant records each through the data gatekeeper, re-renders, and presents the fresh file card: 🏛️ is gone from the order's line and 🔬 from the argument's — verification is the one act that clears 🔬 — and any remaining capture work (📜 *excerpt needed*, 📍 *pinpoint missing*) shows on the authority's line until done. Had a question come back empty, the slot would instead show 🚧 *dead end* — the practitioner's decision to reframe, drop, or proceed unsupported, and the assistant asks rather than papering over it.

7. **Practitioner:** some days later, fills the last open drafting item. Every completion criterion printed above counsel's review now holds.

8. **Assistant:** announces it in the Opening and runs the pre-filing sweep without being asked: reads the mockup for every 📇 *note up* (authority never checked) and every 👃 *dubious* (a doubted statement of law), and dispatches the whole batch through the `/legal-research` gate in one round. Treatments come back and the assistant records them, re-renders, and presents the file card with the results in place:
   - Authorities that check out clean carry nothing — a clean line is the finished state.
   - One authority picks up an ⚠️ *distinguishable* prefix, another a 🚨 *negative treatment* prefix. Both are still law; the mockup shows them for the practitioner to weigh — argue past, disclose, or replace.
   - One comes back ⛔ *not good law*. The basis slot that authority was filling reopens — 🏛️ or 📖 returns to its line — and the assistant immediately dispatches a replacement question through the gate, reporting what it did.

   > The note-up round is back. Two authorities are clean. The limitation case is ⚠️ distinguishable on its facts, and the interest case has 🚨 negative treatment — both are flagged on the mockup for your call. The damages case was overruled (⛔), so that slot is open again and a replacement question is already out.

9. **Practitioner:** opens the mockup, weighs the ⚠️ and 🚨 flags, and answers in the same conversation — keep one and argue past it, replace the other. The assistant re-enters the loop at step 2's shape: open the slot, dispatch the question, let the marker stand until verified authority returns.

## Principles this journey encodes

- **The order and its argument are the practitioner's.** The assistant records the order as dictated and asks for the argument; it never composes either.
- **Every authority passes through the gate.** Drafting writes only unverified leads — even an authority named in the matter's own prior research memo enters as a lead. Verification by the research lawyer is the only thing that upgrades it, and the assistant never states the law itself.
- **Two bases, two markers, two questions.** Power to grant (🏛️) and test applied (📖) are distinct research asks; the mockup keeps them distinguishable so the practitioner never has to open a slot to learn which research is missing.
- **Open markers are honest.** While research is out, the gap renders as a gap. Leads and reserved material render for the human in *Held in reserve* and are withheld from the forum — never hidden from the mockup, never shown to the tribunal.
- **Treatment is the practitioner's call, except ⛔.** ⚠️ and 🚨 render for weighing and block nothing; only *not good law* mechanically reopens the slot and triggers replacement research.
- **No approval pauses.** Recording leads, writing verified authorities, dispatching the note-up sweep, and re-rendering all happen without asking first — the file card carries the review.
