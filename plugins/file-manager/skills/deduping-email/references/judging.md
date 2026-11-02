# Judging tier 2 groups

Know-what for the `file-manager:email-dedupe-judge` agent, and for anyone checking its verdicts.

A tier 2 group is copies of one email (same Message-ID) that are not byte-identical. Usually they differ only in delivery headers (`Received`, `Delivered-To`, signatures) because the same email arrived twice. Sometimes they hold different content: a copy with an attachment stripped, a version edited before resending, a forward that kept the Message-ID, a list copy with a footer.

## The rule

> Keep the smallest set of copies that together hold everything the sender sent, as delivered: body text, quoted chain, embedded images, links (original addresses), attachments (by content), and the sender's headers (From, To, Cc, Subject, Date). Content added after delivery (mail-program edits, notes, banners, list footers, rewritten links) is not critical, and a copy differing only by it can go. Content removed or altered after delivery is critical: the copy that still has the original is kept. When the judge can't tell whether a difference came from the sender or was added later, keep both.

- **Critical:** everything the sender sent: the body text, the quoted chain, embedded images, the original link addresses, attachments by content (SHA-256), and the sender's headers (`from`, `to`, `cc`, `subject`, `date`).
- **Not critical:** anything added after delivery: notes and edits made in a mail program, "external email" banners, mailing-list footers, links rewritten by a mail filter, delivery stamps and delivery headers (`differing_transport_headers`). A copy that differs from a kept copy only by such additions can go.
- **Removed or altered after delivery:** critical. A copy missing an attachment or an inline image, with a link rewritten where another copy has the original, or with text cut or changed, has lost something: the copy that still has the original is kept.
- **Keep the smallest set** of copies that together hold every copy's sender content, and remove every other copy. If one copy holds all of it, keep only that copy.
- **The most complete copy is kept regardless of age.** Never keep a copy because it is newer or has the higher UID.
- **When it's unclear whether a difference is the sender's or a later addition, keep both.** A truncated diff, an undecodable body, an attachment present in name but with a different hash, or anything the comparison file does not settle: decision `keep_all`, reason `uncertain: ...`.

## Evidence to use

Per group, in this order: `sender_header_differences` and `hints` (mechanical: `body_equal`, `body_i_within_j`, `attachments_i_subset_of_j`, `links_equal`, `rewritten_links_i`, `images_i_subset_of_j`, `sender_headers_equal`, ...), then each copy's `attachments` and `images` (compare `sha256`, not filenames), `links` and `missing_inline_images`, then `body_diffs` (lines with `-` exist only in copy 0, `+` only in the other copy), then `differing_headers`. A diff with only `+` lines means the other copy adds text; only `-` lines means copy 0 adds text; both means each has something unique, unless the changed lines are whitespace or quoting only.

- **Rewritten links.** A link's `original` is its decoded destination; `rewritten_by` names the filter that rewrote it. The link hints compare originals, so two copies can hold the same addresses while one shows them rewritten. A copy with rewritten links lacks the original addresses, unless another kept copy has them: keep a copy that shows the originals.
- **Missing inline images.** An entry in `missing_inline_images` is an image the HTML shows (`cid:`) with no image part in that copy. That copy has lost that image; keep a copy that still has it (`images`, by `sha256`).
- **Sender headers.** A different `to` or `cc` (or `from`, `subject`, `date`) is the sender's content, not a later addition: each copy holds something the other lacks, so keep both and say so.

### Telling a later addition from the sender's content

Text one copy has and another lacks is a later addition when it is a banner, footer or note at the top or bottom of the body ("CAUTION: This email originated from outside the organization", "You received this because you are subscribed to...", a note typed above the message), or text that is not part of the quoted chain. Text inside the message or its quoted chain, a changed sentence, or a different recipient list is the sender's. If you can't tell, keep both.

## Verdict file

Write exactly this shape, one entry per group in the comparison file, nothing else:

```json
{"groups": [
  {"group_id": "g1", "decision": "remove",
   "keep": [{"folder": "INBOX", "uid": 12}],
   "remove": [{"folder": "INBOX", "uid": 9}],
   "reason": "UID 12 has everything the sender sent, including the order.pdf attachment UID 9 lacks"},
  {"group_id": "g2", "decision": "keep_all", "keep": [...], "remove": [],
   "reason": "each copy has a paragraph of the sender's the other lacks"}
]}
```

`reason` is one short sentence a lawyer can check, naming, in terms of what the sender sent, what the kept copy holds or what the removed copy only adds. It quotes no more than a few words of the email.
