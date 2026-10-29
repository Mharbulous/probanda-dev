# DRAFT: revise after the spike tests — TokenEconomizer green stage (Cowork adaptation)

Draft plan of 2026-10-29, reviewed and corrected the same day, for the green stage of
`docs/Specs/2026-10-28_tokeneconomizer-cowork-adaptation-spec.md` (the spec). It was written before
the spec's spike tests S1 and S2. Once they have run, this plan is revised from their results, and
nothing here is built before then.

**The problem in one paragraph.** TokenEconomizer's loop guard watches an agent's tool calls and,
when a turn looks stuck in a failing loop, tells the model to change course. It only dares to do
that once it has learned, from earlier turns that ended well, how long a normal turn runs here (the
"envelope": a list of turn lengths, kept in `envelope.json`). In Claude Cowork every session runs in
a brand-new cloud container, so that file is thrown away with the session and the guard never learns
anything. The green stage would keep the envelope on Brahm's PC, in a small SQLite file reached
through two new tools on `lawyer`'s data server, and have the model carry it in and out of each
Cowork session, because a hook cannot call a tool itself (red test R7).

## Spike tests first

The spec's "Spike tests first" defines the two spike tests that come before this plan is revised:
S1, whether the loop guard acts on a staged stuck turn on the PC, and S2, whether the Cowork model
makes a tool call a hook asks for at every prompt. They need no code in either repository. Whether
the guard saves more than it costs is measured after the build, in step g.

S1's result is read on the PC, read-only, from the probanda-dev clone. This prints the `nudge`
events logged with `shadow: true`, the `abort` events, and for each `envelope.json` the count,
smallest, median, 90th-percentile and largest turn length it has learned:

```bash
python -I -c "import glob,json,os,statistics as s;R=os.path.expanduser('~/.tokeneconomizer/repos');ev=[json.loads(l) for f in glob.glob(R+'/*/claude/events.jsonl') for l in open(f,encoding='utf-8') if l.strip()];print('shadow nudges',sum(e.get('kind')=='nudge' and e.get('shadow') is True for e in ev),'aborts',sum(e.get('kind')=='abort' for e in ev));[print(os.path.basename(os.path.dirname(os.path.dirname(f))),len(t),min(t),s.median(t),sorted(t)[int(.9*(len(t)-1))],max(t)) for f in glob.glob(R+'/*/claude/envelope.json') for t in [json.load(open(f,encoding='utf-8')).get('resolved_turns') or [0]]]"
```

## Context

The red run (spec, "Red run results") showed that TokenEconomizer runs in Cowork but cannot learn
there:

- Each session gets a new container, so nothing written survives to the next (R5, R6 fail).
- A hook cannot call an MCP tool (R7), so a hook cannot fetch the envelope from the PC itself.
- The PC shell, `mcp__remote-devices__device_bash`, is not one of the tool names the guard knows
  (R10), so the guard cannot read the commands run on the PC.
- But a `PostToolUse` hook does receive a PC tool's response (R8), and a hook's `additionalContext`
  does reach the model (R9).

So the green design has the model do the carrying: at the first prompt a hook asks the model to
call a read tool, the `PostToolUse` hook catches the response and writes it to the local
`envelope.json`; at later prompts a hook asks the model to call an append tool with the turns
finished since. This is the route Probanda already uses when a hook needs a tool's answer
(`source/lawyer/hooks/missing-key-note.py` asks the model to call
`practice_data__config_status` once).

**Rulings this plan follows**, given with the request of 2026-10-29:

