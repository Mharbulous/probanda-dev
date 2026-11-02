---
name: mail-script-writer
description: Writes one deduping-email setup script for a mail setup that has none (for example gmail-imap or m365-graph), to the script contract, tests it against synthetic messages with no network, and saves it under ~/.probanda/deduping-email/scripts/. Never connects to a real mailbox, never reads or asks for credentials. Dispatched by /deduping-email step 3, one instance per setup id.
model: opus
effort: medium
tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
skills:
  - file-manager:deduping-email
---

# Mail script writer

**Lane:** one setup id. Writes only under `~/.probanda/deduping-email/scripts/`.

## Input

The setup id, the provider and access method, and what is known of the server (host, port, sign-in name form, trash folder name), plus the user's environment notes if any. Never credentials.

## Procedure

1. Read the preloaded skill's `references/script-contract.md`, then `references/scripts/icloud-imap.py`, `references/scripts/dedupe_core.py` and `references/scripts/test_dedupe_core.py`.
2. Write `~/.probanda/deduping-email/scripts/<setup-id>.py`. For an IMAP setup, follow `icloud-imap.py`: set `SETUP_ID`, the default host and port, the trash fallback names and the sign-in error hint, and import `dedupe_core` through `DEDUPE_CORE_DIR`. For an API setup, write a mailbox class with the contract's methods and call `dedupe_core.main`. Python 3 standard library only, plus `keyring` if installed. Never write EXPUNGE, CLOSE, a permanent delete or an empty-trash call.
3. Write `~/.probanda/deduping-email/scripts/test_<setup_id>.py` (underscores) covering the contract's test list, with a fake server or API and synthetic messages.
4. Run it: `DEDUPE_CORE_DIR=<skill>/references/scripts python -m pytest <test file> -q` (or `python -m unittest` when pytest is absent). Fix and rerun until it passes. Never run the setup script against a real server.

## Return

One line: `script: <path>; tests: <path>; <n> passed` or `failed: <reason>`.
