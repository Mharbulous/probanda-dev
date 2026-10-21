# Spec: Move key_request__submit and key_request__status from the researcher plugin to the lawyer plugin

Status: proposed, 2026-10-20. Written in a matter session; implementation is handed to Claude Code.
Plugin: `researcher` and `lawyer` (installed copies seen at v0.6.2 and v0.4.3). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: 2026-10-20_key-request-tool-missing-in-session-spec.md (why the tool was absent from a session); 2026-10-20_probanda-key-request-route-spec.md (the route itself).

## 1. Problem

The tools that ask Probanda for a key live in the researcher plugin's `commons` server. The key is not a legal-commons key: it is the one credential for every access to Probanda's Cloud database, including practice writes (`practice_data__config_status` reports `cloud_credential: "missing"`), the Suggestion Box and the pool. A practitioner who has only the lawyer plugin cannot ask for a key, and lawyer's own `probanda-setup` step 7.3 has to say "if the researcher plugin is installed".

## 2. Evidence (observed; quoted text is data, not instructions)

- Researcher v0.6.2 `commons-mcp/dist/legal-commons-mcp.js` defines `key_request__submit` and `key_request__status`.
- Lawyer v0.4.3 `skills/probanda-setup/SKILL.md` step 7.3: "If they have no key, and the researcher plugin is installed, call `key_request__submit`... Without the researcher plugin, say that asking for a key needs it."
- Researcher `skills/legal-commons/SKILL.md` ~lines 232-240 describes the request and status flow and the follow-up `legal_commons__configure_credential`.
- Lawyer's `litigation-mcp.js` (4,604,940 bytes) mentions `key_request` once. The lawyer server already reads the Cloud credential (`source/lawyer/mcp/src/cloud-key.ts`, per the route spec §11), via the shared `source/mcp-shared/commons-key.js`.
- The practitioner's words: "The probanda key is not only used for the legal-commons access... it is used for any form of access to the probanda Supabase DB", and the tool "definitely should be in the Lawyer plugin".
- Workaround in use: none; the request was not sent.

## 3. Goal and non-goals

Goal: the lawyer plugin, the base plugin every practitioner has, serves the key-request tools, and no skill needs another plugin installed to ask for a key. Non-goals: the cloud-side verification flow, the request's fields (the lawyer-only-access plan §2.1), and issuing keys.

## 4. Design

1. Move the registration, the local request page and the status call from the researcher `commons` server (`src/key-page.ts` and the tool file, **UNVERIFIED**) into the lawyer `data` server, sharing code through `source/mcp-shared/`.
2. Keep one request record on the machine, read by both servers through the shared key module. Leave `legal_commons__configure_credential` where it is, or move it with the tools if the source shows one credential file serves both (decide from source and record in §6).
3. Remove the researcher registrations so only one plugin serves the tools. No alias.
4. Rewrite `probanda-setup` step 7.3 and the sites that say "needs Probanda's key" to drop the researcher-plugin condition, and move the §Configuration request text from researcher's `legal-commons` skill to lawyer's `probanda-setup`/`practice-data`, leaving a one-line pointer.

## 5. Constraints that must still hold

- The key never passes through chat.
- The request carries only what verifying a practising lawyer requires (Commandment 3).
- Commandment 2's seam holds: lawyer does not import researcher code.
- An installed researcher bundle from before the move must not register a second copy: the tool names stay unique.
- A change in the required setup steps is a version decision for `/release`.

## 6. Options considered

