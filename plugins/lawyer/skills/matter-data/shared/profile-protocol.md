# Profile Protocol

Backend-free completeness semantics. Profiling audits whether a matter's identifying and structural data is complete, reports the gaps, and fills them from confirmed sources. This file speaks only in terms of the **matter**, its **proceedings**, its **parties**, fields, and states — no SQL, no table-qualified writes, no engine specifics.

Cross-cutting definitions (the citation format, the `verified` enum) live in [`conventions.md`](conventions.md) — referenced here, not restated.

## Two owners, two scopes

Completeness is split across two operations, each owning its own scope. Neither writes the other's tables.

### Matter-level completeness — owned by the profile operation

The **profile** operation owns the matter's identifying fields:

- `matter_id` — the matter reference
- `client_no`
- `matter_no` — the matter number
- `short_name`
- `client_name`
- `filing_lawyer_name`
- `filing_lawyer_firm`
- the **file number** where available.

Profile audits these fields for the matter, reports which are missing, and fills them.

### Proceedings completeness — owned by the proceedings-profile operation

The **proceedings-profile** operation owns per-proceeding and per-party completeness:

**Per proceeding:**

- `court`
- `registry`
- `file_number`
- `style_of_cause` — a short cause for orientation, not an exhaustive formal-style checksum
- `courthouse_address`
- `trial_date` (optional)
- `status`

**Per party:**

- `name`
- `party_type`
- `lawyer_name` (optional)
- `lawyer_firm` (optional)
- `service_address_filed_date` (optional — breadcrumb, never completeness-required)
- `replaced_representative` (optional — breadcrumb, never completeness-required)
- **`role`** — drawn strictly from
  `plaintiff | defendant | third_party | intervenor | applicant | respondent | petitioner | appellant | defendant_by_counterclaim`.

`plaintiff_by_counterclaim` is prohibited. A standalone
`defendant_by_counterclaim` identifies a counterclaim-only party and may not be
stacked on a main-action party. Exactly `{defendant, third_party}` is the sole
valid multi-role group; every other multi-role combination requires
practitioner-confirmed correction before the profile is renderable.

The roster contains formally named parties only. Participation in an
application does not itself create a party role: garnishees, records
custodians, service recipients, and similar non-party participants remain out
of the named-party groups unless the practitioner confirms otherwise.

## Document-sourced values are cited and confirmed before writing

Any completeness value taken from a matter document — a name from a signature block, a file number from a pleading, a party role from a style of cause — MUST be **presented to the user with its citation** (in the citation format from [`conventions.md`](conventions.md)) and **confirmed by the user before it is written**. The profile operations do not silently absorb document-derived values into the record; the user confirms each one first. Values the user supplies directly are, of course, taken as given.
