---
journey: Tender an exhibit through a witness
actor: practitioner reviewing the Evidence Index or witness-statement mockup; drafting skills when they write a statement of fact
trigger: a document is selected for a Writing's evidence book (VanIAC r. 17(c), (e)) or attached to an affidavit (BCSC), and the mockup is regenerated
outcome: every exhibit is tendered by some witness's statement of fact, or covered by an admission; one that is neither carries 👤 on its own Evidence Index line until it is
preceded_by:
  - Exhibit the best copy of a source document
  - Link facts to evidence (statements of fact)
followed_by:
  - Render and review the mockup
  - Flag evidence that may not be admissible
schema:
  - statements_of_fact (exhibit_id → documents — the document the statement tenders; distinct from its instrument, the affidavit or witness statement it is written in. exhibit_excerpt and exhibit_pinpoint, schema v25 #502, carry the passage and locator into that document, and are what 📑 and 📌 read; the row's own `excerpt`/`pinpoint` stay the testimony pair)
  - admissions (exhibit_id → documents — the document whose authenticity etc. the admitted foundation postulate is about)
  - filing_documents / documents (what enters the evidence book, in citation order)
machinery:
  - drafting skills (set exhibit_id on the statement of fact that tenders the document — never a bare document link on a fact)
  - renderer: Evidence Index "Tendered by" column built from the two exhibit links; 👤 on the line when both are empty (build #333, blocked by schema v3 #328)
work_markers: 👤 no witness — second instance, on the document (admitted by #330, 2026-08-22; work-markers.md §6 edit queued in Engineering/work-markers-gated-edits-2026-08-22.md)
documents: VanIAC Evidence Index (rendered from filing_documents); BCSC affidavit exhibits (Form 32 Part 4 lists the affidavits, the exhibits ride inside them)
source: issue 330 grilling, 2026-08-22 (effort owner's answers)
status: ratified
---

# Tender an exhibit through a witness

## The journey

1. A document proves nothing by itself. It is proved by a witness whose statement of fact tenders it ("attached as Exhibit A is a true copy of the agreement I signed on …"), or by the other side's admission of the foundation fact about it (authenticity, date, business record, genuine signature — which of these a given document needs for a given use is a question of law, answered per document through `/legal-research`, never encoded in the schema).
2. VanIAC r. 17(e) lets a document be "referenced in the written argument" alone, so the evidence book can hold an exhibit that no witness statement mentions. In BC court practice that cannot happen: an exhibit reaches the court only inside an affidavit. The plugin holds the practitioner's model in both forums — an argument-only citation is a to-do, not a permitted shape.
3. When a drafting skill writes the statement of fact that tenders a document, it sets the statement's `exhibit_id`. When an admission covers the document, the `admissions` row for the foundation postulate carries `exhibit_id` too. Foundation facts are ordinary postulates; nothing groups them under the exhibit.
4. The Evidence Index mockup lists, per exhibit, who tenders it — the witnesses (and their instruments) and any admitting party — built from those two links. An exhibit with nobody in that cell renders 👤 on its own line: find the witness who will tender it, or record the admission. Same emoji, same work as 👤 on a fact; different object.
5. The practitioner reviews the Evidence Index before the package goes out. Every 👤 line is either given a tendering witness, covered by an admission, or the document leaves the evidence book.

## Why the data is shaped this way

- The exhibit link sits on the statement of fact, not on the fact and not on the Writing, because the same document may be tendered by one witness and not another, and the practitioner needs to know *who* proves it, not merely *that* it is relevant.
- Two links, not one: `instrument` is the vehicle the statement is sworn or signed in (the affidavit, the witness statement); `exhibit` is the document it proves. An affidavit is the instrument of its deponent's statements and may also be another witness's exhibit.
- Admission mirrors statement: proof = statements ⊕ admissions, and both can tender a document. No document-level admissions table — authenticity is a fact about the document, so it is a fact admission with a pointer.
- 👤 is reused rather than a new emoji because the work is identical (find the person who will prove it) — the way ↩️ 👃 🏷️ attach identically to facts and law. The excerpt and pinpoint markers no longer belong on that list: they split by basis (📜 📍 authority · 📑 📌 exhibit · 💬 🧷 testimony), so an exhibit-backed statement of fact owes 📑 and 📌 on the exhibit's own passage, never 💬.

## What would break if this were deleted

Without the link and the marker, an evidence book ships with exhibits no witness speaks to — the tribunal has a document and no one to say what it is — and the practitioner finds out at the hearing, not on the mockup.
