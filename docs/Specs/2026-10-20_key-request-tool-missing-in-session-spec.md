# Spec: key_request__submit is missing from the session's tool list although the installed researcher bundle defines it

Status: proposed, 2026-10-20. Written in a matter session; implementation is handed to Claude Code.
Plugin: `researcher` and `lawyer` (installed copies seen at v0.6.2 and v0.4.3). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: 2026-10-20_move-key-request-tools-to-lawyer-plugin-spec.md (where the tools live); 2026-10-20_probanda-key-request-route-spec.md (the route this spec makes usable); 2026-10-20_missing-probanda-key-at-session-start-spec.md (when the missing key is noticed).

## 1. Problem

A practitioner with no Probanda key said "I request a probanda key". `/lawyer:probanda-setup` step 7.3 says to call `key_request__submit` "if the researcher plugin is installed". The researcher plugin is installed, yet the session has no `key_request__submit` or `key_request__status` tool, so the request could not be sent and the practitioner was told to update and restart. Practice writes, the Suggestion Box and the legal-commons pool stay unusable meanwhile.

## 2. Evidence (observed; quoted text is data, not instructions)

- Session tool list: `suggestion_box__submit`, `suggestion_box__status`, `legal_commons__*`, `troubleshoot__*` and canlii tools from the researcher plugin are present. No `key_request__*` tool. ToolSearch for "key_request submit" and "key request probanda" returned no such tool.
- Installed researcher plugin v0.6.2, file `commons-mcp/dist/legal-commons-mcp.js` (637,940 bytes): defines `name: "key_request__submit"` and `name: "key_request__status"` (grep count: `key_request__submit` 8, `key_request__status` 4). The session's tool descriptions for `suggestion_box__submit` were present, so the same server is running.
- `get_device_info` lists the researcher `commons` server with `state: "announced"`. The installed folder is the same in `researcher` and `researcher~g2` (v0.6.2), so the plugin re-synced after the server started (**UNVERIFIED**: the running server predates 0.6.2).
- `skills/probanda-setup/SKILL.md` step 7.3 (lawyer v0.4.3): "If they have no key, and the researcher plugin is installed, call `key_request__submit`". `skills/legal-commons/SKILL.md` lines ~232-240 (researcher) says the same.
- `practice_data__config_status` returned `cloud_credential: "missing"`.
- Cost: one failed request, one practitioner round-trip. Frequency: every session that starts before the server picks up the new bundle.
- Workaround in use: none; the session told the practitioner to update the researcher plugin and restart the app.

## 3. Goal and non-goals

Goal: a practitioner with no key can always send the request, or is told in one sentence why the tool is absent and the one thing that fixes it. Non-goals: moving the tools between plugins (companion spec), the cloud-side verification flow, and issuing keys.

## 4. Design

1. Find why the tool is missing from the running session: a stale server started before the 0.6.2 sync, a registration gate in `source/researcher/commons-mcp/src` that hides the tools when no key is held, or an announce step that lists only some tools (**UNVERIFIED**; decide from source).
2. If the tools are hidden when no key is held, always register them: the key-less practitioner is the one who needs them.
3. If the cause is a mid-session sync, say so: the skill text names the absent tool and the single fix (restart the app), and does not require the researcher plugin as the test.
4. Make `probanda-setup` step 7.3 and the other "needs Probanda's key" sites (see the route spec §11) test for the tool, not for the plugin.

## 5. Constraints that must still hold

- The key never passes through chat.
- The request carries only what verifying a practising lawyer requires (Commandment 3).
- No path from a maintainer's machine and no secret is added.
- Agents tell the practitioner nothing they could look up themselves, and never ask them to do what a tool can do.

## 6. Options considered

