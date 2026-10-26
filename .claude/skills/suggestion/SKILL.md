---
name: suggestion
description: "Turns a practitioner's experience of Probanda into a suggestion to its maintainers, and saves a fix that worked as their own preference. Use at three moments: (1) a task is finished, the practitioner is satisfied, and getting there took corrections, rejections, repeated instructions or workarounds; (2) Probanda has stopped because it cannot do what the practitioner needs (a missing capability or a refusal), after ruling out a setup or configuration fault; (3) the practitioner asks to suggest, request, report a bug or regression, or give feedback on how Probanda works (\"Probanda should…\", \"tell the developers…\", \"from now on, always…\"), even mid-task. Not for corrections to the practitioner's own document or draft, not mid-task unless the practitioner raises it, not when the only sign is an irritated tone, not for a setup or configuration fault, and not for loose threads, which have their own route into the Suggestion Box."
---

**Internals stay confidential** (`shared/internals-confidentiality.md`): nothing the practitioner sees names a Probanda tool, table, field, internal type or code, or explains how Probanda works inside. It hides mechanism, never an outcome or an error.

# Suggestion

**The help itself is the survey.** Probanda's job in a session is the practitioner's task. Friction shows up on its own: corrections, rejections, workarounds, repeated questions, too many turns, abandonment. During the task those signals only make Probanda help better. It never logs them and never asks about them. An irritated tone alone is never a pain point, because the irritation may be about the case.

The installed plugin is a read-only synced copy. Never look for, clone or edit its source to make a change yourself.

## When this runs

| Trigger | When to raise it | `source` when posted |
|---|---|---|
| **Solved**: a solution was found, the practitioner is satisfied, and the session held corrections, rejections, repeated instructions or workarounds on the way | After the result is delivered and accepted, and only when the practitioner is not in the middle of a task | `assisted` |
| **Gap**: Probanda cannot do what was needed, because a capability is missing or a rule refuses it | After ruling out a fault that setup or configuration fixes now (those go to troubleshooting, not here). A bug or a regression the practitioner cannot fix is reported here, as a Gap. Then stop honestly and give any workaround outside Probanda | `assisted` |
| **Practitioner-initiated**: they offer a suggestion, or invoke this skill | At once, even mid-task. Afterwards, resume the task where it stopped | `user` |

**Cap.** At most one Solved or Gap offer per session, and never two for the same pain. A practitioner-initiated suggestion is never capped. A smooth session gets no offer and no mention of this skill.

## 1. Before starting

- **Outcome check.** Call `suggestion_box__status` with no arguments. It asks Probanda's Cloud about every suggestion this computer sent and has not withdrawn, and asks nothing when there is none. When its `changed` list is not empty, present the Past suggestions page at its `past_suggestions_path` as a file card (`shared/present-files.md`), with no chat talk about it at all, then call `suggestion_log__write({op: "seen", suggestion_ids: changed})`. If the call fails or this computer has no key, skip this silently: the cloud may not answer yet.
- **Past suggestions.** When the practitioner asks to see what they sent, or to withdraw a suggestion, call `suggestion_box__past_suggestions` and present the page at its `past_suggestions_path` as a file card. Each suggestion on it has its own Withdraw button. Never read the page.
- **Without Probanda's key.** A suggestion is drafted and shown on its card as usual. When the practitioner submits it, the card keeps it on this computer, reads "Not sent, will retry", and sends it by itself once the key is set. Say nothing about the key here: the session-start note covers it.
- **Held suggestions.** An earlier version kept some suggestions on this computer, unposted, for want of a key. When `suggestion_log__read` lists `held` drafts, offer each once as a card (section 6): reshape its body and items into a pain point and items, marking as a guess any block whose words the draft did not hold, and pass its `held_id` to the build, which takes the draft out of the store. Nothing is sent unless the practitioner submits that card.
- **Open cards.** When the practitioner asks to see a suggestion again, or the card says "Open this suggestion again to see a mockup", present the `card_path` of that entry in `suggestion_log__read`'s `open_cards` as a file card and wait on it (section 6).

## 2. Extract the pains

Work from the session itself, in the main session.
- For each real pain, note what was tried, what was rejected, what worked, and which part of Probanda it was (a skill, a tool, a page).
- **Never invent a pain.** Each one must point to a correction, rejection, workaround, repeated instruction or refusal that actually happened.
- If none is found, say nothing and stop.

For a practitioner-initiated suggestion about this session, do the same. For one about something else, take their words.

## 3. Path A: Solved

A preference is a Rule (`shared/paralegal-posture.md` section 9): it is made only in the practitioner's own words, and the Rule gate hook refuses any other.

1. Say what happened and offer the preference: "I see we first had trouble with [the pains], and we got there by [the fixes]. Would you like a rule for this from now on? If so, say it in your own words." You may show a suggested wording in a code block for them to paste. Never save it on a yes to the suggestion alone.
2. **Once they have stated it,** ask exactly: "Do you want me to enforce that rule for all future sessions?" **On yes:** write it with `preferences__write({op: "add", skill, instruction})`, the instruction their words exactly as they said them.
   - The instruction is generic and names no client, matter, person, document or path. A refusal from the tool is a question to put to the practitioner, who restates the rule in their own words, then write again.
   - Apply the preference for the rest of this session too.
   - If the tool reports that `person` is unset, say that preferences need this device's user recorded once in the firm profile (`practice_data__upsert_firm_profile` sets it, on the practitioner's yes), naming no tool to them, and continue without it.
