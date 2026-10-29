# Diagnose: what the tech-support agent relies on

Read after **Store states** and **Hard stops** in the skill's SKILL.md. Used by `mode: diagnose` only.

## Shipped first checks

These hold whatever the store's state. When the symptom matches one, list it first in the checklist with **Source:** `shipped first check`.

- **`mail_auth` on `imap.mail.me.com`.** Likely cause: the username is not the Apple ID. iCloud Mail signs in with the Apple ID (an @icloud.com, @me.com or @mac.com address), even for a custom-domain address such as name@example.com. Check: the username that `mail__configure_status` reports. Fix: run `mail__configure_credential` again with the Apple ID as `username` and the custom-domain address as `from_address`, and have the practitioner enter an app-specific password on the page. Needs the human: yes, to type the password on the page.

## Web search

Search the exact error text and the tool names. Prefer the vendor's documentation, issue tracker and release notes. Fetch a page only to confirm what it says.

## Ranking

Store entries rank above web results; among store entries, the higher `confirmed_count` first. Drop any cause that what was already tried rules out.

## Return format

- First line, exactly one of: `store: found N`, `store: searched, none found`, `store: answered with an error (<first line of the error>)`, `store: unreachable (<first line of the error>)`, `store: not configured`.
- Then the ranked checklist. Each item gives:
  - **Likely cause.**
  - **Check:** something the main agent or the practitioner can run or look at to confirm it.
  - **Fix.**
  - **Source:** the store `entry_id` with its `confirmed_count`, or the URL.
  - **Needs the human:** yes or no, and why when yes.
- Last line: `hard stops: none`, or each hard stop being handed to the practitioner.
