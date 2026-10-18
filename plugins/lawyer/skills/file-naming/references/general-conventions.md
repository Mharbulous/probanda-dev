# General conventions + edge cases (shared)

Every housekeeping subagent gets this file **plus** its own folder-type code
chunk — and nothing else. This file holds the rules that are the same across
all folders, and the protocol for what to do when your scoped chunk doesn't
cover a situation. Your folder chunk overrides this file only where it is more
specific about codes; the format and the edge-case protocol here always apply.

## The naming format

```
YYYY-MM-DD CODE Author/Recipient re/encl/srv Subject or description $Amount [FILED/UNFILED/signed]
```

**Worked example:** `2023-01-31 RCPT Alexei re tenant rights $288.88`

| Component | Value in example |
|---|---|
| Date | `2023-01-31` |
| Code | `RCPT` |
| Author/recipient | `Alexei` |
| re / encl / srv | `re` |
| Subject or description | `tenant rights` |
| Amount | `$288.88` |

Not every component appears in every name — include only the ones that apply
(`$Amount` only for financial documents; `FILED/UNFILED/signed` only for court
documents).

## Date

- The date of a document is the date it was **created or last modified**.
- The date of an **unfiled** court document is the date it was **signed**.
- The date of a **filed** court document is the date of the **court stamp**.
- Use zeroes where part of the date is unknown:
  - `0000-03-01` = March 1, year unknown
  - `0000-00-00` = no date at all

## Code

Always use the firm's standardized **UPPERCASE** shorthand code for the
document type — the tables live in your folder-type chunk. Standardized codes
are the whole reason the convention exists: they make keyword search reliable.
A generic description defeats that purpose even when it's accurate.

**Building a multi-word code.** When a document type has a multi-word name,
build the code as an initialism of **all significant words first**, then shorten
only if needed:

- Full acronym **≤ 3 characters** → keep as-is, even with a preposition.
  "Affidavit of Service" → `AOS` (3 chars; "of" stays).
- Full acronym **> 3 characters** → drop prepositions / minor words to shorten.
  "Affidavit of Attempted Personal Service" → drop "of" → `AAPS` (not `AOAPS`).

Exception: the affidavit codes `AFFPS` / `AFFOS` use a deliberate `AFF`-prefix
convention rather than a pure initialism. This rule does **not** force renaming
them.

**Collision rule.** Before registering a new code, check the initialism these
rules produce against every code already in `code-registry.md` — including the
deprecated/synonym table. If it is taken, the existing code keeps its meaning:
never reuse or overload it, and never redefine it. Give the new type a short
distinctive whole word or extended form instead ("Notice of Appeal" → `APPEAL`,
because `NOA` is Notice of Application), and add a disambiguation note beside
both entries. Codes are minted only by editing the registry — a subagent that
meets a document type with no code logs a type-(2) instruction gap and leaves
the file alone; it never invents one.

## Author / Recipient

To stay consistent with Casemap and keep keyword search reliable, names are
**Lastname + first initial, no space**:

- "Jane Smith" → `SmithJ`
- "Michael B. Jordan" → `JordanM`

For a **multi-word given name**, take the initial from the **first word only**
— same as the single-given-name rule, not both syllables:

- "Mei Lin Tan" → `ZhouS` (not `ZhouSC`)
- "Wen Li Hao" → `ZhengY` (not `ZhengYQ`)

For **corporations, banks, and government bodies**, use the entity's accepted
initialism or short-form name — not the `LastnameFirstInitial` pattern, which
applies only to individuals:

- Royal Bank of Canada → `RBC`
- Insurance Corporation of British Columbia → `ICBC`
- Attorney General of British Columbia → `AGBC`

If no widely accepted initialism exists, use a compact but unambiguous
truncation (e.g. `CityVancouver`).

**Lawyer and law firm both on the document — the lawyer governs.** A
letter signed by a named lawyer on a law firm's letterhead takes the
**signer's** `LastnameFirstInitial` token, not the law firm's. The same rule
applies to the recipient side: a letter addressed to a law firm for the
attention of a named lawyer takes that **lawyer's** token. Use the law firm's
short-form name only when no individual signs (author side) or is named as the
addressee (recipient side). When more than one individual is named, take the
**first-named** one. This rule chooses between a lawyer and their law firm
only. Which of two individuals counts (e.g. an assistant sending for a cc'd
lawyer) is settled by your folder chunk.

- Northgate Law LLP letterhead, signed "Jane Smith" → `SmithJ`
- Signed by Jane Smith and Bob Lee → `SmithJ`
- Addressed to Northgate Law LLP, "Attention: Jane Smith" → `SmithJ`
- Addressed to Northgate Law LLP, no named lawyer → `NorthgateLaw`

## re / encl / srv

Flag whether the document **serves** something (`srv`), merely **encloses**
something (`encl`), or is neither (`re`). Service usually triggers a deadline
under legislation or a contract, so getting `srv` vs `encl` right is how the
firm spots triggered deadlines. Read the **operative language** of the document
itself, not just a cover note:

