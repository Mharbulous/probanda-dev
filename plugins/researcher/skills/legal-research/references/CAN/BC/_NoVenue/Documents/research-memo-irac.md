```json
{
  "renderer": "general",
  "needs_forum_parts": false,
  "title": "Memorandum of Law",
  "exhibit_numbering": "writing",
  "goal_criteria": ["primary-authority", "excerpts", "noting-up", "open-items", "counsel-review"],
  "parts": [
    { "heading": null, "heading_numbering": "none", "paragraph_numbering": "none", "source": "slot:memo-header" },
    { "heading": "Issue", "heading_numbering": "none", "paragraph_numbering": "none", "source": "slot:issue" },
    { "heading": "Rule", "heading_numbering": "none", "paragraph_numbering": "continue", "source": "slot:rule" },
    { "heading": "Application", "heading_numbering": "none", "paragraph_numbering": "continue", "source": "slot:application" },
    { "heading": "Conclusion", "heading_numbering": "none", "paragraph_numbering": "none", "source": "slot:conclusion" },
    { "heading": "Sources", "heading_numbering": "none", "paragraph_numbering": "none", "source": "slot:sources" }
  ]
}
```

# Research memo (IRAC)

research-agent's Memorandum of Law on one Issue, stored as a Writing so each numbered paragraph is one item a later job can name. Its shape is `shared/research-memo-template.md`'s and its save is `shared/legal-research.md`'s ("After the answer, the caller persists it"). Never drafted by hand: every statement of law in it comes from research-agent.
