Read when: session entry returns parties_drift rows, counsel_offers or migration_refused, or setup is about to ask for a party's counsel or address for service (SKILL.md section 8).
Assumes SKILL.md is loaded. Rules are not restated here.

## Section 8: Counsel of record and counsel offers

**Counsel of record and each party's address for service are not elicited once.** They are court-record state that `/case-data` owns and keeps current as notices and orders are filed, so every drafting render reads them live from case data and session entry returns `parties_drift`: every party not linked to its `/case-data` party, linked to one not of record in the proceeding, or not read (`parties_drift_note` says why). Present the rows at session entry, after the fast open and before the Opening, one question per row, and the practitioner confirms each:

- **Case data is right:** link the party to its `/case-data` party through `/drafting-data` (its filing checklist's confirm write).
- **The practitioner says case data is wrong:** write the correction to case data through `/case-data`'s own gate first, then link as above.

Withdrawn counsel is stored as no value, never an empty string. The mockup marks each drifted party for the practitioner and the filed render refuses while any stands. A sent Writing keeps the counsel it printed.

**Counsel offers.** Session entry also returns `counsel_offers` while a party row of the drafting database still holds a counsel or address-for-service value that case data does not hold. Present them after the drift rows, as one batch table per proceeding: party, field, value in case data, value held here. The practitioner answers every row with one of three choices, and nothing is written without the answer:

- **Apply:** case data should hold the value. Write it to case data through `/case-data`'s own gate, naming the instrument it comes from. The row then disappears.
- **Discard:** case data is right. Clear the held value through `/drafting-data` (its filing checklist's discard write). The row disappears.
- **Hold:** no write. The row stays, and the matter's drafting database stays at v42, one version behind the hop that drops the held values, listed and rendered as usual until every row is decided.

A row for an unlinked party, or one linked to a party not of record, is answered by confirming its link first; its values are then offered one by one.
