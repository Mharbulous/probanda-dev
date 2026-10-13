---
name: proof-read
disable-model-invocation: true
description: Use when asked to proofread, review, or improve legal writing (emails, letters, pleadings). Also trigger when a writing sample is pasted without instructions — ask if they'd like proofreading for spelling, grammar, and tone.
---

# Proof-Read

Review writing for errors and suggest improvements in tone, style, and clarity appropriate for professional legal communications.

## Workflow

### Initial Assessment

When the user provides text without explicit instructions:

1. **Evaluate if it's a writing sample** (email, letter, legal document, correspondence)
2. **Check if it appears to be a response to prior correspondence:**
   - Look for phrases like "Re:", "In response to," references to previous communications, or context suggesting it's a reply
   - **ALWAYS request the prior correspondence before proceeding:** "To provide the most helpful feedback, could you share the prior correspondence this is responding to? This will help me ensure your response is appropriate and addresses all necessary points."
   - Wait for the user to provide the context
3. **If unclear what the user wants** (and it's not a response), ask:
   ```
   Would you like me to proofread your writing for spelling, grammar, and tone?
   ```
4. **If it's clearly a standalone writing sample**, proceed with Step 1 below

### Step 1: Initial Grammar and Spelling Review

When the user provides a writing sample:

1. **Identify the text to review:**
   - If an email chain is provided, identify and review ONLY the most recent email (the last message in the chain)
   - For standalone documents, review the entire text

2. **Review for errors:**
   - Grammatical mistakes
   - Spelling errors
   - Punctuation issues
   - Obvious typos

3. **Present findings as a numbered list:**
   ```
   I found the following errors:

   1. [Location/context]: "[error]" → "[correction]"
   2. [Location/context]: "[error]" → "[correction]"
   3. [Location/context]: "[error]" → "[correction]"
   ```

4. **End with the offer:**
   ```
   Would you like me to make these changes for you?
   ```

### Step 2: Apply Corrections (if requested)

If the user agrees to corrections:

1. **Reproduce the corrected text with these formatting rules:**
   - Fix ONLY the grammatical and spelling errors identified
   - Add blank lines between paragraphs for clear separation
   - Do NOT alter content, tone, or style at this stage
   - Do NOT put the text in quotation marks
   - Place a horizontal line above and below the corrected text:

   ```
   ---
   [Corrected text with blank lines between paragraphs]
   ---
   ```

2. **End with the style review offer:**
   ```
   Would you like me to review your writing for style, tone and clarity?
   ```

### Step 3: Style and Tone Review (if requested)

If the user requests style review:

1. **Load the style guidelines:**
   Read `references/trial-lawyer-style.md` to understand appropriate tone for different audiences

2. **Determine the audience:**
   - Client
   - Opposing counsel
   - Witness
   - Court
   - Other

3. **Structure the review:**

   **Opening paragraph:**
   Briefly acknowledge what is working well (e.g., "Your opening clearly states the issue" or "The tone is appropriately professional")

   **Improvement suggestions as bullets:**
   - Tone adjustments for the specific audience
   - Style improvements (passive voice, hedging language, clarity)
   - Boundary-setting language enhancements
   - Removal of weakening phrases
   - Better precision or specificity

4. **Show exact proposed changes in a numbered list:**

   Format each suggestion showing the full sentence with:
   - ~~Strikethrough for deletions/replacements~~
   - **Bold for additions**

   Example:
   ```
   1. ~~I think we should consider moving forward with discovery.~~ We will proceed with discovery by [date].

   2. ~~I'm sorry to bother you, but~~ I need ~~to ask if~~ you ~~could~~ **to** provide the documents by Friday.

   3. While I appreciate your position, ~~it seems like~~ our client ~~feels that they~~ **maintains that the** agreement was breached.
   ```

5. **End with the selective implementation offer:**
   ```
   Would you like me to make all or some of these changes for you? (list the changes you want me to make by number, i.e., '1,3,4')
   ```

### Step 4: Apply Selected Style Changes (if requested)

If the user specifies which changes to implement:

1. **Apply only the numbered changes requested**
2. **Format the final version:**
   - Add blank lines between paragraphs
   - Do NOT use quotation marks
   - Place horizontal lines above and below:

   ```
   ---
   [Final revised text]
   ---
   ```

## Important Guidelines

### Context is Critical

**ALWAYS request prior correspondence when reviewing responses:**
- If the writing sample appears to be replying to previous communication, request the original correspondence before proceeding
- Review both documents together to ensure:
  - All points are addressed appropriately
  - Tone matches the situation
  - Response is strategically sound
  - No important details are missed

### Audience-Appropriate Tone

Always consider who will receive the communication:

- **Clients:** Clear boundaries, realistic expectations, accessible language
- **Opposing counsel:** Professional, firm, courteous
- **Court:** Formal, respectful, precise
- **Witnesses:** Neutral, clear, professional

### Boundary Preservation

When editing for tone and diplomacy:
- NEVER weaken clear boundaries or firm positions
- Remove apologetic language for legitimate positions
- Maintain strength while improving civility
- Balance fairness with advocacy

### Common Improvements

Watch for these common issues in legal correspondence:
- Excessive passive voice
- Over-apologizing
- Hedging language that weakens positions ("I think," "maybe," "if possible")
- Unclear commitments or missing deadlines
- Apologetic tone for professional requests

### Reference Material

For detailed guidance on trial lawyer communication style, consult `references/trial-lawyer-style.md` when performing style reviews.
