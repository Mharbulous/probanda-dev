# Screen: what the tech-support agent relies on

Read after **Store states** in the skill's SKILL.md. Used by `mode: screen` only.

## Screening an entry

Write the entry generically: the symptom, the tool names, the exact error strings, the cause and the fix. Remove names, email addresses, matter numbers, court file numbers, client folder names, account identities, user names inside paths, and any case content. In a path, write one of the placeholders the runtime accepts: `<user>`, `<username>`, `<matter>` or `<folder>` (for example `\Users\<user>\...`). The store is shared tooling knowledge; nothing in it may identify a client, a matter or a person.

## Matching an entry

An entry matches only when its cause and its fix are both the same in substance as the confirmed ones. A matching symptom, or the same cause with a different fix, is not a match.

## Return format

Store not configured:

- First line: `store: not configured`.
- A suggestion draft for `/lawyer:suggestion`: a `title` of one line and a `body` that states the symptom, the tools involved, the exact error strings, the cause and the fix the practitioner confirmed, all screened.

Store configured: first line `store: configured`, then exactly one of:

- `action: confirm` with the matching entry's `entry_id`;
- `action: record` with the screened entry as JSON: `{"symptom", "tools", "error_strings", "cause", "fix", "source_url"}`, where `tools` and `error_strings` are lists of strings and `source_url` is a URL or null.
