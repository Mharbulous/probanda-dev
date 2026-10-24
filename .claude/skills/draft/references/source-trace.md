# Source-trace review

Read when: a letter, email or memo mockup is about to be presented, any email is about to be written by `shared/email.md`'s `write_email` (an email Writing, a covering email, or a reply on the reply route), or the practitioner asks whether a draft's facts are sourced. This file is the one source for the review. SKILL.md ban 20 makes it a gate.

Every letter can be used as evidence of what it states. The review checks each fact the text states against its primary source, in an agent isolated from the drafting session, so that a fact taken on another person's say-so never leaves the firm as the firm's own. It runs on every letter, email, memo and reply, scheduling and transmittal notes included. It does not replace the passes of `references/letters.md` §4 or `references/overstatement.md`, and it states no law.

## 1. When

- Before each presentation of a letter, email or memo mockup whose text changed since its last review.
- Before each `write_email` call. The covering email of a letter is reviewed on its own body. A letter it encloses was reviewed at its mockup. An empty body states nothing and needs no review.
- On the reply route, before the `.eml` of `references/reply.md` §6.

## 2. Spawn the reviewer

Spawn the `litigator:source-tracer` agent once for the text, from the main session, with:

- `kind` and `audience`.
- `matter_root`.
- `text`: the exact text that will go out. For an email, the exact `body` the `write_email` call will pass, character for character. For a letter or memo, the mockup's text as rendered.
- `sources`: the locators of what the draft was written from (paths, mail uids, Message-IDs), the scrivener's `sources` lines among them. Locators only: never a summary of what a source says.
- `accepted`: the assertions the practitioner has accepted in an earlier round on this text, with their words.

## 3. Resolve each finding

- **`verified`.** Nothing to do.
- **`attribute`** and **`cut`.** Revise the text to `proposed_text`. These need no question: the text then says only what a source supports. The revision is the scrivener's: spawn it with the finding and its `proposed_text` as its `instruction` (`references/letters.md` section 5, `shared/correspondence-isolation.md`).
- **`trace_needed`.** Ask the practitioner, one finding at a time, by `/show-me`: the draft's words, what was checked, and the record that would settle it, with the file card of the source the claim came from. Their choices: point to a source (re-review), attribute it, leave it out of the text, or accept it as their own knowledge. An accepted assertion goes into `accepted` for the next round.
- **`unanswered`.** Ask, one at a time, by `/show-me`, whether the text should answer the characterization. Never answer it on the practitioner's behalf.
- **`unread_sources`.** Say in one line which sources could not be opened.
- **`accepted`.** Nothing to do.

Each question is a decision, not a review surface: ban 13 holds, and the Writing is still reviewed in its mockup. Speak of the review in plain words ("I checked each fact against its source"), never by the agent's name (`shared/internals-confidentiality.md`).

## 4. Deliver only the reviewed text

When any finding changed the text, spawn the reviewer again on the final text, with every accepted assertion. Present the mockup or write the email only when the last review of that exact text returned no `attribute`, `cut` or `trace_needed` and no open `unanswered`. The email's `body` is then the reviewed text, character for character, so the plugin's check of the email passes. A refused `write_email` means the text was not reviewed as it stands: review it, never reword it to get past the refusal.
