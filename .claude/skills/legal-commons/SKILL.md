---
name: legal-commons
user-invocable: false
description: Sole gatekeeper for the layer-3 shared legal-commons pool — matter-free legal principles, authorities, criteria, and treatments in Supabase, reached only through the legal_commons__* MCP tools.
---

**Internals stay confidential** (`shared/internals-confidentiality.md`): nothing the practitioner sees names a Probanda tool, table, field, internal type or code, or explains how Probanda works inside. It hides mechanism, never an outcome or an error.

# legal-commons — Router

Sole gatekeeper for **layer 3**: the shared, matter-free pool of generalized
legal principles, their public authorities, criteria, and treatment edges,
stored in Supabase and served by the `legal_commons__*` MCP tools. Every read,
the one push, and every amend go through this skill. Other skills consume the
pool only through it.

Sibling gatekeepers: `/matter-data` (local per-matter case data, including the
working legal-knowledge layer) and `/practice-data` (local practice data).
The consolidation/push skill is a **client** of `/matter-data` + `/legal-commons`,
never a gatekeeper itself.

## Encapsulation — absolute

All database particulars for layer 3 live in the runtime that serves
`legal_commons__*` (schema, table/column names, pgvector, SQL, redirect
resolution, the push transaction). **This skill file contains none of them**, and
neither may any consumer. Access the pool only by invoking the tools below; treat
the store as opaque. Redirect hops, variant clustering, and candidate retrieval
are the runtime's business — callers pass ids and text and receive resolved results.

## The permission-prompt invariant (PP-1) — do not defeat it

The pool is the one place case work reaches the cloud. Every `legal_commons__*`
call fires a Supabase permission prompt, and that is the design, not friction:
routine case work never touches the cloud, so a prompt only ever appears during a
deliberate lookup or push. **Never add `legal_commons__*` to any allowlist**
(`settings.json`, `settings.local.json`, or plugin pre-auth), and never "fix" the
prompt. A WARN pause inside a push is a content confirmation, a separate thing.

## Operation routing

| Intent | Tool |
|---|---|
| Resolve a principle by id (with its variant cluster, criteria, authorities); follows one merge redirect internally | `legal_commons__resolve_by_id` |
| Shortlist pooled principles for push-time dedup — the retrieval step | `legal_commons__find_candidates` |
| Find pooled authorities by exact public citation | `legal_commons__lookup_by_citation` |
| Keyword-browse principles by substring | `legal_commons__browse` |
| Find pooled principles by meaning, whatever their wording; returns each one's prose with its authorities' citations and pinpoints | `legal_commons__search` |
| Trace the authority-treats-authority chain leading to an authority | `legal_commons__treatment_chain` |
| Publish one generalized, matter-free principle to the pool | `legal_commons__push` |
| Correct the text of an already-pooled principle | `legal_commons__amend_principle_text` |
| Correct the description of one of its criteria | `legal_commons__amend_criterion_text` |
| Correct what an edge asserts about its authority (proposition/finding/relationship/obiter) | `legal_commons__amend_authority_edge` |
| Attach a pooled authority to a pooled principle | `legal_commons__link_authority` |
| Remove a principle-authority edge that should not stand | `legal_commons__unlink_authority` |
| Fold a duplicate authority row into its canonical row | `legal_commons__merge_authority` |
| Record that one authority has treated another (overruled, distinguished, followed…) | `legal_commons__record_treatment` |
| Correct a pooled authority's own title, url, or authority_type | `legal_commons__amend_authority` |
| Share locally verified court-rule overlay records | `legal_commons__rule_period_push` |
| Find pooled court-rule records for an enactment, optionally by amending regulation, rule_ref or deadline type | `legal_commons__rule_period_find` |
| Retire a pooled court-rule record | `legal_commons__rule_period_retire` |

## Reads

