```json
{
  "renderer": "general",
  "needs_forum_parts": true,
  "title": "Letter to the court",
  "exhibit_numbering": "writing",
  "letterhead": true,
  "goal_criteria": ["primary-authority", "excerpts", "noting-up", "open-items", "counsel-review"],
  "ingest_inputs": ["2. SOLICITOR CLIENT*", "3. CORRESPONDENCE*", "5. COURT*"],
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
