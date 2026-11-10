Read when: Loose-thread triage reaches the open `tooling` threads (`references/loose-thread-triage.md`, "Tooling threads are reported to Probanda").
Assumes SKILL.md is loaded. Rules are not restated here.

## Section 14: Tooling threads

**What it is.** A `tooling` loose thread is feedback about the plugin. It does nothing for the matter, and it is never posted as a suggestion and never shown as a suggestion card from here. What it noticed about one of Probanda's own tools is reported to the lawyer plugin as an observation, holding only Probanda's own output. The lawyer plugin then decides by itself whether and when to show it to the practitioner as a card that opens "Probanda noticed:": at most one a day, and never again for one the practitioner dismissed, sent or left unanswered. The thread's own words never go into the observation: no thread text, matter, person, document, path, argument value or error message. Nothing is shown, asked or said here, and no thread is discarded or stamped.

1. **Take the open `tooling` threads** from triage Step 1's read (`references/loose-thread-triage.md`). Skip the deferred ones. Set aside any whose rank reason says it blocks live work on the Writing (a tool failure that blocks the downloads, currency checks or review pages other threads need), and name them in one line. They stay on the board.
2. **Report each thread that names a Probanda tool's failure,** in rank order, by one `suggestion_observation__record` call (load it first with one `select:` ToolSearch under both prefixes, `mcp__plugin_lawyer_data__` and `mcp__remote-devices__plugin_lawyer_data__`) holding only these fields:
   - `kind`: `tool_error` (the tool returned an error), `tool_refused` (it refused the request), `tool_missing` (the work needed it and it was not available) or `repeated_calls` (it was called again and again for one result).
   - `tool`: the tool's name, exactly as this session's tool list writes it.
   - `error_code`, only when the thread or this session's own tool result gives one: the error's class or code alone (`not_found`, `ValidationError`, `HTTP 500`), never its message.
   - `counts`, only when known as whole numbers: `calls` (needed for `repeated_calls`), `retries`, `failures`.
   - `text_key: "noted_as_loose_thread"`, and `skill`: the skill this session runs, `draft` or `work`.
   A refusal names the field that held something other than Probanda's own output. Correct that field only by removing what it names, never by adding words; if it then cannot be said, leave the thread unreported. `recorded: false` with `already_held` means it was reported before: nothing more to do.
3. **A thread that names no tool failure** (a missing feature, a page defect, an idea about how Probanda works) is not reported. It stays on the board for the practitioner's word under Step 4 of `references/loose-thread-triage.md`, like any other thread.
4. **Every thread stays on the board.** Reporting one consumes nothing and stamps nothing, so the board needs no re-render for it; a discard is still only on the practitioner's yes, under Step 4. Say nothing about observations or suggestions in chat.

**When something fails.** A record call that fails for any other reason: leave the thread as it is, report nothing more about it this session, and carry on with the next.
