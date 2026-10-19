# Authority claim verification — doctrine

Four cross-cutting doctrines for verifying a claim about what an authority document says. This
file states each once, as the maintainer-facing single source of truth.

## 1. Session isolation is mandatory

The verifier runs in a session isolated from whatever produced the material it checks —
extractor or main conversation. Same-context verification is not verification: an agent
carries the same assumptions and blind spots that produced any errors in the material it is
checking, and tends to ratify its own work.

## 2. The unsourced-gloss test

Every load-bearing word must be traceable to the document. A statement may generalize and
compress but may not add. Comparatives and superlatives get particular attention — *stricter*,
*broader*, *higher*, *narrower*, *more onerous*. An unsourced gloss is a clear error, not a
quibble: it changes the rule a lawyer would draw.

## 3. The grammatical-voice test

<!-- recital-rule: begin. Source: shared/authority-claim-verification.md §3. Every copy must match it exactly (plugin-packager check recital-rule-mirror). -->
**Whose reasons are they?** Support comes only from the court's own reasons ("I find…", "The test requires…"). Before relying on a passage, decide whose voice it is in:

- **Never support:** a headnote; counsel's submissions ("The plaintiff argues…", "It was submitted that…"); an authority or argument the court distinguishes or rejects. This holds even where an appeal court recites them.
- **A cited authority** ("The court in *Smith* held X") is ambiguous on its own. Read forward to the court's disposition of it. The court adopts, applies or follows X → X is part of the court's own reasons. It distinguishes or rejects X → not support. It recites X and never disposes of it → not support.
- **An appeal court reciting the decision under appeal** ("The chambers judge held X, following *Smith*") is ambiguous the same way. Read forward to the appeal court's disposition of that reasoning. Upheld with the stated test undisturbed → X is adopted on review, and the paragraph reciting it is support: cite it together with the paragraph that upholds it. The authority the judge below followed strengthens that support. Corrected or qualified → the appeal court's qualification governs and is cited alongside X. Reversed or set aside on that point → not support.
<!-- recital-rule: end -->

## 4. The mandatory-anchor rule

A confirmation is valid only with a quoted supporting passage and locator. An anchor the
verifier cannot quote means the claim is not confirmed.

## Consumers

Verifier prompts (`matter-data/agents/verify-edges.md`, `verify-law/agents/verify-claim.md`)
**mirror these doctrines inline** because subagents read no repo files — this file is the
maintainer-facing SSOT, and an edit here is not complete until the inline mirrors are updated.
`matter-data/shared/verification-protocol.md` defers here for these four doctrines and owns
everything else.

Doctrine 3's marked block is copied exactly into every prompt that judges whose reasons a
passage is: the plugin agents `verify-claim`, `verify-edges`, `extract-caselaw` and
`verify-caselaw` with their skill-tree mirrors, `case-brief/agents/brief.md`, and
`shared/legal-audit-protocol.md`, which every law-audit agent follows. The list lives in
`RECITAL_RULE_MIRRORS` in the plugin-packager gate (direct_mode.py), and its
`recital-rule-mirror` check fails `check litigation` when any copy differs from this one.
Edit the block here first, then paste it unchanged into each copy.
