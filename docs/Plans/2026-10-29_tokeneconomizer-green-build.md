# TokenEconomizer green stage (Cowork adaptation): a fixed envelope

Plan of 2026-10-29 for the green stage of
`docs/Specs/2026-10-28_tokeneconomizer-cowork-adaptation-spec.md` (the spec), revised on 2026-10-28
after both spike tests passed (spec, "Spike tests first"). It replaces the earlier draft, which kept
the envelope on Brahm's PC through two new tools on `lawyer`'s data server and had the model carry
it in and out of each Cowork session.

**The problem in one paragraph.** TokenEconomizer's loop guard watches an agent's tool calls and,
when a turn looks stuck in a failing loop, tells the model to change course. It only acts once it
has an envelope: how long a normal turn runs, learned from earlier turns that ended well and kept in
`envelope.json`. In Claude Cowork every session runs in a brand-new container, so that file is
thrown away with the session and the guard never acts. This plan gives the guard a fixed envelope in
Cowork, set in the plugin's hook command, so it can act from a session's first prompt.

## Why a fixed envelope (Brahm's ruling of 2026-10-28)

The plugin uses the envelope for three things only: an envelope must exist before the judge may run
(`plugin/controller.py:298`), the hard backstop sits at 2.5 times it (`loopguard/envelope.py:106-110`),
and the judge is told it as the usual turn length (`loopguard/state.py:225-231`). It never opens the
judge's gate by itself (`controller.py:327`). A fixed number does all three, and `EnvelopeTracker`
already returns a `frozen_envelope` until a repository has learned 5 turns of its own
(`envelope.py:84-88`).

Carrying a learned envelope instead would cost two tools, a store on the PC under Commandments 3 and
5, and, by spike test S2, about 400 tokens of context and one model step at every Cowork prompt. What
the fixed value gives up is the envelope following Cowork's own turn lengths across sessions. Every
Cowork session works in `/home/claude`, so Cowork could only ever learn one pooled envelope, and the
carry design sent turn counts only, so it would not have learned the noise thresholds either. Within
one Cowork session the local envelope still learns from the session's own turns once it has 5.

The value is 38, from the probanda-dev envelope on the PC (37.75 on 2026-10-28). If step e shows it
is wrong for Cowork, it is changed by hand, or the store is built then.

## Context

The red run (spec, "Red run results") showed that TokenEconomizer runs in Cowork but cannot learn
there:

- Each session gets a new container, so nothing written survives to the next (R5, R6 fail).
- The PC shell, `mcp__remote-devices__device_bash`, is not one of the tool names the guard knows
  (R10), so the guard cannot read the commands run on the PC.
- A hook's `additionalContext` does reach the model (R9), so a redirect reaches it.

The spike tests showed that the guard can act: S1 caught a staged loop on the PC, with a judge call
of 148,007 effective tokens. On the PC the judge had also woken three times on productive work, at
26k to 137k tokens each, partly because successful edits were counted as errors; the fork fixed that
in commit `9cdec34`.

**Rulings this plan follows:**

- A fixed envelope in Cowork, no store and no new tools (Brahm, 2026-10-28).
- Tool pruning is off in the Probanda copy (below, step c).
- Steps a to e, in the order given; each step names the check that proves it.
- Cowork probe prompts start "If this project is not te-cowork-test, stop and report." and write
  markers only under `/root/.tokeneconomizer`.

**Conventions for every step:**

- **Tests first, by path.** A hook refuses whole-suite runs, so every test file is run by its path:
  `python -m pytest <file>` in the fork.
- **Deletions.** Shell deletes, `git rm` and the trash tool are blocked inside a repository, so any
  file to delete goes to Brahm as a PowerShell `Remove-Item` command.
- **Before each push.** `python scripts/check_publishable.py --new-since origin/main` in
  probanda-dev.
- **Fork mechanics.** Keep `plugin/scripts/te` and `plugin/scripts/te-hook` executable in git
  (`git update-index --chmod=+x`; they are mode 100755 today). A pathspec commit can drop the bit
  set in the index, so check `git ls-tree HEAD` after committing. The hooks file is
  `plugin/hooks/hooks.json`; git stores it with LF line endings, and Brahm's PC working copy shows
  it as CRLF, so a diff there that is only line endings is not a change.

