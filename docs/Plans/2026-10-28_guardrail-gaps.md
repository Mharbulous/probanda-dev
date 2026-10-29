# Close three gaps in the untrusted-content and one-way-approval guardrails

## Context

`docs/Plans/2026-10-28_untrusted-content-and-approvals.md` shipped the one-way approval gate and the untrusted-content labels, and left three known gaps:

1. Raw SQL `*_execute` tools can record a gated act without approval.
2. `troubleshoot__record` writes to a cloud store with no delete, from a subagent the gate cannot see.
3. Grep output from client files carries no `<client_file>` label.

Each gap below is its own commit and its own `/release`. The order is gap 3, then 1, then 2 (smallest blast radius first). Every step ends with `python scripts/build_plugin.py --check`, `python scripts/check_plugin.py`, `python scripts/check_layering.py` and `python scripts/check_publishable.py --new-since origin/main`, plus the test files that step changes, run by path.

Findings that correct the brief:
- `record_filed`'s description (`source/lawyer/mcp/src/schema/submission-data.ts:261-262`) says *clearing* a `filed_on` is an ordinary update. *Setting* one is the gated act.
- No agent can call any execute tool. Every caller is a main-session skill. So the bypass is a main-session model writing raw SQL, not a subagent.
- `sent_on` and `served_on` don't exist on `filings`. All three record tools set `filings.filed_on`, and sent and served also set `filings.sent_copy_id`.

---

## Gap 1. Raw SQL can set `filed_on` (lawyer, patch)

### Which statements count as one-way

I classified by state, not by parsing the SQL:

- **Drafting database.** The gated act is `filings.filed_on` or `filings.sent_copy_id` becoming a non-NULL value it did not hold before. That covers an UPDATE from NULL, an UPDATE from one date to another, and an INSERT of a filings row that already carries a date. Each one fires the send triggers (`snapshot_clause_wording_on_send`, `snapshot_recipients_on_send`, `guard_filings_parties_snapshot` in `drafting-data/references/schema.sql`) and freezes the Writing. Clearing back to NULL stays allowed. That is the documented undo (`filing-checklists.md:369`, `work/references/opening-routes.md:26`), and the gated tools treat it the same way.
- **Matter database.** Nothing here mirrors a gated act. Anchors and contacts live in the practice store, so `delete_anchor` and `merge_contact` cannot be faked through `matter_data__execute`. No change.
- **Timecamping database.** `proposals.written_back` mirrors `timecamp__update_entry`, but setting it by SQL changes nothing in TimeCamp and can be reversed. No change.

### Change

In `do_execute` (`source/lawyer/mcp/src/submission/backend.ts:81-90`), inside `mutate`:
1. Read `id, filed_on, sent_copy_id` from `filings` before the script runs.
2. Run the script.
3. Read the same columns again.
4. If any row's `filed_on` or `sent_copy_id` is now non-NULL and differs from its value before (new rows included), raise. The message: `filed_on and sent_copy_id are set only by drafting_data__record_sent, record_filed or record_served; clearing filed_on stays an update`.

Raising inside `mutate` means `staged_write` never promotes the staged copy, so a script that runs its own `COMMIT` still has no effect. The implementer confirms this in `stagedStorePython` before relying on it. If it does not hold, an authorizer that denies `SQLITE_TRANSACTION` during the script is the fallback.

The rule also goes into the execute tool's description (`submission-data.ts:42-59`). That description lists `record_sent` and `record_filed` as the only ways to set those columns and leaves out `record_served`, so `record_served` is added.

The record tools write through `submissionDataWriteAll`, not `do_execute`, so they are unaffected.

Before building, grep `source/lawyer/mcp/test/**` and `.claude/skills/*/tests/**` for execute scripts that set `filed_on` or `sent_copy_id` (for example `test/fixtures/forms-render-seeds.mjs`). Each such seed moves to a direct sqlite seed or to `record_filed`.

### What it costs callers

No documented skill script sets either column through execute. `filing-checklists.md:366` already says "`filed_on` is set through a tool, never by an update". So no skill prose changes.

### Touches