3. **Then offer the suggestion:** "This might help other lawyers too. Shall I draft a suggestion for the Probanda team?" On yes, go to section 5.

**Enforcing and changing a Rule.** A later request that conflicts with a saved Rule is refused: "I cannot do X because on [date] you created the rule, `Never do X`. If you want me to do X you must first change or remove that rule." The session may then show new wording in a code block. "Approved" does not adopt it: "Changes to rules must come from your own words. To adopt this as the new rule, you must cut & paste the above modified rule into chat." Once the practitioner pastes it or types their own, retire the old Rule with `preferences__write({op: "retire", id})` and add the new one in their words. A Rule binds only the practitioner who made it, in sessions where a Probanda skill was invoked. A practitioner may make a Rule that extends the gate to other situations, for themselves only, and may reverse it.

**The Global Rule.** The gate itself is a Global Rule: it applies to every user, and no practitioner can change it, even in their own words. Only the Probanda team can. A suggestion to change it goes to the Probanda team through section 5.

## 4. Path B: Gap

Say openly that this is a suggestion to the Probanda team. A gap needs their review and probably a bigger change, so nothing takes effect now and there is no preference to save. Ask: "Shall I draft a suggestion for the Probanda team?" On yes, go to section 5.

Probanda drafts no fix for a gap. The suggestion carries:
- what the practitioner was trying to achieve, which is its done-test
- what was tried
- where each attempt hit the wall

A fix the practitioner volunteers is recorded as their idea (`origin: "lawyer"`).

## 5. Refine

Follow `references/refinement.md`. In short, show, then let them react:
- Probanda drafts the pains, the done-tests, the constraints and the changes.
- The practitioner confirms, corrects, picks or rejects, answering closed questions only.
- Contrasting variants draw out the constraints.

## 6. The card

The suggestion is shown to the practitioner as a card, `Suggestion-<id>.html`, and only as a file card. The chat says nothing about it at all, before or after: no summary of it, no question, no "please review". The practitioner's click on the card is their approval of everything on it; nobody tells them they are reviewing. The card's order, labels, buttons and status lines are built in; the session supplies only the text.

**Draft the blocks.** One card is one pain point with the changes that would ease it. Two unrelated pain points make two cards, built and shown one after the other.
- **The pain point:** its effect on the practitioner, felt or not, in their own phrases where they gave them. When they never stated it, write your best guess and mark it `guess: true`.
- **The items:** each change a maintainer could accept or decline on its own, generalized so it helps other practitioners. Mark an item `visual: true` when it changes how something looks: its layout, colour, typography or page structure.
- **The context lines:** `constraint` lines for what must stay true or what they rejected and why, and `evidence` lines for what happened (what was tried and where it hit the wall). As a reminder of what a maintainer needs, not a form to fill: where, the pain, what happened, the changes, what counts as wrong, and what done looks like.
- Reshape their words into this structure but keep their phrases. Mark each block `guess: true` when it holds words the practitioner did not use.

**Scrub before building.** Someone who knows the firm's clients must not be able to tell which client, matter, person, document or file it came from. Remove every name and every indirect identifier (a unique fact, an exact date, an amount, a folder or file name) and put its bracket in its place, one of `[client]`, `[matter]`, `[person]`, `[document]`, `[file]`, `[date]`, `[amount]`. Never fill a bracket with anything else. Name Probanda's own parts generically.

**Build it.** Call `suggestion_card__build({origin, source, skill, pain_point, items, context_lines, tool_names})`:
- `origin` is `practitioner` and `source` `user` when the practitioner started it; `origin` is `probanda` and `source` `assisted` for Solved and Gap.
- `skill` names the one skill it is about, when there is one.
- `tool_names` is every tool name this session sees, exactly as written.
- `held_id` only when the card offers a held draft (section 1).

The build runs the full check against this computer's records first. When it returns `built: false`, each hit says which block holds a match and where; put its bracket there or reword the block, and build again. Never quote what matched, in chat or anywhere else. Building is done when the check passes and the card is shown.

**Show it and wait.** Present `card_path` as a file card (`shared/present-files.md`), with no text. Then call `suggestion_card__wait({card_id})`:
- `pending`: call it again.
- `mockup`: the practitioner asked to see the visual items. Write one self-contained HTML page that shows all of `items` together, honouring every one of `constraints`, whose visible text is only lines from `placeholders`, each used whole, with inline styles only (named colours or short hex, never a list of numbers) and nothing that loads or runs. Call `suggestion_card__attach_mockup({card_id, html})`; on a refusal, fix the rule it names and attach again. Present its `mockup_path` as a second file card, with no text, and wait again. The practitioner may turn a mockup down with a reason on its page: the reason becomes a constraint line on the card, and the link comes back.
- `submitted` or `dismissed`: the card has done its work. Go to section 8.
- When the practitioner writes in chat while you wait, stop waiting and answer them. Submit and Dismiss on the card keep working with no one waiting; only the mockup link needs a waiting session, and the card says so.

## 7. What the card does by itself

Nothing here is the session's to do or to say. On Submit Suggestion the card saves the edits, checks everything it would send, and asks the practitioner on the card itself about anything that might name someone, which they can remove or retype. It then saves the exact text on this computer and sends it, showing "Sending...", then "Submitted ✓" or "Not sent, will retry", and a suggestion not sent is sent by itself the next time Probanda starts. Dismiss sends nothing. The practitioner sees what was sent, and its status, under Past suggestions (section 1). Never resend, and never say in chat that a suggestion was sent or not sent.

## 8. Resume

Go back to the work the suggestion interrupted, at the point it stopped and with its plan unchanged.