## Step a — Fork: teach the guard the PC shell's name (turn R10 green)

**What it does.** The guard maps every agent's tool names onto a few canonical ones (`bash`,
`view`, `edit`, ...) through the table `_TOOL_CANON` in `tokeneconomizer/loopguard/state.py`. Cowork's
shell on the PC is not in the table, so its commands are invisible to the guard.

- **Change.** Add `"mcp__remote-devices__device_bash": "bash"` to `_TOOL_CANON`. `canon_tool`
  lowercases the name before the lookup, so this key matches. In `tests/test_loopguard_state.py`,
  delete the `@pytest.mark.xfail(strict=True, ...)` line and the `import pytest` only it needs.
- **Why it is enough.** `SpiralState.update` (`state.py:187`) reads the call's `command` only once
  the name maps to `bash`; after this change the PC shell's command reaches the guard's action log
  and its test-run counter.
- **Check.** `python -m pytest tests/test_loopguard_state.py` passes (today it passes only because
  the test is marked as an expected failure). `python -m pytest tests/test_live_hooks.py` still
  passes.

## Step b — Fork: a fixed envelope as a guard setting

**What it does.** Lets a person or a hook command give the guard an envelope to use until a
repository has learned its own, through the existing pinned-threshold route.

- **Change.**
  - In `tokeneconomizer/plugin/config.py`, add to `LOOPGUARD_KEYS`
    `"envelope_frozen": (float, 1.0, None, "envelope used until this repository has learned its own")`.
  - In `tokeneconomizer/loopguard/envelope.py`, add `"envelope_frozen": "frozen_envelope"` to
    `_ENVELOPE_KEYS`. `load_envelope` then passes it to `EnvelopeTracker(frozen_envelope=...)`, and
    `thresholds()` leaves it out of the pinned keys, as it does the other envelope keys.
  - Nothing else changes. `controller.post_tool` and `cli.py` status already call `load_envelope`
    with `cfg.loopguard_thresholds`, so the hooks act on it and `te status` reports it.
- **How it is set.** Like any threshold: `te config set loopguard.envelope_frozen 38`, a config
  file, or `TE_LOOPGUARD_THRESHOLDS='{"envelope_frozen":38}'` in the environment. The public fork is
  unchanged while it is unset.
- **Tests first**, in a new `tests/test_loopguard_frozen_envelope.py`:
  - With `envelope_frozen=38` and no `envelope.json`, `load_envelope(...).envelope` is 38 and
    `thresholds(...)["backstop_turns"]` is 95.
  - With 5 or more learned turns, the learned envelope wins.
  - Unset, nothing changes.
  - The setting refuses 0, a negative number and a string.
  - Through `hook.main` with `TE_LOOPGUARD_THRESHOLDS` set and no `envelope.json`, a `PostToolUse`
    reaches the judge (`controller._judge` returns a judge, not None).
- **Check.** The new file passes by path, and `tests/test_live_hooks.py`,
  `tests/test_live_core.py` and `tests/test_loopguard_state.py` still pass.

Then bump the fork version in `pyproject.toml`, both `package.json`, and the three `plugin.json`
files (`.claude-plugin`, `.codex-plugin`, `.github/plugin`), commit, and push to the fork's `main`.
That commit is after `9cdec34`, so step c's copy carries the edit-miscount fix.

## Step c — probanda-dev: TokenEconomizer becomes a governed Probanda plugin

**What it does.** Moves the plugin from `vendor/` (a byte-for-byte copy outside the build, not
governed by COMMANDMENTS.md) to `source/tokeneconomizer/`, where `scripts/build_plugin.py` builds
and `/release` versions it like the other plugins. The Probanda copy ships only what Claude Code and
Cowork need.

- **Move.** Copy the fork's bundle (`python scripts/build_plugin.py --out <dir>` in the fork, at the
  step b commit) into `source/tokeneconomizer/`, keeping: `lib/tokeneconomizer/`, `scripts/`
  (`te`, `te-hook`, `te_bootstrap.py`), `hooks/hooks.json`, `slash-commands/` without `toolprune.md`
  and `untool.md`, `README.md` and `LICENSE`. Leave out the Codex, Copilot and Pi parts
  (`codex-skills/`, `pi/`, `.codex-plugin/`, `.github/`, `hooks/codex-hooks.json`,
  `hooks/copilot-hooks.json`, `package.json`). Add a `plugin.json` named `tokeneconomizer` (the
  build writes it to `.claude-plugin/plugin.json`), an empty `roster.json` (`{}`), and a
  `FORK_COMMIT` line in CLAUDE.md. Delete `vendor/tokeneconomizer/` by a `Remove-Item` command for
  Brahm. Repoint `.claude-plugin/marketplace.json:54` from `./vendor/tokeneconomizer` to
  `./plugins/tokeneconomizer`.
