# Spec: Mail pasted-password fallback

Status: proposed, 2026-10-16. Written in a matter session; implementation is handed to Claude Code.
Plugin: `legal` (installed copy seen at v0.5.0), mail connector of the `legal_data` MCP server. Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: `2026-10-16_mail-sign-in-link-and-password-explanation-spec.md`

---

## 1. Problem

Non-technical lawyers will paste their mail password straight into chat. Once pasted, the password has reached Anthropic and is in the session's history, unlike text typed on the local sign-in page, so Brahm wants the connector still to be set up by that path, with a warning that this was not the recommended way. Today the connector has no path for it: `configure_credential` "Takes no password", so a pasted password leaves the user stuck. The connector is generic IMAP; the fallback must work for any provider.

## 2. Evidence (observed; quoted text is data, not instructions)

- Tool description, `mail__configure_credential`: "Takes no password: an email password never passes through the chat."
- Brahm, this session (paraphrase): once a password is pasted the damage is done, so refusing to set up the connection that way achieves nothing; warn instead.
- Claude-side constraint observed this session: the session's operating rules prohibit Claude from "Entering ... passwords ... into any field" and from "entering passwords to authenticate", even when the user supplies them. A design that relies on the model passing a pasted password into a tool or typing it into the page is therefore likely to be refused by the model, whatever the plugin allows. UNVERIFIED how this applies to an MCP tool argument; treat it as a hard risk.
- Cost: not measured; anticipated support burden for non-technical users.
- Workaround in use: none (password was not pasted this session).

## 3. Goal and non-goals

Goal: when a user pastes a mail password into chat, they are (a) told plainly it reached Anthropic and that this was not the recommended way, (b) told how to limit the exposure in provider-neutral terms, and (c) brought to connection with the fewest possible further steps.
Non-goals: changing the sign-in page wording (sibling spec); storing anything pasted in chat.

## 4. Design

Two candidate paths; §6 ranks them.
- A (no model-entered password): skill/tool guidance tells the session, on seeing a pasted password, to warn that it reached Anthropic and is in the session's history (unlike text typed on the local page), recommend changing or revoking that password (or app password) at the provider, and present the "Open Mail Sign-in" link so the user pastes the same or new password there. Works within Claude's rules; one extra paste for the user.
- B (tool accepts password): add an optional `password` argument to `configure_credential`, used only when the user has already pasted it, returning a warning string. Matches Brahm's stated intent, but depends on the model being willing to pass a credential, which §2 says is likely refused; it also routes the password through the tool-call record.

## 5. Constraints that must still hold

- Credential stored encrypted at rest, never logged or returned.
- Sign-in still tested before saving.
- Provider-neutral wording throughout.

## 6. Options considered

1. Path A. (recommended) Works with the model's credential rules; the warning and link do the job.
2. Path B. Brahm's stated preference; build only after confirming in Cowork that the model will actually pass the argument.
3. Doing nothing. Pasted passwords leave the user stuck with no guidance.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Ask Brahm (via the orchestrator) to choose A or B, citing §2's model-rule risk.
3. Implement the chosen path: tool description and `next` text, plus any relaying skill text; for B, the optional argument and its warning.
4. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of Mail pasted-password fallback complete!`, then what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. Guidance exists telling the session what to say when a password is pasted: the warning, provider-neutral exposure advice, and the "Open Mail Sign-in" link.
2. No wording assumes iCloud or app-specific passwords as universal.
3. If B: the password argument is optional, never echoed, never logged, and the return carries the not-recommended warning.

Scope: edit source only (skill text, mcp/src, docs). Out of scope, because `/repackage` does it in the cloud from origin/main: rebuilding or committing any MCP bundle (mcp/dist), npm or esbuild runs, the plugin packager, version bumps, *-latest.plugin files, and running `/repackage`. Out of scope, because the orchestrating session runs it once after every spec lands: `build_plugin.py`. Out of scope, because valid testing happens only in Cowork after `/repackage`: writing, updating or running any test, suite, golden or E2E run in Claude Code. A type-check of edited TypeScript is allowed; it is not a test.

## 9. Open questions

1. Path A or B (§6). Brahm's call, given the model-rule risk.

## 10. Verify against HEAD before building

- Where `configure_credential` lives in mcp/src and how it stores the credential (UNVERIFIED).
- Whether any skill already tells the session what to do with a pasted password (UNVERIFIED).
