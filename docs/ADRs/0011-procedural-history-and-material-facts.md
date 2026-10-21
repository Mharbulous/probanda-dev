---
status: accepted
---

# A procedural fact carries the date of its step, and the Provable Facts page splits into Procedural History and Material Facts

The Provable Facts view page mixed two kinds of fact: procedural ones (a filing, a service and its method, an order made, correspondence about a procedural matter) and material ones (the facts that speak to the merits of a claim or defence). The practitioner wants them on separate pages (2026-10-20), and every procedural fact has a date, which is why its page is a history. The drafting database's `facts` table held neither a kind nor a date.

- **`facts.procedural_on`** (drafting schema v77): the `YYYY-MM-DD` date the procedural step happened, NULL on a material fact. One column holds both the kind and the date, so a procedural fact cannot be stored without its date.
- **The session sorts each fact by inference** from the fact and its source when it records it, and the practitioner corrects a mistake through `/drafting-data` by setting or clearing the date. On request, the session sorts a board's existing facts the same way.
- **Two view pages, one reader.** Procedural History lists the facts with a date, in date order, each with its date. Material Facts, the renamed Provable Facts, lists the rest in the order the Writing states them. Both show how each fact will be proven exactly as Provable Facts did: on the court record, admitted by every opposing party, or by a statement of fact with its instrument, exhibit and any recorded inadmissibility.
- **Every existing fact migrates to Material Facts**, because none has a date. No fact is dropped, and the copy-aside backup is taken before the hop.
- **The date is a step that happened, never a deadline.** Nothing computes from it, and no deadline tool reads it.

## The ruling on Exception 2

drafting-data is a legacy store under Exception 2 of COMMANDMENTS.md, which bars a revision that deepens the Development Plugin's reliance on it, and ADRs 0006, 0009 and 0010 turned down new DDL in legacy stores for that reason. A column marking a fact procedural is a column for one kind of fact. Brahm ruled expressly in the conversation of 2026-10-20 that this one column is allowed. It adds to the work of converting drafting-data out of Exception 2.

## Considered options

- **The date as a prefix of the fact's text**: no schema change, but the prefix would print wherever the fact prints, including the filing itself, unless every renderer stripped it, and a mistyped date would silently file the fact as material.
- **A separate procedural history table**: a clean split, but it duplicates the facts, their sources and their proof links.
- **Draw the page from the matter's `ProceduralHistory.md`**: cheap, but that log records no proof method, so the requirement is not met. It stays the matter's own log, separate from this page.
- **Add information and belief and viva voce as proof methods**: neither is modelled today. Brahm chose to keep the current proof tracking in this change.
- **Wait until drafting-data is converted out of Exception 2**: no change now.

## Consequences

- Existing matters' procedural facts sit on Material Facts until a session sorts them, on the practitioner's request or as it records facts.
- An old `Provable Facts - Job Board <id>.html` is moved to the matter's `TRASH` by the next page write, and the html-pages gate still refuses it until then.
- A database held below v77 reads every fact as material.
