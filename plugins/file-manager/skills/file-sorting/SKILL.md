---
name: file-sorting
user-invocable: false
description: Resolve a folder's filing profile — a litigation matter (renames files in place) or the firm's accounting root (routes loose files to sibling destination folders) — which of its subfolders or destinations are in scope, and how that profile's review record is looked up and recorded. Domain-aware companion to /file-naming — knows folder layouts, not naming grammar. Used internally by /housekeeping and /route-accounting.
---

<!-- file-manager v0.22.1 -->
> **Installed copy.** Relative paths below cite this skill's shipped tree.
> Resolve in order: current file's dir, `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is `${CLAUDE_SKILL_DIR}/../shared/x.md`).
> `${CLAUDE_SKILL_DIR}` is this SKILL.md's directory even if unsubstituted: never search or guess.
> Read references and shared files with Read (whole or offset/limit), never via shell, the litigation data server's skill-source tool, or a folder-access request; run declared scripts and templates from there too.
> Before each fresh read (not already in context), list only `${CLAUDE_SKILL_DIR}/../../..`. If it holds this plugin's folder name (sans `~g<N>`)
> plus a `~g<N>` higher than this plugin's folder's own (none counts as 0), or if `${CLAUDE_SKILL_DIR}` no longer exists, the plugin was re-synced mid-session:
> retry the three paths with the highest `~g<N>` copy's `skills/<this skill>` dir and tell the user once that the plugin updated mid-session (old version comment to new SKILL.md comment).
> If still missing at every path, STOP and report the exact path and error: do not substitute, re-derive script logic, search elsewhere, or diagnose further; ask the user to reinstall the plugin and fully restart the app.

**Internals stay confidential** (`shared/internals-confidentiality.md`): nothing the practitioner sees names a Probanda tool, table, field, internal type or code, or explains how Probanda works inside. It hides mechanism, never an outcome or an error.

## Contents

| Section | Read when |
|---|---|
| Profiles | Matching a folder to a profile, or checking a profile's Kind |
| Intent: detect-profile | Given a root folder path and the profile and Kind must be named |
| Intent: scope | A profile's in-scope subfolders or destinations, skip list or extension whitelist are needed |
| Intent: record-backend | A profile's review record, its lookup protocol or its working files are needed |
| For callers (e.g. housekeeping) | Before a caller consults this skill |

This skill deliberately carries no `disable-model-invocation` line: `/housekeeping` and
`/route-accounting` open it through the Skill tool, which refuses a skill carrying that line. It is a stated
exception. Do not add the line back.

# File sorting (folder profiles)

Owns folder-layout knowledge: which profile a root folder matches, which of
its subfolders are reviewable, the skip list, the extension whitelist, and
how that profile's review record is stored and reached. Knows nothing about
the naming grammar itself — that's `/file-naming`.

## Profiles

Every profile declares a **Kind**, right after its Detection rule:
`rename-in-place` (the profile's job is renaming a file where it already
sits) or `route-to-destination` (the profile's job is moving a file to one
of several sibling destination folders). The two Kinds diverge at exactly
the points documented in each intent below — everywhere else, a profile is
just a profile.

| Profile | Kind | Detection | profile.md |
|---|---|---|---|
| `litigation-matter` | `rename-in-place` | root holds the matter pointer, or a subfolder the practitioner's folder map names (`practice_data__folder_map`) | `profiles/litigation-matter/profile.md` |
| `accounting` | `route-to-destination` | root is, or directly contains, `ACCOUNTING\` with all four of `General Account Bookkeeping\`, `Trust Account Bookkeeping\`, `LOGICA LAW BILLING\`, `Family\` | `profiles/accounting/profile.md` |

(Future profiles land here as their own `profiles/<name>/profile.md` — see
that profile's directory once added.)

## Intent: detect-profile

Given a root folder path:

1. Check it against each known profile's detection rule (currently:
   `litigation-matter`, `accounting`). If it matches, return that profile
   name **and its Kind** — read straight off the matched profile's
   `**Kind:**` line, in the same round trip.
2. If it matches none, return `unknown` — let the caller ask the user which
   profile or which folder applies rather than guessing.

## Intent: scope

Given a root folder path and a resolved profile name, read that profile's
`profile.md` and return everything it documents about scope. What that means
depends on the profile's **Kind**:

- For a `rename-in-place` profile: the in-scope subfolders, resolved from
  the practitioner's folder map (each with its own type/label and the notes
  chunk it should be reviewed with), the always-skip list, disambiguation tips, the verbatim-path rule, and the
  argument rule.
- For a `route-to-destination` profile: the in-scope location (e.g. files
  loose directly at the profile root, non-recursive), the never-descend
  list, and the profile's routing-rule table (destination folder +
  destination-subfolder rule per rule, in priority order, plus which rules
  require opening a file's content).

Either way, also return the extension whitelist. This is a pure delegation
to the named profile's document — this skill holds no folder-layout or
routing knowledge of its own outside `profiles/`, and a matter's layout is the
practitioner's folder map, never a built-in one.

## Intent: record-backend

Given a resolved profile name, read that profile's `profile.md` and return
its "Record backend" section verbatim: which gatekeeper skill and intents to
use, the full protocol for when the record is unavailable (including the
exact `AskUserQuestion` the profile specifies) — or, for a profile that
documents no record backend at all, that fact plainly — and its "Working
files" section (the profile's own working directory, and which files are
written there — e.g. a litigation matter's `/housekeeping` run directory,
`route-plan.json`).

## For callers (e.g. housekeeping)

This skill answers "what folders, with what rules, remembered how" — it does
not gate filenames (`/file-naming`), dispatch reviewers, cap a work list, or
manage approval. A caller owns its own orchestration and consults this skill
only for profile resolution, scope, and record-backend routing, following
each profile's documented protocol exactly rather than inventing its own.
