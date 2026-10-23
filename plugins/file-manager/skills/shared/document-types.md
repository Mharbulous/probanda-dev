# Document types

Shared doctrine. It is not a skill: it has no `SKILL.md` and is never wrapped. It is the one list of the kinds of document a matter holds. Each type is one thing, so a practitioner can say where they keep it. Where a given practitioner keeps each type is their own folder map, not this file. No skill assumes a folder from a type's name.

A type's name may be shown to the practitioner. Its id is for skills and tools only.

## Flags

- `never_ingest`: nothing of this type is ingested into case data, by a scan, a coverage check or `/ingest`.
- `privileged_by_default`: a file of this type takes the privileged path at ingest with no question asked.
- `authority`: a file of this type is read as a legal authority, through the bulk classification cascade.

A type with no flag is ingested by the ordinary routing read.

## Types

| Id | Name | Definition | Flags |
|---|---|---|---|
| `correspondence_opposing_counsel` | Correspondence with opposing lawyers | Letters and emails between the firm and a lawyer acting for another party | |
| `correspondence_unrepresented_party` | Correspondence with unrepresented parties | Letters and emails between the firm and a party who has no lawyer | |
| `correspondence_witness` | Correspondence with witnesses | Letters and emails between the firm and a lay witness | |
| `correspondence_expert` | Correspondence with experts | Letters and emails between the firm and an expert retained or approached on the matter | |
| `correspondence_court` | Correspondence with the court or registry | Letters and emails between the firm and a court, tribunal or registry that are not themselves filed | |
| `correspondence_non_party` | Correspondence with non-parties | Letters and emails between the firm and anyone else outside the firm: insurers, public bodies, records holders | |
| `client_communications` | Client communications | Letters, emails, notes and documents passing between the firm and its client | `privileged_by_default` |
| `retainer_and_billing` | Retainer and billing | The retainer agreement, accounts, trust records and billing correspondence with the client | `privileged_by_default` |
| `court_filings` | Court filings | Documents filed in or issued by a court or tribunal in a proceeding, with the orders and reasons made in it | |
| `documents_exchanged` | Documents exchanged in the proceeding | Lists of documents, productions, and transcripts of examinations exchanged between the parties | |
| `searches` | Searches | The lawyer's own searches and records requests: court, corporate, land title, property assessment | |
| `work_product` | Lawyer's work product | Memos, notes, chronologies, summaries and calculations the lawyer prepares for their own use | |
| `authorities` | Legal authorities and research | Decisions, statutes, regulations, treatise extracts and research memos about the law | `authority` |
| `trial_materials` | Trial materials | The trial brief and the documents assembled for a trial or hearing | |
| `disbursement_records` | Disbursement records | Invoices and receipts for costs paid on the matter | |
| `drafts` | Drafts | Unfinished versions of the firm's own documents, and earlier versions kept after a later one replaced them | `never_ingest` |
| `raw_intake` | Raw or unsorted intake | Files received or scanned and not yet sorted, and working copies | `never_ingest` |

## A new type

A practitioner who keeps a kind of document that fits none of these types proposes a new one through `/suggestion`. Until a new type ships, the nearest type above serves, or the folder stays unmapped.