- `source/lawyer/mcp/src/submission/backend.ts`
- `source/lawyer/mcp/src/schema/submission-data.ts`
- the rebuilt `source/lawyer/mcp/dist/litigation-mcp.js`
- `plugins/lawyer/`. If `build --check` shows that file-manager's `files` bundle changed too, file-manager also takes a patch.

### Version

lawyer patch. Inputs are unchanged, nothing documented breaks, and old and new copies share the data safely.

### Test (fails today)

New file `source/lawyer/mcp/test/execute-filed-on.db.test.mjs`:
- Each of these is refused through `drafting_data__execute`, and the row is unchanged afterwards:
  - `UPDATE filings SET filed_on='2026-10-01'`
  - an UPDATE from one date to another
  - an INSERT of a filings row that carries `filed_on`
  - a script that sets `sent_copy_id`
  - a script holding its own `COMMIT;` before the UPDATE
- `SET filed_on = NULL` passes.
- An ordinary UPDATE of `decided_on` passes.

---

## Gap 2. `troubleshoot__record` is ungated (researcher, patch; all seven patch because `shared/` changes)

### Change

Move the cloud write out of the subagent and into the main session, behind the existing gate.

- **`source/researcher/agents/troubleshooter.md`:**
  - Record mode becomes "screen" (`prepare` is a litigator skill name, which the layering check reads as an upward reference). It still runs `configure_status`, screens the text, and searches for a duplicate.
  - It returns either `{action: "record", entry: {symptom, tools, error_strings, cause, fix, source_url}}` or `{action: "confirm", entry_id}`. It writes nothing.
  - Its `tools:` list drops `troubleshoot__record` and `troubleshoot__confirm_fix` (both prefixes).
  - The rewrite-once-on-refusal rule moves to the skill.
- **`.claude/skills/probanda-troubleshooting/SKILL.md` step 5:**
  - For `confirm`, the main session calls `confirm_fix`. It stays ungated, because it only adds one to a counter and carries no text.
  - For `record`, the main session calls `troubleshoot__record` with the returned entry. When the gate refuses, the model shows the six fields exactly as the call carries them, then the warning and the block.
  - Pasting `Modifications: NONE` binds the approval to that exact text through the call's hash. That is a human check on top of `redact.ts`, made on the very text that will leave the machine.
  - On a `record refused` screen hit, the skill has the troubleshooter rewrite once. Then the main session shows the new entry and asks again.
- **New `source/researcher/hooks/one-way-gate.py`:** a copy of `source/lawyer/hooks/one-way-gate.py`.
  - It gets an entry in `source/assignment.json` under researcher hooks.
  - Its matcher in `source/researcher/plugin.json` is `mcp__.+troubleshoot__record$`.
- **`.claude/skills/shared/tests/test_approval_gate.py`:**
  - `HOOKS` adds the researcher hook.
  - `GATED` adds researcher → `troubleshoot__record`.
  - `UNGATED` drops it and adds `troubleshoot__confirm_fix`.

### Commandments

- **C3:** the entry must hold no Client Information. The screen, the troubleshooter's scrubbing and now the practitioner's own read all guard this. The main session holds client context, so the entry passed to the call is the troubleshooter's returned entry, unchanged unless the practitioner writes modifications.
- **C2:** an entry is generic tooling knowledge, which is Shared Information, not Account Information.
- **C4:** no Trade Secret is involved.

### Layering

researcher names only lawyer. The gate module comes from `shared/`, so no upward reference is added.

### Version

researcher patch: tool inputs are unchanged, and the approval is a step inside the flow, not a setup step. The `shared/tests` edit rebuilds all seven plugins, so the other six take a patch too.

### Tests (fail today)

- `test_approval_gate.py`: the matcher test fails until the researcher hook and matcher exist. Add one case: a `troubleshoot__record` call is refused, then passes after the block is pasted.
- New `source/researcher/tests/test_troubleshooter_contract.py`: `troubleshooter.md` frontmatter grants neither `troubleshoot__record` nor `confirm_fix`.

---

## Gap 3. Grep output from client files is unlabelled (lawyer, patch)

### 3.0 Probe (not shipped)

