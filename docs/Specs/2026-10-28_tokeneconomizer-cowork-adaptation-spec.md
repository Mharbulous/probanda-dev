# TokenEconomizer (Cowork adaptation)

## Goal

The marketplace listing says: "The original Microsoft TokenEconomizer was optimized for Claude Code. This version has been adapted and optimized for Claude Cowork." This spec makes that true. Done means every red test below passes in a real Cowork session, and the fork's existing test suite still passes.

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

R5 and R6 need a second session. The other four run in the first.

## Facts to record

The red run records these, because the green stage's design depends on them.

- Python's version, `$HOME`, the user, the working folder and its mount, and the machine's boot id (the same boot id in both sessions means the same machine).
- Which of these places keep a marker into the second session: `S`, `$HOME`, `/tmp`, the working folder, and the plugin data folder (`~/.claude/plugins/data/` if it exists).
- Whether `claude` is on `PATH`, its version, and where the session's own transcripts are kept.
- The exact names of the session's shell, read, edit and write tools.
- Whether `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA` and `CLAUDECODE` are set in the shell.
- Whether the session saw any `SessionStart` hook text at its start.

## Red run results

Run by Brahm on 2026-10-28 in four probes, each a new Cowork session in the project `te-cowork-test` except probe 3, which ran in a matter project. Plugin 0.1.0.

| Id | Result | Evidence |
|---|---|---|
| R1 | PASS | `/root/.tokeneconomizer/bin/te` written and state files changed after tool calls |
| R2 | PASS | `doctor` and `status` exit 0, Python 3.13.18 ok, state root writable, no `errors.log` |
| R3 | PASS for `Bash`, `Read`, `Edit` and `Write` | `mcp__remote-devices__device_bash` was not tested and is not in `_TOOL_CANON` |
| R4 | PASS | `/opt/node22/bin/claude` 2.1.312 answered `OK`, at 8,067 effective tokens for that one call |
| R5 | FAIL | No marker survived to the next session in `/root/.tokeneconomizer`, `/root`, `/tmp`, `/home/claude`, `/root/.claude/plugins/data`, `/mnt/user-data` or `/mnt/attach/outputs` |
| R6 | FAIL | The second session reported "0 folded" |

Facts recorded:

- Each session runs in a new cloud container (`container_name` holds `remote_cowork`, a new boot id each time). `CLAUDE_CODE_REMOTE_SDK_URL` points at `api.anthropic.com/v1/code/sessions/cse_...`, and `CLAUDE_CODE_SKIP_PLUGIN_MCP_SERVERS=1` is set.
- The working folder is always `/home/claude`, not a git repository, so every Cowork session shares one state key. That matches Brahm's choice of one shared pattern for all Probanda projects.
- The linked folder is not visible from the cloud shell. It is visible only from `mcp__remote-devices__device_bash`, at `~/mnt/<folder name>`, as a Linux user named after the session.
- `/mnt/attach/outputs` is an rclone store named after the session, and it was empty in the next session.
- `CLAUDE_PLUGIN_ROOT` and `CLAUDE_PLUGIN_DATA` are not set in the shell. `CLAUDECODE=1` is.
- A `SessionStart` hook's text (Probanda's practitioner notes) reached the session at its start.
- The session's transcript is kept at `/root/.claude/projects/-home-claude/<id>.jsonl` and is lost with the container. The desktop app keeps no copy on the PC.
- A post-turn memory pass writes only under `/projects/<project id>/`. It is a per-project store run by a model for facts about the person.

Conclusion: TokenEconomizer runs in Cowork but cannot learn there, because nothing it writes outlasts the session. The loop guard needs learned turns before it acts, so in practice it does nothing.
