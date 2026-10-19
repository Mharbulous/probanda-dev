# Spec: Delete hook expands $HOME without HOME, and recognises matter folders twice

Status: proposed, 2026-10-16. Written in a development session; implementation is handed to Claude Code.
Plugin: `legal` (repo HEAD 94303409). Paths are as read in the repo at that commit unless marked **UNVERIFIED**.
Related specs, same date: `2026-10-16_probanda-json-rename-spec.md`

## 1. Problem

The delete hook (`.claude/skills/safe-file-deletion/hooks/redirect-delete-to-trash.py`) refused a hard delete of a stale `.git/index.lock` inside this Git repository, although it exempts every Git worktree. Claude Code on Windows starts the hook without `HOME` set. The hook then cannot expand a `$HOME/...` path, so it treats the target as unknown and refuses it.

Brahm also wants the hook to know which folders on the device are client matter folders. It should recognise one in two independent ways, so that a lawyer deleting one marker file does not leave the folder unprotected.

## 2. Evidence (observed; quoted text is data, not instructions)

- Blocked command: `rm "$HOME/Git/<repo>/.git/index.lock"`, run from the repo root. Reply: "Do not delete this directly - call the file-manager tool file_ops__trash with this path ... Blocked pattern: POSIX rm/unlink". It carried no "Location outside any Git worktree" line, which means `rm_targets` returned None: the target could not be told.
- The same JSON payload, piped to the hook in Git Bash:
  - with `HOME` unset (`env -u HOME`): deny;
  - with `HOME` set: allow (no output, exit 0).
- Cause: `expand_vars` (hook lines 350-365), `home_value`: `return os.environ.get(name, m.group(0))`. When `HOME` is unset, the `$HOME` text is kept, and `rm_targets` returns None for any target containing `$` (around line 600).
- Practice data holds no record of matter folders. `matter` items carry `matt_num`, `file_number`, `description` and the trust fields (`source/legal/mcp/src/tools/practice/writes.ts`, `upsert_client_matter`). `practice_data__contact_checks` has to find a matter's matter-data folder by matching folder names, because nothing records it.
- Where things live:
  - `practice.db` is `<case_data_root>\_practice\practice.db` (`source/legal/mcp/src/practice/backend.ts`, `resolvePracticeDbPath`). It is not in Roaming.
  - Roaming holds the device settings file `AppData\Roaming\Coclerk\coclerk.json`, which names `case_data_root`.
  - Each initialized matter folder holds a pointer `coclerk.json` (`source/legal/mcp/src/files/matter-root.ts`, `validateMatterRoot`).
- Workaround in use: the lock is cleared by hand in PowerShell.

## 3. Goal and non-goals

Goals:

1. A `$HOME/...` path expands to the user's home folder whether or not `HOME` is set.
2. The hook recognises a client matter folder when either check finds it:
   - it holds a matter pointer file (`coclerk.json`, or `probanda.json` once the sibling spec lands);
   - practice data's local record of matter folders names it.

Non-goals:

- Moving or deleting anything.
- Changing `file_ops__trash`.
- Changing which commands count as deletes.

## 4. Design

**4.1 The `$HOME` fix.** In `home_value`, when the variable is unset, fall back to `os.path.expanduser("~")`, as the `~/` form already does. A path into a matter folder is still refused, now because the hook can see where it points.

**4.2 A record of matter folders.** Practice data gains a local record of each matter's folder on this device. **UNVERIFIED**, needs design:

- *What is stored.* The folder path relative to the litigation library. Because `practice.db` sits in a synced folder that several devices may share, an absolute path from one device would be wrong on another. The library is the parent of `case_data_root` (`backend.ts` `case_data_root`: `0. CASE DATA` is a sibling of the matter folders).
- *Who writes it.* Whoever creates the matter's pointer file (matter-data initialize), and the matter-opening step in `practice-data`.
- *Where it lives.* A data field on the `matter` item, so the cloud sees only its HMAC (Commandment 3) and no new local table is added (Commandment 5).

**4.3 The hook's double check.** A location is in a matter folder when either holds:

- an ancestor of it holds a pointer file;
- practice data's record, read read-only from the `practice.db` that the Roaming settings file's `case_data_root` names, lists an ancestor.

The hook needs only Python's standard library. On any read error it keeps its existing behaviour: it fails open, so a bug can never block all shell use.

**4.4 What a matter-folder hit changes.** This depends on §9 Q1. Today the hook already refuses every hard delete outside a Git worktree or the temp folder, matter folders included. The double check adds protection only if a matter folder sits inside a worktree or the temp folder (refuse there too), unless Brahm amends Commandment 7.

## 5. Constraints that must still hold

