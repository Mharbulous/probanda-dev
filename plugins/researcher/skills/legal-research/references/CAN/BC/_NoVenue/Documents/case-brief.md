```json
{
  "renderer": "general",
  "needs_forum_parts": false,
  "title": "Case Brief",
  "exhibit_numbering": "writing",
  "goal_criteria": ["primary-authority", "excerpts", "open-items", "counsel-review"],
  "parts": [
    { "heading": "Case", "heading_numbering": "none", "paragraph_numbering": "none", "source": "slot:case" },
    { "heading": "Facts", "heading_numbering": "none", "paragraph_numbering": "continue", "source": "slot:facts" },
    { "heading": "Procedural history", "heading_numbering": "none", "paragraph_numbering": "continue", "source": "slot:procedural-history" },
    { "heading": "Issues", "heading_numbering": "none", "paragraph_numbering": "continue", "source": "slot:issues" },
    { "heading": "Holding", "heading_numbering": "none", "paragraph_numbering": "continue", "source": "slot:holding" },
    { "heading": "Ratio decidendi", "heading_numbering": "none", "paragraph_numbering": "continue", "source": "slot:ratio" },
    { "heading": "Obiter dicta", "heading_numbering": "none", "paragraph_numbering": "continue", "source": "slot:obiter" },
    { "heading": "Disposition", "heading_numbering": "none", "paragraph_numbering": "continue", "source": "slot:disposition" }
  ]
}
```

# Case brief

A one-page structured summary of one decision in someone else's case, stored as a Writing so each numbered paragraph is one item a later job can name. Its shape and save are `shared/case-brief-template.md`'s. Never drafted by hand: every statement of law in it comes from research-agent.
