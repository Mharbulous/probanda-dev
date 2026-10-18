---
name: suggestion
description: "File the practitioner's own idea or complaint about the Probanda plugin (a page, a skill, a behaviour they dislike or want changed, or an idea they ask to send to Probanda) in the Suggestion Box: draft a scrubbed title and body, show the exact text, post it only on their yes, then resume the interrupted work. When the practitioner voices dissatisfaction with the plugin, offer this once instead of looking for, cloning or editing the plugin's source. Not for loose threads, which have their own vetted route into the Suggestion Box."
---

# Suggestion

The practitioner's route for their own ideas about the plugin. Each post is saved in Probanda's Cloud, marked as from the user. The practitioner's ideas are not weighed for merit: they go in as the practitioner wants them. The installed plugin is a read-only synced copy. Never look for, clone or edit its source to make the change yourself.

1. **Offer once.** When the practitioner says they dislike or want changed something about the plugin, and has not asked for this skill, offer it in one line: "Would you like me to send that to Probanda as a suggestion (/lawyer:suggestion)?" Do not offer again for the same point in this session. Run the steps below only on their yes, or when they invoke the skill.
2. **Precondition.** The `suggestion_box__submit` tool is served by the researcher plugin. If it is not installed, say in one line that posting a suggestion needs the researcher plugin, post nothing by any other route, and resume the prior work. Otherwise `legal_commons__configure_status` reports `configured: true`. If not, say in one line that the Suggestion Box needs Probanda's key set once through `legal_commons__configure_credential`, and resume the prior work.
3. **Take their words.** Use what the practitioner said about the plugin, and nothing from the matter.
4. **Draft.** A title of at most eight words, and a body of one short paragraph that keeps the practitioner's point and wording where it can. Remove every person, entity, matter, document and path. Name the plugin's part (a page, a skill, a tool) generically.
5. **Show the exact text, then ask.** Show the title and the body exactly as they will be posted, then ask in plain text, under `/show-me`: "Would you like to submit this suggestion?" Yes | No | Modify. Under Yes, state the mechanism: `suggestion_box__submit · saved in Probanda's Cloud · free`.
   - **Yes.** Only after an explicit yes, call `suggestion_box__submit({title, body, source: "user"})` with the text shown, unchanged. Add `skill` with the skill's name when the suggestion is about one skill.
   - **No.** Post nothing.
   - **Modify.** Take the practitioner's new text and show it again for a yes. Their edited text goes to the tool exactly as typed, because they are its author.
6. **Report.** Say the suggestion was received, with the suggestion id the tool returns. A refused post (a redaction hit, Probanda's Cloud not reached, the key refused) is reported in one line with the kind of hit, never the text. Then offer to redraft once, or leave it.
7. **Resume.** Go back to the work the suggestion interrupted, at the point it stopped and with its plan unchanged.
