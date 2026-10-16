---
name: file-apply
user-invocable: false
description: Apply an approved rename manifest (files renamed in place) or an approved routing manifest (files moved to other folders), and hash a set of files before a move. The mechanical rename and move engine of the file-manager plugin, used by a caller that already holds the practitioner's approval (/route-accounting, /housekeeping, /publish's renumber-affidavit). Never proposes a name and never decides what is approved. Naming grammar -> /file-naming.
---

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
the code registry belong to `/file-naming`, in the `legal` plugin. This skill
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
