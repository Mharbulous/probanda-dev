---
name: litigation-fact-extractor
disable-model-invocation: true
description: Use when asked to analyze, summarize, or present extracted facts from litigation documents for review — not for database ingestion (use the ingest skill instead). Always cites sources in bracketed references.
---

## Contents

| Section | Read when |
|---|---|
| Context Isolation | More than one document is to be analyzed |
| Core Principles | Always: citation format, multiple sources, document identification |
| Extraction Approach | Organizing facts, setting detail level, or handling contradictions |
| Document Types and Special Considerations | Extracting from a pleading, affidavit, transcript, discovery response, expert report, motion, contract or correspondence |
| Quality Standards | Always: accuracy, completeness and objectivity |
| Example Output Format | Shaping the user-facing output |
| Special Instructions | A document lacks page numbers, or exhibits or multi-page facts are cited |

# Litigation Fact Extractor

Extract and organize information from litigation documents with proper citations for trial preparation and case analysis. This skill presents facts to the user; it does not write to any database.

## Context Isolation

When analyzing more than one document, spawn one read-only Sonnet subagent per document using the prompt in `agents/extract.md`. Each subagent reads its assigned file and returns the full cited extraction. The main agent assembles the user-facing output from the subagent returns. For a single document, inline reading is acceptable.

## Core Principles

### Citation Format

**CRITICAL**: Every paragraph containing extracted information MUST end with a bracketed citation identifying the source document.

Citation format: `[Source: Document Name, Page X]` or `[Source: Document Name, ¶X]` for paragraph-numbered documents.

Examples:
- `[Source: Smith Affidavit, Page 3]`
- `[Source: Defendant's Answer, ¶12]`
- `[Source: Plaintiff's Motion for Summary Judgment, Page 8]`
- `[Source: Deposition of Jane Doe, 45:12-23]` (for deposition transcripts with page:line format)

### When Multiple Documents Support the Same Fact

If a fact appears in multiple documents, cite all sources: `[Sources: Smith Affidavit, Page 3; Jones Deposition, 67:4-8]`

### Document Identification

When beginning analysis, first identify all documents being analyzed. List them with their full names for reference throughout the extraction.

## Extraction Approach

### Systematic Organization

Organize extracted information logically based on the user's needs:

**By topic or issue** - Group related facts together across documents
**By document** - Extract systematically from each document
**By chronology** - Arrange facts in timeline order
**By party** - Organize facts by witness or party making statements
**By element** - Structure facts according to legal elements that must be proven

### Level of Detail

Match the level of detail to the user's request:

**High-level summary** - Main points only with citations
**Detailed extraction** - Comprehensive facts with full citations
**Targeted extraction** - Focus on specific issues, claims, or defenses

### Handling Contradictions

When documents contain contradictory information:
1. Present both versions
2. Cite each source
3. Note the contradiction explicitly
4. Do not resolve contradictions unless asked

Example:
> The incident occurred at 3:00 PM according to the plaintiff. [Source: Plaintiff's Complaint, ¶8] However, the defendant states it occurred at 5:00 PM. [Source: Defendant's Answer, ¶8]

## Document Types and Special Considerations

### Pleadings (Complaints, Answers, Counterclaims)

- Extract allegations, admissions, and denials
- Note which facts are disputed vs. admitted
- Identify affirmative defenses
- Track causes of action and legal theories

### Affidavits and Declarations

- Extract factual statements
- Note declarant's relationship to case
- Identify personal knowledge vs. hearsay
- Track dates and timelines

### Deposition Transcripts

- Use page:line citations (e.g., 45:12-18)
- Extract key testimony
- Note objections and their bases
- Identify impeachment material
- Track inconsistencies with other testimony

### Discovery Responses

- Extract substantive information from answers
- Note objections
- Identify document references
- Track what was produced vs. withheld

### Expert Reports

- Extract opinions and bases
- Identify methodologies
- Note qualifications
- Track assumptions and limitations

### Motions and Briefs

- Extract factual assertions
- Identify legal arguments
- Note evidence cited
- Track procedural history

### Contracts and Agreements

- Extract key terms and obligations
- Note effective dates and deadlines
- Identify parties' responsibilities
- Track conditions and contingencies

### Correspondence

- Extract factual assertions or admissions
- Note dates and parties
- Identify agreements or disputes
- Track settlement discussions (if applicable)

## Quality Standards

### Accuracy

- Quote sparingly and only when precise language matters
- Paraphrase accurately without changing meaning
- Preserve nuance and qualifications (e.g., "approximately," "believed to be")
- Do not infer facts not stated in documents

### Completeness

- Extract all relevant information unless limited scope requested
- Include context needed to understand facts
- Note when information is incomplete or unclear

### Objectivity

- Present facts neutrally without advocacy
- Do not characterize facts as "strong" or "weak"
- Avoid legal conclusions unless specifically requested
- Let the facts speak for themselves

## Example Output Format

### Organized by Topic

**Accident Details**

The collision occurred on January 15, 2024, at approximately 2:30 PM at the intersection of Main Street and Oak Avenue. [Source: Police Report, Page 2] The weather was clear and dry at the time. [Source: Smith Affidavit, ¶4]

**Injuries Claimed**

Plaintiff sustained a fractured left wrist and soft tissue injuries to the neck and back. [Source: Complaint, ¶18] Medical treatment began the same day at Memorial Hospital. [Source: Medical Records, Page 1]

### Document-by-Document

**Smith Affidavit (dated March 1, 2024)**

Smith is a witness who was standing on the northeast corner of the intersection when the accident occurred. [Source: Smith Affidavit, ¶1-2] He observed the defendant's vehicle traveling at high speed through a red light. [Source: Smith Affidavit, ¶6] He immediately called 911. [Source: Smith Affidavit, ¶8]

**Jones Deposition (taken April 15, 2024)**

Jones testified that she did not see the defendant's vehicle before the collision. [Source: Jones Deposition, 34:12-15] She was looking down at her phone when the impact occurred. [Source: Jones Deposition, 34:18-22]

## Special Instructions

- If a document lacks page numbers, use paragraph numbers or section identifiers
- If no numbering exists, describe location (e.g., "second full paragraph")
- Always verify document names match what user provided or uploaded
- When referencing exhibits, identify both the exhibit letter/number and document name
- For multi-page facts, cite all relevant pages: `[Source: Contract, Pages 4-7]`
