```json
{
  "renderer": "general",
  "needs_forum_parts": false,
  "folder_code": "REL",
  "title": "Release",
  "exhibit_numbering": "writing",
  "letterhead": false,
  "signer": "party",
  "goal_criteria": ["terms-traced", "recipients", "open-items", "counsel-review"],
  "parts": [
    { "heading": null, "heading_numbering": "none", "paragraph_numbering": "none", "source": "slot:date" },
    { "heading": null, "heading_numbering": "none", "paragraph_numbering": "none", "source": "slot:preamble" },
    { "heading": null, "heading_numbering": "none", "paragraph_numbering": "restart", "source": "terms" },
    { "heading": null, "heading_numbering": "none", "paragraph_numbering": "none", "source": "signature-block" }
  ]
}
```

# Release

A settlement release, given by the releasor to the releasee on the other side. It is looked up under the `opposing-party` recipient, the releasee, even when it is delivered through the releasee's counsel. The releasor signs it, so the Writing is created with the releasor's party as its signer.

Draft it by `/draft`'s `SKILL.md`, as any Writing. Every item in this file is the firm's own practice (`source: practitioner`). Nothing in it says what a release must or may contain as a matter of law: that goes to `/legal-research`.

## Defaults

- The preamble names the releasor first, then the releasee.
- No clause is repeated.
- The operative scope clause uses the customary wording, limited to what the offer and the acceptance covered.
- The signature block shares a page with the last clause. `/publish` with `publish-general` keeps it there. Never add a page break or spacing to move it.

## Clauses

Every clause is a clause row written through `/drafting-data`'s clause writes, and selected for this Writing in the order it prints. A clause is never written into a slot, because a slot holds no provenance. Each clause traces to where it comes from:

- **Express.** A clause the offer, the acceptance or the counterparty's proposed form states. Link it to that document in the proceeding, with the passage verbatim and its locator. Leave the locator empty until it is captured, never guessed: 📌 shows until then.
- **Implied.** A clause the offer and the acceptance carry without stating. It may cite the statement of law it rests on, and 📍 shows while that statement has no locator. Counsel grants an implied clause only by approving it in a review job, never mid-drafting. Until then it shows 🧐 on the mockup, or whichever work marker still holds the line.

## Legislation citations

The statute-currency check (`shared/statute-currency.md`) runs through `/legal-research` on every enactment the release names, when the enactment is first captured. For an implied clause it is asked in the same request as the cited statement's verification, not as a separate round. It is never answered from the drafting session's own knowledge. A lookup the gate cannot run is `validation_unavailable`, never a pass. The check's result is the `currency` value of the enactment's legislation record (`shared/legal-research.md`, "Statute currency."), and the review card below shows that value. The relayed result is stored through `/drafting-data` on the authority and, for the provision the cited statement pinpoints, on that provision, and the filed render refuses while an implied clause names an enactment whose stored result, or whose cited provision's, is not `current` (the mockup tags the line `[currency: …]`, naming the provision when the result is the provision's), and the Sent write holds sending on the same rule until the result is `current` or the practitioner waives it (`/drafting-data`, the pre-send hold). Once the Writing is sent (`filed_on` set) its clauses no longer change, so its filed render reproduces what was sent and does not refuse; the mockup keeps the tag (#1227).

- **An implied clause** relies on an enactment by citing a statement of law on it, entered as a lead. Its wording names the enactment only once the currency check confirms it. The statement's verification is a different check and never suffices on its own. While the result is anything but `current`, the clause is worded without the enactment. The line shows 🔬 while the statement is a lead, and the Job Board's Proposal names the enactment. It also takes a row on the review card below, which keeps it in view after 🔬 clears. So it is rendered for the human and withheld from the forum.
- **An express clause** is worded as its source passage reads, enactment included, because that is the term the parties agreed. The check's result goes on the review card beside the mockup, which holds one row per enactment the release relies on, from either kind of clause: the clause number, the source's words or the cited statement, and the result. It is written to the release's Writing folder and presented as a file card, and an unconfirmed result is also said in one line in chat. The card never enters the Writing or the Sent copy. Whether to reword the clause is the practitioner's call, made as an ordinary revision.

## Sending

A release gets no stock jobs at its save. Once it is signed and delivered, outline a job to record it as sent. The recording is `/drafting-data`'s Sent write, as `references/letters.md` section 8 describes for a letter.
