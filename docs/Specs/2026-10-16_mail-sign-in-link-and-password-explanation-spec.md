# Spec: Mail sign-in link and password explanation

Status: proposed, 2026-10-16. Written in a matter session; implementation is handed to Claude Code.
Plugin: `legal` (installed copy seen at v0.5.0), mail connector of the `legal_data` MCP server. Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: `2026-10-16_mail-pasted-password-fallback-spec.md`

---

## 1. Problem

When the mail connector needs a password, `mail__configure_credential` returns a raw localhost URL and tells the session to "Send the practitioner this link". The session pasted the bare URL (`http://127.0.0.1:<port>/mail/<48-hex token>`) into chat, which Brahm called incomprehensible. The local sign-in page itself gives no disclaimer and no reason why the password is entered there rather than in chat, and the chat message gives none either. Brahm also stresses that the connector is a generic IMAP connector: any wording must work for any provider (Gmail, Microsoft 365, Fastmail, a firm's own server), not iCloud alone. In this session Claude repeatedly drifted into iCloud-only advice because the user's own account is iCloud.

## 2. Evidence (observed; quoted text is data, not instructions)

- Tool: `mail__configure_credential` (legal_data). Return seen: `{"status":"awaiting_password","url":"http://127.0.0.1:62502/mail/<token>",...,"next":"Send the practitioner this link and ask them to type the password on that page, never in chat. ..."}`.
- Tool description: "Takes no password: an email password never passes through the chat." and "For iCloud: imap.mail.me.com, https://caldav.icloud.com, https://contacts.icloud.com ...". The iCloud line is the only provider worked example.
- Page text seen (built-in browser, `get_page_text`): "Probanda mail connector / Server / Username / Calendar server / Time zone / Contacts server / Your password will be sent to: ... / Your mail password. For iCloud and most hosted mail, use an app-specific password, never the account password. / Sign in and save / What you type here goes only to Probanda on this computer. It is never sent to Claude." No disclaimer, no explanation of why chat is avoided.
- Presentation attempts this session: raw URL in chat (rejected by Brahm); an HTML file card wrapping the link (an extra click, rejected); an HTML file card that redirects to the URL (renders blank: the in-app preview cannot load localhost); `Claude_Browser__preview_start` (loads, but the pane stays hidden and cannot be brought forward by a tool). A markdown hyperlink `[Open mail sign-in](<url>)` worked: it opens in whichever browser the user's Claude "Preferred browser" setting names. Brahm approved this form.
- Cost: about 8 turns spent on link presentation alone.
- Workaround in use: markdown hyperlink in chat.

## 3. Goal and non-goals

Goal: (a) the sign-in link is always presented in chat as a markdown hyperlink labelled "Open Mail Sign-in", never as a raw URL; (b) the local page carries a short disclaimer and a plain explanation of why it exists; (c) the chat message carrying the link gives the same short explanation; (d) all wording is provider-neutral.
Non-goals: the pasted-password case (sibling spec); changing how the credential is stored or encrypted; auto-opening a browser pane.

## 4. Design

- `configure_credential`'s `next` field (and the tool description) instruct the session to present the URL as `[Open Mail Sign-in](<url>)` and never as bare text, followed by the explanation in (c).
- Page: add a short "Why this page?" block and a disclaimer near the password field. Suggested explanation (provider-neutral): "Anything typed into a Claude chat is sent to Anthropic's servers. It is encrypted on the way, but once there it is readable, kept with the conversation, and seen by Claude. This page runs only on your own computer. Your password goes from here straight to your mail provider to test the sign-in, and is then stored on this computer, encrypted. Neither Anthropic, Claude nor Probanda sees it." Disclaimer wording is Brahm's call (§9).
- Replace "For iCloud and most hosted mail, use an app-specific password" with provider-neutral text, e.g. "If your mail provider uses two-step sign-in, it may require an app password (Gmail, iCloud, Yahoo and others call it that). Check your provider's security settings."
- Tool description: keep the iCloud example but add at least one non-iCloud example (e.g. Gmail `imap.gmail.com`, Microsoft 365 `outlook.office365.com`) so models do not treat iCloud as the default. UNVERIFIED whether Microsoft 365 basic-auth IMAP is still available to tenants; the implementer checks before naming it.

## 5. Constraints that must still hold

- The password never passes through chat or through any tool argument.
- The page still only binds to 127.0.0.1 and the token-gated URL; only the newest link works.
- The page's existing "Your password will be sent to: ..." line stays.

## 6. Options considered

1. Hyperlink instruction in `next` + page explanation + provider-neutral wording. (recommended)
2. Same, but render the explanation only on the page, not in chat. Lawyers who never open the page get no reason.
3. Doing nothing. Raw URLs and iCloud-centred advice continue.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Edit the `configure_credential` description and its `next` text (mcp/src) per §4.
3. Edit the sign-in page template (mcp/src) per §4.
4. Grep skills that relay the link (e.g. practice-data, probanda-setup, build-timeline) for raw-URL relay wording and align them.
5. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of Mail sign-in link and password explanation complete!`, then what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. The `next` text names the exact label "Open Mail Sign-in" and forbids presenting the bare URL.
2. The page source contains the explanation block and a disclaimer.
3. No user-facing text in the mail connector says or implies the user's provider is iCloud; the iCloud example in the tool description sits beside at least one other provider.
4. No password parameter is added to any tool.

Scope: edit source only (skill text, mcp/src, docs). Out of scope, because `/repackage` does it in the cloud from origin/main: rebuilding or committing any MCP bundle (mcp/dist), npm or esbuild runs, the plugin packager, version bumps, *-latest.plugin files, and running `/repackage`. Out of scope, because the orchestrating session runs it once after every spec lands: `build_plugin.py`. Out of scope, because valid testing happens only in Cowork after `/repackage`: writing, updating or running any test, suite, golden or E2E run in Claude Code. A type-check of edited TypeScript is allowed; it is not a test.

## 9. Open questions

1. Exact disclaimer wording (liability, "use at your own risk", or a privacy statement). Brahm's call.

## 10. Verify against HEAD before building

- Where `configure_credential` and the page template live in mcp/src (UNVERIFIED).
- Which skills relay the sign-in URL to the user (UNVERIFIED).
- Whether the calendar/contacts wording on the page is also iCloud-specific (UNVERIFIED).
