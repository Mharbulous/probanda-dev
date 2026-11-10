```json
{
  "renderer": "general",
  "needs_forum_parts": false,
  "title": "Letter to witness",
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

# Letter to witness

Correspondence with non-party, non-expert witnesses who have factual knowledge relevant to the litigation.

How every letter is drafted, checked on its mockup and sent is `references/letters.md`. Its words are the scrivener's (`shared/correspondence-isolation.md`), worded by `shared/scrivener/references/recipient/witness.md`. This file holds this audience's layout and routing only, and every item in it is the firm's own practice (`source: practitioner`).

## Recipients

If a witness tells you they have retained counsel, all further communication goes through that counsel. Document your interactions with the witness.
