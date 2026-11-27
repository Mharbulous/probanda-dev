---
name: file-apply
user-invocable: false
description: Apply an approved rename manifest (files renamed in place) or an approved routing manifest (files moved to other folders), and hash a set of files before a move. The mechanical rename and move engine of the file-manager plugin, used by a caller that already holds the practitioner's approval (/route-accounting, /housekeeping, /publish's renumber-affidavit). Never proposes a name and never decides what is approved. Naming grammar -> /file-naming.
---

<!-- file-manager v0.22.2 -->
> **Installed copy.** Relative paths below cite this skill's shipped tree.
> Resolve in order: current file's dir, `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is `${CLAUDE_SKILL_DIR}/../shared/x.md`).
> `${CLAUDE_SKILL_DIR}` is this SKILL.md's directory even if unsubstituted: never search or guess.
> Read references and shared files with Read (whole or offset/limit), never via shell, the litigation data server's skill-source tool, or a folder-access request; run declared scripts and templates from there too.
> Before each fresh read (not already in context), list only `${CLAUDE_SKILL_DIR}/../../..`. If it holds this plugin's folder name (sans `~g<N>`)
> plus a `~g<N>` higher than this plugin's folder's own (none counts as 0), or if `${CLAUDE_SKILL_DIR}` no longer exists, the plugin was re-synced mid-session:
> retry the three paths with the highest `~g<N>` copy's `skills/<this skill>` dir and tell the user once that the plugin updated mid-session (old version comment to new SKILL.md comment).
> If still missing at every path, STOP and report the exact path and error: do not substitute, re-derive script logic, search elsewhere, or diagnose further; ask the user to reinstall the plugin and fully restart the app.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases;
> never view, read, grep, parse, script over, author, or request a screenshot of one (you may present it to a human user, staging first where needed, and view screenshots the user provides).
> Rule and data to use instead: `shared/html-pages.md`.

**Internals stay confidential** (`shared/internals-confidentiality.md`): nothing the practitioner sees names a Probanda tool, table, field, internal type or code, or explains how Probanda works inside. It hides mechanism, never an outcome or an error.

## Contents

| Section | Read when |
|---|---|
| Intent: apply — execute an approved rename manifest | An approved rename manifest is ready to run |
| Intent: apply-route — execute an approved routing manifest | An approved routing manifest is ready to move files across folders |
| Intent: hash — hash files before a move | A caller needs each file's SHA-256 once, before it moves anything |

This skill deliberately carries no `disable-model-invocation` line: its callers open it
through the Skill tool, which refuses a skill carrying that line.

# File apply (rename and move engine)

Executes renames and moves that a caller has already had approved. The grammar and
the code registry belong to `/file-naming`, in the `lawyer` plugin. This skill
ships in `file-manager`, so disabling that plugin removes it with every other
Probanda tool that renames, moves or deletes a user's file.

**A file renamed *incorrectly* is worse than one left alone.** This skill never
builds a manifest from its own judgement: the caller builds it from its own
approved plan and sets `expected_total` to the count it presented to the user.
This skill does not track approval state itself.

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
script never performs one.

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

## Intent: hash — hash files before a move

Wraps `scripts/hash_files.py`, read-only:

```
python scripts/hash_files.py --files <path> [<path> ...]
python scripts/hash_files.py <folder> [--ext .pdf .docx ...]
```

Prints each file's SHA-256. `/housekeeping` hashes every candidate once, before
its approval page, so a later move can be checked against the bytes that were
approved.
