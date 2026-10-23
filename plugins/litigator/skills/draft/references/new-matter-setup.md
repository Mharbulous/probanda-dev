Read when: session entry reports no proceeding, or the practitioner asks to start a proceeding or Writing, or names a document type or an incoming document to answer, or asks for a new Job Board for work that is not a Writing (SKILL.md section 8).
Assumes SKILL.md is loaded. Rules are not restated here. "Save first" stays in SKILL.md section 8, which also points to the counsel-of-record rules.

## Section 8: New matter setup

**Proceeding**, elicited once and reused forever by every later Writing: the forum, the registry or arbitration centre and file details, every party with its role in that forum's own vocabulary. Before asking, consult `/matter-data` and the practice matter lookup and offer what the matter already holds for the practitioner to confirm or correct. Confirming borrowed data is an accuracy check, not an approval checkpoint. Each party is linked to its `/matter-data` party when it is recorded.

**Before the forum is chosen** (ADR 0018), the proceeding is created with the matter reference alone and no forum, and its work, starting with choosing the forum, is outlined as jobs on its own board. The forum, registry and file details and every party are gathered when the forum is chosen, by updating that same proceeding. Pursuing a second forum means a new proceeding, whose work is outlined fresh. No job moves between proceedings.

**Document type:** ask or infer which document type, from this skill's knowledge tree (the lookup below). A venue's type must match the proceeding's forum. A type that needs forum parts needs a forum: `/drafting-data`'s creation write refuses one on a proceeding with no forum, while a type that needs none may sit on any proceeding.

**Venue and kind lookup.** The venue and the document type are looked up in this skill's knowledge tree whenever either is chosen, and whenever a drafting step needs what the venue requires. The tree's folder grammar, index files, resolve rules and learned-file notice are `shared/knowledge-tree.md`, not restated here.

1. **Venue test.** Apply that file's venue test to the recipient. A forum is a venue, and a Writing addressed to a forum is that venue's kind. Any other recipient is `_NoVenue`, under the jurisdiction whose conduct rules govern the writer for the matter, which this session passes and never infers. **A client recipient never enters the lookup and never calls `/localize`:** a client letter is drafted from `references/letters.md` "Client letters" as a file card, with no Writing, attached to one Job Board by its folder, and held for counsel's review in its own draft folder before a send copy exists.

Before step 2, read `references/venue-and-kind-lookup.md`, which holds steps 2 to 6: resolving the venue and then the kind, reading what resolved, an ambiguous result, a miss, and no fallback.

Two things happen before eliciting:

1. **Recovery check first.** Ask the gatekeeper whether a retired Writing in this proceeding would be duplicated (same kind, same round, same subkind). A hit is offered, never applied: a decision form, `Recover <title> (retired <date>, <reason>)` beside `Start new`, nothing preselected, both options also stated in prose. On recover, perform the recovery write and go to render (section 11). No new Writing is created and the recovered substance is untouched.
2. **The response seam** (ADR 0024 D12). The other side's delivered materials, and the forum's, are documents in `/matter-data`, never our Writings. The seam is entered when the practitioner names the answering kind, or names an incoming document as the thing to answer, by its title or its `/matter-data` source. Where the incoming document has a named answer, offer that kind by name for the practitioner to confirm:

   | Incoming | Answering kind |
   |---|---|
   | A letter from opposing counsel | Letter to opposing counsel |
   | A registry request | That venue's `letter` kind (`references/letters.md`, "Responding to a Registry Request") |

   A kind whose type file names the incoming document it answers is offered the same way, and its type file says what to capture before responding. Any other incoming document gets no offer: the practitioner names the type as for any Writing. The offer creates nothing. The answering Writing is created only by the save above, on the practitioner's confirmation, never because an incoming document exists. A date the incoming document sets is recorded through `lawyer:docket-clerk`. If the practitioner states it anyway, `shared/deadline-isolation.md` "If the practitioner states a deadline anyway" governs.

**A Job Board with no Writing.** When the practitioner asks for a new Job Board for work that is not a Writing (finding a paper original, stamping it, re-scanning it), on a proceeding that has a Writing, open it through `/drafting-data`'s Job Board creation write, with the practitioner's own words as its title. Never create a Writing for it, of any kind, and run no document type lookup and no recovery check. Render it by its id with `draft_dir` (section 11), present its Job Board page as a file card (`shared/present-files.md`), then outline the work on that board. On a proceeding with no Writing no such board is opened: the work goes on the proceeding's own board.

**Exit.** Fast-open what was created (section 7). An outlining interview that led here resumes in place of the Opening, answers carried.
