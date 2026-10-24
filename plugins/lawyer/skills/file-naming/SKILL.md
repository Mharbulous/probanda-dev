---
name: file-naming
description: Check a filename against the firm's file naming convention (date + code + author/recipient + re/encl/srv + subject + amount), or propose a conforming name from a document's content. Domain-agnostic — knows the grammar and code registry, not any folder layout. Use for "check this file name", "what should I call this file", or when another skill (housekeeping, ingest) needs the grammar or the gate. Applying a rename -> /file-apply. Covers .pdf/.docx/.doc/.eml/.msg/.xls.
---

<!-- lawyer v0.9.3 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: it means the directory containing this SKILL.md, not a placeholder to search for or guess. Read references and shared files natively from there, never over the litigation data server's skill-source tool and never by requesting folder access; scripts and templates the text declares are executed and read from there too. If `${CLAUDE_SKILL_DIR}` itself no longer exists, the plugin was re-synced mid-session: list only `${CLAUDE_SKILL_DIR}/../../..` (the folder that held this plugin's folder), take the folder named as this plugin's folder with any `~g<N>` suffix removed plus the highest `~g<N>`, and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, stages, authors or requests a screenshot of one, but may present one to a human user to view, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

**Internals stay confidential** (`shared/internals-confidentiality.md`): nothing the practitioner sees names a Probanda tool, table, field, internal type or code, or explains how Probanda works inside. It hides mechanism, never an outcome or an error.

## Contents

| Section | Read when |
|---|---|
| References | To find the code registry, format grammar or conformance contract |
| Intent: gate — test a filename, no file opened | Checking whether a filename conforms, without opening the file |
| Intent: propose — derive a conforming name | A name failed the gate, or the user asks what to call a file |
| For callers building their own review pipeline (e.g. housekeeping) | A caller dispatches its own reviewers or runs its own approval loop |

This skill deliberately carries no `disable-model-invocation` line: `/housekeeping` opens it
through the Skill tool, which refuses a skill carrying that line. It is a stated
exception. Do not add the line back.

# File naming (grammar authority)

Owns the firm's file naming grammar, the code registry, and the mechanics of
checking names. Knows nothing about which folders exist or what belongs in
them — that is the folder profiles of the `file-manager` plugin, or a caller's
own logic. This skill answers exactly two questions: **does this name
conform?** and **what should this file be named?** It renames nothing:
applying an approved rename or routing manifest is `/file-apply`, in the
`file-manager` plugin.

**A file renamed *incorrectly* is worse than one left alone** — a wrong name
can hide a triggered deadline or break a keyword search. Every intent below
honours the same default: when not confident, leave the name alone.

## References

- `references/code-registry.md` — the single source of truth for every
  firm-standard code.
- `references/general-conventions.md` — the format grammar (date, code,
  author/recipient, re/encl/srv, subject, amount, status marker) and the
  edge-case protocol (escape-log classification (1)/(2)) that callers
  dispatching their own subagents reuse.
- `references/conformance-check.md` — the semantic contract behind both
  intents below (test mode / proposal mode).

## Intent: gate — test a filename, no file opened

Mechanical grammar + registry check, run via `scripts/name_gate.py`:

```
python scripts/name_gate.py --registry <path-to-code-registry.md> \
    --files <path> [<path> ...] [--flag-tokens A,B,...]
```

Prints `{"results": [{"name", "verdict": "conforms"|"fails", "reason", "flags"}]}`.
`--registry` must be a file holding `code-registry.md`'s text — pass
`references/code-registry.md` directly.

This checks grammar + valid-code only (`conformance-check.md`'s test mode).
It does not know any folder's alternate whole-name formats (a caller with
those — e.g. housekeeping's Law/Discovery citation forms — runs its own
second pass over this call's failures) and never judges typicality (soft,
prose-only, never affects the verdict).

## Intent: propose — derive a conforming name

Reached only for a name that failed **gate**. This is `conformance-check.md`'s
**proposal mode**: assemble date, code, author/recipient, re/encl/srv,
subject, and amount from whatever signal the caller supplies —

- reading the file's content (a caller like /housekeeping, where a page-1 read
  of the document supplies the naming evidence the name is composed from), or
- already-extracted metadata (a caller like ingest, which never re-reads the
  file).

Apply the code-building, author/recipient, and date rules in
`general-conventions.md` exactly. If any required component — the date or
the code above all — cannot be pinned down confidently, propose nothing and
return the leave-alone signal; never guess a component to complete a name.

For a **standalone "check this file name" / "what should I call this"**
request: run **gate** on the current name first. If it conforms, say so — no
further work. If it fails, read the file yourself, derive a proposed name
under **propose**, and present it to the user for confirmation. For a PDF,
call `pdf_pages__images` first, and read a page it returns as `scanned` only
from its PNGs, never from the PDF or its text layer, and a `born_digital` page
with `Read` `pages:` (`/matter-data`'s design decision #71). If the tool
refuses, say so with its reason and read the PDF no other way. Once they approve, the
rename is `/file-apply`'s **apply** intent. If `/file-apply` is not available in
this session, the `file-manager` plugin is not enabled: stop, tell the
practitioner that this step renames a file and needs `file-manager`, and do
nothing else. Never fall back to a shell `mv` or `rm` or the Write tool.

## For callers building their own review pipeline (e.g. housekeeping)

This skill is the grammar layer only. A caller that dispatches its own
reviewers, batches many files, or manages an approval/record-keeping loop
owns that orchestration itself and uses this skill's **gate** and this skill's
reference files (`code-registry.md`, `general-conventions.md`) as the
material it hands its own subagents. Nothing here dispatches a subagent or
asks the user anything on a caller's behalf, except in the standalone-request
case above.