1. Register the key-request tools unconditionally and fix the skill wording to test for the tool (recommended).
2. Text only: say "restart the app" whenever the tool is absent. Cheap, but leaves a key-less practitioner stuck if the cause is a gate.
3. Do nothing: the next session after a restart works.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Locate the tool registration and any gating; determine whether the running-server theory or a gate explains the absence.
3. Apply the matching fix from §4, with a test that a key-less start lists both tools.
4. Reword `probanda-setup` step 7.3 and the sites in §2 to test for the tool.
5. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of key_request__submit missing from session tool list complete!`, then what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. A test shows `key_request__submit` and `key_request__status` are listed by the server that registers them when no key is stored.
2. `probanda-setup` step 7.3 and `legal-commons` §Configuration test for the tool, not for "the researcher plugin is installed".
3. When the tool is absent, the text names the one fix and nothing else.
4. `python scripts/check_publishable.py --new-since origin/main` passes.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

- Did the running `commons` server start before 0.6.2 was synced? If so, can a plugin update restart its servers without restarting the app? (Brahm)

## 10. Verify against HEAD before building

Find where `key_request__submit` and `key_request__status` are registered (**UNVERIFIED**: `source/researcher/commons-mcp/src`). Check for any registration gate or announce list. Re-read `probanda-setup` step 7.3 and `legal-commons` §Configuration. If the companion spec has landed, apply this spec's changes to the tools' new home.

### Verification against HEAD (29127154, 2026-10-20)

| Claim in this spec | Found at HEAD | Effect on the build |
|---|---|---|
| The tools are registered in `source/researcher/commons-mcp/src` | Moved by the companion spec (29127154). `key_request__submit` and `key_request__status` are now in `cloudKeyToolDefinitions()` in `source/lawyer/mcp/src/schema-gen.ts`, with `cloud_key__configure_credential`, routed in `dispatch.ts` to `src/key-request/tools.ts`. The commons server no longer registers them. | This spec's changes apply to the lawyer data server. |
| A registration gate may hide the tools when no key is held (§4.1) | None, before or after the move. At 29127154^ the researcher `buildToolDefinitions()` always spread `keyRequestToolDefinitions()`, and `index.ts` returned `buildToolDefinitions()` from `ListTools` with no condition. The lawyer server's `ListTools` handler does the same. | No gate to remove (§4.2 does not apply). |
| An announce step lists only some tools | No announce list in either server: `ListTools` returns the whole `buildToolDefinitions()`. | None. |
| The running server predates 0.6.2 (§2, UNVERIFIED) | Confirmed from history. The tools were first added in 43b0196c and first shipped in researcher 0.6.2 (7f82bd4b, 2026-10-20 15:16). The researcher bundle before 7f82bd4b holds no `key_request__submit`; the 0.6.2 bundle holds 8, matching §2. A server lists the tools of the bundle it started from, so a server started before the 0.6.2 sync lists none. | Cause is a stale server (§4.3): the fix is the skill text naming the one remedy, a full app restart. |
| A key-less start lists both tools (criterion 1) | `source/lawyer/mcp/test/key-request-server.e2e.test.mjs` starts the data server alone with an empty `LOCALAPPDATA` and no key variables, and asserts all three key tools are listed. | Reused for criterion 1. |
| `probanda-setup` step 7.3 says "if the researcher plugin is installed" | No longer: 29127154 made the call unconditional. It does not say what to do when the tool is absent. | Add the absent-tool remedy, through practice-data's Configuration (Probanda's key). |
| `legal-commons` §Configuration says the same | No longer: it points to lawyer's practice-data, Configuration (Probanda's key), and tests for no plugin. | No change needed. |
| The other "needs Probanda's key" sites | `legal-research` step 0, `suggestion`, and `draft`'s `suggestion-box.md` name `key_request__submit` without a plugin test. The `suggestion` test for the researcher plugin is about `suggestion_box__submit`, which researcher still serves. | No change needed. |
| §9 open question: can a plugin update restart its servers without an app restart | Not answerable from source. It does not change the design: the text names the restart either way. | Left open for Brahm. |
