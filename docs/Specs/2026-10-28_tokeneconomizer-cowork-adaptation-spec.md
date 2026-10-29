# TokenEconomizer (Cowork adaptation)

## Goal

The marketplace listing says: "The original Microsoft TokenEconomizer was optimized for Claude Code. This version is being adapted for Claude Cowork." This spec makes it adapted and optimized for Cowork, and the listing says so once the work is green. Done means every red test below passes in a real Cowork session, and the fork's existing test suite still passes.

The work happens in the fork, `Mharbulous/TokenEconomizer`. The result is vendored into this repository by the steps in CLAUDE.md, "Vendored plugin".

## Method

Test-driven, in three stages.

1. **Red.** Run the red tests in Cowork against the plugin as vendored at fork commit `a45bf5a9`. Each test that fails confirms a gap. A test that already passes needs no work and is kept as a guard against regression. The run also records the facts listed under "Facts to record", which the design of the green stage depends on.
2. **Green.** In the fork, add a pytest test for each failing red test that can run outside Cowork, change the code until those tests and the existing suite pass, re-vendor, and run the red tests in Cowork again until all pass.
3. **Refactor.** Simplify what the green stage added, with both test sets as the safety net.

## What the code already shows

These come from reading the fork's source and from this repository's own Cowork findings (`docs/Plans/2026-10-13_four-plugin-split.md`, Phase 0).

- **Cowork has two shell tools.** The loop guard maps tool names through `_TOOL_CANON` in `tokeneconomizer/loopguard/state.py`. It knows `Bash`, Cowork's cloud shell, but not `mcp__remote-devices__device_bash`, the shell on the person's computer. An unknown name passes through unchanged, so the loop guard does not read the command text of that shell's calls.
- **Hooks run on a cloud machine.** TokenEconomizer's state root is `$TOKENECONOMIZER_HOME`, else `~/.tokeneconomizer`, which there is `/root/.tokeneconomizer`. Red test R5 checks whether it survives to the next session.
- **The loop guard needs history.** It does nothing in a folder until it has learned enough resolved turns there (`envelope_min_samples` in `tokeneconomizer/loopguard/envelope.py`). If state does not survive between sessions, the loop guard never acts in Cowork.
- **Model calls go through `claude -p`** (`tokeneconomizer/plugin/sidecall.py`). The loop guard's judge and redirect need it. Whether a `claude` command exists in Cowork's Linux machine is unknown. Red test R4 checks it.
- **Tool pruning writes `.claude/settings.local.json`** in the session's working folder and builds its deny list from Claude Code's tool catalog. In Cowork that folder is `/home/claude` on the cloud machine, which is lost with the session. The green stage decides whether tool pruning is adapted or turned off in Cowork.

## Red tests

Each test runs inside a Cowork session that has the plugin installed and an empty test folder open. `P` is the plugin's folder and `S` is the state root.

| Id | Claim | Passes when |
|---|---|---|
| R1 | The hooks run in Cowork | `S/bin/te` exists, is executable and runs `P/scripts/te`, and files under `S` change after the session makes tool calls |
| R2 | The command line runs in Cowork | `P/scripts/te --cwd <folder> doctor` and `status` both exit 0, `doctor` reports Python ok and the state root writable, and `S/errors.log` has no entry from this session |
| R3 | The loop guard recognises Cowork's tools | `canon_tool` maps this session's shell tool to `bash`, its read tool to `view`, its edit tool to `edit` and its write tool to `create` |
| R4 | The loop guard can make its model calls | A side call (`sidecall.claude_call`) asked to reply `OK` returns `OK` |
| R5 | What was learned survives to the next session | A second Cowork session on the same folder finds the marker that the first session wrote in `S` |
| R6 | A finished session is folded | `te status` in the second session counts the first session |
| R7 | A hook can call a tool on `lawyer`'s `data` server | A `UserPromptSubmit` hook of type `mcp_tool` calling `practice_data__config_status` puts that tool's output into the session |
| R8 | `PostToolUse` fires for a tool on the PC | The hook's input for `mcp__remote-devices__plugin_lawyer_data__practice_data__config_status` carries the tool's response |
| R9 | A redirect reaches the Cowork model | A `PostToolUse` hook's `additionalContext` reaches the model, and its `systemMessage` reaches the person |
| R10 | The loop guard reads the PC shell's commands | `canon_tool` maps `mcp__remote-devices__device_bash` to `bash`, and its `command` input reaches the action log (fork test `tests/test_loopguard_state.py`) |
| R11 | The hook's cost per session is known | Hook time per tool call, judge calls per session, and the credentials `claude -p` in the container uses are recorded |
| R12 | `SessionEnd` fires and its fold finishes | A `SessionEnd` hook's marker, and the fold's log, can be read after the session ends |

