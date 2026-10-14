# Outgoing email

Read when: the practitioner asks to email, send or forward anything to anyone, from any skill or from none ("email it to opposing counsel", "send this to the client"). This file is the one source for that route. A skill that ends in an email adds only what its own Writing decides (recipients, subject, attachment) and cites this file for the rest.

**The model never sends email.** Every outgoing email is an unsent draft that the practitioner opens, checks and sends from their own mail program (`docs/adr/0032`). Never load, call or dry-run a mail send, forward or reply tool to deliver one. A plugin hook refuses those calls and names this route.

**The route.** Call `drafting_forms__draft_harness` with `step` `write_email`. ToolSearch it. On a remote-device host its name carries the host's prefix. It writes `<output_name>.eml` with `X-Unsent: 1`, which the mail program opens as a new message ready to send. Pass:

- `matter_root`: the matter folder.
- `to` (at least one) and `cc`: address strings, `"Name <a@b>"` or `"a@b"`. Take them from `/case-data` or `/drafting-data`, or as the practitioner gives them. Never guess an address.
- `subject`: one line.
- `body`: plain text, the message only. **The body carries no closing and no name.** The signature supplies them. A body whose last lines repeat this machine's roster `closing` or `name` while a signature applies is refused with `signoff_duplicates_signature`, and nothing is written.
- `output_name`: a bare stem under `/file-naming`'s grammar, dated the day it is written. Optional `folder`: one folder name under the matter's `0. DRAFT` folder.
- `attachments`: PC paths, absolute or relative to the matter folder. Copy a container-only file to the PC with `device_commit_files` first. Never attach a file ending ` UNSIGNED.pdf` unless the practitioner names it.

**From and signature.** The server sets the From address from this machine's roster entry. It adds the signature from the roster person's template, `<case_data_root>\_practice\firm\email-signatures\<roster key>.htm` (`/practice-data`), when one exists. Otherwise it adds Outlook's default new-message signature for that address. The result's `signature_source` says which (`template`, `outlook` or null). When `signature` is null, quote its `signature_note` in one line. Then write the draft again with the roster entry's `closing` and `name` (`/practice-data`'s firm profile) at the end of `body`. The new copy takes the next " vN".

**Refusals**, each quoted in one line: `from_unresolved` (this machine's roster entry has no person or email: `/practice-data`), `attachment_unresolved` (names each file not found) and `signoff_duplicates_signature` (remove the closing and name from `body` and call again).

**Present.** Present the draft as a file card, give its PC path from the result, and tell the practitioner to open it, check it and send it from their mail program. Nothing is overwritten: a taken name gets the next " vN", reported as `versioned_from`. The draft is never the copy as sent. The sent message is filed with the matter's correspondence.
