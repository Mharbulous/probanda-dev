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

- **Cowork's shell tool has another name.** Probanda's own hooks match Cowork's shell as `mcp__workspace__bash` or `mcp__cowork__workspace__bash` (`.claude/skills/drafting-data/hooks/html-pages-gate.py`). The loop guard maps tool names through `_TOOL_CANON` in `tokeneconomizer/loopguard/state.py`, which knows `Bash` but not those names. An unknown name passes through unchanged, so the loop guard does not read the command text of a Cowork shell call and cannot spot a failing command run again and again. Red test R3 checks this.
- **Hooks run in Cowork's Linux machine.** Phase 0 found plugins at `/root/.claude/plugins/synced/<account>_<user>/<plugin>`, with `${CLAUDE_PLUGIN_ROOT}` set. TokenEconomizer's state root is `$TOKENECONOMIZER_HOME`, else `~/.tokeneconomizer`, which there is `/root/.tokeneconomizer`. Whether that folder survives to the next session is unknown. Red test R5 checks it.
- **The loop guard needs history.** It does nothing in a folder until it has learned enough resolved turns there (`envelope_min_samples` in `tokeneconomizer/loopguard/envelope.py`). If state does not survive between sessions, the loop guard never acts in Cowork.
- **Model calls go through `claude -p`** (`tokeneconomizer/plugin/sidecall.py`). The loop guard's judge and redirect need it. Whether a `claude` command exists in Cowork's Linux machine is unknown. Red test R4 checks it.
- **`SessionStart` output arrived late in Cowork.** In Phase 0 (2026-10-13) a hook's output reached the session only after an agent was dispatched, and in one run never. Micro-skills are injected at `SessionStart`, so they may not reach the session when they are needed. This is recorded as a fact, not a red test, because a fresh folder has no micro-skills to inject.
- **The slash commands name "the Bash tool"** (`slash-commands/*.md`). Cowork has no tool by that name.
- **Tool pruning writes `.claude/settings.local.json`** in the session's folder and builds its deny list from Claude Code's tool catalog. In Cowork that folder is the person's own folder, and whether Cowork reads that settings file is unknown. The green stage decides whether tool pruning is adapted or turned off in Cowork. It has no red test yet, because it acts only after several sessions.

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

Not run yet.
