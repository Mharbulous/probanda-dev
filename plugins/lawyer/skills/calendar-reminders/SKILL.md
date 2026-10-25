---
name: calendar-reminders
description: >-
  Triage likely obligations and unfinished tasks from calendar events.
  Use for calendar reminder checks, personal obligation triage, "what do I need
  to do?", "what have I put off?", "ask me if I finished things", and
  session-start reminder checks. Reads the calendar through the lawyer plugin's
  calendar tools and never writes to it.
---

<!-- lawyer v0.9.12 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: it means the directory containing this SKILL.md, not a placeholder to search for or guess. Read references and shared files natively from there, never over the litigation data server's skill-source tool and never by requesting folder access; scripts and templates the text declares are executed and read from there too. If `${CLAUDE_SKILL_DIR}` itself no longer exists, the plugin was re-synced mid-session: list only `${CLAUDE_SKILL_DIR}/../../..` (the folder that held this plugin's folder), take the folder named as this plugin's folder with any `~g<N>` suffix removed plus the highest `~g<N>`, and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, stages, authors or requests a screenshot of one, but may present one to a human user to view, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

**Internals stay confidential** (`shared/internals-confidentiality.md`): nothing the practitioner sees names a Probanda tool, table, field, internal type or code, or explains how Probanda works inside. It hides mechanism, never an outcome or an error.

# Calendar Reminders

## Purpose

Use the calendar as read-only evidence for likely obligations, overdue follow-ups, and unfinished work cues. This skill answers "what should I act on or may have put off?", not "what is on my calendar today?"

It does not answer agenda or day-summary prompts. It never writes to the calendar.

## Query

Tools are named without their prefix. Call each under whichever of `mcp__plugin_lawyer_contacts-calendars-email__<name>` and `mcp__remote-devices__plugin_lawyer_contacts-calendars-email__<name>` this host grants.

Use `calendar__list_events`:

- `calendars`: omit it to read every calendar, unless the user names one (`calendar__list_calendars` lists the names).
- `start`: the date 7 calendar days before today.
- `end`: the date 7 calendar days after today (a date is inclusive, whole day).
- `includeNotes`: `true`, so description cues can be read.

Times come back in the connector's configured timezone. Never widen the date window automatically.

Use `calendar__get_event` (with the event's `url`) only for candidate events where the listing is not enough to assess the notes, recurrence or attendees. An event with `busy: false` is transparent.

On `dav_not_configured`, say the calendar connector is not set up, and stop.

## Classify

Include events with clear action cues in the title or description:

- Action words: "follow up", "prepare", "draft", "review", "submit", "send", "file", "complete", "finish", "call", "book", "arrange", "schedule".
- Deadline or reminder words: "due", "deadline", "reminder", "by [date]", "don't forget", "overdue", "pending", "action required".
- Prep cues: "prep for", "prepare for", "materials for".

Treat `hold`, `block`, `placeholder`, `TBD`, and `tentative` as lower-confidence cues unless paired with a deliverable, decision, deadline, or follow-up.

Exclude events unless they contain action cues above:

- Routine recurring meetings such as daily standups, weekly syncs, 1:1s, and team meetings where the user is an attendee.
- All-day transparent events and context markers.
- Social events, birthdays, holidays, and meals.
- Past events that are clearly meeting records, with multiple attendees or a meeting link and no action language.

Label every surfaced item with the exact signal that caused inclusion, such as `title contains "follow up"` or `description says "deadline"`.

## Rank And Present

Rank qualifying items in this order:

1. Overdue items, oldest overdue first.
2. Due today or currently active.
3. Upcoming items in the next 7 days, nearest first.
4. Uncertain inferred items.

Show at most 3 items by default. If the user asks for more or says "show me everything", show up to 10 and mention when additional candidates were hidden.

For each item, include:

- `Item`: event title.
- `Due/When`: date and time with an overdue or upcoming relative label.
- `Why it surfaced`: the exact classification signal.
- `Suggested next action`: one concrete sentence.
- `Done?`: ask the user whether it is done.

If fewer than 3 strong items exist, include likely-but-uncertain items and mark them `[uncertain]`. If no items qualify, say: `No likely reminders found in the past 7 to next 7 day window.`

## User Answers

When the user says an item is done, acknowledge it as session-local only. Do not edit, rename, delete, move, or otherwise update the source calendar event.

When the user says an item is not done, acknowledge it. Do not create a deferral event. The item remains eligible to appear again while it stays in the scan window.

If the user asks this skill to create, update, rename, delete, move, defer, or mark a calendar event complete, decline the calendar write and explain that `calendar-reminders` is read-only by design. The user may make calendar changes in their calendar app.

If the user wants an item kept as a durable to-do, `/task-prioritization` adds it to the to-do registry. This skill never writes one itself.
