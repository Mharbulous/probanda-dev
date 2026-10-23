```json
{
  "renderer": "general",
  "needs_forum_parts": false,
  "title": "Letter to non-party",
  "exhibit_numbering": "writing",
  "letterhead": true,
  "goal_criteria": ["primary-authority", "excerpts", "noting-up", "recipients", "open-items", "counsel-review"],
  "ingest_inputs": ["client_communications", "retainer_and_billing", "correspondence_opposing_counsel", "correspondence_unrepresented_party", "correspondence_witness", "correspondence_expert", "correspondence_court", "correspondence_non_party", "court_filings"],
  "parts": [
    { "heading": null, "heading_numbering": "none", "paragraph_numbering": "none", "source": "slot:date" },
    { "heading": null, "heading_numbering": "none", "paragraph_numbering": "none", "source": "addressee" },
    { "heading": null, "heading_numbering": "none", "paragraph_numbering": "none", "source": "slot:salutation" },
    { "heading": null, "heading_numbering": "none", "paragraph_numbering": "none", "source": "slot:re" },
    { "heading": null, "heading_numbering": "none", "paragraph_numbering": "none", "source": "slot:body" },
    { "heading": null, "heading_numbering": "none", "paragraph_numbering": "none", "source": "signature-block" }
  ]
}
```

# Letter to non-party

Reference guidance for correspondence with any recipient that no other audience covers: an insurer, a landlord, a bank or other records holder, an employer, a strata corporation, the media. It is the last audience to choose, never the first.

How every letter is drafted, checked on its mockup and sent is `references/letters.md`. This file holds this audience's guidance only, and every item in it is the firm's own practice (`source: practitioner`).

---

## Is This the Right Audience?

Check each of these in order, and use this file only when every answer is no:

1. Does the recipient prescribe the form or procedure of what is sent to it? Then it is a venue, and the letter is that venue's own kind.
2. Is the recipient the client? Then it is a client letter, which is never a Writing.
3. Is the recipient on the other side, or their lawyer? Then use `opposing-party` or `opposing-counsel`.
4. Is the recipient a witness or a retained expert? Then use `witness` or `expert`.
5. Is the recipient a government or law-enforcement body acting under a public mandate? Then use `public-body`.

Where the answer is unclear, ask the practitioner once.

---

## Core Principles

**The recipient owes your client nothing by default.** A non-party cooperates because the request is clear, reasonable and easy to meet. Make it so.

**Tone baseline:** Formal, courteous and plain. Explain who you act for and why you are writing, without arguing the client's case.

**Assume the letter will be shared.** A non-party may pass it to the other side, to its own lawyer, or to the public. Write nothing you would not want read aloud in court.

**Any legal proposition needs research first.** If the letter states what the law requires of the recipient, that statement goes through `/legal-research` before it appears in the draft.

---

## Structure

1. **Identification.** Who you are, who you act for, and the matter in one sentence.
2. **The request in one line.** What you are asking for: records, confirmation of a fact, preservation of evidence, a payment direction, or a response.
3. **Why this recipient.** Their connection to the facts, stated plainly.
4. **Particulars.** Dates, account or policy numbers, addresses, and the exact records or information sought.
5. **Enclosures.** Any authorization, direction or prior correspondence, each listed.
6. **The response sought and by when.** A specific calendar date and one direct contact.

When a matter needs fuller guidance for one kind of recipient (an insurer, a records holder), add it as a section in this file.

---

## What to Avoid

- **Arguing the dispute.** Give the recipient only what it needs to act.
- **Implying authority you do not have.** A request is a request. Do not present it as an obligation unless that has been researched.
- **Disclosing more than necessary.** Share privileged or personal information only with the client's instructions.

---

## Checklist Before Sending

- [ ] Every audience above was checked and none fits
- [ ] The request appears in the first paragraph and is specific
- [ ] The recipient's connection to the facts is stated
- [ ] Every enclosure, including any client authorization, is listed
- [ ] A response date is stated as a calendar date
- [ ] No legal proposition appears unless it has been through `/legal-research`
- [ ] Nothing privileged or personal is disclosed without the client's instructions