The six reads are safe to call directly for lookup and dedup. `search` answers a
question in its own words with the principles that mean the same, best match
first. `find_candidates`
is the retrieval step for push-time dedup: pass a **retrieval packet** — several
`rephrasings` of the principle (so paraphrases with different wording are still
caught), an optional `doctrine_tag`, and the `citations` it relies on. The
runtime unions full-text, trigram, citation, and doctrine-tag matches in Postgres
(no embedding, no external model) and returns candidates with which filter hit
and a score. **The runtime never decides duplicate/variant/distinct — the client
adjudicates.** Generating good rephrasings and the doctrine tag is the caller's
job; that is where the semantic judgment lives.

## Push — the severance point

`legal_commons__push` is the **only minter** of layer-3 content and the deliberate
severance point (spec §6/§8). It is **matter-free by signature: there is no
`matter_id` parameter** — a pointer back to a matter is structurally
unrepresentable in a push. It accepts only already-generalized, severed content: the principle `text`,
optional `jurisdiction`, an optional `variant_of` (+`variant_note`) to link it
into an existing cluster, public `authorities` (attached/deduped by citation),
and `criteria`. The runtime mints the principle, its authorities, and its
criteria in one transaction, returning the cloud principle
id for the caller to record as its local up-pointer. Pass a `doctrine_tag` (reuse
an existing one where it fits) so the principle lands in the right retrieval
bucket.

**Never pass matter-identifying content** — matter strategy, `notes`,
`file_path`/`file_hash`, `factual_context`, or precedent-vs-live-fact commentary
belong in the local working layer (`/matter-data`), and never cross. Compression,
the severance/indirect-identifier screen, and dedup adjudication are the
consolidation/push skill's job, upstream of this call.

## Amends — corrections, not revisions

The amend ops exist because push is judgment-driven: adjudication can miss a
duplicate authority, attach an authority a principle does not stand for, leave an
edge unmade, or carry a defect in the wording of a principle, one of its criteria,
or what an edge claims its authority held. Without them the pool accretes those
errors permanently.

A wording defect can sit in **any** of those places independently — the A4 pilot
left a mischaracterization in a criterion and in an edge's proposition while the
principle text above them was already correct. Check all three before concluding a
principle is clean; fixing only the text would have left that defect in place.

They are **correction tools, not editing tools**. Amend a principle's text only to
fix a defect in the statement of the law it already makes; a principle that says
something materially different is a **new push**, and a superseding or competing
formulation is a **variant** (see `variant_of` in the push skill's adjudication
reference) — never an in-place rewrite over the old text.

An edge's `proposition` and `finding` are **authored at push time** — they are
claims about what a real decision held, and nothing in the pipeline checks them
against the decision. When one is wrong, correct it with
`legal_commons__amend_authority_edge` rather than unlinking and re-linking, which
would silently drop the rest of the edge. Verify against the decision itself
before amending; a confident-sounding proposition is not evidence.

Amends are as irreversible as pushes and carry the same permission prompt. They
have no undo: verify the target with `legal_commons__resolve_by_id` before and
after each one. `merge_authority` is re-runnable and reports which edges it
repointed and which it dropped as already-canonical; it refuses to delete a
duplicate that anything still stands on, and that refusal is a real signal — read
it rather than working around it.

## Currency — treatments, not rewrites

Law moves after a principle is pooled. Currency records that movement **beside**
the pooled statement; it never edits the statement. A superseding or narrowed
formulation is a **new push as a variant** (`variant_of` + `variant_note`), and
the authority it displaced gets a treatment edge pointing at the decision that
treated it. Never reach for `legal_commons__amend_principle_text` to bring a
principle up to date — that op remains a correction tool (see *Amends* above),
and rewriting the old text would erase the law as it stood.

`legal_commons__record_treatment` takes the **treating** decision as a citation
packet, not an id: the overruling judgment — or an oral decision — is usually not
pooled yet, so the runtime upserts it by citation exactly as push does. Give the
same citation for the same decision every time and it resolves to the one
authority row; vary the formatting and the pool gains a duplicate that only
`legal_commons__merge_authority` can undo. An authority may not treat itself, and
the treated authority must already be pooled.

