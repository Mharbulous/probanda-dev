# Operation: profile

Read [`../shared/conventions.md`](../shared/conventions.md) first; derive the live `matter_root` per §2.2 and read `coclerk.json` only to confirm initialization; halt on any tool error per §2.3.

This operation owns matter-level completeness only. Read [`../shared/profile-protocol.md`](../shared/profile-protocol.md) for the exact key list that defines matter-level completeness and the document-sourced confirmation rule — this file does not restate them.

## 1. Audit `matter_metadata`

```sql
SELECT key, value FROM matter_metadata;
```

Check for the expected keys per [`../shared/profile-protocol.md`](../shared/profile-protocol.md): `matter_id`, `client_no`, `matter_no`, `short_name`, `client_name`, `filing_lawyer_name`, `filing_lawyer_firm`, and the file number where available. Report which keys are missing or blank.

## 2. Fill gaps from matter documents

For each missing key, look for a value in matter documents likely to carry it: pleadings (the court's file number for the proceeding — not the firm's matter number, which comes from the practice database), retainer correspondence (client name, filing lawyer), signature blocks (filing lawyer name/firm). Present each candidate value **with its citation** (per the citation format in [`../shared/conventions.md`](../shared/conventions.md)) and get the user's confirmation before writing. Do not write an unconfirmed value.

Write confirmed values with `INSERT OR REPLACE`:

```sql
INSERT OR REPLACE INTO matter_metadata (key, value) VALUES (?, ?);
```

All writes for a confirmed batch run in one `case_data__execute` call (§2.3).

## 3. Dump

`case_data__execute` regenerates `evidence.sql` automatically on success (§2.3) — no separate dump call. Report every INSERT/UPDATE performed.

## 4. Delegate proceedings completeness

`profile` never writes `proceedings`, `parties`, or `proceeding_parties` itself. Once matter-level fields are handled, delegate to [`proceedings-profile.md`](proceedings-profile.md) for proceedings-and-parties completeness. Invoke it programmatically and fold its returned per-proceeding summary into this operation's final report.

## 5. Final report

Report exactly one of:

- **"Profile complete."** — every matter-level key is filled and `proceedings-profile` reports no gaps.
- **The remaining gaps and why** — list each still-missing matter-level key and each still-incomplete proceeding/party field (from the delegated summary), and the reason it remains open (e.g. "no confirming document found", "user declined to confirm", "no document on disk states this value").
