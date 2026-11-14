# Practice quirks as rule and knowledge entries

Status: built in `lawyer` 0.26.0. The procedure sessions follow is `.claude/skills/practice-data/operations/practice-quirks.md`. This file holds the design and the reasons.

## Why

One free-text note per machine (`practice_quirks` in `probanda.json`, at most 1,000 characters, replaced whole) could not hold a real practice's quirks without becoming a wall of text. It also mixed two kinds of thing: instructions Probanda must follow, and facts it needs to reason well. Quirks are also not only about email.

## The entry

`{id, type, areas, title, body, created_on, last_confirmed_on, retired_on, retired_reason, supersedes, plugin_version}`, kept in `<case_data_root>\_practice\quirks\quirks.json` as `{version, entries[]}`.

- `type` is `rule` (what Probanda must or must not do in this practice: the practitioner's instruction) or `knowledge` (a fact that informs reasoning and directs nothing).
- `areas` is one to three one-word lowercase tags (`^[a-z][a-z0-9]{1,19}$`). The list is open. `quirks__list` returns `areas_in_use` and the usual ones, so a typo shows. Every rule title is in context whatever its area, so a mistyped area cannot hide a rule.
- `title` is at most 100 characters. `body` is one paragraph (no line break) of at most 1,000, one issue per entry. Over a limit: refused, nothing written, never truncated. The refusal asks a question and states no rule (Commandment 6).
- Revise retires the old entry and writes a new one with `supersedes`. Retire stamps `retired_on`. Nothing is deleted (Commandment 7). Confirm stamps `last_confirmed_on`. Temporary knowledge is retired when it stops being true.
- One file with `type` and `areas` as values, never a file or column per area (Commandment 5). The file stays under the case data root on the practitioner's machine (Commandment 3).

## Decisions

1. **Rules versus preferences: beside each other.** A preference is one person's standing instruction to one named skill (`preferences__*`, `rule-gate.py`). A quirk rule is a fact about the practice that any skill touching its area must obey, and names no skill. If the sentence needs a skill's name it is a preference. Absorbing preferences would migrate live data and retire a tested gate, and could not be undone cheaply (Commandment 8).
2. **Scope: practice-wide only.** A machine-specific scope can be added later with no break, since an entry without one means the practice. The legacy per-machine note is migrated once per machine ("Migration").
3. **Enforcement: a PreToolUse hook, `quirk-gate.py`, on `quirks__write`.** The tool cannot see the practitioner's messages. The harness runs the hook and writes the transcript, so the model can do neither. The hook reads the practitioner's turns through `shared/scripts/transcript.py`, as `rule-gate.py` does, and fails closed.
4. **Areas: open**, as above.

## The gate

| Call | Passes only when the practitioner's last turn ... |
|---|---|
| add or revise, type `rule`, or a revise whose `expect_type` is `rule` | holds the call's title and body, each as an unbroken run (pasted from the code block the session showed, or typed) |
| retire a rule | holds the rule's title and a word of removal |
| add or revise knowledge | is a bare yes, and the session's reply before it showed the title and body |
| confirm a rule, confirm or retire knowledge | is a bare yes, and the reply before it showed the entry's title |
| any call carrying `agent_id` (a subagent) | never |

- `expect_type` and `expect_title` on a call about an existing entry let the hook know its type and title without reading the store (it cannot in Cowork). The tool refuses a call whose echo does not match the stored entry, so a rule cannot be demoted to knowledge by claiming it was knowledge.
- One message pasting several blocks approves several calls, since the check is on the last turn.
- Known limit, shared with `rule-gate.py`: the gate proves the practitioner's message holds the words, not that they meant to approve them. The proposal block asks them to paste the whole block, which makes it deliberate.
- Measured in Cowork on 2026-11-13, on `contacts__write_probe` (lawyer 0.29.5): the approval gate refused the call before and after the practitioner pasted the approval block, both times with "No record of this conversation could be read", the message `approval_gate.check` gives when the payload holds no `transcript_path`. So a PreToolUse payload carries no usable `transcript_path` in Cowork, and every gated call is refused there: safe but limiting. Not measured: whether the field is absent or empty, which `source/developer/hooks/payload-probe.py` would show. Answered for the five gated tools of the `contacts-calendars-email` server (decided 2026-11-13, practitioner's option A): each checks its own approval on the PC (`source/lawyer/mcp/src/approval/gate.ts`), the hook lets them through when it has no transcript, and the tool changes nothing until the practitioner clicks Approve on a page it serves. The design and what it gives up are in `docs/Plans/2026-10-28_untrusted-content-and-approvals.md`. The gate's other tools, and `quirks__write`, still refuse in Cowork.

## Server refusals

The tool saves nothing and asks a question when an entry holds a credential, text that skips a verification, approval or privilege rule, or (for knowledge) opens like an instruction. A mailbox address, or the fact that a password exists and where it is kept, is allowed, unlike `preferences/redact.ts`, because mail routing is the main use. The patterns are tripwires, not proofs. The guarantees are that the practitioner reads every rule and that sessions place every verification, approval and privilege rule above any entry.

## How sessions see them

- A SessionStart hook (`inject-practice-quirks.py`) injects the index (type, areas, title), rules first, capped at 60 lines, with no bodies and no ids. It states facts and names no tool (context-engineering rule 19). Where it cannot reach the practice folder, as in Cowork, it says so.
- A skill that starts a lookup in an area reads the bodies with `quirks__read` (`areas`). `quirks__list` returns the index.
- `practice_data__config_status` and `practice_data__firm_profile` still return `practice_quirks` as one text, built from the entries (`RULE [area] title: body`, rules first), else the old note. Readers not yet changed get the same information.

## Migration

1. The old note stays readable and is injected after the index until it is cleared.
2. Once the practice has an active entry, a non-empty write to the old note is refused. `""` still clears it.
3. Per machine: propose entries for what the old note says that the entries do not, one issue each, saved as above. Then clear the old note.
4. `practice_quirks` stays in `DOCUMENTED_KEYS` until every machine is migrated, and is removed in a later minor release.
5. The first practice's own entries hold personal addresses, so they are created in a live session and never written into this repository. Tests use `example.com`.

## Version

`lawyer` 0.26.0 (minor): a non-empty write to the old note is refused once entries exist, and an older copy reads only the old note, so after the migration an old copy sees no quirks.
