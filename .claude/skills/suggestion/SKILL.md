---
name: suggestion
description: "Turns a practitioner's experience of Probanda into a suggestion to its maintainers, and saves a fix that worked as that person's own preference. Use at three moments: (1) a task is finished, the practitioner is satisfied, and getting there took corrections, rejections, repeated instructions or workarounds; (2) Probanda has stopped because it cannot do what the practitioner needs (a missing capability or a refusal), after ruling out a setup or configuration fault; (3) the practitioner asks to suggest, request, report or give feedback on how Probanda works (\"Probanda should…\", \"I wish it would…\", \"tell the developers…\", \"from now on, always…\"), even mid-task. Not for corrections to the practitioner's own document or draft, not mid-task unless the practitioner raises it, not when the only sign is an irritated tone, not for a fault that can be fixed now, and not for loose threads, which have their own route into the Suggestion Box."
---

# Suggestion

**The help itself is the survey.** Probanda's job in a session is the practitioner's task. Friction shows up on its own: corrections, rejections, workarounds, repeated questions, too many turns, abandonment. During the task those signals only make Probanda help better. It never logs them and never asks about them. An irritated tone alone is never a pain point, because the irritation may be about the case.

The installed plugin is a read-only synced copy. Never look for, clone or edit its source to make a change yourself.

## When this runs

| Trigger | When to raise it | `source` when posted |
|---|---|---|
| **Solved**: a solution was found, the practitioner is satisfied, and the session held corrections, rejections, repeated instructions or workarounds on the way | After the result is delivered and accepted, and only when the practitioner is not in the middle of a task | `assisted` |
| **Gap**: Probanda cannot do what was needed, because a capability is missing or a rule refuses it | After ruling out a fault that can be fixed now (setup, configuration, a tool failure: those go to troubleshooting, not here), stopping honestly, and giving any workaround outside Probanda | `assisted` |
| **Practitioner-initiated**: they offer a suggestion, or invoke this skill | At once, even mid-task. Afterwards, resume the task where it stopped | `user` |

**Cap.** At most one Solved or Gap offer per session, and never two for the same pain. A practitioner-initiated suggestion is never capped. A smooth session gets no offer and no mention of this skill.

## 1. Before starting

- **Outcome check.** When `suggestion_log__read` lists any suggestion whose `last_status` differs from `last_shown_status`, or `new` was last seen, call `suggestion_box__status` with those ids. For each status that changed, say one line ("Your suggestion about the deadline summary was approved."), then record it with `suggestion_log__write({op: "seen", suggestion_id, status})`. If the status tool is not in the tool list, or the call fails, skip this silently: an older researcher plugin lacks the tool, and the cloud may not answer yet.
- **Posting needs the researcher plugin.** `suggestion_box__submit` is served by it. If it is absent, Path A's preference still works: say in one line that sending a suggestion needs the researcher plugin, and offer only the preference. If `legal_commons__configure_status` does not report `configured: true`, say in one line that the Suggestion Box needs Probanda's key set once through `legal_commons__configure_credential`, and offer only the preference.

## 2. Extract the pains

Work from the session itself, in the main session.
- For each real pain, note what was tried, what was rejected, what worked, and which part of Probanda it was (a skill, a tool, a page).
- **Never invent a pain.** Each one must point to a correction, rejection, workaround, repeated instruction or refusal that actually happened.
- If none is found, say nothing and stop.

For a practitioner-initiated suggestion about this session, do the same. For one about something else, take their words.

## 3. Path A: Solved

1. Say what happened and offer the preference: "I see we first had trouble with [the pains], and we got there by [the fixes]. Shall I remember to do it this way for you from now on?"
2. **On yes:** write it with `preferences__write({op: "add", skill, instruction})`.
   - The instruction is generic and names no client, matter, person, document or path. A refusal from the tool is a question to answer, then write again.
   - Apply the preference for the rest of this session too.
   - If the tool reports that `person` is unset, say that preferences need the person key set once through `practice_data__upsert_firm_profile`, and continue without it.
3. **Then offer the suggestion,** if posting is available (section 1): "This might help other lawyers too. Shall I draft a suggestion for the Probanda team?" On yes, go to section 5.

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

## 6. Show the exact text, then ask

The draft is:
- **a title** of at most eight words
- **a body:** one short paragraph that summarizes the whole suggestion
- **one item per pain:** `{pain, where, done_test, constraints, changes: [{change, origin}]}`
- **UI Previews,** for a UI pain only, when a deterministic preview of the page exists

Remove every person, entity, matter, document and path, and name the plugin's part generically.

Show the title, the body and every item exactly as they will be posted. Then ask in plain text, under `/show-me`: "Would you like to submit this suggestion?" Yes | No | Modify. Under Yes, state the mechanism: `suggestion_box__submit · saved in Probanda's Cloud · free`.

- **Yes.** Only after an explicit yes, call `suggestion_box__submit({title, body, source, items, skill})` with exactly the text shown.
  - Add `previews` only for Previews the practitioner saw rendered.
  - Add `skill` when the suggestion is about one skill.
  - `source` is `assisted` for Solved and Gap, and `user` when the practitioner initiated it.
- **No.** Post nothing.
- **Modify.** Take their new text and show it again for a yes. Their edited text goes to the tool exactly as typed, because they are its author.

## 7. Report

- **On success,** say the suggestion was received, with the id the tool returns. Record it with `suggestion_log__write({op: "add", suggestion_id, title})`.
- **If the reply lacks `items_saved: true`,** say in one line that only the summary reached Probanda, because the researcher plugin is older. Don't resend.
- **A refused post** (a redaction hit, Probanda's Cloud not reached, the key refused) is reported in one line with the kind of hit, never the text. Then offer to redraft once, or leave it.

## 8. Resume

Go back to the work the suggestion interrupted, at the point it stopped and with its plan unchanged.