**The vocabulary.** Every `relationship`, `treatment` and `edge_treatment` value,
its definition, and which column takes it are in
[`../shared/treatment-vocabulary.md`](../shared/treatment-vocabulary.md) and
nowhere else. Read it before writing any of them. Probanda records treatment per
principle, not per case, which departs from every citator
(`docs/Specs/2026-10-15_per-principle-treatment-vocabulary-spec.md`).

**Two tenses, not interchangeable:**

- `treatment` — **present tense**, what the treating decision *does*. This is
  the treatment edge's own value and is always required. Treatment of one
  principle goes on the treating authority's principle edge (`relationship`); the
  treatment edge records events about a whole decision.
- `edge_treatment` — **past tense**, what has *been done* to the treated
  authority. It stamps every pooled principle edge standing on the treated
  authority, so pass it only where the treatment really does change what those
  principles now stand on. **Oral treatment notes pass no `edge_treatment`** — an
  account of what a judge said orally records the treatment edge and nothing more
  (design decision D4/D7).

`scope` narrows a treatment to part of a decision — a case distinguished on its
facts is not a case overruled, and saying so in `scope` is what keeps the pooled
authority usable.

`legal_commons__amend_authority` corrects an authority row's own identity —
title, url, authority_type. It is what a later **transcript upgrade** of an oral
decision calls, once the reasons acquire a real citation: push never updates an
existing authority row, so nothing else can.

## Court-rule periods — shared, never applied

The pool also holds **court-rule records**: one row per deadline-rule period a
practitioner verified locally against the rule's primary source (the
firm rule overlay that `lawyer:docket-clerk` keeps). They are a separate kind of row from
principles, with their own three tools. Probanda ships no procedure that pushes, pulls
or retires them; this section states the rules every caller keeps.

- **Push carries only verified records in the overlay shape.** The runtime refuses
  a record with a field outside that shape, a missing required field, a local
  status other than `verified`, or a client matter code anywhere in its text. It
  strips the local bookkeeping fields. A refusal names the field, never the text.
- **One current row per rule period, latest wins.** A rule period is one
  jurisdiction, enactment, rule_ref, deadline type and start date. `rule_period_find`
  returns its latest live row, or its latest retired row when none is live. A row
  is retired when `retired_at` is set. No row carries a status, a re-check count or
  who contributed it.
- **A pooled record never drives a calculation until the lawyer's own live
  re-check.** A pulled record lands locally as unverified and becomes usable only
  after a live re-check against its primary source and the practitioner's
  approval.
- **Identity is an opaque per-install id**, minted by the runtime. No tool takes
  it as an argument, and it names no one. The contributing install may retire its
  own row; any install may retire a row by naming the plugin version that now
  ships the same rule.

## Configuration

The runtime holds a single static credential: the key Probanda gave this machine
(the project secret on a maintainer's machine). The same key serves the
lawyer plugin's Suggestion Box. There is no login, unlock, or session step, and no
embedding/model API key (retrieval runs entirely in Postgres).

The credential is supplied once per machine through the lawyer plugin's
`cloud_key__configure_credential`, which returns a link to a page on this computer. The
practitioner pastes the key on that page, never in chat; the page validates it and stores it
in Windows Credential Manager (practice-data's operations/credentials.md, "Probanda's key"). It cannot arrive as an environment variable in Cowork: Cowork
does not inject a plugin's configured secret into that plugin's MCP server process
(see `plugins/legal-commons/docs/ADR-002-key-delivery.md`). An environment variable
still wins where one is genuinely set, which is the Claude Code CLI / developer path.

On a "not configured" error, check `legal_commons__configure_status` first — it
reports whether this machine already holds a credential, and identifies which one
by a redacted hint, without exposing the key. If it reports one is configured but
calls still fail, the error names the cause (an unreadable stored file reads
differently from an absent one); do not work around it. If none is configured, call
`cloud_key__configure_credential` and send the practitioner the link it returns.
Never ask for the key in chat, and never echo it back into the transcript.

A practitioner who has no key asks Probanda for one: lawyer's practice-data, operations/credentials.md (Probanda's key).