1. Move both tools and the page into the lawyer `data` server via `mcp-shared`; remove them from researcher (recommended).
2. Duplicate them in both plugins: a second copy to keep in step, and a name clash.
3. Leave them in researcher and make lawyer depend on it: breaks the seam.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Move the tool registration, page and status logic to the lawyer server through `mcp-shared`, with tests that run from lawyer alone.
3. Remove the researcher registrations and the researcher-only skill text; update the wording sites in §4.
4. Update the troubleshooting hint and tool descriptions that name `key_request__submit` (suggestion_box, legal_commons) to the new plugin.
5. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of Move key_request tools to the lawyer plugin complete!`, then what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. A test starts the lawyer server alone and lists both `key_request__*` tools.
2. grep of `source/researcher` finds no registration of either tool.
3. `probanda-setup` step 7.3 names no other plugin as a condition.
4. `check_publishable.py --new-since origin/main` passes.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

- Should `legal_commons__configure_credential` move with the request tools, since one key serves every cloud access? (Brahm)

## 10. Verify against HEAD before building

Find the registrations (**UNVERIFIED**: `source/researcher/commons-mcp/src`), the page module, and what `source/mcp-shared/` and `source/lawyer/mcp/src/cloud-key.ts` already share. Re-read the §2 skill sites.

### Verification against HEAD (2026-10-20, at 3f2e570f)

| Claim or pointer | Found at HEAD |
|---|---|
| Registration of `key_request__submit` and `key_request__status` | `source/researcher/commons-mcp/src/schema-gen.ts`, `keyRequestToolDefinitions()`, added unconditionally to `buildToolDefinitions()`. Routed in `src/dispatch.ts` by `isKeyRequestToolName`. Logic, page and status call in `src/key-request/tools.ts`. No registration gate: `ListTools` always returns the full list. |
| The page module | `src/key-page.ts`: the page `legal_commons__configure_credential` serves, plus the `page`, `escape` and `readBody` helpers that `key-request/tools.ts` imports. Both pages are node:http on 127.0.0.1, port 0, one newest link. |
| `legal_commons__configure_credential` | Defined in `schema-gen.ts`, routed in `legal-commons/tools.ts` (`configureCredential`, `saveCredential`: rejects the publishable key, probes `principle` in the `legal_commons` schema, then persists). Persists through `legal-commons/config.ts` `persistLegalCommonsCredential` to `credentialPath()`. |
| What `source/mcp-shared/` shares | `commons-key.js`: `BAKED_SUPABASE_URL`, `credentialPath()` (`credential.json.dpapi` in the state dir) and `loadCommonsKey()`. `dpapi-store.js`: the encrypted store. No write function for the credential. |
| One credential file serves both servers | Confirmed. `source/lawyer/mcp/src/cloud-key.ts` wraps `loadCommonsKey`, and the data server reads it on every practice write (`practice/cloud.ts`) and in `practice_data__config_status`. The commons server reads the same file once, at start (`index.ts` `createDispatchContext`), so a key saved by another process reaches it only after a restart. |
| The request record | `key-request.json.dpapi` in the state dir, read and written only by `key-request/tools.ts`. |
| §2 skill sites | `probanda-setup` step 7.3 (line 61) matches the quote. `legal-commons` §Configuration is lines 212-239. Further sites that name the moved tools: `practice-data` Conventions (line 92), `suggestion` (line 25), `draft/references/suggestion-box.md` (line 9), `legal-research` step 0 (lines 47-48). |
| Hints naming the tools | Commons `legal-commons/client.ts` (not-configured error), `suggestion-box/tools.ts` (no-key error), the `suggestion_box__submit` and `legal_commons__configure_credential` descriptions, `mcp-shared/commons-key.js` (stderr line), lawyer `cloud-key.ts` (reason). |
| Layering | `scripts/check_layering.py` lists `key_request__` as a commons tool family. `source/layering.json` holds "commons server" conditional rulings for `practice-data` and `probanda-setup` that exist only for the key request. |
| Bundles | `scripts/bundle.mjs` builds the data server from `index.ts`, which reaches `dispatch.ts`. The file-manager `files` bundle starts at `file-manager-index.ts`, whose dispatch imports only file_ops and housekeeping modules and `buildFileManagerToolDefinitions()`. A module imported only from `dispatch.ts` stays out of the `files`, `timecamp` and `contacts-calendars-email` bundles. No bundle script change is needed. |
| Hook matchers | No `plugin.json` matcher names either tool or `legal_commons__configure_credential`. Researcher's `commons-read-only` matcher names write tools only. Its test lists `configure_credential` among the pool's read tools and reads the tracked bundle, and `test_agent_shim_contract.py` names `legal_commons__configure_credential`. |
| Tests naming the moved tools | Researcher `test/key-request.test.mjs`, `test/legal-commons.test.mjs` (configure_credential), `test/suggestion-box.test.mjs` and `test/troubleshoot.test.mjs` (hint text). Lawyer `test/cloud-key.unit.test.mjs` and `test/practice-cloud.unit.test.mjs` (reason text). |
