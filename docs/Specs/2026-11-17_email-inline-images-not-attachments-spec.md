# Spec: Emails whose only attachments are inline images are not set aside

Status: proposed, 2026-11-17. Written in a matter session; implementation is handed to Claude Code.
Plugin: `lawyer` (installed copy seen at v0.31.0). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: `2026-11-17_email-ingest-privilege-protocol-spec.md`, `2026-11-17_ceremony-gate-misfires-outside-timecamping-spec.md`

## 1. Problem

The batch ingester sets aside every email the renderer reports with any attachment, sending it to the slower one-at-a-time path. An email signature's inline logo counts as an attachment, so ordinary replies are set aside.

## 2. Evidence (observed; quoted text is data, not instructions)

- `lawyer/skills/ingest-orchestrator/references/routing.md` check 5: "An email the renderer reports with attachments: set aside for `/ingest`, which registers its attachments".
- `lawyer/skills/matter-data/references/scripts/render_document.py` `render_eml`: `for part in msg.iter_attachments():` appends every part to `attachments`, with no inline/Content-ID distinction.
- Session: 11 emails; 6 set aside for attachments, of which 3 were set aside only for one `image001.png`, `image/png`, 6,802 bytes, the same SHA-256 in all three (a signature logo).
- Workaround in use: those 3 wait for the single-document path.

## 3. Goal and non-goals

Goal: an inline image referenced by the body (Content-ID, or `Content-Disposition: inline`, image/*) is not an attachment for routing; the email routes with the batch.
Non-goals: dropping real attached images (a photo sent as evidence); changing attachment registration for real attachments.

## 4. Design

The renderer marks each attachment `inline: true` when it is an image part with a Content-ID referenced in the HTML body or an inline disposition, and routing check 5 ignores entries marked inline. Inline images are still named in the email's `notes` (as routing.md "Emails with attachments, unattended" already names unread ones), so nothing is silently lost.

## 5. Constraints that must still hold

- The email's raw-bytes hash is unchanged (rendering never feeds the hash).
- A non-inline image attachment still sets the email aside, attended, or is listed unattended.
- Existing renderer output fields keep their meaning; `inline` is additive.

## 6. Options considered (streamline and deburr first, additions last)

1. **Renderer flags inline parts; check 5 ignores them** (recommended). One boolean, one clause.
2. Size threshold for images. Fragile: a small evidential image would be lost.
3. Drop inline parts from the renderer's list entirely. Loses the record that they existed.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. In `render_document.py`, set `inline` on image parts with a Content-ID or inline disposition; test with a synthetic email carrying a CID logo and a real attached PNG.
3. Edit routing.md check 5 (and the unattended section) to ignore `inline` entries and name them in `notes`.
4. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of Emails whose only attachments are inline images are not set aside complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. A test email whose only part besides the body is a CID-referenced PNG renders with that entry `inline: true`, and check 5's text routes it rather than setting it aside.
2. A test email with an attached (non-inline) PNG still reports it without `inline`.
3. routing.md names inline images in the email's notes.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

- Does `matter-data/operations/ingest.md`'s single-document path also treat inline images as attachments to register? If so, apply the same flag there.

## 10. Verify against HEAD before building

Confirm in HEAD: `render_eml`'s attachment loop; routing.md check 5 and the unattended attachments section; any other caller of the renderer's `attachments` list.
