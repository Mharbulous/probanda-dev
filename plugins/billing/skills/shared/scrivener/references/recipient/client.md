# Wording a letter or email to the client

Read when: the recipient is the firm's own client: the people who have hired the firm and whose interests it represents. The goal is to inform, advise and get clear instructions, without over-explaining or being paternalistic.

**Standing client guidance.** When `purpose` asks to tell the client about their own document-disclosure duty in a BC Supreme Court action, call `knowledge__read` with `matter_root` and the path "draft/CAN/BC/BCSC/Sources/client-guidance-document-disclosure.md". Use its `## Paragraph` word for word, and give it one `sources` entry whose locators are that path and the header's `memo_path`. An error or a `stale` header makes it unusable: return an open item to research it or re-check it (`shared/knowledge-tree.md` section 12).

## Voice and tone

Client emails from this practice are direct, practical and analytical. They read like a smart advisor talking to someone they respect, not a lawyer performing for a file. Key characteristics drawn from practice samples:

- **Informal but professional**: open with "Hi [Name]," not "Dear Mr./Ms. [Surname]".
- **Direct**: lead with the point, not a preamble.
- **Analytical**: show the reasoning when a decision is on the table. Lay out the pros, cons and risks so the client can make an informed choice.
- **Action-oriented**: every email ends with a clear ask or next step.
- **Non-patronizing**: don't re-explain what the client told you. If they flagged something, acknowledge it and move on.
- **Plain language**: no legalese. Explain legal concepts in plain terms when they're unavoidable.
- **Numbered lists for next steps**: when there are several action items, number them so the client can track them.
- **No over-promising**: present options honestly, including risks.

## Structure

1. **Opening.** Acknowledge what triggered the email (their question, a development in the file, something they sent over). Don't write a formal acknowledgment paragraph: fold it into the first line. E.g., "Thanks for sending this over." or "No significant updates to speak of."
2. **Body.** Deliver the substance. Use numbered or bulleted lists for action items, options or next steps. For complex decisions, lay out the full picture: what could go wrong, what the upside is, and what you recommend. Trust the client to weigh the information.
3. **Close.** Ask explicitly for instructions if a decision is needed. End with "Shall I proceed?" or "Do you want me to [X]?" Don't leave the next step ambiguous.
4. **Sign-off.** "Yours truly, [Name]", left out of an email body, which carries no closing and no name (`shared/email.md`).

## What to avoid

- **Don't repeat what the client already knows.** If they sent you the document, don't summarize the document back to them: they wrote it.
- **Don't make decisions unilaterally.** Present options with their tradeoffs and ask for instructions.
- **Don't be vague about risks.** If there's a downside, say it plainly: "The risk here is that this might cause them to stop making the $10,000 monthly payments."
- **Don't add unnecessary pleasantries.** Skip "I hope this email finds you well."
- **Don't use formal salutations with long-standing clients.** "Hi Glen" beats "Dear Mr. Ashby."
- Don't sound AI-generated. See `../style-examples/ai-to-lawyer-style.md` for the tells and before/after examples.

## Examples

These are patterns to adapt, not fixed text.

### Presenting next steps after a development

> Hi Glen,
>
> Next steps:
> 1. It's been 21 days since we served the Notice of Civil Claim, so you can now apply for default judgment. It takes about a week for the court to process the application, and if the court processes the application before the Defendants file their response, then you would get default judgment. At the very least, it forces the Defendants to file their reply and move the case forward faster.
> 2. Optionally, we can also apply for a garnishing order against the bank where the Defendants bank, rather than where its subsidiaries bank. The element of surprise will be gone, so they might have moved their money or paid off debts to reduce the amount of cash in their bank.
> 3. List documents (already started preparing).
>
> Possible next steps:
> 4. Apply for summary judgment, or summary trial (depending on how the Defendants respond). There are some hints that they might bring a counterclaim against you, if only for tactical reasons and to cause delay.
>
> Yours truly,
> [Lawyer Name]

### Explaining a nuanced decision with tradeoffs

> Hi Glen,
>
> No significant updates to speak of. Really, it is a question of whether you want to apply for a pre-judgment garnishment order at the risk of jeopardizing the ongoing $10,000 payment that they seem to be continuing to make.
>
> [Explanation of the legal and strategic considerations]
>
> However, the first step is for you to decide whether to instruct me to proceed, given the risk that this might cause them to stop making the $10,000 monthly payments, and that if they get the garnishing order set aside, you might be ordered to pay them some legal costs.
>
> Shall I proceed toward making a garnishment application?
>
> Yours truly,
> [Lawyer Name]

### Responding to a client forwarding a non-party's request

> Hi Glen,
>
> Thanks for sending this over. [Brief summary of what you're doing in response and the relevant figures.]
>
> [Key information, in plain numbered or bulleted form if multiple items.]
>
> Do you want me to respond to [non-party] directly on your behalf?
>
> Yours truly,
> [Lawyer Name]

## Formatting notes

- Use plain `-` bullets, not `*`.
- Dollar amounts use `$` with commas: `$10,000`, not "ten thousand dollars".
- Numbered lists for sequential steps or multiple options.
- Keep paragraphs short: one idea per paragraph.
- No bold headers within the email body unless it's a long email with several distinct topics.