- **Assignment.** In `source/assignment.json`, add
  `"tokeneconomizer": {"requires": [], "skills": [], "agents": [], "hooks": {}, "servers": []}`
  plus a `"payload": ["lib", "scripts", "slash-commands"]` list naming the trees the build copies
  whole. It uses no other plugin, as the marketplace listing already says. `plugin_layout.plugins()`
  reads `requires`, `skills`, `agents`, `hooks` and `servers`; the new key is read by the build only.
- **Build.** `scripts/build_plugin.py` copies `plugin.json`, `.mcp.json`, `README.md`, `VISION.md`,
  and the files directly in `agents/` and `hooks/`. Teach `collect()` to also copy each `payload`
  tree recursively, byte for byte, and to record the executable bit for `scripts/te` and
  `scripts/te-hook` so `write()` sets it and `--check` compares it (the hook command runs
  `${CLAUDE_PLUGIN_ROOT}/scripts/te-hook` directly, so Linux needs the bit). The build's own gates
  then apply: every path must match `ARCHIVE_PATH`, text files are written with LF, and the hook
  path named in `plugin.json` must exist in the output.
- **Settings in the hook command.** `hooks/hooks.json` in the Probanda copy prefixes every hook
  command with `TE_LOOPGUARD_THRESHOLDS='{"envelope_frozen":38}' TE_TOOLPRUNE=off` (in the JSON
  string the inner double quotes are escaped). Brahm confirms once on the PC that Claude Code on
  Windows runs a hook command with that prefix.
  - The fixed envelope gives the guard an envelope at a Cowork session's first prompt. On the PC it
    matters only in a repository with fewer than 5 learned turns, where the guard can now act from
    the start; probanda-dev and the others with a learned envelope are unchanged.
  - Tool pruning is off, so the plugin never writes a user's `.claude/settings.local.json` and
    Commandment 7 is met without rulings; the `toolprune` and `untool` slash commands are left out
    because `te toolprune apply` does not check the setting (`cli.py:321-335`).
- **Names.** `scripts/check_publishable.py:27` already allows `tokeneconomizer`.
- **File-ops check.** `scripts/check_file_ops.py` scans skills, `agents/`, `hooks/` and the import
  closure of each MCP server; it does not scan a `lib/` tree, so it will not see the 27 lines of
  file operations in the fork's Python (12 files, all writes under the plugin's own state root or
  temporary folders, plus the pruning writes that are now unreachable). This stage does not extend
  it: 27 rulings whose counts drift at every fork refresh would cost more than they protect, since
  with pruning off the plugin touches no file Probanda did not create. CLAUDE.md records this
  reasoning so it is revisited if the fork's writes change.