- `srv` — *"Take notice that you are in default of the terms of lease, and your
  lease will be terminated in accordance with clause 5 if the default is not
  corrected within the time allowed under the lease."*
- `encl` — *"Please find enclosed our proposed terms of agreement."*
- `srv` — *"Please find enclosed Notice to Admit."* (despite the word
  "enclosed," this triggers a deadline, so it's `srv`, not `encl`)

A document can carry **more than one** flag — combine them when it both demands
something on a deadline and encloses/serves a supporting document (e.g.
`re demand letter srv RTB order`).

## Subject or description

Brief but descriptive enough to avoid duplicate names — and don't just restate
what the code already says:

- ❌ `2020-10-29 LT DorstB srv Notice of Civil Claim` — too generic; fails to
  use the available code (`NOCC`)
- ✅ `2020-10-29 LT DorstB srv NOCC Smith v. Jones` — uses the code, and the
  party names add the distinguishing detail

## Amount

Where a precise dollar amount applies (payments, invoices, receipts, deposits,
settlements), include it — it makes the firm's accounting records searchable.

## Revision suffix

Later copies take ` v2`, ` v3`…, never `(v2)`. A non-court PDF for signature ends `UNSIGNED`: `… v2 UNSIGNED.pdf`.

## FILED / UNFILED / signed

For court documents, a trailing marker records status — filed with the court,
unfiled, or signed-but-unfiled. Combine with the date rule above (signed date
for unfiled, court-stamp date for filed).

---

# Edge-case protocol — read before you fall back

This is the part that powers the self-improving loop. **Whenever you step
outside your own folder chunk** — you have to consult *this* file for a rule
your chunk didn't give you, or you reach a point where you'd have to ask the
human for direction — **stop and record an escape-log entry**, then classify
*why* you had to step outside. Exactly two classifications exist.

### Classification (1) — One-off anomaly

The fallback was the correct move and there's nothing wrong with your
instructions. Examples:

- **Corrupted / unreadable file** — you can't open it or it has no recoverable
  content.
- **Misfiled document** — the file is sitting in your folder but, by its
  content, clearly belongs to a *different* folder type (e.g. a court pleading
  parked in the correspondence folder; an invoice in the law folder). See the
  misfiled-file rule below.
- **Truly idiosyncratic one-offs** — something you would not expect to recur
  and that no reasonable chunk would pre-empt.

For a type-(1) escape: do the safe thing (leave the file alone / put it on
manual review), record it in your escape log as **type (1)** so the
orchestrator can see your reasoning, but understand that the orchestrator will
**discard it** — nothing is logged or carried forward. No instruction needs
changing.

### Classification (2) — Instruction gap

Your own folder chunk *should* have covered this but didn't. Examples:

- A document type that plainly belongs to your folder but has **no code** in
  your chunk.
- A rule in your chunk that is **ambiguous** for a case you actually hit.
- A **missing example** that would have let you decide confidently (e.g. a
  `srv` vs `encl` call your chunk didn't illustrate).

For a type-(2) escape, record an escape-log entry with **all three** of:

1. **Triggering file/situation** — the file name and one line on what it is.
2. **What your chunk currently says** — quote the relevant rule, or state that
   the chunk is **silent** on this.
3. **What was missing** — the specific document type, rule, or example your
   chunk needed in order to handle this without falling back.

Under `/route-accounting`, the orchestrator turns every type-(2) entry into a
ready-to-paste "review and refine" prompt at the end of the same run, so the
gap gets fixed immediately. Under `/housekeeping`, every type-(2) entry is
recorded as a rule gap for the convention maintainer. Either way, you do
**not** defer it or try to fix your own instructions mid-run.

### Deciding between (1) and (2)

Ask: *"Would I expect a file like this to show up again in a folder like
mine?"* If yes, and my chunk had no answer → **(2)**. If it's a corrupted file,
a stray misfiled document, or a genuine one-off → **(1)**. When genuinely
torn, prefer **(2)**: a surfaced prompt or a recorded rule gap the user can
ignore is cheaper than a real gap that stays hidden.

## Misfiled-file rule

If a file's *content* shows it belongs to a different folder type than the one
you're reviewing:

- **Do not rename it** to your folder's codes, and **do not move it** (you have
  no move/rename tools anyway).
- Put it on your **needs-manual-review** list with a one-line note naming the
  folder type it probably belongs in (e.g. "appears to be a court pleading —
  belongs in Court File").
- Log it as a **type-(1)** escape. Misfiling is an anomaly of *where the file
  lives*, not a gap in *your naming rules* — so it does not generate a
  refine-prompt or a recorded rule gap.

## When you can't pin a component down

If, after reading the file, you can't confidently determine the date, the code,
the parties, or any other required component — **don't guess.** A wrong rename
hides deadlines and breaks search; that's worse than leaving the file alone.
Put it on the needs-manual-review list with a short reason. (Note: not knowing
*which code applies* because your chunk lacks one is a type-(2) gap; not being
able to *read the parties off a blurry scan* is just manual review, not an
escape.)
