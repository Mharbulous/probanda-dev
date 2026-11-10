---
name: westlaw-query-optimizer
description: Optimize, draft, or refine a legal research question for Westlaw AI Deep Research. Trigger on Westlaw, Deep Research, or a research query, or turning a rough conversational legal question into a research-ready one.
---

<!-- REGRESSION-PRONE: CanLII-first research has recurred repeatedly. See docs/design/2026-09-24 research-lawyer Westlaw-first fix plan.md before editing. Tests: legal-research/tests/. -->

# Westlaw AI Deep Research Query Optimizer

This skill transforms a raw legal question into a well-crafted query optimized for Westlaw AI Deep Research. The goal is a tight 1–2 sentence research question that includes the right legal terminology, statutory references, and factual context — while stripping out personally identifying information.

## Workflow

### Step 0: Confirm tiers 1–3 lack pinpointable text, then proceed

Deep Research is tier 4 of `shared/research-priority.md`: the source of decision
text and research memos when the matter does not already hold them. In one line,
state what tiers 1–3 returned: the matter's ingested layer (`/matter-data`), the
shared pooled layer, and the matter's `6. LAW\` folder. Where a law-audit agent has
already run, its per-tier coverage line answers this outright — quote it.

If they have not been checked, check them first. If pinpointable text in them answers
every issue, say so: no query is needed. Otherwise proceed to Step 1 without asking.
The practitioner may also direct a Westlaw run outright; proceed on that too.

### Step 1: Receive the raw question

If the user hasn't yet provided a question, ask for it. Once you have it, proceed.

### Step 2: Clarify ambiguities with AskUserQuestion

Use the `AskUserQuestion` tool to fill in gaps that would materially improve the query. Don't ask for information you can already infer from context. Typical areas to clarify:

- **Conduct/legal issue**: What specific conduct or facts drive this research? (e.g., type of tort, contract term, statutory provision at issue)
- **Research goal**: What does the user actually want to know? Liability? Available remedies? Procedural rights? Defences?
- **Jurisdiction**: Which province(s), or all of Canada? Should the research include SCC decisions?

Limit yourself to what's genuinely ambiguous — don't ask for information that's already clear. Three well-targeted questions is usually the right ceiling; fewer is often better.

### Step 3: Craft the optimized query

With the clarified facts in hand, draft a 1–2 sentence research question that applies all of the rules below.

**Format rules**
- Exactly 1–2 sentences. No more.
- Phrased as a question, not a command. Westlaw AI Deep Research is designed for substantive legal questions, not instructions. For example:
  - ❌ "Explain whether a landlord can enter without notice."
  - ✓ "Under the BC *Residential Tenancy Act*, may a landlord enter a rental unit without notice, and if so, in what circumstances?"
- Avoid asking for: comprehensive case lists, cross-jurisdictional comparisons, drafting assistance, calculations, predictions, analytics, or specific parties or judges — Westlaw AI does not support these.

**Substance rules**
- Include the jurisdiction in the query text (e.g., "under Canadian law", "in British Columbia", "under the *Criminal Code* of Canada"). This overrides the jurisdiction selector and ensures precision.
- Add key legal terms, doctrine names, and statutory citations (e.g., s. 443 of the *Criminal Code*, s. 7 of the *Charter*, s. 85 of the *Land Title Act*). Specific terminology surfaces better results than abstract descriptions.
- Include a brief factual scenario where the facts are material to the legal question. A concrete situation is almost always better than a bare abstract query.
  - ❌ "Is trespass a crime in Canada?"
  - ✓ "In Canada, may a private individual initiate a criminal prosecution by laying an information under section 504 of the *Criminal Code* for alleged trespass and interference with survey monuments contrary to section 443, and what is the Crown's role and ability to intervene in or stay such proceedings?"
- Do not remove any facts the user provided. Add facts; reframe if necessary; do not subtract.

**Anonymization rules**
- Remove all personally identifying information: client names, opposing party names, addresses, file numbers, case references, and lawyer names.
- Replace with neutral descriptors: "the plaintiff", "the neighbouring landowner", "the employee", "the accused", etc.
- The finished query should read as a general legal research question, with no connection to a specific file.

### Step 4: Present the result

Output the optimized query in this exact format — use the horizontal rules and blockquote exactly as shown:

---

**Westlaw AI Deep Research Query:**

> [Optimized query here]

---

A dispatch that follows carries an existing `6. LAW\` subfolder and a verified
client-matter ID. The caller chooses that ID: the matter's `{client}.{matter}`
ID (client number from `/matter-data` when the folder name lacks it) for research
serving a client matter, or `PERSONAL` only for research it states is testing
or authorized unbilled firm work.

Follow this with a concise explanation of what you changed and why. Cover: any facts you added and why they're material, legal terms or statutory citations you inserted, how you reframed the question away from command-style phrasing, and what PII you removed.

## What Westlaw AI Deep Research does and does not support

Keep these constraints in mind when drafting. Westlaw AI does not support:

- Comprehensive searches ("find all cases interpreting s. 15 of the *Charter*")
- Cross-jurisdictional comparisons ("how does each province handle X")
- Analytics ("how often do plaintiffs win in negligence cases")
- Calculations or timing ("what is the limitation period if X happened on date Y")
- Specific parties, lawyers, or judges
- Drafting or form requests
- Point-in-time legislation questions
- Predictions ("how will the court rule on these facts")
- Foreign law

Westlaw AI excels at substantive legal questions: what does the law say, what have courts held, what is the test for X, do these facts constitute Y.
