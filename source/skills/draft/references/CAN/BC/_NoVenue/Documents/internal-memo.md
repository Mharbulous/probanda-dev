```json
{
  "renderer": "general",
  "needs_forum_parts": false,
  "title": "Internal memo",
  "exhibit_numbering": "writing",
  "goal_criteria": ["primary-authority", "excerpts", "noting-up", "open-items", "counsel-review"],
  "parts": [
    { "heading": null, "heading_numbering": "none", "paragraph_numbering": "none", "source": "slot:date" },
    { "heading": null, "heading_numbering": "none", "paragraph_numbering": "none", "source": "addressee" },
    { "heading": null, "heading_numbering": "none", "paragraph_numbering": "none", "source": "sender" },
    { "heading": null, "heading_numbering": "none", "paragraph_numbering": "none", "source": "slot:re" },
    { "heading": null, "heading_numbering": "none", "paragraph_numbering": "none", "source": "slot:body" }
  ]
}
```

# Internal memo

A memo to the file, or to another member of the firm, on the matter. It goes to no one outside the firm and carries no letterhead.

Draft it by `/draft`'s `SKILL.md`, as any Writing: its substance comes from the practitioner and the matter record, and every statement of what the law is comes only from `/legal-research`. Every item in this file is the firm's own practice (`source: practitioner`).