R5 and R6 need a second session. The others run in the first. R8, R9, R11 and R12 ran with a temporary probe hook in plugin 0.1.3.

## Facts to record

The red run records these, because the green stage's design depends on them.

- Python's version, `$HOME`, the user, the working folder and its mount, and the machine's boot id (the same boot id in both sessions means the same machine).
- Which of these places keep a marker into the second session: `S`, `$HOME`, `/tmp`, the working folder, and the plugin data folder (`~/.claude/plugins/data/` if it exists).
- Whether `claude` is on `PATH`, its version, and where the session's own transcripts are kept.
- The exact names of the session's shell, read, edit and write tools.
- Whether `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA` and `CLAUDECODE` are set in the shell.
- Whether the session saw any `SessionStart` hook text at its start.

## Red run results

Run by Brahm on 2026-10-28 in six probes, each a new Cowork session in the project `te-cowork-test` except probe 3, which ran in a matter project. Plugin 0.1.0, except R7 on 0.1.1 and R8 to R12 on 0.1.3.

| Id | Result | Evidence |
|---|---|---|
| R1 | PASS | `/root/.tokeneconomizer/bin/te` written and state files changed after tool calls |
| R2 | PASS | `doctor` and `status` exit 0, Python 3.13.18 ok, state root writable, no `errors.log` |
| R3 | PARTIAL | `Bash`, `Read`, `Edit` and `Write` map correctly. Cowork's second shell, `mcp__remote-devices__device_bash`, is not in `_TOOL_CANON`, so the loop guard cannot read its commands |
| R4 | PASS | `/opt/node22/bin/claude` 2.1.312 answered `OK`, at 8,067 effective tokens for that one call |
| R5 | FAIL | No marker survived to the next session in `/root/.tokeneconomizer`, `/root`, `/tmp`, `/home/claude`, `/root/.claude/plugins/data`, `/mnt/user-data` or `/mnt/attach/outputs` |
| R6 | FAIL | The second session reported "0 folded" |
| R7 | FAIL | Plugin 0.1.1 carried two such hooks, one with server `plugin:lawyer:data` and one with server `remote-devices` and tool `plugin_lawyer_data__practice_data__config_status`. Neither put any output into the session, and neither reported an error. Removed in 0.1.2 |
| R8 | PASS | The hook's input for the PC's `config_status` held the response (1,276 characters). It fired for the PC shell too |
| R9 | PASS | The `additionalContext` line reached the model, as context added after the call. Whether the `systemMessage` showed on screen was not checked, and need not be: on Claude the plugin also sends each notice as `additionalContext` for the model to relay (`relays_notices`, `plugin/hosts.py`) |
| R10 | FAIL | Cowork sends the PC shell as `mcp__remote-devices__device_bash` with input key `command`. The fork test fails as expected, marked `xfail` until the green build (fork commit `bc804bd`) |
| R11 | RECORDED | A hook call took 0.082 to 0.089 s (five runs). No judge calls and 0.0 judge tokens, because no envelope exists. No `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` is set. `ANTHROPIC_BASE_URL` and `CLAUDE_SESSION_INGRESS_TOKEN_FILE` are, so `claude -p` appears to bill through the session's own account (inferred, not verified) |
| R12 | NOT OBSERVABLE | `/clear` does not work in Cowork, and a session ends only when its container does, which leaves nothing to read (R5). The green design does not depend on `SessionEnd` |

Facts recorded:

- Each session runs in a new cloud container (`container_name` holds `remote_cowork`, a new boot id each time). `CLAUDE_CODE_REMOTE_SDK_URL` points at `api.anthropic.com/v1/code/sessions/cse_...`, and `CLAUDE_CODE_SKIP_PLUGIN_MCP_SERVERS=1` is set.
- The working folder is always `/home/claude`, not a git repository, so every Cowork session shares one state key. That matches Brahm's choice of one shared pattern for all Probanda projects.
- The linked folder is not visible from the cloud shell. It is visible only from `mcp__remote-devices__device_bash`, at `~/mnt/<folder name>`, as a Linux user named after the session.
- `/mnt/attach/outputs` is an rclone store named after the session, and it was empty in the next session.
- `CLAUDE_PLUGIN_ROOT` and `CLAUDE_PLUGIN_DATA` are not set in the shell. `CLAUDECODE=1` is.
- A `SessionStart` hook's text (Probanda's practitioner notes) was in the session's context when it answered the first prompt. Phase 0 (2026-10-13) saw such text arrive only after an agent was dispatched, so Cowork's behaviour has changed or the two probes saw different things.
- The session's transcript is kept at `/root/.claude/projects/-home-claude/<id>.jsonl` and is lost with the container. No copy was found on the PC: the files under `%APPDATA%\Claude` that changed during the probes hold no `.jsonl` transcript, and the `claude-code-sessions\...\local_*.json` files changed that day name none of the probe sessions. `vm_bundles\claudevm.bundle\sessiondata.vhdx` was not opened.
- A post-turn memory pass writes only under `/projects/<project id>/`. It is a per-project store run by a model for facts about the person.

