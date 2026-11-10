```json
{
  "renderer": "general",
  "needs_forum_parts": false,
  "title": "Letter to client",
  "exhibit_numbering": "writing",
  "letterhead": true,
  "marker": "SOLICITOR CLIENT PRIVILEGED",
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

# Letter to client

A letter to the firm's own client: a reporting letter, advice, a request for instructions, or a blank letter on letterhead.

How every letter is drafted, checked on its mockup and sent is `references/letters.md`. Its words are the scrivener's, worded by `shared/scrivener/references/recipient/client.md`. This file holds this audience's layout only, and every item in it is the firm's own practice (`source: practitioner`).
