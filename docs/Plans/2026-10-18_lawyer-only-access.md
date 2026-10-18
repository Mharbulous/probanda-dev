# Spec: lawyer-only access to Probanda's shared services

Assembled 2026-10-18 from the closed tickets of the map [Lawyer-only access to Probanda's shared services](https://github.com/Mharbulous/probanda-dev/issues/46). It adds no decision. Each decision is stated once, here, with a link to the ticket that holds its reasoning. Where a ticket's resolution was later revised, this document states the revised rule and names the revising ticket. This is the single source where it overlaps `docs/Plans/2026-10-14_install-keys.md`, and that plan points here (section 10).

The outcome: the legal commons, the Suggestion Box and the troubleshooting store accept only a key that belongs to a lawyer account. The server enforces every access check and usage limit. No user's installed copy holds a Supabase secret key.

Nothing here is built yet, except what section 10 lists as already applied.

## 1. Classification under COMMANDMENTS.md as it stands

COMMANDMENTS.md as of 38a8d05 governs. Two amendments came from this map:

- a7ec93e ([The COMMANDMENTS 3 amendment](https://github.com/Mharbulous/probanda-dev/issues/57)): Probanda's Cloud may also hold "what verifying that a person is a practising lawyer requires". It covers applicants who fail to match, proof of identity and later status re-checks. It is a purpose limit, so it also limits how long the User Data it covers is kept.
- 38a8d05 ([Privacy terms and where the data is stored](https://github.com/Mharbulous/probanda-dev/issues/58)): Data that Probanda's Cloud obtains from a public website is not User Data. Any Data or Metadata about a user that Probanda's Cloud holds is Cross Data, never stored in a Public Folder, and accessible only to Probanda and that user.

Two earlier resolutions ([Contribution quality: quarantine, reputation and rollback](https://github.com/Mharbulous/probanda-dev/issues/53) decision 2, [The COMMANDMENTS 3 amendment](https://github.com/Mharbulous/probanda-dev/issues/57)) said that account ids, key ids, counters and attribution "never go to a device". That rested on the old Trade Secrets reading. The current rule is the table below.

| Data | Class | Who may receive it |
|---|---|---|
| The details an applicant types (name, year of call, call date, firm name) | User Data (Commandment 3, fourth bullet) | Probanda and that lawyer |
| The lawyer's directory record (name as shown, call date, Primary location, record token, Current status) and the email found on the firm's site | Cross Data (public-website data about a user) | Probanda and that lawyer |
| Account id, state, verification dates, proof route, batch-reveal record, key hashes and labels, usage counters, alerts, the lawyer's own version stamps | Cross Data | Probanda and that lawyer |
| Another account's attribution, standing or counters | Cross Data of that other user | Never to a reader |
| Public pages not about a user (other same-name candidates' detail pages) | Trade Secrets | Never to a device |
| Raw commons clauses (`commons-search`) | Trade Secrets | Never to a device (Commandment 4) |
| Query text and reply content | User Data | Never stored by the cloud |

No function serves attribution, standing or counters. A lawyer receives their own Cross Data on an access request (section 8.6). A contribution or suggestion carries only Probanda's opaque account id, so neither needs Commandment 3's verification bullet. The retention of Cross Data rests on PIPA s. 35, not on Commandment 3 ([58](https://github.com/Mharbulous/probanda-dev/issues/58)).

## 2. Lawyer accounts

From [Lawyer accounts: LSBC verification, collisions and re-verification](https://github.com/Mharbulous/probanda-dev/issues/48), as revised by its superseding notes of 2026-10-16 and 2026-10-18, by [The COMMANDMENTS 3 amendment](https://github.com/Mharbulous/probanda-dev/issues/57) and by [Privacy terms and where the data is stored](https://github.com/Mharbulous/probanda-dev/issues/58). The term is defined in `GLOSSARY.md` (**Lawyer account**: provisional, verified, suspended). Each lawyer has at most one.

The directory facts these rules rest on are in `docs/Research/2026-10-15_lsbc-member-directory.md` ([47](https://github.com/Mharbulous/probanda-dev/issues/47), [60](https://github.com/Mharbulous/probanda-dev/issues/60), [64](https://github.com/Mharbulous/probanda-dev/issues/64)): the search submits by GET with no CAPTCHA, results show only names linking to an opaque `encrypted` token, the detail page shows no member number, the email is CAPTCHA-gated, and the "exact match" option behaves as "starts with". Its terms permit lookups "to verify their status". Checking the directory for an applicant who contacted Probanda is not a commercial, marketing or fundraising use: directories are queried only for applicants, one lookup per application, never in bulk (Brahm, 2026-10-15, the map's source draft).

### 2.1 The application

- Taken on a local page on `127.0.0.1` served by the plugin. There is no public Probanda website for applying ([49](https://github.com/Mharbulous/probanda-dev/issues/49) decision 1).
- Fields: full name, jurisdiction (BC only), year of call (full call date optional), and firm name as the directory shows it ("Primary location"). There is no email field ([57](https://github.com/Mharbulous/probanda-dev/issues/57)).
- The privacy notice (section 8.5) is shown before submission. Submitting is consent.

### 2.2 The match (automated, one lookup per application)

- Search the LSBC directory by last name, filter given names by starts-with, and filter surnames exactly in Probanda's own code, because "exact match" returns every surname that starts with the search ([64](https://github.com/Mharbulous/probanda-dev/issues/64)).
- Read the detail pages of at most 5 same-name candidates. More than 5 sends the application to Brahm's batch. Those pages are read and never stored.
- Keep only candidates whose Current status is exactly `Practising`, then narrow by year of call, then by Primary location. Current status alone decides: restrictions, discipline history and regulatory proceedings are neither read nor stored. No member number is used anywhere.
- No match: the applicant is told that no practising LSBC member matches and to check their details against their own directory entry. The application is deleted when they are told.
- Two or more candidates still match: Brahm's batch. A wrong pick can only fail, never admit the wrong person, because proof is tied to the chosen record.
- The server reads only the search URL and each candidate's detail page, with an identifying User-Agent.
- One match: a **provisional** account exists at once and receives its first key (section 3.1) (Brahm's ruling).

### 2.3 Identity proof

1. **Firm-site route (automatic).** A Claude agent on Probanda's server, with Anthropic's web-search tool:
   - searches for the firm by its directory name;
   - accepts a domain only if its site shows the directory's firm name plus at least one of the directory's address, firm phone or fax;
   - finds the lawyer's own page on that site;
   - sends the one-time link to the email on that page.

   It sends the application to the batch instead on any of: a domain registered within the last 90 days, or an unreadable registration date; two matching domains; a generic mailbox (info, reception, office, mail, admin, contact); no page naming the lawyer; any bot check or CAPTCHA on the firm site, where it stops and never retries around it.

   The agent sends Anthropic only what the cloud took from the directory and the firm's site (directory name, firm name, address, phone, fax), never the applicant's typed details. It runs without zero data retention, with `inference_geo: "us"`, on a model that is not a Covered Model (not Fable or Mythos) ([58](https://github.com/Mharbulous/probanda-dev/issues/58) decision 1).
2. **Brahm's batch (manual).** For each queued application Brahm opens the directory page in his own browser, solves the email CAPTCHA himself, and has the link sent to that email. This is never scripted and never given to a browser agent. The batch also spot-checks a random sample of firm-site-verified accounts. An application the batch cannot verify is deleted when the applicant is told ([58](https://github.com/Mharbulous/probanda-dev/issues/58)).
3. **A clicked link makes the account verified.**
4. **An unclicked link** suspends the provisional account after 14 days, and the abandoned application is deleted at once. A nightly `pg_cron` job in the commons database does both ([58](https://github.com/Mharbulous/probanda-dev/issues/58) decision 3). The applicant may re-apply from scratch. A provisional account has no other expiry.
5. **Collision.** If another applicant verifies against the directory record a provisional account holds, the verified applicant takes the record, the provisional account's keys are revoked, its User Data and directory fields are deleted at the collision, and only a Probanda-created event row stays for Brahm's queue as a likely impersonation. Only the verified winner is emailed, because the provisional holder has no address ([58](https://github.com/Mharbulous/probanda-dev/issues/58)).
6. **No CAPTCHA is ever automated, relayed or bypassed. Probanda never emails a law society** as part of verification, automatically or by hand ([63](https://github.com/Mharbulous/probanda-dev/issues/63)).

### 2.4 The account record

- jurisdiction (`BC`) and licensing body;
- the directory record as matched: name as shown, call date, Primary location, and the `encrypted` token as last seen;
- Current status at the last check;
- dates of first and last verification;
- state: provisional, verified or suspended;
- the proof route (firm site or batch) and the verified email;
- for a batch proof, who revealed the email and when.

No member number, no restrictions text, no discipline text, no application email.

### 2.5 Re-verification

- **No scheduled automated re-check, ever** ([48](https://github.com/Mharbulous/probanda-dev/issues/48) superseding note of 2026-10-16, [63](https://github.com/Mharbulous/probanda-dev/issues/63)).
- Status is re-checked per lawyer only: when the lawyer adds a device, when Brahm works a batch, and for any account not checked in 12 months, which joins the next batch.
- Suspension happens only on a known non-practising value: `Non-practising`, `Suspended*` (the asterisk is part of the value), `Former member` or `Disbarred` ([64](https://github.com/Mharbulous/probanda-dev/issues/64)). Any other value, `Retired` included until it is confirmed, a record that cannot be found, or a site error flags the account to Brahm and never suspends it.
- A suspended account loses every key at the check that finds it, and Probanda emails the verified address. A later check that finds `Practising` reinstates it. Local data is untouched.

### 2.6 Other law societies

Each directory is added later as an adapter that returns candidates (name, status mapped to practising or not, call date, location, record reference) and names its proof route. The account stores jurisdiction, licensing body and the adapter's record reference. Only the LSBC is in scope.

## 3. Keys and devices

From [Keys: one-time-link delivery, device keys, paralegal keys, rotation and revocation](https://github.com/Mharbulous/probanda-dev/issues/49), with device labels revised by [58](https://github.com/Mharbulous/probanda-dev/issues/58) decision 6.

1. **First key by device sign-in.** On a match, the cloud returns the key to the waiting plugin, which writes it straight to the credential file. The key is never shown to anyone.
2. **Another device by one-time link.** On the new device the lawyer runs "add this device" and names the account. The cloud emails a link, expiring after about 30 minutes, to the verified email. Clicking it approves the device and the waiting plugin receives its key, never shown. A provisional account cannot add a device, so it stays on one. The second device never repeats the application, which would collide with the account's own directory record. Each addition triggers the status re-check (section 2.5).
3. **No device limit.** The per-account caps (section 6) are the only bound.
4. **No staff key type.** A paralegal's or articling student's device joins through the device flow, approved from the lawyer's verified email, and belongs to the lawyer's account. No personal data about the staff member is stored. Only a verified account can add a device.
5. **No self-service revocation.** A lawyer asks Probanda and Brahm revokes by hand. The automatic revocations are suspension, the unclicked 14-day link and the collision (section 2).
6. **No rotation feature.** Revoke plus re-add issues a fresh key.
7. **Revocation takes effect at the device's next request**, because `serve()` looks up the key on every call. The refusal is the existing `401 {"error":"not authorized"}`. Revocation stops writes, never reads of local data ([55](https://github.com/Mharbulous/probanda-dev/issues/55) point 4).
8. **One key for all three services.** `troubleshoot__configure_credential` and the troubleshooting store's `sb_secret_` credential file (`source/researcher/commons-mcp/src/troubleshoot/config.ts`) go away.
9. **No per-key scopes.** Each function allows either every live lawyer-account key or only the project secret. `access.install_key` loses `scopes`, and `serve(…, {scope})` becomes a yes/no flag.
10. **The tenant comes from the device's own `practice.db`** at sign-in or device addition. A key with no tenant works for the commons, suggestions and troubleshooting, and the items functions refuse it.
11. **The key row** gains its owning lawyer account. The cloud stores only the key's SHA-256. Its `label` is made by Probanda, for example "device 2, added 2026-10-18", never a hostname or a person.

## 4. The gateway and access per function

From [The server-side gateway for all three shared services](https://github.com/Mharbulous/probanda-dev/issues/50), which also took in the items functions from [55](https://github.com/Mharbulous/probanda-dev/issues/55).

1. **The gateway is the shared `serve()` check** in `cloud/legal-commons/supabase/functions/_shared/caller.ts`, not a forwarding function. Every service an install reaches is an edge function that calls `serve()`. No install reaches a table.
2. **The troubleshooting store moves into the commons project** (`nbzkuhgiqscjkypedqff`). Its schema (CoClerk `plugins/legal-commons/mcp/db/troubleshoot.sql`: `troubleshoot.entry`, `search_entries`, `confirm_entry`) is applied there, the rows are copied once, and three `serve()` functions are added: `troubleshoot-search`, `troubleshoot-record`, `troubleshoot-confirm`. The separate project is retired, and the store's "refuse the pool's host and key" guard goes away.
3. **Access per function:**

   | Function | Lawyer key |
   |---|---|
   | `commons-find`, `commons-read` | yes, read only |
   | `commons-search`, `commons-contribute`, `commons-reembed`, every commons maintainer write | no, project secret only (`commons-search` returns raw clauses, which are Trade Secrets) |
   | `items-write`, `items-sync`, `items-seed` | yes, when the body's tenant equals the key's; a key with no tenant is refused |
   | `suggestion-submit` | yes, insert only |
   | `suggestion-list`, `suggestion-set-status` | no, project secret only |
   | `troubleshoot-search`, `troubleshoot-record`, `troubleshoot-confirm` | yes |
   | the commons version writes of section 7, once contributions open | yes |

4. **No RLS.** Tables stay closed by grants.
5. **Maintainer access.** The project secret lives only on Probanda's development machines, in `POOL_SECRET_KEY` or a maintainer-only file, never in the plugin's `credential.json.dpapi`. On Brahm's machines the plugin uses a minted install key and sees exactly what a lawyer sees. `cloud/items/tools/check_items.mjs` and `scripts/migrate_practice_db.py` switch to the maintainer source.
6. **Region.** Every edge function, maintainer ones included, is pinned to `ca-central-1` with the `x-region` header, or `forceFunctionRegion` where a header cannot be set ([58](https://github.com/Mharbulous/probanda-dev/issues/58)). A pinned call is not rerouted during an outage.

## 5. The Suggestion Box

From [The Suggestion Box in Probanda's Cloud, and any GitHub mirror](https://github.com/Mharbulous/probanda-dev/issues/51). Its build spec is `docs/Specs/2026-10-18_suggestion-triage-spec.md`, which stays the source for the triage design.

- Installs are insert-only through `suggestion-submit`. No install reads any suggestion, its own included.
- The row gains `plugin_version` (required, filled by the `commons` server from the researcher `plugin.json`, never the model), `skill`, `status` (`new`, `approved`, `approved in part`, `rejected`), `issue_number` and `triaged_at`.
- `account_id` may be added now: it is an opaque Probanda-created id and needs no further amendment ([57](https://github.com/Mharbulous/probanda-dev/issues/57)). It serves only the per-account write cap, and the link is cut when the account's User Data is deleted ([58](https://github.com/Mharbulous/probanda-dev/issues/58)).
- Triage runs on Probanda's development machine with the project secret, through `/suggestion-triage` and the maintainer script `cloud/suggestions/tools/triage.mjs`, and files a probanda-dev issue labelled `suggestion` that carries no person, entity, matter or account.
- No GitHub mirror, and no GitHub token in the cloud.

## 6. Metering, caps, alerts and the fingerprint

From [Usage metering, caps, enumeration alerts, canary rows and account sharing](https://github.com/Mharbulous/probanda-dev/issues/52), with the commons write cap from [The contribution ratio](https://github.com/Mharbulous/probanda-dev/issues/54) and the provisional cap from [Whether provisional accounts get tighter caps](https://github.com/Mharbulous/probanda-dev/issues/111).

1. **Counters only.** Per account, hour and function: `calls` and `records`. Never which entries were read, never query text or reply content.
2. **No canary rows.** No fabricated entry is ever served. Instead each reply from `commons-find` and `commons-read` lists a principle's authorities in an order fixed by the account: sorted by SHA-256 of account id, principle id and authority id. A copy is recognised by scoring copied principles against each account's expected order.
3. **What counts.** Calls feed the token bucket. Records returned feed the daily cap. A record is one principle, authority, treatment, rule period or troubleshooting entry in a reply.
4. **Per lawyer account.** Until accounts are built, counting is per key, which covers Brahm's minted bridge keys. Calls with the project secret are not metered. A provisional account has a lower shared-read cap (item 6) and otherwise the same limits as a verified one (Brahm, [111](https://github.com/Mharbulous/probanda-dev/issues/111)).
5. **Mechanism.** One SQL function in `access` replaces `resolve_key`: it looks up the key and spends a token in one round trip. `access.usage (account, hour, function, calls, records)` holds the counters, `access.limit` holds every number (changeable without a redeploy), with the account state as a column so a number can differ for provisional accounts, and `access.alert` records each alert. `serve()` checks the daily cap before the work runs and adds the record count after it, so a reply can exceed the cap by at most one page.
6. **Starting numbers**, to be tuned from Brahm's own usage:
   - token bucket: 30 calls of burst, refilling 10 a minute, on every lawyer-key call;
   - shared reads (`commons-find`, `commons-read`, `troubleshoot-search`): 2,000 records a day per account, and 200 while the account is provisional. A provisional account traces to someone who never proved identity, so the fingerprint deters nothing there. The token bucket, page sizes, write caps and items functions do not differ by state. A read refused at the provisional cap gets the same 429 as any read cap and never mentions the account's state;
   - daily write caps: `troubleshoot-record` 10, `troubleshoot-confirm` 50, `suggestion-submit` 20, commons version writes 200 versions (one version per item);
   - page-size caps: `commons-find` 10, `browse_principles` 20, `find_candidates` 20, `troubleshoot-search` 10;
   - the items functions get the bucket only.
7. **A bulk commons write** that would cross the cap (for example one `contribute_decomposition` call) is refused whole, with no partial save ([54](https://github.com/Mharbulous/probanda-dev/issues/54) decision 4).
8. **Refusals.** A write refused at its cap replies `{saved: false}` with a guiding question that does not state the cap, such as "Can this entry wait until tomorrow?" (Commandment 6). A read refused at its cap gets 429 with the reset time.
9. **A day** is a calendar day in America/Vancouver.
10. **Alerts** only notify Brahm by email, carrying only the account id. Brahm acts by hand. They fire on: (a) the daily cap reached on 3 of the last 7 days; (b) shared reads in 16 or more distinct hours of one day; (c) more than 10 live keys on one account. Alert (a) also fires on a provisional account at its lower cap, which tells Brahm which queued application to settle first.
11. A `browse_principles` keyword shorter than 3 characters gets 400.
12. **Account sharing:** no location or IP signal, no device limit, no automatic response. Alert (c) is the only signal.
13. **No contribution ratio** (Brahm, [54](https://github.com/Mharbulous/probanda-dev/issues/54)). The reviewed ratio design is recorded on that ticket for a future effort.

## 7. Commons contributions

From [Contribution quality: quarantine, reputation and rollback](https://github.com/Mharbulous/probanda-dev/issues/53). These rules take effect only when contributions open, which is a separate effort (the map's Out of scope). Until then `source/researcher/hooks/commons-read-only.py` refuses the commons write tools.

**Brahm's rulings.**

1. Every lawyer verifies what they rely on, and Probanda warrants nothing. There is no quarantine, corroboration, reputation or verification status of any kind.
2. The commons works like git: a failed verification becomes a correction, with the full history always available.
3. Show, don't tell: no note-up date (`stamp_verified`, `authority.last_verified_at`), verified flag, version count or "last corrected" marker is served. The principle itself is stated by "Show, don't tell: state the principle in Probanda's vision" ([106](https://github.com/Mharbulous/probanda-dev/issues/106)).
4. No hold for provisional accounts.
5. The cloud stays on Supabase.

**Design.**

6. **Attribution.** The server stamps every version with the account id and key id it reads from the calling key in `serve()`. Project-secret writes are stamped `project`. No caller-supplied value is used, so `source/researcher/commons-mcp/src/legal-commons/contributor.ts` and every `p_contributor` parameter go away. A key id survives the key's revocation.
7. **No reader sees attribution.** No reply carries an account id, key id or account standing (section 1). `rule_periods_find` stops returning `contributor`, `verifier` and `verifications`, and `mine` (`rule-periods.ts`) goes.
8. **Versions.** The versioned unit is the item a lawyer checks: a test, an authority link, a treatment, or a rule-period key. Item identity: an authority by its neutral citation, a link by principle and authority, a treatment by its two authorities and value ([54](https://github.com/Mharbulous/probanda-dev/issues/54)). Clauses never change: a correction makes a new clause and a new version of the test that points at it. Each version holds the full item. Content different from the current version makes a new version. Identical content does nothing, so item identity decides whether a near-duplicate push makes a version and counts against the write cap (section 6.6). An earlier version's content is a revert and becomes a new version. A withdrawal version is a recoverable delete. A correction's reason text is stripped like a push. A passed check stores nothing.
9. **Every edit is a version**, the project secret's included, so `amend_*` become versions. The only in-place act is a project-secret hard delete of content that must not exist, such as leaked matter text. `merge_authority` and `unlink_authority` become versions or stay secret-only.
10. **History.** A reader gets the current version and, on request, its correction history: earlier versions with dates and reasons, never attribution.
11. **Current version** is the latest one whose account and key are servable (not blocked, not rolled back), derived on read and never stored.
12. **Rollback.** Brahm alone, with a maintainer tool on the project secret, rolls back an account, optionally narrowed to one key. Its versions stop being current, nothing is deleted, and undoing the rollback restores them. A later lawyer's correction stacked on a rolled-back version stays current.
13. **Block** is a standing rollback: the account's new versions are saved (`saved: true`) and never become current. Reads and other services continue. Only Brahm sets or lifts it. Revoking an account's keys stays a separate act (section 3.5). A block lapses on voluntary closure, because the closed account's directory token is deleted at once ([58](https://github.com/Mharbulous/probanda-dev/issues/58) decision 5). Brahm can block a re-applicant by hand.
14. **Write replies** say only whether the write was saved, never anything about the account's standing.
15. **Rule periods.** One current version per key, latest servable wins, with visible history. `corroborated`, `disputed` and "the pool never picks a winner" go. Retirement by naming the shipped plugin version becomes a withdrawal version carrying `shipped_version`. A pooled record still never drives a calculation until the lawyer's own live re-check.
16. **Lawyer-key writes:** `push`, `link_authority`, `record_treatment` and `rule_period_push`, and no other. A lawyer key loses `stamp_verified` and `rule_period_record_verification`. `amend_*`, `merge_authority`, `unlink_authority` and `rule_period_retire` stay with the project secret, as versions under rule 9.
17. **Maintainer view**, derived with no new storage: each account's versions and how many were later corrected, the items with the most versions in a window, and the items whose current version is a withdrawal.
18. **Research rule.** A commons proposition is relied on only after it is checked against the cited authority at the pinpoint (verify-law). Noting up an authority is not that check.
19. **Existing rows** are attributed to Probanda by a one-time backfill when contributions open.

## 8. Local features, the licence and privacy

### 8.1 Local features

From [Whether local features need any gate](https://github.com/Mharbulous/probanda-dev/issues/55). No startup or local gate, because a check in public code can be deleted. Data-storing local features are gated on the server, because the items functions accept only a lawyer-account key. Text-only skills are governed by the licence alone (section 8.2). The legacy local-only stores exist only in the Development Plugin and need no gate.

### 8.2 The licence

The published plugin carries a simple proprietary licence ([55](https://github.com/Mharbulous/probanda-dev/issues/55) point 3, [53](https://github.com/Mharbulous/probanda-dev/issues/53), [58](https://github.com/Mharbulous/probanda-dev/issues/58)):

- free use by licensed lawyers, and staff they supervise, for practising law ("licensed lawyers" covers a lawyer anywhere);
- no redistribution, and no use of the plugin to copy the shared services;
- Probanda may change the terms on notice, and continued use is acceptance;
- the licence ends when the user's lawyer account ends;
- the commons is an unverified finding aid, Probanda warrants nothing in it, and contributions are made by users working with AI.

### 8.3 Where the data is stored

From [Privacy terms and where the data is stored](https://github.com/Mharbulous/probanda-dev/issues/58), on the facts of [56](https://github.com/Mharbulous/probanda-dev/issues/56) and [93](https://github.com/Mharbulous/probanda-dev/issues/93). PIPA (BC) governs. No statute and no binding Law Society Rule requires storage in BC or Canada.

All lawyer data sits in the commons project `nbzkuhgiqscjkypedqff`, whose database is in `ca-central-1` (Montreal), found by resolving `db.nbzkuhgiqscjkypedqff.supabase.co` against AWS's ip-ranges.json. The troubleshooting store joins it when it moves (section 4.2).

### 8.4 Retention

Every deletion reads "removed from the live database at once and from backups within the plan's backup window".

| Data | Kept |
|---|---|
| Account record (User Data and Cross Data) | While provisional or verified. After a status suspension, deleted 2 years later unless reinstated. The verified email is kept only so a reinstated lawyer can add a device. On voluntary closure every key is revoked and the record deleted at once. |
| No-match application, or one the batch cannot verify | Deleted when the applicant is told |
| Abandoned application | Deleted when its 14-day link lapses (nightly `pg_cron`) |
| Same-name candidates' detail pages | Never stored |
| Collision loser | User Data and directory fields deleted at the collision. The event row stays. |
| `access.usage` | 90 days |
| `access.alert` | 12 months |
| Item ledger (`ledger.*`, no value in clear) | While any key for the practice is live, then 90 days after the last is revoked |
| Suggestion text | No fixed end. The `account_id` link is cut when the account's User Data is deleted. A row found to hold client information is hard-deleted. |
| Commons contributions and troubleshooting entries | No fixed end, shared with every lawyer. Attribution goes only to the lawyer who made them, on an access request (section 8.6). |
| Supabase request logs (IP address, function, time) | Supabase's plan log window. Probanda copies none. |

Edge functions log only error codes. Postgres must not log statement parameters on error.

### 8.5 The privacy notice

- A short `PRIVACY.md` in the Public Folder's plugin, shown on the local application page before submission. Submitting is consent (PIPA ss. 6-10).
- It says what is looked up and collected and why, the retention above, that the directory record and firm-site email come from public sources, and that Brahm reviews applications the automatic check cannot settle.
- It tells lawyers to include no client information in a suggestion.
- It names every party that touches the data, with its country: Supabase and AWS (US companies, data stored in Canada, and US law can reach data a US provider holds); Anthropic (the firm-site check, which may keep those details for up to 30 days and longer where its usage policy or the law requires, and suggestion triage); GitHub (suggestion plan issues in Probanda's private repo); and Amazon SES, the email sender (section 8.7). AWS therefore appears twice: as Supabase's host and as Probanda's email sender.
- While maintainer copies are on (section 8.7), it says Probanda's maintainer receives a copy of every email Probanda sends, to check that the system works, in a mailbox hosted by Apple (a US company), and that those copies are outside the deletions in section 8.4.
- Breach notice, in these words: "If a breach of Probanda's security creates a real risk of significant harm to you, Probanda will tell you as soon as it can and report the breach to BC's Information and Privacy Commissioner." It covers identities and the item ledger.
- Privacy officer: Brahm (s. 4(3)). Access and correction requests are answered within 30 days (s. 29(1)).
- The no-warranty statement goes in the licence (section 8.2), not the notice.

### 8.6 Access requests

Answered with all of the lawyer's own Cross Data, including counters, alerts and attribution ([58](https://github.com/Mharbulous/probanda-dev/issues/58) decision 4), and any maintainer copies of emails sent to them (section 8.7).

### 8.7 The email sender

From [Choose the email sender for one-time links and alerts](https://github.com/Mharbulous/probanda-dev/issues/110).

- **Amazon SES, configured in `ca-central-1`**, sends every Probanda email: the one-time links (sections 2.3 and 3.2), the suspension and collision notices (sections 2.3 and 2.5) and the alerts to Brahm (section 6.10). The edge function calls the SES API at `email.ca-central-1.amazonaws.com` with a signed request. The notice says: "Amazon SES (Amazon Web Services, a US company), configured in Canada (ca-central-1). The message itself travels over the internet to your own mail provider." It never says the mail is sent from Canada, because SES does not guarantee where its sending IP addresses sit. No dedicated IP is bought.
- **The sender** is `Probanda <verification@probanda.app>` (Brahm, 2026-10-18), on Probanda's own domain `probanda.app` and never a law firm's. It is not a no-reply address: a reply to it reaches Brahm, so a lawyer whose link failed can say so.
- **The maintainer address** is `brahm@dorst.ca`, held in `access.limit`. Alerts (section 6.10) and maintainer copies go there. Its mail is hosted by Apple iCloud Mail.
- **Maintainer copies.** While a switch in `access.limit` is on, every Probanda email to a lawyer also goes to the maintainer address as a blind copy, live link included (Brahm, 2026-10-18). It serves two purposes: Brahm's own end-to-end tests before any real lawyer applies, and watching the first real sign-ups for glitches. It stays on until Brahm is confident the system works, and turning it off needs no redeploy. While it is on, a click on Brahm's copy verifies the account or approves the device just as the lawyer's own click would.
- Rejected: Resend (a new party, with its logs and metadata stored in the US), Supabase Auth's mailer (it serves only Supabase Auth, which lawyer accounts do not use), and a law firm's Microsoft 365 mailbox (a mailbox credential in Probanda's cloud, and Probanda's mail sent as the firm).

## 9. Documents this spec supersedes

- `docs/Plans/2026-10-14_install-keys.md`, in the parts section 10 lists.
- CoClerk `Engineering/1. Spec/2026-10-05_legal-commons-court-rule-sharing-spec.md`, and the court-rule bullets of `.claude/skills/legal-commons/SKILL.md` (the "Several contributors may hold different rows" and "Identity is an opaque per-install id" bullets), by section 7 rule 15 ([53](https://github.com/Mharbulous/probanda-dev/issues/53)).
- The source draft of 2026-10-15 (the map's first comment), wherever this spec differs.

## 10. Changes to the install-keys plan

Stage 1 of that plan is applied and deployed, and the Suggestion Box is live. The plan carries on as staged, with `scripts/mint_install_key.mjs` (stage 4, not yet written) minting keys for Brahm's machines as a bridge ([49](https://github.com/Mharbulous/probanda-dev/issues/49) decision 12). When lawyer accounts are built, Brahm's account is created and his minted keys are attached to it or re-issued through the sign-in. It changes as follows:

- **Open decision 1 is settled:** one key per device (section 3).
- **Scopes go** (section 3.9). The scope list under "Install keys" and the scope rule under "Who may call" are replaced by section 4.3.
- **The troubleshooting store** joins the one key and moves into the commons project (section 4.2). The plan's "this plan does not touch it" no longer holds.
- **Open decision 2 is settled differently:** the maintainer secret is `POOL_SECRET_KEY` or a maintainer-only file, never the plugin's credential file, and the plugin on Brahm's machines uses a minted key (section 4.5).
- **Decision 8 is revised** by section 7 rule 16: a lawyer key loses `stamp_verified` and `rule_period_record_verification`. The maintainer writes stay with the project secret, and each of them makes a version (section 7 rule 9).
- **`resolve_key`** is replaced by the metering function (section 6.5), and `install_key.label` becomes Probanda-made (section 3.11).

## 11. Not decided here

Nothing. The two points left open at assembly were decided on the map: the email sender (section 8.7) and the provisional-account caps (section 6).

## 12. Checks at build time

Facts the build confirms before relying on them. None is a decision.

1. The Supabase dashboard confirms `ca-central-1` for `nbzkuhgiqscjkypedqff` before the notice states it.
2. The project's plan and its backup window are recorded here before the notice's deletion wording ships.
3. The 200-version commons write cap is checked against the largest decomposition in the pool.
4. `source/researcher/commons-mcp/test/suggestion-box.test.mjs` still asserts the removed GitHub route and must follow the code ([51](https://github.com/Mharbulous/probanda-dev/issues/51)).
5. AWS's SES data-protection page confirms that SES keeps no message content after delivery, and Virtual Deliverability Manager and mail archiving stay off (section 8.7).

## 13. Brahm's own steps

- Delete `%LOCALAPPDATA%\Coclerk\suggestion-box\credential.json.dpapi` on each of his machines and revoke its GitHub token ([51](https://github.com/Mharbulous/probanda-dev/issues/51)).
- Rotate the project secret at install-keys stage 5, as that plan says.
- Open Probanda's AWS account and keep it like the project secret: its root email, MFA and payment card are Probanda assets (section 8.7).
- Verify `probanda.app` in SES, set its SPF, DKIM and DMARC records, and route mail sent to `verification@probanda.app` to himself.
- Request SES production access. Until AWS grants it, SES sends only to verified addresses, so firm-site verification cannot run: this request is on the critical path for lawyer onboarding. Reviews have taken from a day to over a week, AWS refuses a vague use case, and it looks for a public page describing Probanda.
- Turn maintainer copies off (section 8.7) once he is confident the system works.
- `docs/Correspondence/2026-10-16_lsbc-status-check-enquiry.eml` is an unsent, orphaned draft ([63](https://github.com/Mharbulous/probanda-dev/issues/63)). A deletion hook kept it in place.
