#!/usr/bin/env python3
"""deduping-email setup script: iCloud Mail over IMAP.

Server imap.mail.me.com, port 993, SSL. Sign in with the Apple ID (often an
@icloud.com address) and an app-specific password, not with the mailbox address:
a custom-domain mailbox on iCloud still signs in as its Apple ID.

Credentials, in this order (never printed, never written to a file):
  MAIL_USER (the Apple ID), MAIL_PASSWORD (the app-specific password), MAIL_HOST
  then the OS keyring, if `keyring` is installed:
    service "deduping-email/icloud-imap", key "MAIL_USER"  -> the Apple ID
    service "deduping-email/icloud-imap", key <Apple ID>   -> the app-specific password

iCloud's trash folder is "Deleted Messages", flagged \\Trash.

Usage and modes: references/script-contract.md, or --help.
"""
import imaplib
import os
import sys

sys.path.insert(0, os.environ.get("DEDUPE_CORE_DIR") or os.path.dirname(os.path.abspath(__file__)))
import dedupe_core  # noqa: E402

SETUP_ID = "icloud-imap"
DEFAULT_HOST = "imap.mail.me.com"
DEFAULT_PORT = 993
TRASH_NAMES = ("Deleted Messages", "Trash")


def connect():
    host, port, user, password = dedupe_core.resolve_credentials(SETUP_ID, DEFAULT_HOST, DEFAULT_PORT)
    try:
        conn = imaplib.IMAP4_SSL(host, port, timeout=60)
    except OSError as e:
        raise dedupe_core.DedupeError(
            f"cannot reach {host}:{port} ({e}); run this on a computer that can reach the mail server") from None
    try:
        conn.login(user, password)
    except imaplib.IMAP4.error as e:
        raise dedupe_core.DedupeError(
            f"sign-in refused ({e}); use the Apple ID and an app-specific password, "
            "not the mailbox address or the Apple ID password") from None
    mb = dedupe_core.ImapMailbox(conn, trash_fallbacks=TRASH_NAMES)
    mb.secrets = (password,)
    return mb


if __name__ == "__main__":
    dedupe_core.main(SETUP_ID, connect)