- New tools `tokeneconomizer__envelope_read` and `tokeneconomizer__envelope_append` on `lawyer`'s
  data server, built on the generic `runKv` engine (`source/lawyer/mcp/src/kv/backend.ts`), in
  their own SQLite file under `%APPDATA%\Probanda\`. Never the `time_pipeline` store. This settles
  the spec's "first check whether `time_pipeline`…".
- The model carries the envelope, because hooks cannot call tools (R7).
- The append happens at each later prompt, not at `Stop`. Each session's last turn is lost.
- Tool names differ by host: `mcp__remote-devices__plugin_lawyer_data__*` in Cowork,
  `mcp__plugin_lawyer_data__*` in Claude Code on the PC.
- Steps a to g, in the order given; each step names the check that proves it.
- Cowork probe prompts start "If this project is not te-cowork-test, stop and report." and write
  markers only under `/root/.tokeneconomizer`.

**Conventions for every step:**

- **Tests first, by path.** A hook refuses whole-suite runs, so every test file is run by its path:
  `python -m pytest <file>` in the fork; in probanda-dev, build with
  `node source/lawyer/mcp/node_modules/typescript/bin/tsc -p source/lawyer/mcp/tsconfig.json`
  (a hook blocks `npm run`), then `node --test <file>`.
- **Deletions.** Shell deletes, `git rm` and the trash tool are blocked inside a repository, so any
  file to delete goes to Brahm as a PowerShell `Remove-Item` command.
- **Before each push.** `python scripts/check_publishable.py --new-since origin/main` in
  probanda-dev.
- **Fork mechanics.** Keep `plugin/scripts/te` and `plugin/scripts/te-hook` executable in git
  (`git update-index --chmod=+x`; they are mode 100755 today). The hooks file is
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

## Step b — Fork: merge and validate an envelope that arrived from outside

**What it does.** Two small functions in `tokeneconomizer/loopguard/envelope.py` that step c's
hooks call. No command-line subcommand (see "What we removed").

- **`import_turns(store, turns)`** replaces the `resolved_turns` list in this repository's
  `envelope.json` with `turns`, keeping the last `ENVELOPE_HISTORY` (500, `envelope.py:148`), under
  `store.locked("envelope")`, and leaves `resolved_snaps` and `level` as they are. It rejects
  anything that is not a list of non-negative integers.
- **`export_turns(store)`** returns the `resolved_turns` list (empty when there is no envelope).

Why turn counts only: the guard's gate on acting, `EnvelopeTracker.envelope`, reads only
`resolved_turns`. The per-turn snapshots (`resolved_snaps`) only *raise* the signal thresholds
above the preset floor on repositories with churny-but-productive turns; without them the guard
runs on the preset, which is the hand-tuned default. A list of integers is also the simplest
possible thing to validate under Commandment 3 (nothing about a client can hide in it).

**Tests first**, in a new `tests/test_loopguard_envelope_io.py`: export of a missing envelope
returns an empty list; import keeps the last 500; import rejects a string, a negative number and a
non-list; import leaves existing `resolved_snaps` untouched; import then export is lossless.

**Check.** The new file passes by path. `tests/test_plugin_package.py` still passes (it pins that
the mechanisms never import `tokeneconomizer.plugin`, which these helpers do not).

## Step c — Fork: the hooks ask the model to carry the envelope

**The setting.** Add `envelope_sync` to `plugin/config.py`, values `off` (default) and `on`, read
like every other setting from the config files and from `TE_ENVELOPE_SYNC`. The public fork is
unchanged at the default. The Probanda copy turns it on by prefixing the environment variable to
the hook command in its `hooks/hooks.json` (`TE_ENVELOPE_SYNC=on TE_TOOLPRUNE=off
"${CLAUDE_PLUGIN_ROOT}/scripts/te-hook"`), because a Cowork container has no `config.json`. Brahm
confirms once on the PC that Claude Code on Windows runs the hook command through a shell that
accepts that prefix.

With it on, the hook recognises the two tools by the pattern
`^mcp__(?:.+__)?plugin_lawyer_data__tokeneconomizer__envelope_(read|append)$`, which covers both
hosts' prefixes; it is the shape `lawyer`'s own matchers use (`source/lawyer/plugin.json:86`).

**In `plugin/controller.py`:**

- **The session's first prompt** (`user_prompt`, `:255`). There is no first-prompt marker today, so
  set one, `s["envelope_asked"]`, on the session record, and return `additionalContext` asking the
  model to call `tokeneconomizer__envelope_read` once before its other work. Asked once per
  session; if the model does not comply, that session runs without an envelope and the event log
  says so. The early return at `:256-258` (loop guard off) stays as it is: with the guard off there
  is nothing to sync.
- **`PostToolUse` for the read tool** (`post_tool`, `:304`; the name, input and response text come
  from `Host.tool_call`, which flattens an MCP response's text blocks). Parse the response as JSON,
  call `import_turns` with its `resolved_turns`, and set `s["envelope_loaded"]`. If it does not
  parse or fails validation, write nothing, log an `envelope` event with the reason, and fail open.
- **Each turn that ended well.** `_close_turn` (`:240`) already feeds the local envelope through
  `record_turn`; also append the turn's count to `s["envelope_unsaved"]`.
- **Each later prompt with a non-empty `envelope_unsaved`.** Return `additionalContext` asking the
  model to call `tokeneconomizer__envelope_append` with exactly `{"resolved_turns": [...]}` before
  answering.
- **`PostToolUse` for the append tool.** Drop from `envelope_unsaved` the counts the tool input
  carried. If the call failed (`PostToolUseFailure`), keep them for the next prompt.
- **Shadow mode.** No exception for the envelope notes: `shadow` already suppresses everything the
  plugin shows the agent (injection, notices, redirects), and these notes obey it too. Cowork has
  no `config.json`, so shadow is off there unless the hook command sets `TE_SHADOW`.
- **Events.** Log every ask and every import or drop as kind `envelope` (new event kinds are a
  compatibility surface; this one is new, so nothing is renamed).

**Tests first**, in a new `tests/test_live_envelope_sync.py`, in the style of
`tests/test_live_hooks.py` (synthetic hook payloads through `hook.main`):

- The first prompt asks for the read tool; a second prompt does not ask again.
- A read response under either host's tool-name prefix writes `envelope.json`.
- A response that is not JSON, or has a string in the list, writes nothing and logs the event.
- A turn that ended well makes the next prompt ask for an append carrying only the new counts.
- A successful append clears them; a failed one keeps them.
- With `envelope_sync=off` (the default), no hook output changes.

**Check.** The new file passes by path, and `tests/test_live_hooks.py`, `tests/test_live_core.py`
and `tests/test_live_safety.py` still pass. Per the fork's CLAUDE.md, also check against a recorded
session: fold one recorded Claude Code session with sync on and confirm `envelope.json` matches
the fold with sync off (sync changes what the hooks say, never what a fold learns).

Then bump the fork version in `pyproject.toml`, both `package.json`, and the three `plugin.json`
files (`.claude-plugin`, `.codex-plugin`, `.github/plugin`), commit, and push to the fork's `main`.

## Step d — probanda-dev: two tools on `lawyer`'s data server

**What it does.** A read tool and an append tool that keep turn counts in one SQLite file on the PC,
through the same generic key-value engine `practice` and `time_pipeline` use. The code goes under
`source/lawyer/mcp/src/`.

- **`tokeneconomizer/backend.ts`.**
  - **Path.** `tokeneconomizerDbPath(env)` returns `join(dirname(configPath(env)),
    "tokeneconomizer.db")`, so it lands beside `probanda.json` in `%APPDATA%\Probanda\` and honours
    `COCLERK_CONFIG_PATH` exactly as `config-path.ts:70` does. Note for Brahm: Probanda's other local
    databases (`practice.db`, `time_pipeline.db`) live under `<case data root>\_practice\`; this one
    is in the app-data folder by his ruling.
  - **Calls.** Each goes through `runKv({...req, db_path, exclusive: true}, {label, timeoutMs, env})`
    as `practice/backend.ts:64` does, and a reply of `{other_tables: true}` becomes a
    `DataServerError` naming the file, as there.
  - **Storage.** The one generic `kv_store` table, namespace `tokeneconomizer` (Commandment 5: no
    table per kind). Each turn that ended well is one row: key `turn:<ISO time>:<session hash>:<n>`,
    value the integer count. One row per turn means a PC session and a Cowork session can append at
    the same moment without overwriting each other.
- **`tokeneconomizer__envelope_read`** takes no input. It runs the engine's `list` with prefix
  `turn:` (the keys sort by time) and returns the newest 500 as `{"resolved_turns": [...]}`, oldest
  first.
- **`tokeneconomizer__envelope_append`** takes `{"resolved_turns": [...]}`. Integers of zero or more
  only; anything else is refused with a named error (Commandment 3). The rows go in one `apply`
  call (the engine's all-or-nothing write). It deletes nothing: the reader takes the newest 500, and
  the rows are a few bytes each (trimming is a later addition if the file ever grows past tens of
  thousands of rows).
- **Wiring.** Definitions in `schema/tokeneconomizer.ts` (prefix helper as in
  `schema/time-pipeline.ts:4`), listed in `schema-gen.ts` and in `dataToolDefinitions()`
  (`dispatch.ts:295`); handlers by `defineTool` in `dispatch.ts`, one per definition, as
  `dispatch.ts:174-181` does for `time_pipeline`.
- **Test first.** `source/lawyer/mcp/test/tokeneconomizer-envelope.db.test.mjs`, modelled on
  `test/time-pipeline-tools.db.test.mjs`: an `mkdtemp` fixture setting `APPDATA` (no case data root
  is needed, since the path comes from `configPath`), importing `../build/tokeneconomizer/backend.js`.
  It covers: a read of an empty store; an append then a read; the read returns the newest 500 and
  no more; refusal of a string, a negative number and a non-list; the file is at
  `<APPDATA>/Probanda/tokeneconomizer.db` and holds only `kv_store`; no `time_pipeline.db` or
  `practice.db` is created.
- **Check.**
  1. Build (tsc), then `node --test source/lawyer/mcp/test/tokeneconomizer-envelope.db.test.mjs`.
  2. Bundle with `node source/lawyer/mcp/scripts/bundle.mjs`.
  3. `python scripts/build_plugin.py --check`, `python scripts/check_plugin.py` and
     `python scripts/check_publishable.py --new-since origin/main`.
- **Release.** `lawyer` patch by `/release`: `source/lawyer/plugin.json` from 0.14.1 (or what is
  current then) to the next patch, rebuilt, committed as `Lawyer 0.14.x: ...`.

## Step e — probanda-dev: TokenEconomizer becomes a governed Probanda plugin

**What it does.** Moves the plugin from `vendor/` (a byte-for-byte copy outside the build, not
governed by COMMANDMENTS.md) to `source/tokeneconomizer/`, where `scripts/build_plugin.py` builds
and `/release` versions it like the other plugins. The Probanda copy ships only what Claude Code and
Cowork need.

- **Move.** Copy the fork's bundle (`python scripts/build_plugin.py --out <dir>` in the fork, at the
  step c commit) into `source/tokeneconomizer/`, keeping: `lib/tokeneconomizer/`, `scripts/`
  (`te`, `te-hook`, `te_bootstrap.py`), `hooks/hooks.json`, `slash-commands/` without `toolprune.md`
  and `untool.md`, `README.md` and `LICENSE`. Leave out the Codex, Copilot and Pi parts
  (`codex-skills/`, `pi/`, `.codex-plugin/`, `.github/`, `hooks/codex-hooks.json`,
  `hooks/copilot-hooks.json`, `package.json`). Add a `plugin.json` named `tokeneconomizer` (the
  build writes it to `.claude-plugin/plugin.json`), an empty `roster.json` (`{}`), and a
  `FORK_COMMIT` line in CLAUDE.md. Delete `vendor/tokeneconomizer/` by a `Remove-Item` command for
  Brahm. Repoint `.claude-plugin/marketplace.json:54` from `./vendor/tokeneconomizer` to
  `./plugins/tokeneconomizer`.
- **Assignment.** In `source/assignment.json`, add
  `"tokeneconomizer": {"requires": ["lawyer"], "skills": [], "agents": [], "hooks": {}, "servers": []}`
  plus a `"payload": ["lib", "scripts", "slash-commands"]` list naming the trees the build copies
  whole. `plugin_layout.plugins()` reads `requires`, `skills`, `agents`, `hooks` and `servers`; the
  new key is read by the build only. No server of its own (spec).
- **Build.** `scripts/build_plugin.py` copies `plugin.json`, `.mcp.json`, `README.md`, `VISION.md`,
  and the files directly in `agents/` and `hooks/`. Teach `collect()` to also copy each `payload`
  tree recursively, byte for byte, and to record the executable bit for `scripts/te` and
  `scripts/te-hook` so `write()` sets it and `--check` compares it (the hook command runs
  `${CLAUDE_PLUGIN_ROOT}/scripts/te-hook` directly, so Linux needs the bit). The build's own gates
  then apply: every path must match `ARCHIVE_PATH`, text files are written with LF, and the hook
  path named in `plugin.json` must exist in the output.
- **Settings in the hook command.** `hooks/hooks.json` in the Probanda copy prefixes every hook
  command with `TE_ENVELOPE_SYNC=on TE_TOOLPRUNE=off`. Tool pruning is off, so the plugin never
  writes a user's `.claude/settings.local.json` and Commandment 7 is met without rulings; the
  `toolprune` and `untool` slash commands are left out because `te toolprune apply` does not check
  the setting (`cli.py:321-335`).
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
  the hook command's environment prefix); tool pruning is off; why `check_file_ops.py` does not
  scan it. Add the plugin-table row `tokeneconomizer` | Optional. Learns how long a normal turn runs
  and keeps that on the PC through `lawyer`, so the loop guard can act in Cowork | `lawyer`. Update
  line 36's list of permanent names (drop the word "vendored").
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

## Step f — Cowork rerun of R1 to R12, then a second session

**Setup.** Brahm installs the released `lawyer` and `tokeneconomizer` in Cowork, in the project
`te-cowork-test`. The marketplace listing keeps "being adapted" until this step is all green.

**Session 1.** Paste:

> If this project is not te-cowork-test, stop and report. Run the TokenEconomizer red tests R1 to
> R4 and R7 to R12 from docs/Specs/2026-10-28_tokeneconomizer-cowork-adaptation-spec.md, and record
> each PASS or FAIL with its evidence. Call canon_tool for Bash, Read, Edit, Write and
> mcp__remote-devices__device_bash (R3, R10). Then confirm you were asked at the first prompt to
> call tokeneconomizer__envelope_read, call it, and show /root/.tokeneconomizer/repos/*/claude/envelope.json.
> Then run three turns of real tool calls, and at each later prompt report whether you were asked
> to call tokeneconomizer__envelope_append and what it carried. Write the marker
> /root/.tokeneconomizer/r5-marker.txt holding this session's boot id and the time. Write nothing
> outside /root/.tokeneconomizer.

**Session 2** (a new session, same project). Paste:

> If this project is not te-cowork-test, stop and report. Check R5 and R6 through the PC store: call
> tokeneconomizer__envelope_read, then show /root/.tokeneconomizer/repos/*/claude/envelope.json and
> the output of te status --json. R5 passes if resolved_turns holds the turn counts the first
> session appended, though the boot id differs. Report whether /root/.tokeneconomizer/r5-marker.txt
> exists; it should not, which shows the container is new. R6 passes as stated below. Write nothing
> outside /root/.tokeneconomizer.

**Expected results.**

- R1 to R4, R8, R9 and R10 pass.
- R7 stays FAIL by design: hooks do not call tools; the model does.
- R11 records the token cost of each ask, read and append.
- R12 stays not observable. The design does not depend on it.

**R6 needs a ruling.** As written ("`te status` counts the first session"), R6 cannot pass: a
session is counted when it is *folded*, which needs its transcript, and the transcript dies with
the container; the store holds turn counts only. Proposed restatement, for Brahm to rule: "R6
passes when `te status --json` in the second session shows `loopguard.ended_green_turns` at least
the number of turns the first session appended." Until he rules, the report gives R6 under both
readings.

**Docs.**

- Add a dated block `**Claude Cowork, 2026-1x-xx**` to the fork's `docs/PLUGIN.md` §3 ("Verified
  agent behaviour"), in the form of the existing blocks: the Cowork and plugin versions, the two
  sessions, and what each R test showed.
- Point the spec's "Red run results" to that block, and record there the `time_pipeline` ruling and
  the move from `Stop` to the next prompt.

**Check.** Every R test is PASS in Brahm's two reports, except R7 (FAIL by design) and R12 (not
observable). Brahm's sessions are the only proof: none of this runs offline.

## Step g — Measure the gain, then refactor

- **Measure.** Shadow is already off in Cowork (no `config.json` there). On the PC, end shadow mode
  with `te config set shadow false --global`. Run at least ten real Cowork sessions. Compare, per
  session:
  - effective tokens with the plugin against the 2026-10-28 baseline (`te status` for
    probanda-dev: 3 folded sessions, 428.7k effective tokens of the sessions' own work beside
    389.9k of plugin overhead);
  - redirects that changed the turn, read from the transcript by a person;
  - the token cost of the envelope asks, reads, appends and judge calls.

  Record the result in the spec, beside its open question on the measured gain.
- **Decide.** If the guard does not repay its cost in Cowork, Brahm rules what the plugin does
  there (for example, everything but the loop guard off, or no Cowork install), and the listing
  says so.
- **Refactor.** Simplify what steps b to e added, with the fork tests (by path) and the R tests as
  the net. Re-run every test file named above, and rerun one Cowork session pair.

## What we removed or chose not to add

| Considered | Verdict | Why |
|---|---|---|
| `te envelope export/append` CLI subcommand (step b) | Removed | The hooks do the work; two helpers in `loopguard/envelope.py` with their own test suffice. A CLI would be a second entry point to keep in step. |
| The `envelope_sync` setting | Kept, as `off`/`on` | Something must keep the public fork unchanged by default. Renamed from `off`/`lawyer` (the host pattern already covers both prefixes) and read as `TE_ENVELOPE_SYNC`, the fork's existing naming, not a new `TOKENECONOMIZER_*` variable. |
| `scripts/sync_tokeneconomizer.py` with `--check` | Removed | `build_plugin.py --check` already pins `source/` to `plugins/`; the refresh is a short recipe in CLAUDE.md, as today, plus the fork commit named there. |
| Storing per-turn snapshots (`resolved_snaps`) in the PC store | Removed; turn counts only | The guard's gate on acting reads only `resolved_turns`; snapshots only raise the signal thresholds above the preset. Integers are the simplest thing to validate under Commandment 3. The local file keeps whatever snapshots it has. |
| Trimming the store to 500 rows in `append` | Removed | The reader takes the newest 500. The engine's `apply` deletes by key only, so trimming would need a `list` first. Rows are bytes; add trimming when the file is large. |
| Tool pruning in the Probanda copy: `propose`-only mode plus ~25 `file-ops.json` rulings and a wider `check_file_ops.py` | Replaced by `TE_TOOLPRUNE=off` and dropping the `toolprune`/`untool` slash commands | Off, the plugin never writes a user's settings file and the rulings have nothing to rule on. `check_file_ops.py` is not extended: its counts would go stale at every fork refresh, for a tree whose remaining writes are under the plugin's own state root. |
| A shadow-mode exception so envelope notes go out in shadow | Not added | `shadow` means "nothing reaches the agent"; carving an exception breaks that meaning, and Cowork has no config file, so shadow is off there anyway. |
| Codex, Copilot and Pi parts in the Probanda copy | Left out | Probanda ships to Claude Code and Cowork only. Fewer files, nothing to keep in step. |
| Re-asking for the read tool at later prompts if the model ignored the first ask | Not added | One ask per session; spike test S2 measures whether the model complies, which is the right place to learn that. |
| Keeping `vendor/tokeneconomizer/` beside `source/` during a transition | Not done | Two copies of one plugin is the state the move exists to end. |

## Corrections made in review

- **Shadow mode.** The plan said shadow "suppresses only the loop guard's acts". `controller.py`
  shows it also suppresses micro-skill injection, the repository map, every notice and both guard
  actions: everything the plugin shows the agent. The envelope exception is dropped (above).
- **Step c's early return.** The plan said the return at `controller.py:256-258` "must not skip"
  the envelope ask. With the loop guard off there is nothing to sync; the return stays.
- **Environment variable name.** `TOKENECONOMIZER_ENVELOPE_SYNC` becomes `TE_ENVELOPE_SYNC`, the
  prefix every other setting uses (`config.py`, `_ENV`).
- **The kv engine's `apply`.** It takes `set` and `delete` by key only; `delete_prefix` exists only
  in `bulk_apply`, which reads a file. "One `apply` write, which then deletes the rows past the
  newest 500" was not possible as written; trimming is dropped instead.
- **`exclusive: true`.** The engine answers `{other_tables: true}` rather than raising; the backend
  must turn that into an error, as `practice/backend.ts` does. Added.
- **Hooks file path and line endings.** It is `plugin/hooks/hooks.json` (and
  `vendor/tokeneconomizer/hooks/hooks.json`), not `plugin/hooks.json`. Both are LF in git and in this
  checkout; the CRLF is in Brahm's Windows working copy.
- **`te status` and R6.** Folding needs the transcript, so R6 as written cannot pass; the
  observable is `loopguard.ended_green_turns` in `te status --json` (`cli.py:137-138`). The
  restatement now names it.
- **"Plugin overhead" means model tokens.** `ledger.OVERHEAD_KEYS` sums the judge, the redirect
  writer and the micro-skills proposer; hook time is not in it. Step g's measure uses that meaning.
- **Count of file operations.** 27 lines in 12 files (the plan said about 25 in 11 and left out
  `repos.py` with 10, `repomap.py` and `sidecall.py`). Moot now that no rulings are written.
- **Test fixture for step d.** `time-pipeline-tools.db.test.mjs` writes a `coclerk.json` with a
  case data root because `time_pipeline.db` lives under `<case data root>\_practice\`; the new
  store's path comes from `configPath`, so its fixture needs only `APPDATA`.
- **`check_file_ops.py` scope.** Confirmed: `shipped_files()` reads skill folders, the files
  directly in `agents/` and `hooks/`, and server import closures. A `lib/` tree is not read, as the
  plan said; the plan's proposal to extend it is dropped (above).
- **Build script facts.** Confirmed `build_plugin.py` copies only the files directly in `agents/`
  and `hooks/` (`plugin_layout.source_files`), normalises text to LF, checks `ARCHIVE_PATH` and that
  the hook path in `plugin.json` exists in the output. Added that the executable bit must be set by
  the build and compared by `--check`, or every rebuild loses it.
- **Assignment keys.** `plugin_layout.plugins()` reads `requires`, `servers`, `skills`, `agents` and
  `hooks`; the plan's `"hooks": {...}` placeholder is now `{}` and the payload list is named as a
  separate key the build reads.
- **Doing nothing is free in Cowork.** `_judge` returns None without an envelope, so today's
  Cowork sessions pay no judge tokens.
- **Line references checked and kept:** `state.py:187`, `envelope.py:148` and `:157`,
  `controller.py:255`, `:256-258`, `:304`, `practice/backend.ts:64`, `schema/time-pipeline.ts:4`,
  `dispatch.ts:295`, `source/lawyer/plugin.json:86`, `check_publishable.py:27`,
  `marketplace.json:53-54`, `config-path.ts:70`, lawyer at 0.14.1, fork plugin at 0.1.0 and the
  vendored copy at 0.1.4.

## Files touched (when built)

- **Fork.**
  - `tokeneconomizer/loopguard/state.py`, `tokeneconomizer/loopguard/envelope.py`
  - `tokeneconomizer/plugin/config.py`, `tokeneconomizer/plugin/controller.py`
  - `tests/test_loopguard_state.py`, `tests/test_loopguard_envelope_io.py`,
    `tests/test_live_envelope_sync.py`
  - `docs/PLUGIN.md`
  - the version files (`pyproject.toml`, `package.json`, `plugin/package.json`, the three
    `plugin.json`)
- **probanda-dev.**
  - `source/lawyer/mcp/src/{tokeneconomizer/backend.ts,schema/tokeneconomizer.ts,schema-gen.ts,dispatch.ts}`
  - `source/lawyer/mcp/test/tokeneconomizer-envelope.db.test.mjs`
  - `source/tokeneconomizer/` (new), `source/assignment.json`
  - `scripts/build_plugin.py`
  - `.claude-plugin/marketplace.json`, `CLAUDE.md`
  - the spec
  - deleted by Brahm: `vendor/tokeneconomizer/`
