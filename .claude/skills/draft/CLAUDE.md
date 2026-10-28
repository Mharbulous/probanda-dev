# draft/

Defined terms for the draft skill. Terms common to all skills are in `../CLAUDE.md`. Where a term below is defined earlier elsewhere, that definition governs and this file only points to it.

| Term | Meaning |
|---|---|
| **Writing** | Any legal writing this skill drafts: a Filing, a letter, a memo. |
| **Substance** | A Writing's content, written from the practitioner's instructions and matter knowledge and stored through `/drafting-data`. Never edited by hand. |
| **Mockup** | The fresh render of the stored substance. The sole review surface of a Writing. Strict format: a YAML header, then only printed wording, work markers and `<!-- comments -->`, then the generated Legend. A gap is a marker and a blank underline with its description in a comment, `🧩 ________ <!-- signer not chosen -->`. The model never writes a mockup. |
| **Structured Writing** | A Writing whose type file declares its layout. Letters, memos, the release and the BCSC forms are Structured. Defined in the root `GLOSSARY.md`. |
| **Unstructured Writing** | A Writing whose type has no declared layout yet. It is created on a stock type, the venue's `unstructured` or under `_NoVenue` the recipient's `unstructured-<recipient>`, its printed wording goes into slots, and it renders through the general renderer like any general Writing. Defined in the root `GLOSSARY.md`. |
| **Reply** | A reply to a message from the tribunal or counsel, kept as a plain markdown draft in the draft folder. Not a Writing, and has no mockup (`references/reply.md`, ADR 0040). |
| **Filed face** | The text as delivered to the forum. Defined in the root `CLAUDE.md`. Unverified or reserved material renders on the mockup and never appears here. |
| **Type file** | A file in this skill's knowledge tree that declares a Writing's layout, draft-folder code, companions and Milestone criteria. Found by the "Venue and kind lookup" in `SKILL.md` section 8. |
| **Revision** | A change request, made in the same words as the first draft. There is no revision mode (`SKILL.md` sections 1 and 12). |
