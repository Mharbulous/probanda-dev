```json
{
  "renderer": "general",
  "needs_forum_parts": false,
  "folder_code": "LTR",
  "title": "Letter to opposing counsel",
  "exhibit_numbering": "writing",
  "letterhead": true,
  "goal_criteria": ["primary-authority", "excerpts", "noting-up", "recipients", "open-items", "counsel-review"],
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

# Letter to opposing counsel

Reference guide for drafting letters and emails to the lawyer on the other side of a file.

How every letter is drafted, checked on its mockup and sent is `references/letters.md`. This file holds this audience's guidance only, and every item in it is the firm's own practice (`source: practitioner`).

## Contents
- Tone and Voice
- Structure of a Typical Letter or Email
- What to Include
- What to Avoid
- When to Be Firm vs. Open to Discussion
- Position Discipline
- Handling Uncooperative or Bad-Faith Counsel
- Specific Contexts
- Examples
- Quick Reference Checklist

---

## Tone and Voice

The baseline is **collegial professionalism**. Opposing counsel is not the enemy — they are another officer of the court doing their job. Even when the relationship is adversarial, the correspondence should not be.

Key principles:

- **Firm, never hostile.** State your position clearly. Do not soften it with hedging, but do not add editorial commentary about opposing counsel's conduct unless you are building a record for a court application.
- **Counsel-to-counsel courtesy.** Use "you" and "your client" — not first names for the opposing party. Assume the letter may be shown to the client, the court, or both.
- **No sarcasm, no passive aggression.** These read worse on paper than they sound in your head, and they undermine credibility if the letter ends up in an affidavit.
- **Brevity is persuasion.** A chambers judge skims correspondence exhibits; a four-paragraph letter where every sentence advances the position gets read in full, while a two-page letter gets skimmed — and the writer loses control over which sentences land. Every letter needs a clear ask or position; every sentence must advance it; cut anything that merely defends, protests, or repeats. Restraint reads as confidence.
- **Not every point deserves a reply.** Before answering a point from the other side's letter, classify it: points where silence would read as concession before a judge must be answered; jabs, editorializing, and accusations peripheral to the letter's purpose are usually best met with a one-line acknowledgment-and-deferral ("We note your comments regarding X and will respond separately") or with nothing. Answering everything dilutes the two arguments that matter and surrenders the length advantage.

When opposing counsel is reasonable, be warm enough to preserve the working relationship. When they are not, be clinical. The shift in tone itself sends the message.

---

## Structure of a Typical Letter or Email

### 1. Opening line
State the file, the purpose, and any relevant deadline up front.

> Re: Smith v. Jones, BCSC Action No. VLC-S-S-123456
>
> We write regarding the outstanding document production under Rule 7-1.

Do not waste the first paragraph on pleasantries or background the reader already knows.

### 2. Body
Organize by issue. If covering multiple topics, use numbered paragraphs or subheadings. For each issue:

- State the relevant fact or procedural context (briefly)
- State your position or request
- State the consequence or next step if the request is not met

### 3. Closing
End with a concrete next step and a deadline where appropriate.

> Please confirm your client's position by April 25, 2026. If we do not hear from you by then, we will proceed with an application under Rule 7-1(10).

### 4. Sign-off
"Yours truly" is standard in BC litigation correspondence. "Regards" is fine for email. Do not use "Respectfully" unless writing to the court — it reads as either submissive or sarcastic when directed at counsel.

---

## What to Include

- **File reference and context.** Never assume the reader remembers where things stand. A one-sentence refresher saves everyone time.
- **Your position, stated plainly.** Do not bury the point.
- **Deadlines.** Be specific — use calendar dates, not "within a reasonable time."
- **What you will do if you do not get a response.** This is not a threat; it is professional notice of your intended next step.
- **References to the Rules or governing authority** when your position depends on them.
- **An offer to discuss** where you genuinely want to resolve the issue without a court application.

## What to Avoid

- **Personal attacks or commentary on counsel's competence.** Even if warranted, it achieves nothing and creates risk.
- **Ultimatums you do not intend to follow through on.** If you say you will bring an application, bring it.
- **Disclosing privileged strategy.** Be careful about explaining *why* your client wants something — focus on *what* and *when*.
- **Over-explaining your legal position.** You are not writing a brief. State enough to support your request; save the full argument for court.
- **"Without prejudice" misuse.** Only use this label when you are making a genuine settlement offer or concession. Do not slap it on routine correspondence to try to keep it out of court — it does not work that way, and it signals confusion about the rule.
- **Copying the client on counsel-to-counsel emails** unless there is a specific reason. It constrains candid discussion and often escalates tone on both sides.

---

## When to Be Firm vs. Open to Discussion

**Be firm when:**
- A deadline has passed and you have already been accommodating
- The Rules clearly support your position and there is no reasonable basis for the other side's refusal
- You need to build a paper trail for a court application
- The issue is one where compromise would prejudice your client

**Be open when** (and only for positions not yet taken — once a position is on the record, openness is governed by the Position Discipline section below):
- Scheduling or procedural matters where flexibility costs your client nothing
- The other side has a defensible (even if wrong) position and resolving it by consent saves everyone time and money
- Early-stage disputes where the relationship is still being established
- You want information or cooperation from the other side on a related issue

Two tests, applied in order. First, the ratchet test: is this a new question, or a retreat from a position already taken? A retreat requires changed facts, not merely renewed pressure. Second, for genuinely new questions only, the judge test: if a judge would view refusal to discuss as unreasonable, be open; if the judge would view the other side's position as unreasonable, be firm.

---

## Position Discipline

Positions once taken — deadlines set, demands made, characterizations of events, consequences stated — are a floor, not an opening bid. Each successive letter is drafted against the full history, and the reader who matters (a judge, eventually) will have that history in front of them.

**The concession ratchet rule.** Never retreat from a previously taken position unless (a) the facts have actually changed since the position was taken, or (b) the user explicitly instructs the retreat. "The other side pushed back" is not a change in facts. If a draft softens a deadline, waives a stated consequence, or re-characterizes an event more favourably to the other side than the last letter did, flag the retreat to the user expressly and identify what changed — never let a concession leave the office unnoticed.

**Sympathetic is not the same as accommodating.** The goal is for the writer to appear professional, knowledgeable, fair, and sympathetic *to the judge*. A pushover is someone who appeases an adversary by voluntarily giving them more than they could reasonably hope to obtain from a contested hearing. That is not generosity; it is a strategic error with a specific mechanism: a concession more generous than the likely court outcome gets **accepted** — the dispute never reaches a judge, and the sympathy the letter was engineered to earn is never seen by its intended audience. Concessions should therefore always be worth less to the opponent than what a hearing would realistically give them.

**Repairing a prior inconsistent position.** When the verification pass reveals that a position the current draft wants to take is undercut by the firm's own earlier correspondence, do not deny the record and do not silently abandon the new position. Own it, then narrow it: acknowledge what the earlier letter said, then explain why events since — usually the other side's own conduct — have resolved the ambiguity in favour of the position now taken. A retreat the record explains is credibility preserved; a denial the record refutes is credibility spent.

---

## Handling Uncooperative or Bad-Faith Counsel

When opposing counsel is obstructive, unresponsive, or acting in bad faith, the goal shifts from persuasion to documentation. You are writing for a future audience — a judge or master reading an affidavit of records on an application.

**Principles:**

1. **Put everything in writing.** If you had a phone call, follow up with an email confirming what was discussed and agreed (or not agreed).
2. **Be specific about what you asked for and when.** Dates, deadlines, and the substance of each request should be traceable through the correspondence.
3. **State consequences clearly and follow through.** Hollow warnings undermine your credibility when you do bring the application.
4. **Do not match their tone.** If they are rude, aggressive, or unprofessional, stay clinical. The contrast works in your favour when the correspondence is before the court.
5. **Escalate methodically.** Request, then reminder, then notice of intended application, then application. Do not skip steps — courts expect reasonable efforts before granting relief.

---

## Specific Contexts

### Discovery Disputes
- Cite the specific Rule (7-1 for document discovery, 7-2 for examinations) and the specific deficiency.
- Quote or attach the relevant demand or request so the record is self-contained.
- Propose a reasonable deadline for compliance before threatening an application.
- If seeking further and better production, identify the categories of documents you believe are missing and explain (briefly) why you believe they exist.

### Scheduling
- Propose multiple dates. Do not ask "when are you available?" without offering options.
- Confirm agreements in writing the same day.
- When seeking adjournments, explain why (briefly), propose a new date, and offer a consent order.

### Demand Letters
- State the factual basis for the claim concisely.
- State the relief sought with specificity (amount, conduct, deadline).
- Set a response deadline — 14 to 30 days is standard depending on complexity.
- Reference your intention to commence proceedings if the demand is not met, but do not overstate the merits.

### Settlement Discussions
- Mark "Without Prejudice" clearly and only when the communication contains a genuine offer or concession.
- Separate settlement correspondence from substantive litigation correspondence. Do not mix a settlement offer with a discovery demand in the same letter.
- Be clear about what is being offered, what is being sought in return, and the deadline for acceptance.

### Service of Documents
- When serving documents, the covering letter should identify what is being served, the method of service, and the deemed date of service under the Rules.
- Keep it short: list the documents by their identifying features, not their contents. Close with "Kindly acknowledge receipt in your usual way."

---

## Examples

These are patterns to adapt, not fixed text. The letter's parts are fixed by the layout block at the top of this file.

### Example 1: Following Up on Overdue Discovery

> Dear Ms. Chen,
>
> Re: Garcia v. Pacific Industries Ltd., BCSC Action No. VLC-S-S-245678
>
> We write further to our letter of March 15, 2026 requesting production of the maintenance records identified in Category 3 of our demand for documents dated February 20, 2026.
>
> The 14-day deadline for production has now passed. Our client requires these records to prepare for the examination for discovery of your client's representative, currently scheduled for May 12, 2026. Without production in advance of that examination, we will likely need to seek an adjournment and an order for production under Rule 7-1(10), with costs.
>
> We would prefer to resolve this without an application. Please confirm by April 23, 2026 whether the documents will be produced and on what timeline. If we do not hear from you by then, we will proceed with a chambers application.
>
> Yours truly,

**Why this works:** States the history, identifies the specific deficiency, gives a deadline, and offers a path to resolution while making clear what happens if the deadline is missed. No editorializing about the delay.

---

### Example 2: Proposing a Consent Order

> Dear Mr. Patel,
>
> Re: Thompson v. Westridge Holdings Inc., BCSC Action No. VLC-S-S-310987
>
> Further to our discussion today, we understand we are agreed on the following:
>
> 1. The plaintiff's examination for discovery will be adjourned from June 3 to July 8, 2026.
> 2. The defendant will provide supplemental production by June 15, 2026.
> 3. The trial management conference date of September 10, 2026 remains unchanged.
>
> We enclose a draft consent order reflecting these terms. If the draft is acceptable, please execute and return the order so we may file it. If you have changes, please send a revised draft by April 24, 2026 so we can file the order well in advance of the current discovery date.
>
> Yours truly,

**Why this works:** Confirms the agreement in writing immediately, attaches a draft to keep things moving, and sets a deadline for response. Avoids any ambiguity about what was agreed.

---

### Example 3: Responding to an Aggressive Letter

> Dear Ms. Grant,
>
> Re: Nolan v. Apex Construction Ltd., BCSC Action No. VLC-S-S-198765
>
> We have your letter of April 10, 2026. We address your points in order.
>
> First, our client's list of documents was prepared in accordance with Rule 7-1(1) and is complete to the best of our knowledge as of the date it was served. Your suggestion that documents have been deliberately withheld is unfounded, and we trust it will not be repeated.
>
> Second, we have not agreed to produce the categories of documents described in paragraphs 4 through 7 of your letter. Those categories are overbroad and seek production that is neither relevant nor proportional to the matters in issue. We are prepared to discuss refined categories if you can identify the issues in the pleadings to which the requested documents relate.
>
> Third, the trial date was set by the court on consent. If your client wishes to seek an adjournment, that is a matter for an application. We are not in a position to consent.
>
> We are available to discuss any of the above by telephone if that would be productive.
>
> Yours truly,

**Why this works:** Addresses each point directly without adopting the aggressive tone. Pushes back firmly on the unfounded allegation (one sentence, no more). Reframes overbroad demands by placing the burden back on opposing counsel to justify them. Closes with an offer to discuss — signalling reasonableness without conceding anything. Note that point-by-point response is right *here* because each of the three points would read as conceded if ignored — it is not the default. Where the other side's letter mixes substantive points with jabs, answer the former and let the latter die in silence (see "Not every point deserves a reply").

---

## Quick Reference Checklist

Before sending correspondence to opposing counsel, confirm:

- [ ] The file reference and context are stated up front
- [ ] The purpose of the letter is clear within the first two sentences
- [ ] Each request has a specific deadline (calendar date)
- [ ] Consequences of non-compliance are stated if applicable
- [ ] Tone is professional regardless of how the other side has behaved
- [ ] Nothing in the letter would embarrass you if read aloud in court
- [ ] The letter does not disclose privileged strategy or client instructions
- [ ] "Without prejudice" is used only if the letter contains a genuine settlement communication
