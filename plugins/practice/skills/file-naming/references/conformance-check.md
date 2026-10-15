# File-naming conformance check (shared contract)

This is the single contract both callers invoke to test a filename against the
firm's naming convention and to derive a conforming name. It sits beside its two
data files — `code-registry.md` (the code single source of truth) and
`general-conventions.md` (the format grammar and edge-case protocol) — and reads
them by bare filename.

**Callers:**
- **Housekeeping** (`/housekeeping`, in the `file-manager` plugin, via `/file-naming`) runs **test mode**
  (the name gate) over the current names of the files it reviews, then its
  `housekeeping-namer` agent, or the session itself for a privileged-store file,
  runs **proposal mode** from each file's naming evidence.
- **Ingest** (`../../case-data/operations/ingest-extract.md`) runs
  **test mode** on a freshly ingested file's current name, then **proposal
  mode** from the just-extracted source metadata — no re-read of the file.

## The load-bearing default (backend-independent)

**A file renamed *incorrectly* is worse than one left alone** — a wrong name can
hide a triggered deadline or break a keyword search. So whenever a check is not
confident, it leaves the name alone. What "leave alone" means depends on the
caller:
- Housekeeping → put the file on **needs-manual-review**; propose nothing.
- Ingest → **proceed with ingestion, no rename**.

This default governs both modes below. When in doubt, do not rename.

## Test mode (name-only — no file is opened)

Housekeeping executes this mechanically via `file-naming/scripts/name_gate.py`
plus each folder's alternate-format pass — this file remains the semantic
contract. Ingest still applies it as prose.

**Input:** a file path, and the folder type when the caller knows it
(housekeeping always does; ingest usually does not — raw scans, `0. DRAFT`,
`1. RAW`).

**Procedure** — judge from the filename alone (strip the extension first):

1. **Grammar.** Does the name parse into the format in `general-conventions.md`?
   It must lead with a date token `YYYY-MM-DD` (zero-filled parts allowed, e.g.
   `0000-03-01`) followed by a `CODE` token. Later components (author/recipient,
   `re/encl/srv`, subject, `$Amount`, status marker) are optional per that file.
2. **Valid code.** Is the leading `CODE` token a code defined in
   `code-registry.md`? A trailing `#<number>` (e.g. `INV#7413`, `AFF2`) is part
   of the code — match the code stem. Combined delivery codes (`LEF`, `ELT`) are
   whole registry entries; match the whole token.
3. **Typicality (soft, only when folder type is known).** Is that code listed
   with this folder in the registry's "Typical folders" column? A code that is
   valid but atypical for the folder still **conforms** — note it as a soft
   flag, do not fail on it. When the folder type is unknown, skip this check
   entirely (grammar + valid-code is the whole test).

**Output:** `conforms: true | false` + a one-line rationale (what parsed, or
which of grammar / valid-code failed). If the name is ambiguous enough that you
cannot decide, return `conforms: false` with a rationale saying so — the caller
then applies the leave-alone default rather than forcing a rename.

## Proposal mode (derive the conforming name)

Reached only for a name that failed test mode. Assemble the components of the
format in `general-conventions.md` from whatever signal the caller supplies:

- **Housekeeping** reads the file's content to fix each component (date, code,
  parties, `re/encl/srv`, subject, amount, status).
- **Ingest** supplies the already-extracted source metadata instead — no re-read:
  - `date` → the date component;
  - `category` + `title`/`description` → the `CODE`. The category is coarse
    (e.g. `court`, `work_product`); use it together with the title to pick the
    **most specific** valid code in `code-registry.md`. If you cannot confidently
    pin a specific code, apply the leave-alone default.
  - parties → author/recipient (`Lastname` + first initial, or the entity
    initialism — see `general-conventions.md`). Where the caller supplies a
    file code already recorded for that person, use it as it stands, even
    where the rule would derive another; this skill records no codes itself;
  - `title`/`description` → subject;
  - amount → `$Amount`, for financial documents only.

Apply the code-building, author/recipient, `re/encl/srv`, and date rules from
`general-conventions.md` exactly. Preserve the original file extension.

**Output:** the proposed conforming filename (including extension). If any
required component — the date or the code above all — cannot be determined
confidently, propose nothing and return the leave-alone signal; do not guess a
component to complete a name.
