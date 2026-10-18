---
description: Use only when the user explicitly invokes /rule-remodel in a Claude Code session in the probanda-dev repo. Remodels a shipped docket-clerk rule file (bcsc-rules.md, bcca-rules.md, bc-arbitration-rules.md, limitation-rules.md or reckoning.md) for an amending regulation from its primary text, bumps rule-freshness.json in the same commit, and stops for the practitioner's review of the diff before committing.
---

# Rule remodel

Maintainer-only: this command lives in `.claude/commands/`, so no plugin ships it. It brings a shipped rule file in this repo (`.claude/skills/shared/docket-clerk/references/`) up to an amending regulation, so a plugin release replaces the firm overlay records that `/lawyer:rule-update` wrote. After the release, `rule-update.md` §2 reconciliation marks each matching overlay record `superseded_by_shipped` on its next resolution. Repo sessions only: a Cowork session never edits these files.

## Before starting

1. **Live issue.** Remodelling a rule is legal work. Ask once: the named matter and live issue it serves, or express authorization of unbilled firm work. Never write the matter into a shipped file, because `python scripts/check_plugin.py` scans for matter codes.
2. **Competing work.** Grep this repo's `docs/` for the amending regulation's number, and read any plan that schedules the same remodel, such as the deadline engine's phase 3. Put any clash to the practitioner before editing.
3. **The instrument.** Take the regulation number, OIC number, commencement date and sections from the instrument itself, or from the `pending_changes[]` entry in `rule-freshness.json`.

## The remodel

1. **Primary text.**
   - If the firm has verified overlay records for this regulation, read them with `practice_data__rule_overlay` filtered by the amending reg, or take them pasted. They show what was approved, but the shipped file is modelled from the instrument's own text.
   - Fetch the instrument with `sources__fetch` (`save: true` for a PDF).
   - Extract each page's text and render each page as an image with pymupdf into the scratchpad. View the images: a bclaws OIC's text layer is OCR, and it misreads paragraph letters and can misread digits.
   - A subrule amended by striking out and substituting words is the pre-amendment consolidation text with the substitution applied. Quote both.
2. **Copy first.** Peer sessions share this checkout and commit by path, and an uncommitted rule-file edit has been committed by another session before its review. Copy the rule file and `rule-freshness.json` into the scratchpad, edit the copies, and copy them back only to commit. Edit by exact byte replacement in a script file, never `sed -i`, which can rewrite a file's line endings, and never a heredoc, which breaks on apostrophes.
3. **Rows.**
   - Keep every superseded row, and end its Description with `In force to <day before commencement>.` (`rule-update.md` §4).
   - Add each new row with `In force from <commencement>.`, carrying the verbatim words it models.
   - A repealed rule with no successor keeps its row, marked repealed and in force to the day before.
   - Add a new anchor type to the routing table in `source/lawyer/agents/docket-clerk.md`, and a new cross-anchor deadline to that file's Cascade note, in the same commit.
   - List every amended subrule that no row models under "may need new modelling", so `sections: []` hides nothing.
4. **Open questions.** Carry every construction question as an open question: the Interpretation Act s.25.2(3) added day (#740, `reckoning.md`), new wording such as "2 business days before", and the transition question for a period running across the commencement date. Never resolve one. Which side of an open question the stored date takes is the practitioner's decision; record it as theirs.
5. **`rule-freshness.json`.**
   - Set `last_amending_reg` and `last_amended_date` to the regulation, and `pit_watermark` to its commencement date.
   - Fetch the live consolidation and its Point-in-Time table. Move `currency_date` to the live consolidation's date only if the PIT table shows no change after the old watermark.
   - Set the pending entry's `sections` to `[]` and keep its `forms`.
   - Append a `_note` naming the source, its hash and what was checked.
   - Parse the JSON.
6. **Review.** Brief a `reviewer` agent with the diff, the page images and the conventions above, and ask for every finding with its severity. Fix what it finds.

## Stop, then ship

1. **Stop.** Show the practitioner the rule-file diff and the JSON diff, and wait for approval. Do not commit before it.
2. **Commit.**
   - In this repo, `git pull --ff-only`, then confirm the base files are unchanged.
   - Copy the edited files in, read their hunks, and commit the rule file, `rule-freshness.json` and any `docket-clerk.md` change together by pathspec. Push.
3. **Check and release.** Run `python scripts/check_plugin.py`, then `/release`.
4. **Close.** Mark the practice-data to-do for the change completed, naming the commit.
