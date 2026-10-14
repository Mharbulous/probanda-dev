# Filtering Edge Cases and Examples (legacy Westlaw pipe-text format only)

**Scope:** these heuristics apply only to the legacy pipe-delimited plain-text
Westlaw fallback (see `westlaw-playbook.md`). The current OPC format carries
explicit `Question` / `Follow-up question` markers, so no heuristic filtering
is needed there. Alexi memos need none either — the question is the `Issue`/
`Question` section by structure.

This document provides concrete examples of how the filtering logic distinguishes questions from answer headings.

## True Questions (Should Extract)

### Example 1: Multi-line Question
```
| 1\. If smoke from an adjacent strata is leaking into another strata, |
| how bad does it have to be to get an urgent temporary injunction?     |
```
**Extracted as:** "If smoke from an adjacent strata is leaking into another strata, how bad does it have to be to get an urgent temporary injunction?"

### Example 2: Simple Question
```
| 3\. When a complaint is submitted to the strata, what are the |
| procedural requirements before imposing a fine on a unit owner? |
```
**Extracted as:** "When a complaint is submitted to the strata, what are the procedural requirements before imposing a fine on a unit owner?"

### Example 3: Question with Technical Terms
```
| 5\. Under what circumstances can a strata corporation obtain an |
| injunction for breach of bylaws or rules? |
```
**Extracted as:** "Under what circumstances can a strata corporation obtain an injunction for breach of bylaws or rules?"

## Answer Headings (Should Filter Out)

### Example 1: Heading with Colon
```
| 2\. Procedural Requirements: Before imposing a fine, the strata |
| corporation must follow specific steps... |
```
**Filtered because:** Contains heading keyword "Procedural Requirements" before colon

### Example 2: Section Heading
```
| 1\. Authorization: |
```
**Filtered because:** Ends with colon (section heading style)

### Example 3: Case Law Section
```
| 4\. Case Law: British Columbia courts have consistently held... |
```
**Filtered because:** Contains heading keyword "Case Law" before colon

### Example 4: Citation-Heavy Text
```
| 2\. The test was established in *Smith v. Jones*, 2020 BCSC 123 [link](#) |
| and followed in *Brown v. Green*, 2021 BCCA 456 [link](#)... |
```
**Filtered because:** Multiple citation markers `](()` indicate answer text

### Example 5: Too Short
```
| 7\. Yes |
```
**Filtered because:** Length < 30 characters

## Boundary Cases

### Case 1: Question with Colon (Still Extracted)
```
| 2\. What is the legal test for obtaining an injunction: is it different |
| for strata disputes than other civil matters? |
```
**Extracted because:** Text before colon is >100 chars AND doesn't contain heading keywords

### Case 2: Answer Starting Text
```
| 2\. To obtain an injunction, the applicant must demonstrate... |
```
**Filtered because:** Starts with answer indicator "To " (captured during extraction phase)

### Case 3: Complex Multi-line with No Colon
```
| 6\. If a strata owner fails to comply with a significant bylaw |
| requiring remediation of a hazardous condition, what remedies |
| are available to the strata corporation beyond fines? |
```
**Extracted because:** No colon, no heading keywords, substantial length, ends with question mark

## Pattern Recognition

### Question Indicators
- Ends with `?`
- Uses interrogative words: "what", "when", "how", "if", "under what circumstances"
- Spans multiple lines
- No heading-style formatting

### Answer Heading Indicators
- Contains `:` with short text (<100 chars) before it
- Heading keywords present: "Requirements", "Case Law", "Authorization", "Duty of", etc.
- Ends with `:` alone
- Citation-heavy (multiple `](()` or `..]()`)
- Very short (<30 chars)
- Starts with definite answer words: "To ", "Under ", "Yes", "The "

## Validation Checks

### Check 1: No Duplicate Numbers
Within each memo, each question number should appear exactly once.

❌ **Invalid:**
```
1. Question one...
1. Question one duplicate... [should be filtered]
2. Question two...
```

✓ **Valid:**
```
1. Question one...
2. Question two...
3. Question three...
```

### Check 2: Reasonable Count
Expected range: 1-6 questions per memo (varies by complexity).

### Check 3: Text Accuracy
Spot-checked questions must match exactly (character-for-character) with source text.