This mirrors Step 0. Build a probe plugin in the scratchpad whose PostToolUse hook on `Grep|Glob` dumps stdin to a file. Run `claude -p --plugin-dir <probe> --model haiku --allowedTools Grep,Glob` against a temporary case-data root, once for each Grep `output_mode` (`content`, `files_with_matches`, `count`) and once for Glob. Record:
- each `tool_response` shape;
- whether `filenames` is filled in `content` mode;
- whether paths are absolute or relative to the cwd.

Results (2026-10-28, `tool_response` of each, paths absolute because the search path was):

- Grep `content`: `{mode:"content", numFiles:0, filenames:[], content:"<path>:<line>:<text>\n…", numLines, totalLines}`. `filenames` is empty, so the hook decides from the search path, not from the matches.
- Grep `files_with_matches`: `{mode, filenames:[…], numFiles, totalFiles}`.
- Grep `count`: `{mode:"count", numFiles, filenames:[], content:"<path>:<n>\n…", numMatches}`.
- Glob: `{filenames:[…], durationMs, numFiles, truncated, totalMatches, countIsComplete}`.
- The payload's `cwd` is the session's working directory, and a relative `path` resolves against it.

The shapes go inline in the unit tests, as for Read. The e2e test confirmed that Claude Code applies a content-mode `updatedToolOutput` for Grep.

### Change

Extend `source/lawyer/hooks/client-file-label.py`, keeping the same root lookup through `hook_io.config_path()`. The matcher in `source/lawyer/plugin.json` becomes `Read|Grep`.

For Grep in `content` mode: if the search path (resolved against `cwd`) lies under the case-data root or contains it, return `updatedToolOutput` in the probed shape with only the content string changed. The content is wrapped in `<client_file source="client files: grep matches">…</client_file>`, with every `</client_file` escaped as for Read. A search from above the root may also label non-client lines, which is harmless.

Other modes and Glob are covered by decision D3.

### Touches

`client-file-label.py`, `source/lawyer/plugin.json` and both tests.

### Version

lawyer patch.

### Tests (fail today)

- `source/lawyer/tests/test_client_file_label.py`:
  - a probed content-mode fixture with hostile text is wrapped and escaped;
  - matches outside the root are untouched;
  - the matcher test changes from exactly `["Read"]` to `Read|Grep`.
- `test_client_file_label_e2e.py` adds a Grep content-mode run. It asserts that the label reaches the model-visible `tool_result`. This catches a wrong shape, because Claude Code silently ignores `updatedToolOutput` when the shape is wrong. It runs locally, since CI has no CLI auth.

---

## Decisions for Brahm (recommendations apply if the plan is approved unchanged)

**D1. How to close the raw-SQL bypass.**
- (a) **Recommended:** the server refuses any execute script that sets `filed_on` or `sent_copy_id`. It is exact, cannot be bypassed by SQL tricks, and costs no caller anything.
- (b) Gate every `drafting_data__execute` call behind the paste. Every substance write would need an approval.
- (c) Parse the SQL in a hook, like practitioner-words-gate. It can be bypassed through triggers, CTEs or quoting.
- (d) Do nothing.

**D1b. `documents.served_on`** records service of a notice to admit. It has no dedicated tool and is written by execute.
- (a) Gate it: it would need a new `record_*` tool.
- (b) **Recommended:** do nothing. It is a record of a past event, it freezes nothing, and an update corrects it.

**D2. troubleshoot__record.**
- (a) **Recommended:** move the call to the main session behind the gate. The practitioner approves the exact text that leaves the machine.
- (b) A moderation queue on the server. This needs a Supabase change in the CoClerk-held SQL, outside this repo.
- (c) Do nothing.

**D3. Grep names-only modes (`files_with_matches`, `count`) and Glob.**
- (a) **Recommended:** label `content` mode only. Names are mostly the firm's own convention, and a bare list of paths carries little room for instructions.
- (b) Also add an `additionalContext` note when any listed path is under the root.
- (c) Do nothing, not even for `content` mode.

## Verification

For each gap: the new tests fail before the change and pass after, run by file path. The build and check scripts listed in Context are clean. For gap 3, the e2e test passes locally after the probe-fixture tests. For gap 2, a manual run of `/researcher:probanda-troubleshooting` record flow on Brahm's machine after sync is noted as pending until the sync lands.
