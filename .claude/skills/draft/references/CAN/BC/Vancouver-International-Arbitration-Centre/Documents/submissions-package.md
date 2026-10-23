---
sources:
  - ../Sources/vaniac-domestic-arbitration-rules.md
  - ../Sources/arbitration-act-s21.md
---

```json
{
  "renderer": "bespoke",
  "needs_forum_parts": true,
  "title": "Submissions package",
  "exhibit_numbering": "proceeding",
  "goal_criteria": ["noting-up", "open-items", "counsel-review"],
  "ingest_inputs": ["5. COURT*", "7. DISCOVERY*"]
}
```

# VanIAC submissions package

The venue's own conventions, including what "R." and "Part A" mean, are in `venue.md` beside this folder. Rule text lives in `Sources/`; quote a rule only as it stands there.

## Route

Forum: VanIAC arbitration. Assembly route: `/publish` with `publish-vaniac-package`, then `/assemble` with `assemble-vaniac-package`.

## The written exchange and its rounds

- **R. 25(b)(i).** Unless the parties agree or the tribunal directs otherwise, the final award issues without an oral hearing, on the written material delivered to the tribunal (subject to R. 25(d) and (g)). The written package is the case.
- **R. 25(b)(ii).** The exchanged written material may include written argument, witness statements, expert reports and supporting documentary evidence. Delivery of any of these counts as an exchange.
- **R. 25(b)(iii).** The tribunal sets the procedural schedule for the exchange.
- The exchange is symmetric: the drafting procedure is the same for either side.
- **Rounds.** Part B never divides the exchange into rounds. Part A fills that gap: R. 17(a)(i) (claiming material), R. 17(a)(ii) (responding material), R. 17(b) (the tribunal may order additional submissions, including reply and rejoinder). Rounds are therefore **opening**, **response**, **reply**. A tribunal-set schedule that names its own rounds governs instead.
- A reply round exists only if the tribunal's schedule provides for one. If the schedule visible in the matter provides no further round, say so before drafting and follow the practitioner's direction.
- **R. 25(c), (d).** A party may apply for an oral hearing after all written material is delivered; the tribunal orders one only where necessary, having regard to its duties under s. 21 of the *Arbitration Act* (`../Sources/arbitration-act-s21.md`).

## Component standards

- **Witness statements, R. 18(b).** Unless agreed or directed otherwise, each statement must: (i) name the witness and state their relationship to any party, past and present; (ii) give a full and detailed description of the facts and the source of the witness's information, sufficient to be their direct evidence; (iii) confirm the truth of the statement; (iv) be signed by the witness, with the date and place of signature; (v) identify with specificity any document or other material relied on.
- **R. 18(c).** Originally signed versions need not be provided, and statements need not be sworn or affirmed. The signature block is an unsworn signature with date and place, never a jurat.
- **R. 17(d)** (Part A). A witness's direct evidence is given by written witness statement unless agreed or directed otherwise.
- **Expert reports.** Named in R. 25(b)(ii). The practitioner supplies them; drafting skills do not draft expert reports.

## Responding material

- Part B is silent on what a responding round contains. Part A, R. 17(a)(ii) fills it: written argument responding to the claims advanced by the other party, responding expert reports, responding witness statements, and responding supporting documents and legal authorities.
- Read the other side's exchanged package in full before drafting a responsive round: its written argument, witness statements, expert reports and documentary evidence with its index.
- Responding witness statements meet the same R. 18(b) standard.

## Evidence book and index

- Because the award issues on the written material (R. 25(b)(i)), the evidence index is the tribunal's only route from a citation to its exhibit.
- **R. 17(c)** (Part A). Written argument, witness statements and expert reports are accompanied by their supporting documentary evidence.
- **R. 17(e)** (Part A). All supporting documentary evidence must be referenced in the written argument, witness statements or expert reports. A document nothing cites gets no exhibit number and no index row.
- **Numbering and citation across rounds: the Rules are silent. State that silence as fact.** The word "exhibit" does not appear anywhere in Parts A, B, C or D. Nothing addresses whether a responsive round's numbering continues the earlier round's sequence or restarts, what form a citation to an earlier round's exhibit takes, or whether a document already delivered must accompany a later round — R. 17(c)'s "accompanied by" does not reach that question either way. Numbering is whatever the tribunal directs under R. 25(b)(iii) or R. 16(e), or the parties agree; where neither speaks, the firm's own convention under "Package conventions" below applies. Do not read the per-package framing of those conventions as a Centre requirement to restart each round: that implication is the firm's convention showing through, nothing more. Centre practice outside the published Rules is unaudited. (`source: legal-research`, record: issue #712, answered through the `/legal-research` gate on 2026-09-19.)
- **Not the same track: R. 19(h).** "Each document produced shall contain a unique document identifier" governs the R. 19 document-**production** process (requests, objections, tribunal orders), not the R. 17 exchange of supporting documentary evidence. It is not an exhibit-numbering rule and must not be cited as one.

## Non-participation

- The Rules (Parts A and B) contain no provision addressing a party's failure to deliver any R. 25(b)(ii) material. State that silence as fact.
- What follows from non-participation, whether a further submission is available and what it may contain, and whether one party's delivery alone is "delivery of all written material" under R. 25(c), are **questions of law**. Route them to `/legal-research` and draft nothing on a non-participation round until its return and the practitioner's direction are in hand. If the gate closes, relay the refusal and stop.
- Signs the branch may apply (any one): a correspondence record in which the other side says it will not participate; the practitioner says so and no received package contradicts it.

## Package conventions (firm; `source: practitioner`)

- Round names: `Opening`, `Response`, `Reply`, `Non-Participation`.
- Components of one round: exactly one cover and index; exactly one written argument; one witness-statement file per witness, no two witnesses sharing a file; zero or more expert reports, supplied by the practitioner; zero or more exhibits, cited ones only (R. 17(e)). A non-participation round holds only the components the practitioner directs. There is no expert-report placeholder and no separate evidence index: the Evidence Index rows become the exhibits section of the package index.
- **Exhibit numbering runs across the whole proceeding** (`exhibit_numbering: proceeding` above) as the firm's convention, not a Centre requirement, so never state it as one, and defer to any tribunal direction or party agreement that says otherwise.
- **An earlier round's exhibit is cited, not re-shipped.** A round's package holds only its own new exhibits. A document already delivered keeps its number, is cited by it, and carries an Index row marked as already before the tribunal; its file does not ship again.
- **The other side's exhibit keeps their number, with a party qualifier** — `the Respondent's Exhibit 4`. It is never renumbered into this side's sequence and never copied in as a fresh exhibit of our own.
- **Our own exhibits are always cited unqualified** — `Ex. 4`, never "the Claimant's Exhibit 4" even when we act for the Claimant. This is what makes the qualifier decisive: the pre-filing check reads a qualified citation as the other side's and stops looking for it in our package and our Index. Qualify one of our own and it escapes the check entirely.
