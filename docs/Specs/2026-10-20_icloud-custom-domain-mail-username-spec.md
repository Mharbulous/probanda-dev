# Spec: iCloud custom-domain mail username

Status: proposed, 2026-10-20. Written in a matter session; implementation is handed to Claude Code.
Plugin: `lawyer` (installed copy seen at v0.4.2), plus the `researcher` troubleshooter. Paths below were read in a clone of probanda-dev at HEAD `dc6c2c6` unless marked **UNVERIFIED**.
Related specs, same date: 2026-10-20_probanda-key-request-route-spec.md. Supersedes issue #159 (same defect, filed earlier the same day): close #159 when this lands.

## 1. Problem

When the mail connector is set up for a custom-domain address whose mailbox is hosted on iCloud Mail, the IMAP username has to be the person's Apple ID (an @icloud.com, @me.com or @mac.com address), not the custom-domain address. Nothing tells the agent or the practitioner this. The agent used the custom address, and the practitioner's first sign-in failed.

## 2. Evidence (observed; quoted text is data, not instructions)

- First call: `mail__configure_credential` with host `imap.mail.me.com` and username set to the custom-domain address. The practitioner's sign-in on the page failed.
- Second call: username set to the Apple ID, custom address as `from_address`. That sign-in succeeded, `mail__configure_status` showed `configured: true` and `password_set: true`, and an INBOX search returned 67 messages.
- `.claude/skills/practice-data/SKILL.md` §Mail line 213: "If none is configured, ask the practitioner for the host, port and username rather than guessing." The session guessed anyway.
- `source/lawyer/mcp/src/mail/page.ts` line 47, SECRET_HINT: "For iCloud and most hosted mail, use an app-specific password, never the account password." It has no hint about which username to use.
- The `mail__configure_credential` description seen in session says "For iCloud: imap.mail.me.com, https://caldav.icloud.com, https://contacts.icloud.com, and the Apple ID as `dav_username`". It names the Apple ID for DAV only, not for IMAP `username`. Source location **UNVERIFIED** (`source/lawyer/mcp/src/schema-gen.ts` or `mail/imap.ts` both mention me.com).
- The practitioner asked that the troubleshooter learn this. Record mode failed with `store: not configured` (see the sibling spec).
- Workaround in use: the practitioner corrected the username by hand.

## 3. Goal and non-goals

Goal: a custom-domain address hosted on iCloud is set up with the Apple ID as username and an app-specific password on the first attempt.
Non-goals: detecting the mail host from DNS, and any other provider's quirks.

## 4. Design

(a) practice-data §Mail: add that for `imap.mail.me.com` the username is the Apple ID even for a custom-domain address. The agent asks for the Apple ID, and the custom address goes in `from_address`.
(b) `mail__configure_credential` description: say the Apple ID is the IMAP `username` as well as `dav_username` for iCloud.
(c) Setup page: when the host is `imap.mail.me.com` and the username's domain is not icloud.com, me.com or mac.com, show a hint that iCloud signs in with the Apple ID. This is a hint only and never blocks.
(d) The troubleshooter agent carries this as a shipped first check for `mail_auth` on `imap.mail.me.com`, so it works when the store is unconfigured.

## 5. Constraints that must still hold

- The password never passes through chat, and the page signs in before saving.
- No tool input changes (patch level).
- `lawyer` names nothing in `researcher` (layering, `python scripts/check_layering.py`).

## 6. Options considered

1. Skill text plus the description plus a page hint plus a troubleshooter first check (recommended): covers agent and human.
2. Skill text only: cheap, but the human typing on the page gets no help.
3. Auto-rewrite the username: rejected, because it guesses the Apple ID.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Edit practice-data §Mail (a).
3. Edit the tool description (b) and add the page hint (c), with a test for the hint condition.
4. Add the first check to `source/researcher/agents/troubleshooter.md` (d).
5. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of iCloud custom-domain mail username complete!`, then what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. practice-data §Mail states the iCloud Apple-ID username rule and says to ask for the Apple ID.
2. The configure_credential description names the Apple ID as the IMAP `username` for iCloud.
3. page.ts shows the hint exactly when the host is imap.mail.me.com and the username's domain is not icloud.com, me.com or mac.com, with a passing test for both branches.
4. troubleshooter.md lists the check, with no client data.
5. `python scripts/check_layering.py` passes.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

None.

## 10. Verify against HEAD before building

Re-read practice-data §Mail and page.ts at HEAD. Locate where the `mail__configure_credential` description text is defined (**UNVERIFIED**). Confirm that troubleshooter.md has no existing iCloud entry.