Conclusion: TokenEconomizer runs in Cowork but cannot learn there, because nothing it writes outlasts the session. The loop guard needs learned turns before it acts, so in practice it does nothing. A hook cannot reach the PC itself: only the model's tool calls can.

## Spike tests first

Brahm's ruling of 2026-10-28, after an independent review: nothing in the green design is built until a measurement shows the loop guard would act. The red run showed the plugin runs in Cowork, not that the loop guard ever acts, and the fork's `docs/PLUGIN.md` §5 says the loop guard has never fired on a real stuck turn.

"Would act" means the loop guard can act. It is settled by a few spike tests, not by weeks of logs, and it is not a test of whether the guard pays for itself. That is measured after the build (the plan's step g). Two spike tests come before the green build is planned:

- **S1. The loop guard acts (PC).** In a Claude Code session on the PC, in a repository whose envelope has learned turns, stage a stuck turn: a task that sends the model round a failing loop. S1 passes if the event log records a `nudge` or `abort` for that turn. The PC runs with `shadow=true` (global, in `~/.tokeneconomizer/config.json`), so the event is logged with `shadow: true` and nothing is shown to the model.
- **S2. The model makes a tool call a hook asks for (Cowork).** One Cowork session with a temporary probe hook, the way R8 to R12 were run in plugin 0.1.3, that at every prompt asks the model to call `practice_data__config_status` before answering. S2 records, per prompt, whether the model made the call and the token cost of the ask and the call. It passes if the model made the call at nine prompts in ten or more.

The green build is then planned from their results.

One point for planning: the loop guard learns one envelope for all sessions, and a one-shot lookup and a long housekeeping run differ widely in length. On 2026-10-28 the probanda-dev envelope held 18 turns with a median of 6.5 tool calls and a 90th percentile of 27.

The red tests the review asked for before any green build are R8 to R12.

## Green design

From Brahm's rulings of 2026-10-28. On hold until the spike tests in "Spike tests first" have run and the green build is planned from them.

- **One pattern.** TokenEconomizer keeps one learned pattern for all Probanda projects, not one per folder.
- **A Probanda plugin.** TokenEconomizer becomes a Probanda plugin, governed by COMMANDMENTS.md. It stays optional and separate from `lawyer`, and has no server of its own. It moves from `vendor/` to `source/tokeneconomizer/` and is built and released like the other plugins. CLAUDE.md's "Vendored plugin" section changes with that move.
- **Storage on the PC.** The pattern is stored through `lawyer`'s `data` server, in SQLite under the Probanda app data folder, by two tools: one reads the pattern and one saves it. First check whether the `time_pipeline` key-value tools can take a `tokeneconomizer` namespace instead of new tools. The store obeys Commandments 3 and 5.
- **The model carries the pattern, because R7 failed.** At the first prompt, the hook tells the model to call the read tool. The `PostToolUse` hook receives that tool's response in its input (R8) and writes the pattern to the local state root, where the loop guard reads it. At each later prompt, the hook's `additionalContext` (R9) asks the model to call the save tool with only the turns resolved since the last save. Each session's last turn is lost, which is accepted, because nothing runs after it (R12) and a `Stop` block would cost the model an extra step on every turn. This is the route Probanda's own hooks already use, for example `lawyer`'s note that tells the model to call `practice_data__config_status`.

Open questions:

- The token cost of the save at `Stop`, since the model writes the whole pattern out as the tool's input. A small pattern keeps it cheap. If it is not small, save only what changed.
- Whether tool pruning can take effect in Cowork. It writes `.claude/settings.local.json` during a session on a fresh machine, which may be too late to change that session's tools.
- The measured gain. Cowork already defers tools, so the saving may be small. The green stage measures it before the refactor.