- **CLAUDE.md.** Replace the "Vendored plugin" section with a "TokenEconomizer" section: it is now a
  governed plugin, Claude Code and Cowork only; the fork is the source of record for the Python and
  the hooks, and its commit is named here; how to refresh (`build_plugin.py --out` in the fork,
  copy the kept trees, re-apply the two Probanda overrides: the `plugin.json` name and version, and
  the hook command's environment prefix); the fixed envelope's value, where it came from and how to
  change it (from the PC's `te status`); tool pruning is off; why `check_file_ops.py` does not scan
  it. Add the plugin-table row `tokeneconomizer` | Optional. Redirects a turn stuck in a failing
  loop, in Claude Code and in Cowork | nothing. Update line 36's list of permanent names (drop the
  word "vendored").
- **Check.**
  1. `python scripts/build_plugin.py --check`
  2. `python scripts/check_plugin.py` (runs for every plugin in the assignment; an empty roster
     and no skills must pass or the failing check is fixed)
  3. `python scripts/check_file_ops.py`
  4. `python scripts/check_layering.py`
  5. `git ls-files -s plugins/tokeneconomizer/scripts/te plugins/tokeneconomizer/scripts/te-hook`
     shows mode 100755.
  6. `python scripts/check_publishable.py --new-since origin/main`
- **Release.** The first release of `tokeneconomizer` under `/release`.

## Step d — Cowork rerun of the red tests, and a staged loop

**Setup.** Brahm installs the released `tokeneconomizer` in Cowork, in the project `te-cowork-test`.
The marketplace listing keeps "being adapted" until this step is all green. On the PC, Claude Code's
hooks have been running from the fork checkout rather than from this marketplace; Brahm confirms
which copy the PC runs before reading PC results against this release.

**One session.** Paste:

> If this project is not te-cowork-test, stop and report. Run the TokenEconomizer red tests R1 to
> R4 and R8 to R11 from docs/Specs/2026-10-28_tokeneconomizer-cowork-adaptation-spec.md, and record
> each PASS or FAIL with its evidence. Call canon_tool for Bash, Read, Edit, Write and
> mcp__remote-devices__device_bash (R3, R10). For R5, show the output of te status --json and
> report loopguard.envelope. Then run spike test S1's staged loop from the spec's "Spike tests
> first", in your scratchpad directory and in this one turn: 20 pairs of an edit to s1_target.py
> and a run of s1_check.py. If a message tells you the turn looks stuck or to try a different
> approach, note the tool call number it arrived at, then stop and report it. Write nothing outside
> /root/.tokeneconomizer and your scratchpad directory.

**Expected results.**

- R1 to R4, R8, R9 and R10 pass.
- R5, restated in the spec: `te status --json` reports `loopguard.envelope` 38 at the first prompt.
- R6 no longer applies: nothing is folded across sessions.
- R7 stays FAIL by design: hooks do not call tools, and this design needs none.
- R11 records the hook time and the judge calls with their tokens.
- R12 stays not observable. The design does not depend on it.
- The staged loop gets a redirect: Cowork has no `config.json`, so shadow is off there and the
  redirect reaches the model. This is the proof that the guard acts in Cowork.

**Docs.**

- Add a dated block `**Claude Cowork, 2026-1x-xx**` to the fork's `docs/PLUGIN.md` §3 ("Verified
  agent behaviour"), in the form of the existing blocks: the Cowork and plugin versions, the session,
  and what each R test and the staged loop showed.
- Point the spec's "Red run results" to that block.

**Check.** Every listed R test is PASS in Brahm's report, except R7 (FAIL by design), R6 (no longer
applies) and R12 (not observable), and the staged loop got a redirect. Brahm's session is the only
proof: none of this runs offline.

## Step e — Measure the gain, then refactor

- **Payback test, fixed before the sessions run.** Over at least ten real Cowork sessions, the guard
  repays its cost if the effective tokens its true redirects saved are at least what all its judge
  calls cost. A true redirect is one a person reading the transcript agrees came on a stuck turn;
  what it saved is the tokens that turn spent after the point where the guard spoke, in the
  baseline. "Plugin overhead" is the plugin's own model calls (`ledger.OVERHEAD_KEYS`: the judge,
  the redirect writer and the micro-skills proposer), not hook time.
- **Measure.** On the PC, end shadow mode with `te config set shadow false --global`. Record, per
  session:
  - effective tokens and plugin overhead, against the PC baseline of 2026-10-28 (`te status` for
    probanda-dev: 6 folded sessions, 9.7M effective tokens, plugin overhead 526.4k, 5.2%);
  - each judge wake, with its tokens, split into true redirects, false wakes ("not stuck"
    verdicts) and wakes that ended in no verdict;
  - whether the fixed envelope looked right for Cowork's turns (the turn lengths the session's
    `envelope.json` recorded).

  Record the result in the spec, beside its open question on the measured gain.
- **Decide.** If the guard does not repay its cost in Cowork, Brahm rules what the plugin does
  there (for example, everything but the loop guard off, or no Cowork install), and the listing
  says so. If it repays but 38 is wrong for Cowork's turns, change the value; if a learned envelope
  is wanted, the store of the earlier draft is the follow-up.
- **Refactor.** Simplify what steps b and c added, with the fork tests (by path) and the R tests as
  the net. Re-run every test file named above, and rerun the step d session.

