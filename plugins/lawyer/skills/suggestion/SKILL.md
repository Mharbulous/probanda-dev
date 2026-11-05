---
name: suggestion
description: "Use when the practitioner gives feedback on Probanda or reports a bug (\"Probanda should…\", \"tell the developers…\", \"from now on, always…\"), when a finished task took corrections, when Probanda cannot do what is needed, when a reminder names it, or when the session-start note says this computer holds suggestions not yet sent. Not for edits to their own draft, or loose threads."
---

<!-- lawyer v0.25.3 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: it means the directory containing this SKILL.md, not a placeholder to search for or guess. Read references and shared files natively from there, never over the litigation data server's skill-source tool and never by requesting folder access; scripts and templates the text declares are executed and read from there too. Before each fresh read (a file not already in context), list only `${CLAUDE_SKILL_DIR}/../../..` (the folder holding this plugin's folder). If it holds this plugin's folder name, with any `~g<N>` suffix removed, plus a `~g<N>` higher than this plugin's folder's own (none counts as 0), or if `${CLAUDE_SKILL_DIR}` no longer exists, the plugin was re-synced mid-session: take the highest `~g<N>` copy and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, authors or requests a screenshot of one, but may present one to a human user to view, staging it first where presenting needs that, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

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
| **Probanda noticed**: the reminder at the end of a reply names this skill and this session's id | At that reply, in place of waiting for the practitioner. Section 9 only | `llm` |

**Cap.** At most one Solved or Gap offer per session, and never two for the same pain. A practitioner-initiated suggestion is never capped. A smooth session gets no offer and no mention of this skill. A card Probanda noticed is capped by the plugin itself: at most one a day, and never again for one the practitioner dismissed, sent or left unanswered.

## 1. Before starting

**The suggestions folder.** Every card and page this skill presents is in the suggestions folder, the folder holding its `card_path` or `past_suggestions_path`, which `/probanda-setup` connects once. On a remote-device host, before the first stage in the turn one is shown, apply `shared/present-files.md`'s folder check to that folder: when `connectedFolders` lacks it, make the one `device_request_folder_access` call for it before staging.

- **Outcome check.** Call `suggestion_box__status` with no arguments. It asks Probanda's Cloud about every suggestion this computer sent and has not withdrawn, and asks nothing when there is none. When its `changed` list is not empty, present the Past suggestions page at its `past_suggestions_path` as a file card (`shared/present-files.md`), with no chat talk about it at all, then call `suggestion_log__write({op: "seen", suggestion_ids: changed})`. If the call fails or this computer has no key, skip this silently: the cloud may not answer yet.
- **Past suggestions.** When the practitioner asks to see what they sent, or to withdraw a suggestion, call `suggestion_box__past_suggestions` and present the page at its `past_suggestions_path` as a file card. Each suggestion on it has its own Withdraw button. Never read the page.
- **A suggestion's technical write-up.** When the practitioner asks to see the technical write-up of a suggestion, or how it is kept safe, find that suggestion's `record_id` in `suggestion_log__read` by its title and date, then call `suggestion_box__past_suggestions({record_id})` and present the page as a file card, with no chat talk. The page opens at that suggestion with its write-up shown, and explains the safeguards itself. If you cannot tell which suggestion they mean, present the page without `record_id`.
- **Without Probanda's key.** A suggestion is drafted and shown on its card as usual. When the practitioner submits it, the card keeps it on this computer, reads "Not sent, will retry", and sends it by itself once the key is set. Check the key first, as `../practice-data/operations/credentials.md`, "Key check", says: it has the practitioner told once in the session when this computer holds none. The card itself says nothing about the key.
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

A fix the practitioner volunteers goes on the card as an item in their own words, with no guess label.

## 5. Refine

Follow `references/refinement.md`. In short, show, then let them react:
- Probanda drafts the pains, the done-tests, the constraints and the changes.
- The practitioner confirms, corrects, picks or rejects, answering closed questions only.
- Contrasting variants draw out the constraints.

## 6. The card

The suggestion is shown to the practitioner as a card, `Suggestion-<id>.html`, and only as a file card. The chat says nothing about it at all, before or after: no summary of it, no question, no "please review". If a line cannot be avoided, such as a status update the host asks for, it is only: "I've drafted a suggestion. It goes to the Probanda team only if you click Submit on the card." Beyond that sentence, chat never uses send, submit or post, in any form, of the suggestion or its card: a card is shown. The practitioner's click on the card is their approval of everything on it; nobody tells them they are reviewing. The card's order, labels, buttons and status lines are built in; the session supplies only the text.

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

The build runs the full check against this computer's records first. When it returns `built: false` with `hits`, each hit says which block holds a match and where; put its bracket there or reword the block, and build again. Never quote what matched, in chat or anywhere else. Building is done when the check passes and the card is shown.

When it returns `built: false` with `reason: "records_unreadable"`, the suggestion could not be checked, so it is not shown. Tell the practitioner once, in one plain sentence that names nothing inside Probanda: "I couldn't check this suggestion against your records, so I haven't shown it to you, and it hasn't gone to the Probanda team." Then stop: do not build it again in this session, and nothing is kept to send. Go to section 8.

