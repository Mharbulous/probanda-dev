```json
{
  "renderer": "general",
  "needs_forum_parts": false,
  "title": "Letter to public body",
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

# Letter to public body

Correspondence with a public body that is not a venue: the police, a provincial or federal ministry, or a municipal office such as bylaw enforcement. Such a body receives the letter but prescribes no form or procedure for it. A body that does (a tribunal, a regulator with a published intake form) is a venue, and its correspondence is that venue's own kind.

How every letter is drafted, checked on its mockup and sent is `references/letters.md`. Its words are the scrivener's (`shared/correspondence-isolation.md`), worded by `shared/scrivener/references/recipient/public-body.md`. This file holds this audience's layout and routing only, and every item in it is the firm's own practice (`source: practitioner`).

## Recipients

Whether the opposing party or counsel is copied is a choice the practitioner makes on each letter, never a default.
