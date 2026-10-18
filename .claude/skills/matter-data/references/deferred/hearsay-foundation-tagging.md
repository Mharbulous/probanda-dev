schema-context: pre-v6.9

> **This memo predates v6.9.** It was written against an earlier schema version. Any table or column names below must be re-checked against the current schema (see `references/schema.sql`) before this memo is acted on — do not assume they still exist or still mean the same thing.

# Hearsay Foundation Tagging

## When this memo fires

- An actual admissibility challenge to a piece of evidence is raised.
- A voir dire (or equivalent hearing on admissibility) occurs or is anticipated.
- **Never** on routine ingestion — this is not something to tag proactively while extracting facts.

## Problem

When hearsay evidence is challenged, admitting it usually depends on a specific hearsay exception (business records, prior consistent statement, dying declaration, etc.) and the foundation materials that establish the exception applies. Today there is no structured place to record which exception is being claimed for a given piece of evidence, or what foundation material supports that claim. This information currently has nowhere to live except free-text notes, which makes it impossible to query ("which evidence links are relying on an exception, and what backs each one up?") when a challenge actually happens.

## Insights

- This need is rare and reactive — it only matters when a challenge or voir dire actually occurs, not during normal ingestion. Building it into the standard ingestion path would be over-engineering for a case that hits a small fraction of matters.
- The information has two parts that both matter for the argument: (1) which hearsay exception is being claimed, and (2) what materials establish the foundation for that exception (e.g., a business-records affidavit, a custodian's certificate). These are logically distinct from the evidentiary strength rating already captured elsewhere.
- Because this predates the current schema, any future implementation must re-derive which table this should attach to (evidence links vs. facts vs. sources) rather than assuming the old attachment point still holds.

## Direction (non-binding)

- A future design could add a structured record — exception claimed, plus one or more references to foundation materials — attached to the relevant evidence link, activated only when a challenge is actually raised.

## Left open

- Which table this record should attach to under the current schema.
- Whether foundation materials should be modeled as references to existing sources or as free text with citations.
- How this interacts with the existing evidence strength rating (whether they should ever be combined).

---

This memo is problem+insight capital, not a spec. When the trigger fires, absorb the problem framing and insights above and design fresh against the schema in force at that time. Do not copy the Direction section verbatim into an implementation plan.
