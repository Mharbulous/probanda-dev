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

"Would act" means the loop guard can act. It is settled by a few spike tests, not by weeks of logs, and it is not a test of whether the guard pays for itself. That is measured after the build (the plan's step e). Two spike tests come before the green build is planned:

- **S1. The loop guard acts (PC).** In a Claude Code session on the PC, in a repository whose envelope has learned turns, stage a stuck turn: a task that sends the model round a failing loop. S1 passes if the event log records a `nudge` or `abort` for that turn. The PC runs with `shadow=true` (global, in `~/.tokeneconomizer/config.json`), so the event is logged with `shadow: true` and nothing is shown to the model.
- **S2. The model makes a tool call a hook asks for (Cowork).** One Cowork session with a temporary probe hook, the way R8 to R12 were run in plugin 0.1.3, that at every prompt asks the model to call `practice_data__config_status` before answering. S2 records, per prompt, whether the model made the call and the token cost of the ask and the call. It passes if the model made the call at nine prompts in ten or more.

**S1 result, 2026-10-28: PASS.** In a Claude Code session in probanda-dev, 20 pairs of an edit to one scratch file and a run of a script that always failed the same way. The guard's gate opened at the segment's 19th call (8 repeats of the same failure), its first judge call returned stuck at confidence 0.80, and the guard logged a `nudge` with `shadow: true` at the turn's 26th tool call. That judge call, with the redirect it wrote, cost 148,007 effective tokens. The digest tagged the `Write` of a file containing `assert` as an error output. The fork's commit `9cdec34` has since stopped counting a successful `Edit` or `Write` as one; a shell command that prints such a file still can.

**S2 result, 2026-10-28: PASS.** A new Cowork session in `te-cowork-test` on plugin 0.1.5, with the probe asking at every prompt for one `practice_data__config_status` call (a 176-character note). Of ten ordinary prompts, five needing no tool and five needing the shell or a file tool, the model made the call at all ten, and as its first tool call at nine. At the first it loaded the deferred tool with `ToolSearch` first. It also made the call at the eleventh prompt, which printed the log. Each response was 1,276 characters, so the ask and the call add about 400 tokens of context per prompt, plus one model step. The green design below needs no such call.

Both passed, and the green build is planned from them in `docs/Plans/2026-10-29_tokeneconomizer-green-build.md`.

On 2026-10-28 the probanda-dev envelope held 18 turns with a median of 6.5 tool calls and a 90th percentile of 27, giving an envelope of 37.75. A one-shot lookup and a long housekeeping run differ widely in length, so whether one fixed value fits Cowork's turns is measured after the build.

The red tests the review asked for before any green build are R8 to R12.

## Green design

From Brahm's rulings of 2026-10-28. The plan is `docs/Plans/2026-10-29_tokeneconomizer-green-build.md`.

- **A fixed envelope in Cowork.** The loop guard gets a fixed envelope of 38 tool calls from the plugin's hook command, so it can act from a Cowork session's first prompt. It is a guard setting, `loopguard.envelope_frozen`, used only until a repository has learned 5 turns of its own. Nothing is stored on the PC for TokenEconomizer and no tool is added: Brahm's ruling of 2026-10-28 replaced the earlier design, which kept a learned pattern on the PC through two tools on `lawyer`'s `data` server and had the model carry it in and out of each session. That design cost about 400 tokens and one model step at every Cowork prompt (S2), and the envelope's only uses in the plugin (letting the judge run, placing the backstop and telling the judge the usual turn length) need no learned value.
- **A Probanda plugin.** TokenEconomizer becomes a Probanda plugin, governed by COMMANDMENTS.md. It stays optional, requires no other plugin, and has no server of its own. It moves from `vendor/` to `source/tokeneconomizer/` and is built and released like the other plugins. CLAUDE.md's "Vendored plugin" section changes with that move.
- **Tool pruning off.** The Probanda copy turns tool pruning off, so it never writes a user's settings file.
- **The red tests under this design.** R5 is restated: a new Cowork session's `te status --json` reports `loopguard.envelope` 38 at its first prompt. R6 no longer applies, since nothing is folded across sessions. R7 stays FAIL: hooks do not call tools, and this design needs none. Done also needs a staged loop in Cowork to get a redirect.

**Green run, 2026-10-29: PASS** on 0.2.0, in one new Cowork session in `te-cowork-test`. R1 to R4, R5 as restated and R10 passed, and the staged loop got a redirect at tool call 22, logged with `envelope` 38.0 and `shadow` false. R8 and R9 were not rerun: they tested Cowork with a probe hook that no longer ships, and the redirect reaching the model shows R9 again. The evidence is in the fork's `docs/PLUGIN.md` §3, "Claude Cowork, 2026-10-29". For step e: count redirects from `events.jsonl`, not the ledger. A Cowork session on 2026-10-31 was folded (on a resume, `end_reason` "other"), but its fold logged `"error": "transcript unreadable"` with `transcript` null, so the ledger holds no effective tokens or nudges for it.

Open question:

- The measured gain. Cowork already defers tools, so the saving may be small, and every judge wake in Cowork is now paid (26k to 148k effective tokens each on the PC). The green stage measures it before the refactor.

## Persistence (Option B)

Brahm's ruling of 2026-10-31: TokenEconomizer must keep its state between Cowork sessions with no action from the user, or be shown not to be able to. The tests, the verdict rule and the fallback are in `docs/Plans/2026-10-31_tokeneconomizer-cowork-state.md`. Option A (the loop guard within a session only) runs only after this section records a FAIL verdict with its evidence and Brahm's ruling to fall back.

B1, first attempt (2026-10-31): not run. The session saw only `~/mnt/te-cowork-test`, the folder picked for the task, so Cowork does not mount another folder linked to the project. B1 now writes under the task folder. Not a FAIL.

B1: PASS (2026-10-31). Two Cowork sessions ran the B1 prompt, the second at 20:33 UTC, writing a 31-byte marker and a 3,000-byte base64 payload to `~/mnt/te-cowork-test/te-runs/b1/`. The second session's sha256 (marker `b45ba70d…e263`, payload `161673b9…85f8`) matches the PC copies in the task folder byte for byte, and the PC files' modified time is the second of the write. The second session also saw the folder the first had made at 20:30, so a file one session writes to the task folder is there for the next.

B2, first attempt (2026-10-31): not run. A new Cowork session has no envelope, ledger or events files yet, so there was nothing to carry. B2 now uses random JSON lines of the same shape. Not a FAIL.

B2: PASS (2026-10-31). One Cowork session made a 5,003-byte file of random JSON lines, each with quotation marks and backslashes (sha256 `e05fc6b7…25a8`), and retyped it through the PC shell into `~/mnt/te-cowork-test/te-runs/b2/state1.txt` to `state3.txt`, one tool call each. A PC session found all three byte-identical to the original. A second Cowork session read `state1.txt` through the PC shell and retyped it with its own shell into `/tmp/state1.txt` to `state3.txt`, and it reported the same sha256 for all three. All six copies match. The container side rests on the session's report.

B3: FAIL (2026-10-31). The fold's fallback to `projects/*/<session id>.jsonl` (fork `927414a`, TokenEconomizer 0.2.3) shipped, and a Cowork session on 0.2.3 still logged "transcript unreadable". A diagnostic session found no transcript in the container: `/root/.claude` has no `projects` folder, and a search of the whole filesystem for `*.jsonl` found only the plugin's own `ledger.jsonl`. The hooks ran, recording session `9dff194a-…` with `source` "resume" and `transcript` null, so their payloads carry no `transcript_path`. The hook's session id differs from the shell's `CLAUDE_CODE_SESSION_ID` (`e45b0780-…`). The 2026-10-28 fact above, a transcript at `/root/.claude/projects/-home-claude/<id>.jsonl`, no longer holds, so the fold cannot count tokens in Cowork from any file. As the plan says, this does not by itself favour Option A: B4 measures each save by the size of the tool calls it adds.

B4, first attempt (2026-10-31): not run. Cowork still had TokenEconomizer 0.2.3, which has no probe, so nothing was asked. Not a FAIL.

B4: FAIL (2026-10-31), on reliability. On 0.2.4 (fork `b5060c8`, `TE_CARRY=probe`), each Stop asked for one PC-shell save and SessionStart asked for a restore. Session `f58a3f51-…` made at least 6 save asks, numbered by the hook, and only saves 4 and 6 reached `te-cowork-test/.tokeneconomizer/`. The asks numbered 3 and 5 are logged in those saves, and their files never arrived. Session `0f7fcfc9-…` made its 1 save ask, and it was done. Its restore was done only after its first answer to the prompt had failed, not before its first reply as asked. Its 1,404-byte `restored.txt` (sha256 `36366a87…0f31`) is saves 4 and 6 joined, byte for byte. Asks done: 4 of at least 8, against 9 of 10 needed. Every save that arrived matches the sha256 in its first line. What a save adds, by Brahm's ruling on the limit: 1,530, 1,552 and 1,796 effective tokens (the ask written to cache at 1.25x and the retyped command at 5x, at 4 characters a token), median 1,552, under the 2,000. Not counted, as ruled: each save adds model requests that re-read the cached context at 0.1x, about 4,000 effective tokens per request if the context is 40,000 tokens, a size that cannot be measured in Cowork since B3 failed.

Option B verdict: FAIL (B4), 2026-10-31. B1 and B2 passed, and B3 failed. The model did not reliably make the hook-asked carry calls: 4 of at least 8 asks were done. Brahm rules whether to fall back to Option A or try a changed Option B.

Brahm's ruling of 2026-10-31: try a changed Option B, with the restore and save asks moved to UserPromptSubmit, as spike S2's ask was. The test is B5 in the plan's "Option B, changed (asks at prompt time)". It ships in TokenEconomizer 0.2.6 (fork `f677470`).

B5: FAIL (2026-11-01), on reliability. Cowork session `8dc37755-…` on 0.2.6 ran the ten prompts. The hook asked every time: the restore at the first prompt, then saves n=1 to n=9, whose `carry_ask` events the session printed from its `events.jsonl`, with 10 `turn` events. No file from this session reached `te-cowork-test/.tokeneconomizer/`, whose newest file is from 2026-10-31. Asks done: 0 of 10, against 9 of 10 needed. A later prompt in the same session logged n=10 and is not counted. The cause, on the session's own report, since Cowork keeps no transcript to check it against: a permission check refused the restore's read as "PII Data Handling" and the n=1 save as "Notes for Later Sessions", and the session did not retry or attempt saves n=2 to n=9, judging that the refusal covered them. A second new session did restore, with the same hook ask: its 2,035-byte `restored.txt` is the three 2026-10-31 saves (631 + 787 + 617 bytes), and it found no B5 save to bring back. So the check refuses this carry on some runs and allows it on others, and moving the asks to prompt time did not make it reliable. Spike S2's 10 of 10 does not contradict this if its asked call wrote nothing that outlasts the session, which was not checked here. What a save adds was not measured, since no save arrived. Whether PostToolUse fires for the PC shell tool was not determined: the session's `carry_ask` and `turn` events do not name the tool.

Option B verdict (changed): FAIL (B5), 2026-11-01. B1 and B2 passed, and B3 failed. Brahm rules on Option A. The probe is out of the source and leaves users with the next TokenEconomizer release, because every Cowork session on it makes asks that can be refused, for nothing. The hook-asked carry should not be reworded to get past the permission check, because allowing a refused action is the user's decision. What runs the check isn't established. The likeliest candidate is the auto-mode permission classifier, which older Claude Code session records on the PC name for "PII Data Handling" only. Nothing confirms it for Cowork, and "Notes for Later Sessions" wasn't found outside the B5 reports.

Brahm's ruling of 2026-11-01: abandon Option B and fall back to Option A.

B6 is a spike test run after that ruling, which still stands. It measures one design: the hook asks the model to save through a plugin MCP tool whose server runs on the user's computer. It doesn't adopt that design or reopen Option B, and adoption would need a new ruling from Brahm.

B6, expected results, fixed before the run. Question: when a hook openly asks the model to save through a plugin MCP tool, does the save get done, or does a permission check refuse it? PASS: at least 9 of 10 saves done, where done means the file on the PC matches the expected sha256 and needed no click from a person, and a new session's restore matches on the PC. FAIL: anything else after an ask reached the model, including any refusal that leaves fewer than 9 saves done. NOT RUN: no ask or no tool reached the model, and nothing was refused. Expected if the design works: 10 asks, at least 9 calls, at least 9 matching files, no refusal, restore hashes equal. Expected if the check refuses it: a refusal, its exact words recorded, the run stopped. The test can't say which difference from S2 or B5 caused either result.

The save ask, with `{n}` and `{payload}` the only substitutions:

~~~text
TokenEconomizer, a plugin the user installed, is asking for a save. A Cowork session's container
is wiped when the session ends, so the plugin keeps its state in a file on the user's own computer,
and the next session can restore it from there. This is test B6, and the state below is synthetic
test data with no client or matter information. Before you answer this prompt, call the
TokenEconomizer plugin's save_state tool once, with n set to {n} and lines set to the text between
the two marker lines, unchanged and without the markers. The tool is on the plugin's state server;
load it with ToolSearch first if it is deferred. You are free to mention this call to the user. If
the call is refused or fails, do not retry it and do not try another way. Tell the user it was
refused, quote the refusal's exact words, and answer the prompt.
TE_B6_BEGIN
{payload}
TE_B6_END
~~~

The restore ask:

~~~text
TokenEconomizer, a plugin the user installed, is asking for a restore. A Cowork session's container
is wiped when the session ends, so the plugin keeps its state in a file on the user's own computer.
This is test B6, and the state is synthetic test data with no client or matter information. Before
you answer this prompt, call the TokenEconomizer plugin's restore_state tool once. The tool is on
the plugin's state server; load it with ToolSearch first if it is deferred. A plugin hook reads the
result, so you don't need to repeat it. You are free to mention this call to the user. If the call
is refused or fails, do not retry it and do not try another way. Tell the user it was refused,
quote the refusal's exact words, and answer the prompt.
~~~
