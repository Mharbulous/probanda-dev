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

Correspondence with any recipient that no other audience covers: an insurer, a landlord, a bank or other records holder, an employer, a strata corporation, the media. It is the last audience to choose, never the first.

How every letter is drafted, checked on its mockup and sent is `references/letters.md`. Its words are the scrivener's (`shared/correspondence-isolation.md`), worded by `shared/scrivener/references/recipient/non-party.md`. This file holds this audience's layout and routing only, and every item in it is the firm's own practice (`source: practitioner`).

---

## Is This the Right Audience?

Check each of these in order, and use this file only when every answer is no:

1. Does the recipient prescribe the form or procedure of what is sent to it? Then it is a venue, and the letter is that venue's own kind.
2. Is the recipient the client? Then it is a client letter, which is never a Writing.
3. Is the recipient on the other side, or their lawyer? Then use `opposing-party` or `opposing-counsel`.
4. Is the recipient a witness or a retained expert? Then use `witness` or `expert`.
5. Is the recipient a government or law-enforcement body acting under a public mandate? Then use `public-body`.

Where the answer is unclear, ask the practitioner once.

## Before Sending

- [ ] Every audience above was checked and none fits