**Show it and wait.** Present `card_path` as a file card (`shared/present-files.md`, after section 1's folder check), with no text. Then call `suggestion_card__wait({card_id})`:
- `pending`: call it again.
- `mockup`: the practitioner asked to see the visual items. Write one self-contained HTML page that shows all of `items` together, honouring every one of `constraints`, whose visible text is only lines from `placeholders`, each used whole, with inline styles only (named colours or short hex, never a list of numbers) and nothing that loads or runs. Call `suggestion_card__attach_mockup({card_id, html})`; on a refusal, fix the rule it names and attach again. Present its `mockup_path` as a second file card, with no text, and wait again. The practitioner may turn a mockup down with a reason on its page: the reason becomes a constraint line on the card, and the link comes back.
- `submitted` with `write_up: true`: the suggestion is sent. Go to section 10, then section 8.
- `submitted` with `write_up: false`, or `dismissed`: the card has done its work. Go to section 8.
- When the practitioner writes in chat while you wait, stop waiting and answer them. Submit and Dismiss on the card keep working with no one waiting; only the mockup link needs a waiting session, and the card says so.

## 7. What the card does by itself

Nothing here is the session's to do or to say. On Submit Suggestion the card saves the edits, checks everything it would send, and asks the practitioner on the card itself about anything that might name someone, which they can remove or retype. It then saves the exact text on this computer and sends it, showing "Sending...", then "Submitted ✓" or "Not sent, will retry", and a suggestion not sent is sent by itself the next time Probanda starts. When the check cannot read every kind of record, the card sends nothing, says so, and stays open for another try. Dismiss sends nothing. A copy that cannot reach Probanda, such as one shown through the chat, has no buttons: it says it cannot send and links to the card on this computer, where they work. The practitioner sees what was sent, and its status, under Past suggestions (section 1). Never resend, and never say in chat that a suggestion was sent or not sent.

## 8. Resume

Go back to the work the suggestion interrupted, at the point it stopped and with its plan unchanged.

## 9. A card Probanda noticed

Probanda records what it notices about its own work as an observation: a skill that notices a failing Probanda tool, such as one triaging loose threads, reports it through `suggestion_observation__record`, holding only Probanda's own output (the tool's name, the error's class or code, counts and the plugin's fixed texts), never anyone's words. The lawyer plugin decides by itself when one may be shown, and then its reminder at the end of a reply names this skill and gives this session's id. Only then does this section run, and it replaces sections 1 to 8: no outcome check, no pains extracted, no question, and nothing in chat before, during or after it but section 6's one unavoidable line.

1. **Ask.** Call `suggestion_observation__next({chat_session})` with the session id the reminder gave. With `observation: null`, end the reply with nothing more.
2. **Draft the blocks from the observation alone:** its `raw_observation` lines and its `fingerprint` (the plugin, its version, the skill and the kind), never the conversation, a document, a tool's arguments or the practitioner's words.
   - **The pain point:** your best guess at its effect on the practitioner, felt or not: time lost, cost, reliability, accuracy, or a near miss on confidentiality. Always `guess: true`: the card labels it "our guess, edit if wrong".
   - **The items:** one or two changes a maintainer could accept or decline, each `guess: true`, and `visual: true` only for one that changes how something looks.
   - **No context lines:** the raw observation is on the card already. Name no client, matter, person, document or file.
3. **Build** with `suggestion_card__build({origin: "probanda", source: "llm", observation_id, chat_session, pain_point, items, tool_names})`: the observation's id from step 1 and the same session id as `chat_session`, with no `skill` and no `raw_observation`, which the card takes from the observation itself. The card opens "Probanda noticed:". The raw observation is checked against this computer's records before the card is shown, and a line that matches is dropped without asking.
   - `built: false` with `reason: "not_raised"`: the plugin's cap or suppression does not allow it now. End the reply with nothing more.
   - `built: false` with `hits`: reword the block named, without any word that matched, and build once more. If it is refused again, or returns `reason: "records_unreadable"`, end the reply with nothing more: the practitioner never asked for this card.
4. **Show it** as a file card (`shared/present-files.md`), with no text, and end the reply. Do not wait on it: Submit Suggestion and Dismiss work by themselves (section 7). A card left unanswered when the session ends counts as dismissed. If the practitioner asks in this session to see it again or for its mockup, it is among `suggestion_log__read`'s `open_cards` (section 1).

## 10. The technical write-up

Only when `suggestion_card__wait` returned `submitted` with `write_up: true`. The suggestion is already sent; this writes a specification of it for the maintainers, which follows it. It uses the practitioner's Claude plan. Write no text in chat before, between or after these steps, whatever their outcome: the agents' dispatches show in the transcript by themselves.

1. Call `suggestion_card__write_up_brief({card_id})`. With `write: false`, go to section 8.
2. Dispatch the `lawyer:technical-writer` agent with the returned `brief` as its whole prompt, as JSON exactly as returned. Add nothing from this session: no summary of the conversation, no document, no tool result, no word of the practitioner's beyond what the brief holds.
3. Call `suggestion_card__write_up_check({card_id, specification})` with the writer's JSON exactly as it returned it. With `verified: false`, go to section 8: nothing follows the suggestion, and this computer's record says why.
4. Dispatch the `lawyer:spec-backstop` agent with the returned `backstop_input` as its whole prompt, as JSON exactly as returned, and nothing else.
5. Call `suggestion_card__write_up_send({card_id, judgement})` with the backstop's JSON exactly as it returned it. Whatever its `outcome`, go to section 8. Never retry a step, never edit the writer's or the backstop's output, and never dispatch either agent again for the same card.
