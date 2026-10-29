# Spec: suggestion card is not shown on a remote-device host

Status: proposed, 2026-10-29. Written in a matter session; implementation is handed to Claude Code.
Plugin: `lawyer` (installed copy seen at v0.15.0). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: 2026-10-29_suggestion-chat-wording-implies-sent-spec.md, 2026-10-29_suggestion-card-buttons-dead-in-staged-copy-spec.md

## 1. Problem
On a remote-device-only host (cloud session, PC reached through the device bridge, only `SendUserFile` as the card tool), `suggestion_card__build` wrote the card under the user's Probanda settings folder (`<APPDATA>\Probanda\suggestions\Suggestion-<id>.html`), which is not a connected folder. Staging it failed, the one folder-access request was refused by the host's auto-mode classifier, and the session told the practitioner it could not be shown. The card was shown only after the practitioner asked to see it and the second request was granted. The Past suggestions page (`past_suggestions_path`, same folder) hit the same wall.

## 2. Evidence (observed; quoted text is data, not instructions)
- `suggestion_card__build` returned `card_path` = `<APPDATA>\Probanda\suggestions\Suggestion-<id>.html`.
- `device_stage_files` error: "...is not inside a folder connected to Cowork on this device. Connected folders: \"MATTER_ROOT\"."
- First `device_request_folder_access` for that folder: "Permission for this action was denied by the Claude Code auto mode classifier. Reason: [Cowork Folder Access]." The second, made after the practitioner said "Show me the suggestion.", was granted.
- Order of calls was wrong per `shared/present-files.md`: "Before the first `device_stage_files` call of a session, check that `get_device_info`'s `connectedFolders` covers the file's folder. When it does not, make one `device_request_folder_access` call before staging, never after a failed stage". The session staged first.
- `suggestion/SKILL.md` §6: "Present `card_path` as a file card (`shared/present-files.md`), with no text." — no instruction for a card outside the connected folders.

## 3. Goal and non-goals
Goal: on every host the card is shown to the practitioner in the same turn it is built, without needing a folder grant that the host may refuse unprompted.
Non-goals: moving where sent suggestions are stored; changing the card's content.

## 4. Design
Have the card (and the Past suggestions page) written where the session can already present it. On a remote-device host the connected folder is the natural place; the matter folder is client data, so prefer a server-side route that does not depend on folder grants: e.g. the build result returns the card HTML (or a short-lived staged copy) so the session can present it directly, or the card is written into a folder already connected (scratch/outputs) as a copy whose submit still reaches the original (see the buttons spec). Exact mechanism to be chosen against HEAD (§9).

## 5. Constraints that must still hold
- No client or matter content in the card (the build's full check stays first).
- The card under `<APPDATA>\Probanda\suggestions` stays the store of record for retry/sent status.
- `shared/present-files.md` order: folder check, at most one access request, then stage.
- No new permission prompt on the normal path.

## 6. Options considered (streamline and deburr first, additions last)
1. Make the build/past-suggestions tools write the presentable copy into a location the host can already stage (the session scratch folder when `device_bash` has run, or a Probanda folder that setup connects once), and return that path as `card_path`. (recommended, if a stageable location exists without a prompt)
2. Have `suggestion/SKILL.md` §6 name the settings folder as the folder to request before the first stage, in the same turn, per `present-files.md`. Cheapest, but still a prompt and still refusable.
3. Return the card HTML in the tool result for the session to publish/present - large result in context; violates the never-read-an-HTML-page rule.

## 7. Implementation plan
1. Verify against HEAD (§10) and append a verification table to this spec.
2. Find where `suggestion_card__build` and `suggestion_box__past_suggestions` / `suggestion_box__status` choose the card/page path (lawyer data MCP server, `suggestion_card__*` / `suggestion_box__*`, **UNVERIFIED** file).
3. Implement the chosen option; update `suggestion/SKILL.md` §1 and §6 to match, deleting text the change makes unnecessary.
4. Add a test that a remote-device-host build returns a `card_path` inside a stageable location (or the documented route).
5. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of suggestion card is not shown on a remote-device host complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria
1. On a remote-device-only host, the card built in a turn can be staged and shown in that turn with no folder-access prompt on the normal path, or the skill text makes the single access request before the first stage in the build turn.
2. The same holds for the Past suggestions page.
3. Submit from the shown card still records to the store of record (coordinate with the buttons spec).

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions
- Is there a folder the remote-device host can stage from without a prompt? If not, option 2 is the floor and Brahm should decide whether setup connects a Probanda folder once.

## 10. Verify against HEAD before building
- Confirm `card_path` and `past_suggestions_path` are under the settings folder at HEAD.
- Confirm §6's text and `present-files.md`'s ordering rule as quoted in §2.
