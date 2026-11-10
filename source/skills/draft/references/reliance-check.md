# Reliance check

Read when: the scrivener returns text whose `sources` hold an entry with a `fact_id`, or the practitioner asks to verify the facts a draft relies on. This file is the one source for the check.

A case-data fact can read right on its own and still distort its source once a sentence uses it. So each case-data fact a paragraph relies on is checked against its source's own words, with the paragraph as context, by an agent isolated from the drafter and the extractor. The check answers two questions per fact: (i) is the stored fact a faithful extraction, and (ii) does the paragraph use it faithfully. Answer (i) is saved once; answer (ii) is asked on every new use and never saved. Only case-data facts are checked: dictation and the practitioner's own knowledge are not. It runs before `references/source-trace.md`'s review, which it does not replace.

## 1. Entries

1. Split the text into paragraphs at blank lines. Each `sources` entry with a `fact_id` belongs to the paragraph that holds its `clause`. A paragraph with no such entry needs no check.
2. Read the facts as stored through `/matter-data` reliance-verify, Step 1. A fact it does not return is not checked: say so in one line.
3. **Manual trigger.** When the practitioner supplies a paragraph and its `sources` block, use them as given and start at step 2.

## 2. Excerpts, never whole sources

For each locator an entry cites (`<file_path>#<locator>`, `/matter-data`'s conventions §6), copy the source's words verbatim: the passage at the locator as `passage`, and one passage on each side as `before` and `after`.

- `para. N` or `para. N(a)`: that paragraph, between paragraphs N-1 and N+1.
- `pN`: that page, between pages N-1 and N+1. Read a PDF by its pages, never whole.
- `pP-La-Lb`: those lines, between the same number of lines before and after.
- `¶N`: from a fresh rendering by `/matter-data`'s `render_document.py`, between ¶N-1 and ¶N+1.
- `hdr`: the header block, with ¶1 after it.

A locator that is NULL or not found gets no excerpt. An entry left with no excerpt is not dispatched: say in one line that it could not be checked.

**Group shared passages.** Entries of one paragraph whose passages are in the same source and overlap or touch go to one verifier together. Every other entry goes alone.

## 3. Dispatch

Spawn the `litigator:source-tracer` agent once per entry or group, always as that named agent and never as a fork: a fork would carry the drafting session's reasoning. Start it with `model: sonnet` and `effort: high`. Its prompt opens with the same prefix for every dispatch of one paragraph, and ends with its own entries:

```
mode: reliance
paragraph:
<the paragraph, verbatim>
entries:
[{"fact_id": ..., "clause": "...", "stored": {...}, "check_extraction": true, "excerpts": [{"locator": "...", "before": "...", "passage": "...", "after": "..."}]}]
```

`stored` and `check_extraction` come from step 1.2. Start the first dispatch of each paragraph, then, once it returns, the rest in one message, so they read the shared prefix from cache.

**One re-check.** When a result's `extraction` is not `confirmed`, or its `confidence` is `low`, spawn the agent once more, fresh, with the same prompt and without `model` or `effort` (its own Opus). It never sees the first result. Its result replaces the first.

## 4. Use the answers

- **Answer (i).** Pass every non-null `extraction` to `/matter-data` reliance-verify, Steps 2 and 3, which writes it.
- **Answer (ii).** Never written, never a job. A `distorts` or `unsupported` use does not hold the paragraph back. Present the paragraph and, beside it in the same turn, one line per finding quoting the clause and the passage. A fix is the scrivener's revision, given the finding as its `instruction` (`references/letters.md` section 5), and a revised paragraph is checked again.
- **A corrected fact.** Say in one line that the stored fact was corrected and that the paragraph relied on its old form.
- Speak of the check in plain words ("I checked each fact this paragraph relies on against its source"), never by an agent's, model's or tool's name (`shared/internals-confidentiality.md`).
