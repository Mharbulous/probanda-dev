Read when: the pre-review passes run (section 13), or a revision adds or changes an assertion after the overstatement review has run on the Writing.
Assumes SKILL.md is loaded. Rules are not restated here.

## What the review catches

A draft can quote accurately and still state a source more strongly than the source goes, or less strongly: a client's own account softened, or its stronger words on a point dropped while a milder qualifier is kept. The overstatement review checks both directions. It reads the mockup's filed face, and, through `/drafting-data`, the submissions held in reserve that the form does not show (the Arguments page lists them for the practitioner as Held in reserve), and checks every assertion about:

- what a document, an order or a court said, decided or directed;
- a date or deadline;
- what the other side has or has not done;
- what a quoted statute, rule or regulation says.

It reads every paragraph type, a rhetorical paragraph included, because characterising a document or the other side's position is where overstatement most often happens. A rhetorical paragraph's record links are advisory: a link to a document does not make an assertion about that document accurate, so the review checks the wording against the source as it does any other assertion.

It is not the verbatim check. A stored excerpt that may be misquoted goes down the verbatim check route (`references/authorities.md`). This review asks whether the draft's own words claim more or less than the source does.

## Each assertion

- **Read the primary source itself:** the email, letter, order, transcript page, affidavit, or the provision's saved text. Locate a matter document through `/matter-data`, and a provision or decision from its saved copy in the matter's law folder. An email `/matter-data` lacks is not located until ingested: cite sender, date and Message-ID. A summary, a note or an earlier draft is not a source. Wording reused from an earlier Writing is checked against that Writing's own source, never assumed right because it was filed before.
- **Match strength and scope, in both directions:** "ordered" or "directed" against "asked", "invited" or "permitted"; "may" against "must"; "deadline" against "target"; "decided" against "adjourned" or "did not decide"; conditional against unconditional; "burning" against "odour"; and every absolute ("never", "always", "every", "all", "any", "twice", "repeatedly"), completeness claims included ("these are all the occasions", "the only", "to date").
- **Check omission on the same point:** does the same source state the same point more strongly, or with aggravating detail the draft drops? A draft that keeps the source's qualifier ("less intense") and drops what it qualifies ("still burning") understates it. Detail on other points is not this check's concern.
- **Dates and deadlines** are checked only against how the source states them, condition included. The review never computes, looks up or states how long remains before anything (deadline isolation, section 3).
- **Check staleness:** does anything dated after the source, in the matter record or correspondence on file, both located through `/matter-data`, make "never", "has not" or "still" untrue?
- **Check attribution:** who wrote, said or decided it: our side, the other side, or the court or tribunal?
- **Provisions:** compare the draft's words with the provision's words only. Whether the provision has a given effect in law is a statement of law and goes to `/legal-research`. The CanLII API returns no provision text, so the words come from a saved copy or not at all. For an enactment that saved copy is the file at the `path` of its legislation record (`shared/legal-research.md`, "Statute currency."), which `/drafting-data` stores as the authority's locator and returns when asked to locate an authority's own text. Quote the provision from that file by its pinpoint.

## Findings

The review never edits substance. It writes no report: no file, no table and no card. Its findings live on the Writing's Work Board and nowhere else (`drafting-data/references/jobs-stock.md` §3g). Each assertion checked yields a finding with these fields, citing the mockup's printed paragraph number: the assertion, the source and pinpoint, what the source says, the verdict, and, on a finding other than supported, a rewrite at the source's strength. A supported finding has nothing to decide and is written nowhere.

Quote the source verbatim where possible, otherwise paraphrase at exactly its strength. A rewrite for an understated finding goes up to the source's own words and no further. The rewrite is a proposal the practitioner may take or leave, never a write. It is the one proposal the paralegal posture permits here, because running the review is what asked for it.

**Verdicts:**

