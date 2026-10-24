```json
{
  "renderer": "general",
  "needs_forum_parts": false,
  "title": "Letter to opposing party",
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

# Letter to opposing party

Correspondence directly to the person or entity on the other side of a dispute, not their lawyer. This is one of the most ethically sensitive categories of legal correspondence.

How every letter is drafted, checked on its mockup and sent is `references/letters.md`. Its words are the scrivener's (`shared/correspondence-isolation.md`), worded by `shared/scrivener/references/recipient/opposing-party.md`. This file holds this audience's layout and routing only, and every item in it is the firm's own practice (`source: practitioner`).

## When You Can and Cannot Write Directly

### The Core Rule: Represented Parties Are Off-Limits

Under the BC Code of Professional Conduct (Rule 7.2-6), you **must not** communicate directly with a person you know is represented by a lawyer on the matter, except:

1. **With prior consent of their lawyer.** Get this in writing.
2. **On matters outside the scope of the representation.** Narrow exception — be cautious. If the opposing party's lawyer was retained only for the contract dispute, you may be able to contact the party directly about an unrelated collections matter. But if there is any overlap, go through counsel.
3. **The representation has ended.** Confirm this before writing. Where it is not yet confirmed, say so in the request for the letter's words, so the letter asks them to confirm it.

If the party is **unrepresented**, you may write directly.

### Formerly Represented Parties

If the opposing party was previously represented but the retainer has ended, confirm the lawyer is no longer on the record (check court filings if litigation is active) before the first letter.

## Before Sending

- [ ] Confirmed the opposing party is **not currently represented** (or you have counsel's consent to write directly)
