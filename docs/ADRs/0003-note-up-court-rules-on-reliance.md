---
status: accepted
---

# A Court Rule is noted up on the practitioner's machine at Reliance on a rule, against its Venue source record

A Rule Library or commons copy may be stale or wrong, and the commons cannot confirm that a contribution is the publisher's text. Checking every copy on every read would cost a fetch for each search. So a copy is used as it stands for reading and searching, and a provision is **Noted up** only at **Reliance on a rule**: when it is quoted or reproduced in a document, a paragraph, argument or submission rests on it, or a date or deadline is calculated under it. The note-up runs on the practitioner's own machine every time. It checks currency and compares the text relied on, word for word, with the source the Venue's **Venue source record** names. `court-rules-clerk` keeps each Venue source record: the most authoritative online source for the current text, where changes are first announced, and when announced changes come into force.

## Considered options

- **Check every copy when it is read**: a fetch for every search, most of them for rules nobody relies on.
- **Trust the commons copy and confirm contributions centrally**: the cloud only sees what a plugin sends, so it cannot confirm a fetch without fetching itself, and a later amendment would still be missed until the next contribution.
- **Stop the work, or block filing, when a note-up fails or finds different wording**: a publisher's outage would hold up a deadline the practitioner needs to plan around or a filing that cannot wait.

## Consequences

- A note-up that fails or finds different wording does not stop the work. The date, paragraph or quotation is produced and marked 📇 until a later note-up succeeds. Filing or serving is not blocked, but the practitioner sees the 📇 warning before anything still marked goes out. Where the wording differs, the authoritative wording is used, the practitioner is told what changed, and the commons copy is marked for replacement.
- A wrong first contribution can be found by search but never relied on unnoticed: the first practitioner to rely on it checks it against the authoritative source.
- The note-up is a `practice` data server tool beside the `court_rules__*` tools, because docket-clerk, in `practice`, calculates dates and may not call into `research`.
- Where an announced change comes into force inside a date calculation's window, the note-up reports both texts and their in-force dates. Which governs stays with research-agent.
- Venue source records hold web addresses and no rule text, so they may be shared through the commons once more than one practitioner keeps them.
