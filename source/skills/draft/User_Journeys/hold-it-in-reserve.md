---
journey: Hold it in reserve (and bring it back)
kind: ux journey — describes the interaction the practitioner experiences, not the data model. Data-focused journeys use a different format and live in `source/skills/drafting-data/User_Journeys/`.
actor: practitioner
trigger: mid-drafting, the practitioner says "don't put that in yet" about a submission, an authority, or a piece of evidence
outcome: the material moves to the mockup's trailing *Held in reserve* section — always visible to the practitioner, never on the filed face — and one later sentence brings it back
path: happy
status: aspirational (desired UX — not yet verified against the implementation; scoped to the VanIAC submissions package below — the BCSC Notice of Application does not have a trailing *Held in reserve* section at all, so this journey's defining mechanism does not apply there, see [#367](https://github.com/Mharbulous/CoClerk/issues/367) and the reserved-vs-crossed-out design ticket it opened)
source: effort owner's flow selection, 2026-08-23
---

# Hold it in reserve (and bring it back)

## The journey

1. **Practitioner:** reviewing the mockup of a submissions package, decides one point is better kept for later:

   > Take the delay submission out for now — I don't want to show our hand on that yet.

2. **Assistant:** records the hold and immediately re-renders — no confirmation prompt, no "are you sure". On the regenerated mockup the delay submission, with its supporting authority and evidence, now sits in the trailing *Held in reserve* section marked 🂡 held in reserve. The assistant presents the mockup file itself (`shared/present-files.md`) for review, naming in one line the supporting authority and evidence that went into reserve with the submission, so the practitioner can say if any of it should stay in rather than having that assumed. Nothing was deleted: the practitioner can still read every word of the reserved material on the mockup, and none of it will appear on the filed face — the text as delivered to the forum. Reserving took one sentence.

3. **Practitioner:** goes further with one piece of evidence:

   > The recantation statement — don't file it at all. I'm holding that back to impeach their site manager on cross.

4. **Assistant:** records the impeachment posture. On the next render the statement carries 🤥 impeachment instead of the bare 🂡 — impeachment is a species of held in reserve, so the specific marker replaces the general. It renders in the same *Held in reserve* section, and the marker tells the practitioner at a glance *why* this one is held: not merely deferred, but deliberately kept out of the filed materials to impeach on cross-examination.

5. **Practitioner:** days later, circumstances change:

   > Actually, put the delay submission back in.

6. **Assistant:** clears the hold and re-renders. The delay submission returns to its place on the filed face of the mockup, gone from *Held in reserve*. Whatever work markers it carried while reserved come back with it — its supporting authority's passage, still needing capture, still shows 📜 — because holding something in reserve never paused the work on it. The assistant presents the regenerated mockup and the practitioner sees the document exactly as it would now go to the forum.

## Principles this journey encodes

- **Reserving is a tactical instruction, not a workflow.** One spoken sentence in, one out. No mode, no checklist, no approval step — the practitioner says "don't put that in yet" and the next mockup reflects it.
- **Rendered for the human, withheld from the forum.** Reserved material always appears on the mockup, in the trailing *Held in reserve* section, and never on the filed face. The practitioner never loses sight of what they are holding back (the settled rule of `docs/adr/0004-submission-single-database-privilege-by-kind.md`, which also fixes that a reserved item reaching the filed face is a renderer defect, caught by deterministic tests).
- **Reserved is deferred work, not finished work.** 🂡 marks a pending deploy-or-abandon decision, and 🤥 names its impeachment species. The hold posture is orthogonal to the work markers: a reserved item keeps its own to-dos, and both render together.
- **Bringing it back is symmetric.** Nothing is deleted by reserving, so "actually, put that in" is a complete instruction — the material returns to the filed face on the next render with its work intact.

Related data journeys: `source/skills/drafting-data/User_Journeys/broad-sweep-to-verified-authority.md` (tier-3 authority leads render under the same held-in-reserve rule) and `source/skills/drafting-data/User_Journeys/fact-work-on-the-witness-statement.md` (the trailing-section mechanism carrying drafting to-dos).
