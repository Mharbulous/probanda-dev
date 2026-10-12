---
name: ingest
description: >
  Use when asked to ingest, import, or add a litigation document into the case database —
  affidavits, pleadings, transcripts, exhibits, correspondence, or case law.
  Matches: "ingest [path]", "add this to the file", "import this document."
---

<!-- probanda v0.1.2 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: it means the directory containing this SKILL.md, not a placeholder to search for or guess. Read references and shared files natively from there, never over the litigation data server's skill-source tool and never by requesting folder access; scripts and templates the text declares are executed and read from there too. If `${CLAUDE_SKILL_DIR}` itself no longer exists, the plugin was re-synced mid-session: list only `${CLAUDE_SKILL_DIR}/../../..` (the folder that held this plugin's folder), take the folder named as this plugin's folder with any `~g<N>` suffix removed plus the highest `~g<N>`, and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, stages, authors or requests a screenshot of one, but may present one to a human user to view, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

# Ingest

Thin routing skill — delegates immediately to the `case-data` gatekeeper.

This skill deliberately carries no `disable-model-invocation` line: `/legal-research`'s flow
opens it through the Skill tool, which refuses a skill carrying that line. It is a stated
exception, like the gatekeepers. Do not add the line back.

Do not extract, summarize, or present facts here — that is `litigation-fact-extractor`'s job.

A BC Court of Appeal application/response book, or a book of authorities, is one PDF holding several distinct documents behind a set of bookmarks. `case-data` splits it by those bookmarks and reports the parts it does not ingest (reasons for judgment, the order, argument, the book's own authorities listing) rather than force-fitting the whole file through one path.

Do not intentionally run ingestions into the same matter in parallel; queue them and let each handoff finish before starting the next.

## Procedure

1. **Court decisions only — citation preflight.** Before delegating, check whether
   the authority is already held: `shared/research-priority.md` tier 1 (the
   matter's ingested layer) and tier 2 (the shared pooled layer, where this
   runtime can reach it — that file says how, and what to do when it cannot). A
   tier-2 hit carries principles, criteria, and authorities someone already
   derived: surface them for reuse and say so, rather than re-deriving from
   scratch. It does not cancel the ingest — the matter still needs its local copy —
   but it changes what the ingest has to work out for itself. Skip this step
   entirely for affidavits, pleadings, transcripts, exhibits, and correspondence:
   the pool holds no matter documents. **For a book of authorities**, the
   preflight list is the book's own bookmark titles — run the same tier-1/tier-2
   check per citation, rather than treating the book as one undivided authority.
2. Pass the document path — or, for a folder or a batch of documents, the folder path and the fact that this is a scan — and any matter context to `case-data`.
   **Court decisions also take an optional issue focus** — a narrower legal issue (e.g. competence-competence, attornment to court jurisdiction) that limits which concepts get criteria. Use the one the caller or the practitioner's request supplies. When the practitioner invoked `/ingest` directly and named none, ask once: "Any specific legal issues to focus on when ingesting this decision? If not, I'll extract all relevant principles." For a batch of more than ~5 files, ask it in the same single confirmation as the file list. A skipped question means full scope. When a focus was given, the final report names the concepts stored without criteria, so the practitioner sees what was scoped out.
3. `case-data` routes internally — a single document in hand and a folder scan are different rows of its routing table, so state which this is and let the router pick the operation. Never pre-empt that routing, write your own SQL, or diff a folder against the database by hand.
4. **Court orders take one extra leg.** An order's operative terms can change rows the file already holds — the style of cause, the trial date, the party roster, counsel of record — so after the document is ingested, `case-data` runs an order-effects pass that proposes those changes and applies only what the practitioner approves. Expect a proposed-changes table on an order, and nothing at all when the order changes no stored field.
5. **A second version of a court document already held is proposed as a supersession.** An unsigned draft, a signed copy and the filed copy of one document are one document. `case-data` shows both copies, proposes which to keep as the source of record and why, and asks one question: keep the proposed copy, keep the other copy, or they are different documents. Nothing is written before the answer. The kept copy takes the other's facts and links, and the other file moves to `0. DRAFT\Superseded`.
6. **Correspondence from the forum that sets a date takes a shorter leg.** `case-data` reports the date it found and recommends recording it as an anchor through `probanda:docket-clerk`, citing the document. Nothing is recorded during the ingest, and no deadline is worked out (ADR 0024 D12).
