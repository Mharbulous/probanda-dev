---
name: file-naming
description: Check a filename against the firm's file naming convention (date + code + author/recipient + re/encl/srv + subject + amount), propose a conforming name from a document's content, or apply an approved rename or routing manifest. Domain-agnostic — knows the grammar and code registry, not any folder layout. Use for "check this file name", "what should I call this file", or when another skill (housekeeping, ingest) needs the grammar/gate/apply engine. Covers .pdf/.docx/.doc/.eml/.msg/.xls.
---

<!-- probanda v0.1.15 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: it means the directory containing this SKILL.md, not a placeholder to search for or guess. Read references and shared files natively from there, never over the litigation data server's skill-source tool and never by requesting folder access; scripts and templates the text declares are executed and read from there too. If `${CLAUDE_SKILL_DIR}` itself no longer exists, the plugin was re-synced mid-session: list only `${CLAUDE_SKILL_DIR}/../../..` (the folder that held this plugin's folder), take the folder named as this plugin's folder with any `~g<N>` suffix removed plus the highest `~g<N>`, and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, stages, authors or requests a screenshot of one, but may present one to a human user to view, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

## Contents

| Section | Read when |
|---|---|
| References | To find the code registry, format grammar or conformance contract |
| Intent: gate — test a filename, no file opened | Checking whether a filename conforms, without opening the file |
| Intent: propose — derive a conforming name | A name failed the gate, or the user asks what to call a file |
| Intent: apply — execute an approved rename manifest | An approved rename manifest is ready to run |
| Intent: apply-route — execute an approved routing manifest | An approved routing manifest is ready to move files across folders |
| For callers building their own review pipeline (e.g. housekeeping) | A caller dispatches its own reviewers or runs its own approval loop |

This skill deliberately carries no `disable-model-invocation` line: `/housekeeping` opens it
through the Skill tool, which refuses a skill carrying that line. It is a stated
exception, listed in `docs/agents/context-optimization.md`. Do not add the line back.

# File naming (grammar authority + rename engine)

Owns the firm's file naming grammar, the code registry, and the mechanics of
checking and applying names. Knows nothing about which folders exist or what
belongs in them — that is `/file-sorting`'s job (folder profiles) or a
caller's own logic. This skill answers exactly three questions: **does this
name conform?**, **what should this file be named?**, and **apply this
approved rename manifest.**

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

- reading the file's content (a caller like /housekeeping, whose ingest reads
  open the document and whose `housekeeping-namer` composes the name from the
  naming evidence those reads return), or
- already-extracted metadata (a caller like ingest, which never re-reads the
  file).

Apply the code-building, author/recipient, and date rules in
`general-conventions.md` exactly. If any required component — the date or
the code above all — cannot be pinned down confidently, propose nothing and
return the leave-alone signal; never guess a component to complete a name.

For a **standalone "check this file name" / "what should I call this"**
request: run **gate** on the current name first. If it conforms, say so — no
further work. If it fails, read the file yourself, derive a proposed name
under **propose**, and present it to the user for confirmation before
renaming — this skill does not rename without approval, same as every other
caller.

## Intent: apply — execute an approved rename manifest

Wraps `scripts/apply_renames.py`, all-or-nothing:

```
python scripts/apply_renames.py <manifest.json>
```

Manifest shape: `{"expected_total": N, "renames": [{"src": "<abs path>", "dst": "<abs path>"}, ...]}`.
Preflight rejects the whole manifest (renames nothing) on a count mismatch,
a missing source, a colliding destination (unless another pair's source: a
swap, run two-pass with rollback), or any pair whose folder differs
between `src` and `dst` — a move is a separate action from a rename, and this
script never performs one. The caller is responsible for building the
manifest from its own approved plan and setting `expected_total` to the count
it presented to the user; this skill does not track approval state itself.

## Intent: apply-route — execute an approved routing manifest

The move counterpart to **apply** above — for `/route-accounting`, whose
approved plan moves loose files at the accounting root to a different folder
rather than renaming them in place. **apply** continues
to reject any cross-folder pair; this is the intent for when that's exactly
what's wanted.

Wraps `scripts/apply_routes.py`:

```
python scripts/apply_routes.py <manifest.json>
```

Manifest shape:
```json
{
  "expected_total": N,
  "src_root": "<abs path all sources must sit directly in>",
  "allowed_dst_roots": ["<abs path>", "..."],
  "routes": [{"src": "<abs path>", "dst_dir": "<abs leaf destination dir>"}, ...]
}
```
`dst_dir` is the fully-resolved leaf destination folder, not a filename —
the destination filename is only decided at apply time, in case of a
collision (see below).

Preflight rejects the whole manifest (moves nothing) on a count mismatch, a
missing source, a source not directly inside `src_root`, a `dst_dir` outside
every `allowed_dst_root`, or a `dst_dir` equal to the source's own folder.
Unlike **apply**, a destination-filename **collision does not fail the
batch** — the script appends a numbered suffix (`name (2).ext`,
`name (3).ext`, ...) rather than overwriting, and moves the rest of the
batch regardless. It also creates any missing leaf destination folder
(`makedirs`, not the full category template — just the specific folder the
manifest names). The caller builds the manifest from its own approved plan,
the same way it builds an **apply** manifest.

## For callers building their own review pipeline (e.g. housekeeping)

This skill is the mechanical layer only. A caller that dispatches its own
reviewers, batches many files, or manages an approval/record-keeping loop
(`/housekeeping`, `/route-accounting`) owns that orchestration itself and uses this
skill's **gate**/**apply-route** for the mechanical steps and this skill's
reference files (`code-registry.md`, `general-conventions.md`) as the
material it hands its own subagents. Nothing here dispatches a subagent or
asks the user anything on a caller's behalf, except in the standalone-request
case above.
