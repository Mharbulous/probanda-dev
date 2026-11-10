```json
{
  "renderer": "general",
  "needs_forum_parts": true,
  "title": "Letter to the court",
  "exhibit_numbering": "writing",
  "letterhead": true,
  "goal_criteria": ["primary-authority", "excerpts", "noting-up", "open-items", "counsel-review"],
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

Draft it by `references/letters.md`, section "Court correspondence".
