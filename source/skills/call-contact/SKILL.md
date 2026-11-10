---
name: "call-contact"
description: "Use when the practitioner says \"Call\" followed by a person's name (or phone/ring/dial someone): look them up in their contacts and show each of their numbers as a clickable tel: link, with a fallback page for a second calling app on request."
---

**Internals stay confidential** (`shared/internals-confidentiality.md`): nothing the practitioner sees names a Probanda tool, table, field, internal type or code, or explains how Probanda works inside. It hides mechanism, never an outcome or an error.

# Call a contact

When the practitioner says "Call {name}", they want clickable phone links for that contact. They click the link themself. Never place a call yourself.

## Calling setup

Which app a `tel:` link opens, and which fallback line exists, is the practitioner's own setup. It is recorded in their practice quirks (`practice-data`'s "Practice quirks"), never in this skill. Read the entries for the `tools` area with `quirks__read` (`areas: ["tools"]`), in the same round trip as this skill's first tool call.

- **The entries say how calls go out.** Follow them: the app `tel:` links open (for example Phone Link, which calls from an iPhone over Bluetooth), any fallback app and line (for example Webex on a business line), and any line never to use.
- **The entries say nothing about calls.** Give the `tel:` links anyway. Then ask once, in one sentence, which app their `tel:` links open, whether they have a fallback calling app and line, and whether any line is retired. On an answer, propose recording it as "Write" in `practice-data`'s "Practice quirks" says: a knowledge entry in the `tools` area (a line never to use is a rule), shown under `/show-me` and saved as that section describes.

## Steps

Tools are named without their prefix. Call each under whichever of `mcp__plugin_lawyer_contacts-calendars-email__<name>` and `mcp__remote-devices__plugin_lawyer_contacts-calendars-email__<name>` this host grants.

1. Search the contacts for the name with `contacts__search` (`query`: the name as they said it). If that finds nothing, try just the first name or just the last name. On `dav_not_configured`, say the contacts connector is not set up, and set it up with `mail__configure_credential` and its contacts fields as `practice-data`'s "Mail" section describes for the mail credential.
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

Use this only when the practice quirks name Webex as the fallback and the practitioner asks for it, or says their phone is flat or out of range.

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
