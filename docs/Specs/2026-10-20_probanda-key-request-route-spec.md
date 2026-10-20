# Spec: Probanda key request route

Status: proposed, 2026-10-20. Written in a matter session; implementation is handed to Claude Code.
Plugin: `researcher` and `lawyer` (installed lawyer copy seen at v0.4.2). Paths below were read in a clone of probanda-dev at HEAD `dc6c2c6` unless marked **UNVERIFIED**.
Related specs, same date: 2026-10-20_icloud-custom-domain-mail-username-spec.md. Supersedes issue #158 (same defect, filed earlier the same day): close #158 when this lands.

## 1. Problem

Several features need "the key Probanda gave this machine": the Suggestion Box, the legal-commons pool, and every practice write, because `practice_data__config_status` reports `cloud_credential: missing`. A practitioner without a key hears that one must be set. Nothing tells them how to get one, and no tool or page lets them ask. The troubleshooting store needs its own credential, a project URL plus an `sb_secret_` key, and nothing says whether a user should ever have one. So a fix the practitioner confirmed cannot be recorded.

## 2. Evidence (observed; quoted text is data, not instructions)

- `legal_commons__configure_status` returned `{"configured": false, "key_hint": null}`, and `/lawyer:suggestion` stopped at its posting check, so nothing was posted.
- `.claude/skills/legal-commons/SKILL.md` §Configuration (lines 211-229): "The runtime holds a single static credential: the key Probanda gave this machine". It gives no route to obtain one.
- `.claude/skills/suggestion/SKILL.md` line 25 and `.claude/skills/draft/references/suggestion-box.md` line 9 both say only: "the Suggestion Box needs Probanda's key set once through `legal_commons__configure_credential`".
- `researcher:troubleshooter` in record mode returned `store: not configured`, error code `data_error`, "the troubleshooting store is not configured". Its stated remedy was "troubleshoot__configure_credential once with the store project's URL and its sb_secret_ key". `.claude/skills/probanda-troubleshooting/SKILL.md` step 5 (line 16) skips recording when the store is unconfigured.
- `practice_data__config_status` returned `"cloud_credential": "missing"`. `.claude/skills/probanda-setup/SKILL.md` step 3 says every practice write fails until it is set.
- Workaround in use: the fix was filed as GitHub issue #159 by hand, and nothing was recorded in the store.

## 3. Goal and non-goals

Goal: a practitioner with no key can request one from inside a session and learn what happens next, and every message that reports a missing key names that route. The troubleshooting store gets a clear answer on who may write to it.
Non-goals: issuing keys automatically, and the lawyer-verification flow itself, beyond what Commandment 3 permits.

## 4. Design

(a) Add a request route that follows the local-page pattern of `configure_credential` (**UNVERIFIED** placement: the researcher `commons` server). It sends Probanda's Cloud a key request holding only what verifying a practising lawyer requires, and returns a status the practitioner can check later.
(b) Every "needs Probanda's key" message (the three skill sites in §2, and the cloud-credential note in probanda-setup) names that route.
(c) Troubleshooting store: either `troubleshoot__*` authenticates with the per-machine Probanda key, or record mode is declared maintainer-only and a user's confirmed fix falls back to a drafted `/lawyer:suggestion`. §9 asks which.

## 5. Constraints that must still hold

- The key never passes through chat (legal-commons §Configuration).
- Commandment 3: the cloud receives only what verifying a practising lawyer requires.
- A user is never handed a project-level `sb_secret_` key.
- Commandment 2's seam holds.
- A new required setup step is a minor version bump under CLAUDE.md's version rule, decided by `/release`.

## 6. Options considered

1. A request tool and local page in the `commons` server, plus updated messages (recommended): solves the problem but needs a cloud endpoint.
2. Text only: each "missing key" message names a contact route. Cheap, but manual on both sides.
3. Pool-key auth for troubleshoot__* with no request route: fixes only the store half.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. If §9 is unanswered, implement option 2's message text first (safe as a patch), and return §9 to the orchestrator.
3. Implement the request route (option 1), with tests.
4. Update the skill sites in §2 and probanda-setup step 3 to name the route.
5. Apply the §9 decision to troubleshooter record mode and probanda-troubleshooting step 5.
6. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of Probanda key request route complete!`, then what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. Every source line that tells the practitioner Probanda's key is missing also names how to request one (grep `configure_credential` and "Probanda's key").
2. A tool or page exists that sends a key request, with a test showing that it carries no matter or client data.
3. Troubleshooter record mode, given an unconfigured store, either works on the Probanda key or drafts a suggestion. It never asks for an `sb_secret_` key.
4. No path from a maintainer's machine and no secret is added (`python scripts/check_publishable.py --new-since origin/main` passes).

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

- Should a user ever write to the troubleshooting store? If yes, should it authenticate with the Probanda key? (Brahm)
- Who receives key requests, and how is a key delivered back? (Brahm)

## 10. Verify against HEAD before building

Re-read the §2 sites at HEAD. Find where `legal_commons__configure_credential` and `troubleshoot__configure_credential` are implemented (**UNVERIFIED**: source/researcher MCP server). Check whether probanda-cloud already has a key-request endpoint.
