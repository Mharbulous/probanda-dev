# Operation: proceedings-profile

Read [`../shared/conventions.md`](../shared/conventions.md) first; derive the live `matter_root` per §2.2 and read `probanda.json` only to confirm initialization; halt on any tool error per §2.3.

This operation owns proceedings-and-parties completeness for the matter. Read [`../shared/profile-protocol.md`](../shared/profile-protocol.md) for the exact field lists that define "complete" per proceeding and per party — this file does not restate them.

## 1. Query current state

Query proceedings joined to their parties:

```sql
SELECT pr.proceeding_id, pr.court, pr.registry, pr.file_number, pr.style_of_cause,
       pr.courthouse_address, pr.trial_date, pr.status,
       pp.party_id, pp.role, pa.name, pa.party_type, pa.lawyer_name, pa.lawyer_firm,
       pa.service_address_filed_date, pa.replaced_representative
FROM proceedings pr
LEFT JOIN proceeding_parties pp ON pp.proceeding_id = pr.proceeding_id
LEFT JOIN parties pa ON pa.party_id = pp.party_id
ORDER BY pr.proceeding_id, pp.role;
```

Evaluate each proceeding and each of its parties against the field lists in [`../shared/profile-protocol.md`](../shared/profile-protocol.md). If every proceeding and every party is complete, skip straight to the summary (§5).

## 2. Select a mode by database state — never by form type

The mode is chosen from what the database currently holds, not from the kind of document that triggered the call:

| Database state | Mode | Behavior |
|---|---|---|
| No proceedings exist at all | **Commence** | Interview the user directly: ask for court, registry, file number, style of cause, courthouse, trial date, status, and each party (name, type, role, counsel). |
| Proceedings exist but have gaps | **Query+fill** | Ask the user to confirm values, or point to a document; fill only from user-confirmed documents (never write a document-sourced value without confirmation). |
| Documents on disk describe a proceeding that is missing from the database entirely | **Backfill** | Extract the proceeding (and its parties) from those documents, then confirm with the user before writing. |

Do not infer the mode from whether the triggering document is a pleading, an affidavit, a notice, etc. — the same document could trigger Commence (nothing in the DB yet) or Query+fill (one field missing) depending purely on what is already stored.

## 3. Confirm before writing; dedup; roles from the enum only

