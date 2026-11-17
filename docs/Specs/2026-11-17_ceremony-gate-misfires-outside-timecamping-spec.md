# Spec: The time-block question gate refuses questions in sessions that never opened /timecamping

Status: proposed, 2026-11-17. Written in a matter session; implementation is handed to Claude Code.
Plugin: `billing` (installed copy seen at v0.7.0). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: `2026-11-17_email-ingest-privilege-protocol-spec.md`, `2026-11-17_email-inline-images-not-attachments-spec.md`

## 1. Problem

In a matter session doing email ingest, a question widget asking privilege questions about documents was refused with the time-block refusal, although the session had never opened `/timecamping`. The practitioner then had to be asked in plain text.

## 2. Evidence (observed; quoted text is data, not instructions)

- Error text: "PreToolUse:AskUserQuestion hook error: Refused: a question about time blocks is asked one at a time, in plain text, after the block's screenshots, the blocks around it and any gaps are shown. Show them, then ask."
- Hook: `billing/hooks/ceremony-gate.py`, registered in `billing/.claude-plugin/plugin.json` with matcher `^AskUserQuestion$`.
- Line 54 (read in the installed copy): `if not transcript or opened_timecamping(transcript): return hook_io.deny(REFUSAL)`. Docstring: "Fails CLOSED on a missing transcript or its own error." `hook_io.run(main, ..., closed=lambda exc: hook_io.deny(REFUSAL))`.
- Session facts: no Skill call or slash command for `timecamping` or `billing:timecamping` occurred in the session. The session is a cloud session bridged to the practitioner's computer. Likely cause, **UNVERIFIED**: `transcript_path` is empty or unreadable in this harness, or the helper import fails, so the gate fails closed.
- Frequency: 1 refusal in this session.

## 3. Goal and non-goals

Goal: the gate refuses only in a session that has opened `/timecamping`; a session where that cannot be determined does not get a time-block refusal for an unrelated question.
Non-goals: loosening the gate inside `/timecamping` sessions.

## 4. Design

Establish the actual cause first (§10). If it is a missing transcript: keep failing closed only when there is positive reason to think `/timecamping` is in play, otherwise allow. If the transcript is present but `records()` raised: fix the reader. If the refusal must stay closed on error, make its wording say the gate could not check, rather than asserting a time-block question.

## 5. Constraints that must still hold

- Inside a session that opened `/timecamping`, a question widget is still refused.
- Enforced rules change only on the practitioner's instruction: the change to fail-closed behaviour is named in the commit message with what is no longer enforced.
- Refusal text stays in plain words (internals-confidentiality).

## 6. Options considered (streamline and deburr first, additions last)

1. **Fail open when there is no transcript, closed only on evidence of `/timecamping`** (recommended if §10 confirms the missing-transcript cause). Removes a false positive with one condition.
2. Keep fail-closed but change the refusal wording to "could not check whether this is a time-block question". Honest, but still blocks every question widget in such sessions.
3. Gate by reading the question text for time-block content. Fragile heuristics.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Reproduce with a test payload: no `transcript_path`; a transcript with no timecamping record; a transcript with one. Record which branch refused.
3. Apply the option §10 supports; update the docstring.
4. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of The time-block question gate refuses questions in sessions that never opened /timecamping complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. A test with a transcript holding no timecamping record allows the widget.
2. A test with a transcript holding a `Skill` call to `billing:timecamping` refuses it.
3. The missing-transcript case behaves as chosen, and the docstring states it.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

- Fail open on a missing transcript loosens an enforced rule. Brahm asked for this fix; confirm with him only if §10 shows the transcript was present and the cause is something else.

## 10. Verify against HEAD before building

Confirm in HEAD: `ceremony-gate.py`'s branches; what `transcript_path` a bridged cloud session supplies to a plugin hook; `transcript.records` error behaviour.
