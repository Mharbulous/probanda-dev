---
name: suggestion
description: "Turns a practitioner's experience of Probanda into a suggestion to its maintainers, and saves a fix that worked as their own preference. Use at three moments: (1) a task is finished, the practitioner is satisfied, and getting there took corrections, rejections, repeated instructions or workarounds; (2) Probanda has stopped because it cannot do what the practitioner needs (a missing capability or a refusal), after ruling out a setup or configuration fault; (3) the practitioner asks to suggest, request, report a bug or regression, or give feedback on how Probanda works (\"Probanda should…\", \"tell the developers…\", \"from now on, always…\"), even mid-task. Not for corrections to the practitioner's own document or draft, not mid-task unless the practitioner raises it, not when the only sign is an irritated tone, not for a setup or configuration fault, and not for loose threads, which have their own route into the Suggestion Box."
---

<!-- lawyer v0.9.14 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: it means the directory containing this SKILL.md, not a placeholder to search for or guess. Read references and shared files natively from there, never over the litigation data server's skill-source tool and never by requesting folder access; scripts and templates the text declares are executed and read from there too. If `${CLAUDE_SKILL_DIR}` itself no longer exists, the plugin was re-synced mid-session: list only `${CLAUDE_SKILL_DIR}/../../..` (the folder that held this plugin's folder), take the folder named as this plugin's folder with any `~g<N>` suffix removed plus the highest `~g<N>`, and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, stages, authors or requests a screenshot of one, but may present one to a human user to view, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

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
- **Posting needs Probanda's key.** If `practice_data__config_status` reports `cloud_credential: missing`, the suggestion is drafted as usual and held on this computer instead of posted (section 6). Unless this session has already said so, say in one line that sending it needs Probanda's key, and offer the route in the practice-data skill, Configuration, "Probanda's key".
- **Held suggestions.** When this computer holds Probanda's key and `suggestion_log__read` lists `held` drafts, show each draft exactly as held, then ask section 6's question. On Yes, post that exact text, then remove the draft with `suggestion_log__write({op: "release", held_id})`. On Modify, show their text again for a yes. On No, release the draft and post nothing.

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

## 6. Show the exact text, then ask

The draft is:
- **a title** of at most eight words
- **a body:** one short paragraph that summarizes the whole suggestion
- **one item per pain:** `{pain, where, done_test, constraints, changes: [{change, origin}]}`
- **UI Previews,** for a UI pain only, when a deterministic preview of the page exists

Remove every person, entity, matter, document and path, and name the plugin's part generically.

Show the title, the body and every item exactly as they will be posted. Then ask in plain text, under `/show-me`: "Would you like to submit this suggestion?" Yes | No | Modify. Under Yes, state the mechanism: `sent to the Probanda team · saved in Probanda's Cloud · free`.

- **Yes.** Only after an explicit yes, call `suggestion_box__submit({title, body, source, items, skill})` with exactly the text shown.
  - Add `previews` only for Previews the practitioner saw rendered. Pass each as `{label, chosen, reason, path}`, with the path a board preview tool returned for a fixture preview. Never read the preview to pass its HTML.
  - Add `skill` when the suggestion is about one skill.
  - `source` is `assisted` for Solved and Gap, and `user` when the practitioner initiated it.
- **No.** Post nothing.
- **Modify.** Take their new text and show it again for a yes. Their edited text goes to the tool exactly as typed, because they are its author.

**With no key** (section 1), ask instead: "Would you like me to keep this suggestion on this computer and send it once Probanda's key is set?" Yes | No | Modify. On Yes, call `suggestion_log__write({op: "hold", draft: {title, body, source, items, skill}})` with exactly the text shown, and say it is held on this computer, not sent. Never say a held suggestion was sent.

## 7. Report

The tool saves the exact text on this computer before it sends it, and keeps the record itself.

- **`status` "Submitted ✓".** Say the suggestion was received, with the id the tool returns.
- **`status` "Not sent, will retry".** Say in one line that the suggestion is saved on this computer and will be sent by itself the next time Probanda starts and can reach the Probanda team. Never say it was sent, and don't resend.
- **If a sent reply lacks `items_saved: true`,** say in one line that only the summary reached Probanda. Don't resend.
- **A refused post** (a redaction hit) is reported in one line with the kind of hit, never the text. Nothing was saved. Then offer to redraft once, or leave it.

## 8. Resume

Go back to the work the suggestion interrupted, at the point it stopped and with its plan unchanged.