## What we removed or chose not to add

| Considered | Verdict | Why |
|---|---|---|
| Carrying the envelope between the PC and Cowork: two tools on `lawyer`'s data server (`tokeneconomizer__envelope_read`, `tokeneconomizer__envelope_append`), a SQLite store on the PC, an `envelope_sync` setting and hooks that ask the model to call them | Replaced by a fixed envelope (Brahm, 2026-10-28) | The plugin uses the envelope only to let the judge run, to place the backstop and to tell the judge the usual turn length; a fixed number does all three. The carry cost about 400 tokens and a model step at every Cowork prompt (S2), two tools and a store under Commandments 3 and 5, and its first Cowork session would have read an empty store. |
| A new `TE_ENVELOPE_FROZEN` environment variable or config field | Not added | The pinned-threshold route (`LOOPGUARD_KEYS`, `_ENVELOPE_KEYS`) already reads the environment, config files and `te config set`, and already reaches `te status`. |
| Tool pruning in the Probanda copy: `propose`-only mode plus ~25 `file-ops.json` rulings and a wider `check_file_ops.py` | Replaced by `TE_TOOLPRUNE=off` and dropping the `toolprune`/`untool` slash commands | Off, the plugin never writes a user's settings file and the rulings have nothing to rule on. `check_file_ops.py` is not extended: its counts would go stale at every fork refresh, for a tree whose remaining writes are under the plugin's own state root. |
| Codex, Copilot and Pi parts in the Probanda copy | Left out | Probanda ships to Claude Code and Cowork only. Fewer files, nothing to keep in step. |
| Keeping `vendor/tokeneconomizer/` beside `source/` during a transition | Not done | Two copies of one plugin is the state the move exists to end. |

## Facts checked in review

- **Shadow mode** suppresses everything the plugin shows the agent: micro-skill injection, the
  repository map, every notice and both guard actions (`controller.py`). Cowork has no
  `config.json`, so shadow is off there unless the hook command sets `TE_SHADOW`.
- **Doing nothing is free in Cowork.** `_judge` returns None without an envelope, so today's Cowork
  sessions pay no judge tokens. This plan ends that: every judge wake in Cowork is now paid.
- **"Plugin overhead" means model tokens.** `ledger.OVERHEAD_KEYS` sums the judge, the redirect
  writer and the micro-skills proposer; hook time is not in it.
- **Count of file operations.** 27 lines in 12 files of the fork's Python, including `repos.py`
  with 10, `repomap.py` and `sidecall.py`.
- **`check_file_ops.py` scope.** `shipped_files()` reads skill folders, the files directly in
  `agents/` and `hooks/`, and server import closures. A `lib/` tree is not read.
- **Build script facts.** `build_plugin.py` copies only the files directly in `agents/` and `hooks/`
  (`plugin_layout.source_files`), normalises text to LF, checks `ARCHIVE_PATH` and that the hook
  path in `plugin.json` exists in the output. The executable bit must be set by the build and
  compared by `--check`, or every rebuild loses it.
- **Assignment keys.** `plugin_layout.plugins()` reads `requires`, `servers`, `skills`, `agents` and
  `hooks`; the payload list is a separate key the build reads.
- **Line references checked:** `state.py:187` and `:225-231`, `envelope.py:84-88`, `:106-110` and
  `:157-176`, `controller.py:298`, `:319-331`, `cli.py:123-138` and `:321-335`, `config.py:113-127`,
  `check_publishable.py:27`, `marketplace.json:53-54`; the vendored copy at 0.1.6.

## Files touched (when built)

- **Fork.**
  - `tokeneconomizer/loopguard/state.py`, `tokeneconomizer/loopguard/envelope.py`,
    `tokeneconomizer/plugin/config.py`
  - `tests/test_loopguard_state.py`, `tests/test_loopguard_frozen_envelope.py`
  - `docs/PLUGIN.md`
  - the version files (`pyproject.toml`, `package.json`, `plugin/package.json`, the three
    `plugin.json`)
- **probanda-dev.**
  - `source/tokeneconomizer/` (new), `source/assignment.json`
  - `scripts/build_plugin.py`
  - `.claude-plugin/marketplace.json`, `CLAUDE.md`
  - the spec
  - deleted by Brahm: `vendor/tokeneconomizer/`