- **Every value goes to the user for confirmation before INSERT**, whether it came from an interview answer, a document citation, or a backfill extraction. Document-sourced values are presented with their citation (per the citation format in [`../shared/conventions.md`](../shared/conventions.md)).
- **Dedup parties by normalized name** before inserting a new `parties` row (case-insensitive, whitespace-collapsed comparison) — do not create a second party row for a party already on file under a different casing or spacing.
- **Roles come strictly from the fixed enum**: `plaintiff | defendant | third_party | intervenor | applicant | respondent | petitioner | appellant | defendant_by_counterclaim`. Never write a free-text role. `appellant` is the moving party in a Court of Appeal proceeding; `respondent` is reused unchanged as the opposing role there, exactly as it already is for a petition or an application — this schema does not scope role meaning by proceeding type, and BC practice itself uses "respondent" in all three contexts. `plaintiff_by_counterclaim` is deprecated and prohibited. `defendant_by_counterclaim` is reserved for a **counterclaim-only party** who has no main-action role in the proceeding; never add it to an existing main-action party. The only valid multi-role stack is exactly `{defendant, third_party}`. Every other combination of two or more roles is a role-integrity problem that must be corrected before this operation writes further profile data or returns a renderable profile.
- **A participant is not necessarily a named party.** A garnishee, records custodian, service recipient, or other application participant does not enter the proceeding's named-party roster merely because the application affects or gives notice to it. Never translate one into `defendant`, `third_party`, or another party role unless the practitioner confirms that it is formally a named party in that proceeding. If an existing association belongs only to a non-party participant, route its practitioner-confirmed removal through the correction path below; retain any underlying entity record that other matter data may still reference.
- **Practitioner-confirmed removal is supported.** When the practitioner confirms that an existing role row is erroneous, delete that exact proceeding/party/role association in the same confirmed batch and report the deletion. Never silently drop, translate, or replace a role.
- **`style_of_cause` is a short cause for orientation.** It need not enumerate every party or role and is never used as a formal-style checksum.
- **Each new party and counsel is proposed as a contact in the same confirmation** (`../references/design-decisions.md` #69). For each party and each counsel the batch adds, show beside its matter-data rows the practice-data contact and matter role it gets, through ``practice-data``: a contact `contact-lookup` finds (exact, or one from its `near` list the practitioner confirms), or a new contact pre-filled from `contacts__search`. The role is `client` for the party the firm acts for, otherwise as the party's side suggests, for the practitioner to correct; counsel gets `opposing_counsel` or `co_counsel` and an affiliation to its firm, and its role's `from` is the filing date of the pleading that gave its address for service, when known (`../references/design-decisions.md` #72). One approval covers the matter-data rows and the practice items shown. Never write `parties.contact_info`. When a matched contact's details differ from counsel of record, ask whether a notice of change was filed, and overwrite neither (#55).
- **No provenance columns on `proceedings`, `parties`, or `proceeding_parties`.** These tables do not carry `source_id`/`source_locator`/notes-style provenance — the confirmation step is the only record of where a value came from.

## 4. Write and dump

Insert/update `proceedings`, `parties`, and `proceeding_parties` as confirmed. A practitioner-confirmed role correction may also DELETE the exact erroneous association. All writes for a single confirmed batch run in one `matter_data__execute` call (§2.3), which regenerates `evidence.sql` automatically on success. Report every INSERT/UPDATE/DELETE performed.

Then write the approved practice items through ``practice-data``: the contacts (`upsert-contact`), the affiliations (`upsert-affiliation`) and the roles (`upsert-matter-role`), each role with the new `party_id` as `case_party_id` and its `proceeding_id` as `case_proceeding_id`. Case data is written first because the role needs the `party_id`. If a practice write is refused, the matter-data rows stand: relay the question to the practitioner, and `contact-checks` reports the party until its role is recorded.

## 5. Always end with the grouped summary

Whether or not anything was written this run, end with a per-proceeding summary, grouped by proceeding:

- court / registry / file number / short style of cause / courthouse / trial date / status;
- a **valid role groups** section (`valid_role_groups`), grouping opaque party IDs and display names by role and including counsel where known. Return groups in canonical render order: `plaintiff`, `petitioner`, `appellant`, `defendant`, `respondent`, `third_party`, `intervenor`, `applicant`, then standalone `defendant_by_counterclaim`. Each group carries its final count-aware `role_label`: PLAINTIFF(S), PETITIONER(S), APPELLANT(S), DEFENDANT(S), RESPONDENT(S), THIRD PART(Y|IES), INTERVENOR(S), APPLICANT(S), or DEFENDANT(S) BY WAY OF COUNTERCLAIM. Consumers copy this order and label; they do not reconstruct either. When `service_address_filed_date` or `replaced_representative` is non-NULL for a party, append it to the counsel line as `<lawyer> (address for service filed <date>; replaced: <replaced_representative>)`; when both are NULL, render the counsel line exactly as today — this is an optional display element, not a new required key (`../references/design-decisions.md` #24);
- a **correction required** section listing every offending opaque party ID, display name, and complete role set. It must include any deprecated `plaintiff_by_counterclaim`, any `defendant_by_counterclaim` attached to a party that also has another role, every multi-role set except exactly `{defendant, third_party}`, and any association the practitioner identifies as a non-party participant (including a garnishee) rather than a named party;
- no correction warning based only on a party or role omitted from the short `style_of_cause`.

A summary with a non-empty **correction required** section is explicitly **not renderable**. Consumers must stop before formal rendering and send the practitioner through this operation's confirmed correction path. A clean summary is renderable; `{defendant, third_party}` appears in both valid role groups, while a standalone `defendant_by_counterclaim` appears only in that role group.

This summary is the return value when `proceedings-profile` is invoked programmatically by another operation (e.g. [`profile.md`](profile.md) delegating proceedings completeness) — return it in full, not a truncated version.

## 6. Linkage check (candidate-source entry point)

A secondary entry point, reached with one or more already-registered `main.sources` `source_id`s in hand — never §1's whole-matter query. It is invoked from [`ingest-extract.md`](ingest-extract.md) (per document, after completion) and [`extract-facts.md`](extract-facts.md) (once per scan, over every source still missing a proceeding link), or directly for one-off remediation.

Every write below is confirmation-gated exactly as §3 describes — this is authorized skill text, a designated decision point, not an unauthorized interruption.

**Group the supplied sources** by the first path segment of `file_path` (the top-level folder, e.g. `Court File #CA59991`); a source outside a folder the practitioner's folder map gives court filings is handled on its own. For each group:

### Read court identity directly

Read page 1 (or, for `.docx`/`.eml`, the rendering already produced by [`ingest-extract.md`](ingest-extract.md)'s Document pre-processing section) of the group's lead document. A PDF's page 1 goes through `pdf_pages__images` first, by that file's Universal rules: a scanned page is read only from its PNG. One read yields both the party names on the caption (for R1) and the court, registry, file number, and style of cause (for R3) — do not dispatch a subagent or add a field to any extractor's output contract for this; read the document yourself, the way `order-effects.md` Step 2 reads an order's operative terms directly. If a second document in the group has a caption that disagrees with the first, split it into its own group.

### R1 — Client relevance screen

Compare the party names on the caption (and their recorded aliases, resolved through [`participants.md`](participants.md)) against the matter's parties. No overlap → this is a court record from an unrelated proceeding, ingested as evidence (e.g. a prior judgment against a third party). Write nothing to the proceedings tables; the source's `proceeding_id` legitimately stays NULL. Append `PROCEEDING-CHECK: evidence-only — <reason>` to the source's `notes` (see [`../references/design-decisions.md`](../references/design-decisions.md) #42 for the append mechanics and why this marker is exempt from [`../shared/conventions.md`](../shared/conventions.md) §5's forcing rule) and stop — do not run R2/R3.

### R2 — Court-file folder signal

A signal, never a gate. The group's folder is one the practitioner's folder map gives court filings (`practice_data__folder_map`, the caller's answer reused) and its name holds something like a file number, matching `(#|№|No\.?|File)?\s*[A-Z]{0,4}-?\d{4,}` (lenient — the folder name is a hint, not a parser target; the file number from R3's own read is authoritative). R1-pass + R2-hit → the proceeding belongs in `main.proceedings`; continue to R3. R1-pass + R2-miss (a court document, matter parties, but sitting outside any court-filings folder): do not block — report it as a filing question for the caller to surface ("court document for [file no.] found outside a court-file folder — register a proceeding, or refile?") and continue to R3 anyway, since the document may still describe a proceeding worth registering.

### R3 — Match against existing proceedings

Query current proceedings and compare their `file_number` against the file number read in this group:

```sql
SELECT proceeding_id, court, registry, file_number, style_of_cause
FROM main.proceedings;
```

- **Exact match** (string-equal after trimming) → the proceeding exists. Skip straight to §7 with this `proceeding_id` — no elicitation. Report the back-fill; it is not confirmed (see [`../references/design-decisions.md`](../references/design-decisions.md) #42).
- **Partial match** (digits-normalized comparison — strip prefixes/hyphens, compare significant digit runs; e.g. `S-125102` vs stored `125102`) → run the conflict flow below.
- **No match** → run this operation's Backfill mode (§2) for the group's document(s), through the confirm-before-write flow in §3 and the write in §4. Once confirmed, continue to §7 with the new `proceeding_id`.

### Conflict flow (partial match)

Present, per `/show-me`, a table of the matching fields and the conflicting fields — document value with citation vs. database value — then exactly these four options, asked as one plain-text question ending the turn:

1. **Ingest as evidence documents only** — no proceeding change; the source(s) keep `proceeding_id = NULL` with the evidence-only `notes` marker (same mechanics as an R1 fail).
2. **Overwrite** — update the existing proceeding with the document's values, through §3/§4 (confirmation covers each field).
3. **Fill gaps only** — add document-sourced values only where the database field is NULL; existing values untouched. Through §3/§4.
4. **Create a new proceeding** — the partial match is a coincidence; run Backfill (§2) as if R3 found no match.

Mark exactly one option **(Recommended)**: option 3 when the conflict is formatting-level only (prefix, punctuation, party order in the style of cause); option 4 when court *and* registry both differ; option 2 only when the document is more authoritative than the stored value (a filed, stamped document vs. an unconfirmed intake value); option 1 when R1 was borderline rather than a clean pass.

After options 2, 3, or 4 write through §3/§4, continue to §7 with the resulting `proceeding_id`. Option 1 writes only the `notes` marker and stops.

### A deferred check clears its marker

A source whose `notes` carry `LINKAGE-PENDING: proceeding linkage check not yet run` (`../shared/conventions.md` §11) is one an ingest deferred here. When this section reaches an outcome for it (the evidence-only marker, a proceeding written or matched, a §7 back-fill), clear the marker with §11's clear statement, in the same `matter_data__execute` call as that outcome's write, or in its own call when the outcome writes nothing for that source.

### Return contract

When this section wrote or confirmed a proceeding, end with §5's grouped summary as usual. Otherwise (an evidence-only marker only, an exact-match back-fill with no proceeding write, or an R2-miss finding with nothing written) return a compact linkage report instead: sources checked, the rule outcome for each, any `notes` markers written, any `proceeding_id` back-fills applied, and any findings for the caller to surface. Do not force a whole-matter §5 summary when nothing proceeding-level changed.

## 7. Source back-fill

Runs after §6 confirms or matches a `proceeding_id` for a group. `proceeding_id` is reserved for what was actually **filed** in the proceeding: link only orphaned `category = 'court'` sources under that group's court-file folder. Correspondence and every other unfiled category relate to the matter as a whole, never to one proceeding specifically — never link them here, regardless of whether they name the file number (see [`../references/design-decisions.md`](../references/design-decisions.md) #42 for why this line is drawn where it is, and why an earlier draft of this section drew it differently):

```sql
UPDATE main.sources
SET proceeding_id = :confirmed_proceeding_id
WHERE proceeding_id IS NULL
  AND category = 'court'
  AND file_path LIKE :court_folder_prefix || '%';
```

`:court_folder_prefix` is the group's own folder (the first path segment of the `file_path` that triggered the check). This also links any exhibit rows under the same body — they share the body's `file_path` and its `category` ([`../references/design-decisions.md`](../references/design-decisions.md) #17) — no separate handling needed.

Run this in the same `matter_data__execute` call as the proceedings write that produced `:confirmed_proceeding_id`, where practical, and report every source updated. This step runs even for §6's exact-match path, where it is the entire write — see [`../references/design-decisions.md`](../references/design-decisions.md) #42 for why that back-fill needs no separate confirmation.
