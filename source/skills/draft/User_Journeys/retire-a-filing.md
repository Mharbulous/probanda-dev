---
journey: Retire a Writing
kind: ux journey — describes the interaction the practitioner experiences, not the data model. Data-focused journeys use a different format and live in `.claude/skills/drafting-data/User_Journeys/`.
actor: practitioner
trigger: a Writing's work is over — its appeal period ran out, it settled, it was abandoned, or the practitioner simply says it is finished
outcome: the retirement and its reason are recorded, the Writing's open jobs are closed out with it, its research is handed to the matter's case file so it outlives the Writing, the board reads Retired — and consolidation is offered in the next turn without anyone having to remember it
path: happy (with one refusal branch: a job held in progress by another session)
status: aspirational (desired UX — not yet verified against the implementation)
source: design `Engineering/1. Design/2026-09-08_retire-filing-consolidation-currency-design.md` §B (D1–D7)
---

# Retire a Writing

## The journey

1. **Practitioner:** opens `/draft` on a stay-application response filed three months ago, and says the appeal period has run out. The Work Board says **Decided**.

2. **Assistant:** presents the Writing's ready jobs as usual, and last on the widget — after "Something else…", never preselected — a card:

   > **Retire this Writing…**
   > Decided

3. **Practitioner:** picks it.

4. **Assistant:** asks the one thing only the practitioner can settle, why the Writing is being retired, offering the closed set of reasons in plain language and preselecting none — even though the practitioner already mentioned one of them:

   > Why is this Writing being retired?
   >
   > The appeal period ran out · Appeals are exhausted · It was decided and that ends it · It settled · It was abandoned · It was adjourned generally · Something else

5. **Practitioner:** the appeal period ran out. Yes, it was decided — dismissed with costs, on the bench, in August.

6. **Assistant:** the decision was oral and no transcript exists, so the only record of what the court did with the authorities is the practitioner's own memory of it. It asks about each authority the Writing deployed and each opposing authority it answered, four options each and no fifth:

   > On *Przybysz v. Crowe*, what did the court do — followed it, distinguished it, declined to follow it, or did not consider it?

7. **Practitioner:** works through them, and on one says outright that they can't remember.

8. **Assistant:** leaves that one out entirely rather than recording "did not consider it" — a blank is honest, a guess is a false record of what a court did. It takes the court, file number, judge and date of the oral decision, and nothing else: no reasons text, no counsel's notes.

9. **Assistant:** writes the retirement — its date and reason, the decision date, and the supersession of this Writing's own queued jobs — in one write. Then it hands the Writing's research to `/matter-data`: the assertions the Writing argued, the statements of law beneath them, the authorities they rest on, the opposing authorities the Writing answered, and what the court orally did with each. The authority the practitioner dropped weeks ago and the assertion that dead-ended are left out — nobody should inherit rejected research. It reports back what landed, what was held back for verification, and what collided with law already on file, plainly and in full.

10. **Assistant:** re-renders the board alone. Its summary reads **Retired**, and the superseded jobs say so; the Writing's Work Board page is moved to TRASH on the next page write; only live Writings have one. The Writing's other mockups are untouched — frozen as they stood at retirement, which is the point of retiring it.


## The refusal branch

- **Assistant:** on another Writing, the retirement stops before writing anything: a job on this Writing is in progress under another session's lock. It names the job and says the retirement will wait, and it neither takes the job over nor supersedes it. The practitioner finishes that session's work, comes back, and the retirement runs.

## Recovery, weeks later

- **Practitioner:** the other side seeks leave to appeal after all, and the Writing is needed again.

- **Assistant:** finds it in the picker's collapsed **Retired** group and offers recovery rather than a render. Recovery clears only the retirement — the dates, the mockups and the superseded jobs stay exactly as they were, because the work those jobs described belonged to the Writing as it then stood. The Writing is outlined afresh. Nothing is consolidated a second time on the way back in.

- **Assistant:** makes one offer, in one line: the noting-up time recorded at retirement was recorded non-billable, and if the client now gets the benefit of it, the practitioner may want it billable. It performs the flip only on an explicit yes, and never decides that question itself.

## Principles this journey encodes

- **Retirement is an ending, not a pause.** It closes the Writing's jobs and hands its research on. A Writing waiting on the court, the other side, or a decision is simply in progress.
- **The practitioner says when work is over.** The card is never preselected, and the board never tracks an appeal period, since a drafting session looks up no dates.
- **Four words for what a court did, and a blank where memory fails.** The oral-treatment vocabulary is closed, and an unremembered authority is left out rather than filled in. A guess about a court's treatment is a fabrication with a citation attached.
- **Retirement is the one designed flow-back.** The drafting database stays separate from matter-data for as long as a Writing is live; retirement is the single, deliberate moment its research crosses, one way.
- **Rejected research does not travel.** Killed authorities and dead-ended assertions are excluded by the side that knows they were rejected.
- **Remembering is the machine's job; deciding stays the practitioner's.** Consolidation is offered unprompted in the next turn, and every approval downstream of that offer still gets taken.
- **Recovery undoes the retirement and nothing else.** Superseded jobs stay superseded, and the billable flip is offered, never performed.

The Writing's lifecycle states, the dates behind them, and the write and recovery mechanics are `/drafting-data`'s (`.claude/skills/drafting-data/references/filing-checklists.md` §11); this journey describes only what the practitioner experiences.
