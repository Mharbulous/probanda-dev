```json
{
  "renderer": "bespoke",
  "needs_forum_parts": true,
  "title": "Respondent's factum",
  "exhibit_numbering": "writing",
  "goal_criteria": ["noting-up", "open-items", "counsel-review"],
  "ingest_inputs": ["5. COURT*", "7. DISCOVERY*"]
}
```

# BCCA respondent's factum

Read this file before eliciting: it holds this kind's specifics, and `/draft`'s `SKILL.md` governs the rest.

The respondents' factum on an appeal under Court of Appeal Rules Rule 25(2). No prescribed form exists: its parts follow the court's respondent's factum template, which the factum completion instructions make binding. The gatekeeper's checklist says where each part is stored.

The factum is the substantive venue document, so every item deploys to it and there is no deployment question. The court-ready Word document comes from the assembly step once the mockup is filing-ready: see "Court-ready assembly" below.

**Elicit, alongside the rest of the substance:**

- **Cover page details:** the order under appeal (judge, court below, date pronounced), any sealing order, publication ban or anonymity order (ask, most matters have none), counsel contact details for both sides, each party's role in the court below, and party names in the notice of appeal's own order and format. Confirm rather than re-ask anything already recorded for a stay response on the same appeal.
- **Chronology:** a brief list of only the critical events and dates relevant to an issue on appeal. Every factum has one, and no source located permits adopting the appellants' chronology by reference.
- **Opening statement:** a concise statement of the nature of the appeal, one page at most, not paragraph-numbered.
- **Part 1, the respondents' position on the appellants' statement of facts.** Agreement is a position ("The respondents agree with the appellants' statement of facts, except..."). Then any other facts the respondents consider relevant, each with its source: the volume and page of the appeal record or appeal book, or the volume, page and line of the transcript.
- **Part 2, the appellants' points in issue.** Read the appellants' factum, transcribe each point verbatim, and confirm the transcription with the practitioner before writing. Each is answered by a submission. The respondents may also raise other points they may properly put in issue.
- **Part 3, the argument:** the points of law, each with its record references and supporting authorities. Every statement of law comes through the research gate.
- **Part 4, the order sought:** including the costs disposition, and the city where the factum is signed. The date is asked at assembly. The factum carries the name of the person authorizing filing, not a signature.
- **Enactments:** acts and regulations relied on in the argument are reproduced in an appendix from their stored excerpts. Court rules are held back for the practitioner's decision, and the mockup says which. A rule held back is left out of the Book of Authorities too, and stays on the Appendix: List of Authorities either way — re-record it as a regulation to have it reproduced in both. What each authority kind does in the Book of Authorities, and which parts of that are the Rules' requirement rather than the practitioner's choice, is in `publish/subskills/publish-bcca-book/references/bcca-book-contract.md` (#813).

## Route

Forum: BC Court of Appeal. Assembly route: `/publish` with `publish-bcca-factum`.

## Court-ready assembly

This kind is assembled by `/draft`'s `references/court-ready-assembly.md`: its common rule, then these steps.

Before calling the emitter, ask the practitioner the date the factum is to be dated (`YYYY-MM-DD`) and pass it. Call `drafting_forms__emit_bcca_factum`. On success, write the markdown to `<matter-data folder>\bcca-factum-substance\bcca-factum.md`, then invoke `/publish` with `publish-bcca-factum`, drive its protocol to completion, and present the resulting Word document as a file card (`shared/present-files.md`). `publish/subskills/publish-bcca-factum/references/bcca-factum-contract.md` owns the substance-file grammar.
