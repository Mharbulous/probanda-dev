---
name: "call-contact"
description: "Use when the practitioner says \"Call\" followed by a person's name (or phone/ring/dial someone): look them up in their contacts and show each of their numbers as a clickable tel: link, with a fallback page for a second calling app on request."
---

<!-- legal v0.8.2 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: it means the directory containing this SKILL.md, not a placeholder to search for or guess. Read references and shared files natively from there, never over the litigation data server's skill-source tool and never by requesting folder access; scripts and templates the text declares are executed and read from there too. If `${CLAUDE_SKILL_DIR}` itself no longer exists, the plugin was re-synced mid-session: list only `${CLAUDE_SKILL_DIR}/../../..` (the folder that held this plugin's folder), take the folder named as this plugin's folder with any `~g<N>` suffix removed plus the highest `~g<N>`, and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, stages, authors or requests a screenshot of one, but may present one to a human user to view, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

# Call a contact

When the practitioner says "Call {name}", they want clickable phone links for that contact. They click the link themself. Never place a call yourself.

## Calling setup

Which app a `tel:` link opens, and which fallback line exists, is the practitioner's own setup. It is recorded in their practice quirks note (`practice-data`'s "Practice quirks"), never in this skill. Read the note with `practice_data__config_status` (`practice_quirks`) unless it was added at session start.

- **The note says how calls go out.** Follow it: the app `tel:` links open (for example Phone Link, which calls from an iPhone over Bluetooth), any fallback app and line (for example Webex on a business line), and any line never to use.
- **The note says nothing about calls.** Give the `tel:` links anyway. Then ask once, in one sentence, which app their `tel:` links open, whether they have a fallback calling app and line, and whether any line is retired. On an answer, propose adding it to the note as "Write" in `practice-data`'s "Practice quirks" says: under `/show-me`, the whole current note and the whole proposed note, written only after an explicit yes.

## Steps

1. Search the contacts for the name with `mcp__plugin_legal_contacts-calendars-email__contacts__search` (`query`: the name as they said it). If that finds nothing, try just the first name or just the last name. On `dav_not_configured`, say the contacts connector is not set up, and set it up with `mail__configure_credential` and its contacts fields as `practice-data`'s "Mail" section describes for the mail credential.
2. Handle the results:
   - **One match:** show that contact.
   - **Several matches:** show each matching contact with its numbers, so they can pick.
   - **No match, or the contact has no phone numbers:** say so in one line and ask for the number or a different spelling.
3. For each phone number, write a markdown link in this form:
   `[Call {Name} ({label}): {number as shown in contacts}](tel:+1XXXXXXXXXX)`
   - `{label}` is the contact card's label for the number (mobile, home, work). Leave out the parentheses when the card has no label.
   - Build the link target by removing everything except digits. A 10-digit number gets `+1` in front. An 11-digit number starting with 1 gets `+` in front. A 7-digit number has no area code: ask for it. Any other number keeps its digits with `+` in front.
   - Turn letters in vanity numbers into digits using the phone keypad (for example, 1-800-MY-APPLE becomes +18006927753).
   - Remove duplicate numbers.
4. If the card doesn't label the numbers and there are several, say in one line that the card doesn't say which is which.

## Example

Practitioner: "Call Jane Example"

Reply:

Jane Example has two numbers in your contacts:

- [Call Jane: (604) 555-0142](tel:+16045550142)
- [Call Jane: (604) 555-0187](tel:+16045550187)

The contact card doesn't say which is her cell and which is a landline or work number.

## Webex fallback

Use this only when the practice quirks note names Webex as the fallback and the practitioner asks for it, or says their phone is flat or out of range.

Webex links do nothing when clicked in chat or in a built-in browser pane. They dial only from a page opened in **Chrome**. So write a small HTML page and give them its path:

1. Write `call-{name}.html` to a folder on their PC: a folder they have shared with this session, or your outputs folder. Not a sandbox-only path such as `/tmp`, which Chrome on their PC can't open. For each number, the page has one link in this form:
   `<a href="webextel:+1XXXXXXXXXX">Call {Name} via Webex ({line the note names}): {number as shown in contacts}</a>`
   Build the target exactly as in step 3. Put nothing else from the contact card on the page.
2. Give them the file's Windows path on their PC, not a sandbox path, and tell them to open it in Chrome. The first time, Chrome asks whether to open Webex.

Never build a widget or a script that navigates to a `webextel:` link. A widget that did so crashed the desktop app.

## Rules

- Show only the contact they asked for. Never list, copy or summarize other contacts.
- Never pick a person or a number for them, and never place a call.
- Never route a call to a line the note says is retired.
- Keep the reply short: the links, plus one line only if something needs explaining.

## If the call doesn't go out through the iPhone

If Phone Link says no phone is connected or it can't connect, first ask whether the iPhone is flat or out of range. If it is, offer the fallback the note names.

Read `references/iphone-bluetooth-setup.md` only when one of these happens: the link opens the wrong calling app, Phone Link can't connect while the iPhone is charged and nearby, pairing fails, or the practitioner is setting up a new PC or a new iPhone. Don't read it for an ordinary call.