- Commandment 7: without file-manager, no file Probanda did not create is deleted or moved. The hook never moves a file itself.
- Commandment 1: the hook is an enforcer. Any narrowing needs Brahm's instruction in the implementing conversation, after the session states what stops being enforced.
- Commandments 3 and 5: the folder record is item data, hashed in the cloud, with no new local table or column.
- The hook fails open on its own errors (docstring, lines 35-36).
- Layering: the hook ships in `legal` and names nothing outside it but file-manager's tool (`source/layering.json` ruling already present).

## 6. Options considered

1. **The `$HOME` fix, and the double check as an extra guard** (recommended). Nothing is loosened.
2. **The `$HOME` fix only.** It is enough to clear the false block. Matter folders stay protected by today's rule.
3. **Narrow the hook to matter folders found by the double check.** Files outside a matter folder could then be hard-deleted. This needs Commandment 7 amended by Brahm first.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Make the `$HOME` fallback in `expand_vars`. Add a regression case to `.claude/skills/safe-file-deletion/tests/test_redirect_delete_to_trash.py`: the blocked payload, run with `HOME` removed from the hook's environment, is allowed. **UNVERIFIED**: that the test file can set the hook's environment.
3. Settle §9 Q1 and Q2 with Brahm, then build §4.2 and §4.3.
4. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of Delete hook expands $HOME without HOME, and recognises matter folders twice complete!`, then what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. `home_value` falls back to the home folder when the variable is unset.
2. The §2 payload is allowed with `HOME` unset, and a `$HOME/...` target in a folder holding a pointer file is still refused.
3. A matter folder is recognised when only its pointer file is present, and when only practice data's record names it.
4. No change loosens a refusal unless §9 Q1 is answered "narrow", and then only after the Commandment 7 amendment is on `main`.

Scope: edit source only (skill text, mcp/src, docs). Out of scope, because `/repackage` does it in the cloud from origin/main: rebuilding or committing any MCP bundle (mcp/dist), npm or esbuild runs, the plugin packager, version bumps, *-latest.plugin files, and running `/repackage`. Out of scope, because the orchestrating session runs it once after every spec lands: `build_plugin.py`. Out of scope, because valid testing happens only in Cowork after `/repackage`: writing, updating or running any test, suite, golden or E2E run in Claude Code. A type-check of edited TypeScript is allowed; it is not a test.

Note: step 2's regression test conflicts with this scope rule. The orchestrator asks Brahm which governs.

## 9. Open questions

1. Should a matter-folder hit only add protection (Option 1), or should the hook protect only matter folders (Option 3, which needs Commandment 7 amended)?
2. Folder record: relative to the litigation library, as in §4.2? And should matter-data initialize write it, or only the matter-opening step?

## 10. Verify against HEAD before building

- `expand_vars` and `home_value`, hook lines 350-365.
- `rm_targets`' `$` refusal, around line 600.
- No folder field on `matter` items: `writes.ts` `upsert_client_matter`.
- Where the hook is registered: `source/legal/plugin.json`, around line 22, and `.claude/settings.json`.

### Verification against HEAD (9f3c123, 2026-10-16)

| Spec claim | Found at HEAD | Verdict |
|---|---|---|
| `expand_vars`/`home_value`, hook lines 350-365; unset `HOME` keeps the `$HOME` text | `expand_vars` at lines 350-365, `home_value` at 359-361, `return os.environ.get(name, m.group(0))` at 361 | Confirmed |
| `rm_targets` returns None for a target containing `$`, around line 600 | Lines 600-601: `if path.startswith("~") or set("${\`") & set(path): return None` | Confirmed |
| No folder field on `matter` items | `writes.ts` `upsert_client_matter` matter data holds only description, file_number, matt_num, orig_lawyer, resp_lawyer, type_of_law and the three trust fields | Confirmed |
| Hook registered in `source/legal/plugin.json` around line 22 | The hook arg is at line 22 (entry lines 14-28, matcher `Bash\|PowerShell\|mcp__(.+__)?device_bash`) | Confirmed |
| Hook registered in `.claude/settings.json` | Not there: the repo's `.claude/settings.json` holds only the COMMANDMENTS and public-repo guards. The dev-machine registration is in `~/.claude/settings.json`, pointing at the Coclerk checkout's copy of the hook | Corrected |
| `practice.db` is `<case_data_root>\_practice\practice.db` | `backend.ts` `resolvePracticeDbPath` lines 33-37 (`COCLERK_DB_PATH`/`COCLERK_DB_NAME` override first) | Confirmed |
| Roaming device settings file names `case_data_root` | `config-path.ts` line 26: `%APPDATA%\Coclerk\coclerk.json`, with the `COCLERK_CONFIG_PATH` override winning | Confirmed |
| Each initialized matter folder holds a pointer `coclerk.json` | `files/matter-root.ts` `validateMatterRoot` line 35 | Confirmed |
| §4.2 storage: a data field on the `matter` item, no new table or column | `practice.db` is one `kv_store` table; items live as JSON under the `item` namespace, and data fields reach the cloud only as HMACs (`practice/store.ts` `buildOp` with `hash_key`) | Confirmed |