- **supported**: the source says it at that strength.
- **overstated**: the source says something narrower, weaker or conditional, or covers less than a completeness claim says.
- **understated**: the source says it more strongly, or the draft drops the source's stronger statement or aggravating detail on the same point.
- **unsupported**: the source does not say it, or says something different.
- **stale**: the source said it, but later material makes it untrue now.
- **misattributed**: someone said it, but not who the draft says.
- **not located**: no primary source for it is on file. Name the folders searched and ask for it.

## The practitioner's decision

Every finding other than supported is the practitioner's to decide: keep as drafted, or rewrite at the source's strength. State each in one line in the turn it is found, with its fields, and present one decision form per finding. A chat answer covering several findings is a valid answer. A not-located finding instead asks for the source, and is decided once it arrives. A rewrite the practitioner takes is an ordinary revision (section 12), written through the gatekeeper and re-rendered.

A finding decided in that turn is written nowhere. Each one left undecided becomes a `Decide an overstatement finding` job on the Writing's Work Board (`drafting-data/references/jobs-stock.md` §3g), its step the finding's fields in §3g's form. Closing that job records the decision, and §3g's guard never writes the same finding again, so a finding kept as drafted is not raised again unless the assertion or its source changes. A client letter is no Writing and takes no job, even on the board it is attached to: its findings are decided in chat only (`references/letters.md` section 10).

Findings are decided within the pre-review passes, before section 14 checks whether the passes left anything open. A finding still undecided then, such as a not-located one whose source has not arrived, is named in one line with its job's number. It does not stop the review jobs.

## Revisions

Once the review has run on a Writing, every later revision reruns it on each assertion the revision adds or changes, and on nothing else. Each new finding other than supported goes to the practitioner the same way, and is written to the board only if left undecided. An open `Decide an overstatement finding` job whose assertion the revision rewrote is closed by that revision as its decision (§3g, "Closing it records the decision").

## Synthetic cases

Invented facts, for calibration only. None states the law.

| Case | Draft says | Source says | Verdict | Rewrite at the source's strength |
|---|---|---|---|---|
| Conditional deadline stated as fixed | "The Court ordered the plaintiff to deliver its reply by 14 March." | Order, para 3: "If the defendant delivers an amended response, the plaintiff may deliver a reply within 7 days after service of it." | overstated: a permission became an order, and a condition became a fixed date the order never states | "The order permits the plaintiff to deliver a reply within 7 days after service of any amended response." |
| Adjournments described as repeated failures | "The defendant has twice failed to obtain the order it sought." | Clerk's notes, 4 and 18 May: "Application adjourned generally, not reached." | unsupported: the source records adjournments, not a refusal | "The defendant's application has twice been adjourned without being heard." |
| Provision scope widened | "Rule 99-1(2) requires the court to extend time wherever a party shows good reason." | Saved text of Rule 99-1(2) (synthetic): "The court may extend a time period set by these rules." | overstated: "may" became "requires", and "good reason" is not in the text. Whether the rule has that effect goes to `/legal-research`. | "Rule 99-1(2) provides that the court 'may extend a time period set by these rules'." |
| Misattribution | "Opposing counsel proposed 5 May for the examination." | Our letter of 2 April: "We propose 5 May for the examination." | misattributed: we proposed the date | "Our letter of 2 April proposed 5 May for the examination." |
| Client's account softened | "Our client reports that the odour was still present, though less intense." | Client's email, 9 June: "X is still burning SUBSTANCE, although the odour is less intense; I continue to suffer." | understated: "still burning" became "odour still present", and the continuing harm is dropped | "Our client reports that X is still burning SUBSTANCE, although the odour is less intense, and that our client continues to suffer." |
| Completeness claim wider than the source | "These are all the occasions reported to us to date." | Client's emails on file: three occasions, the last of 9 June. Client's email, 20 June, reports a fourth. | overstated: the list omits an occasion on file, so "all" is untrue | "These are the occasions reported to us up to 9 June." |
| Stale absolute | "The defendant has never produced its bank records." (reused from the January application) | Demand letter, 1 February, no reply on file then. Defendant's letter, 20 March: "Enclosed are the bank records you requested." | stale: a later production makes "never" untrue | "The defendant produced its bank records on 20 March, after the demand of 1 February." |
