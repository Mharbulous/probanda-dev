# Bill-of-costs working folder and state file

Read by `gather-disbursements`, `itemize-boc` and `calculate-boc`. It defines the
one folder and the one file the three members share, and where their facts and
their law are allowed to come from.

## The working folder

```
<case-data folder>/bill-of-costs/
```

The case-data folder is the one `probanda.json`'s `case_data_dir` names. The
chain is a Code-tab (PC) job: the Cowork sandbox cannot see this folder, so each
member refuses in Cowork before any tool call or file write (#1273).

`0. DRAFT` and the case-data folder must already exist. If either is absent, stop
and tell the practitioner (a missing case-data folder means the matter is not
initialized: name `/matter-data` initialize) — do not create it and do not write
elsewhere. Only the `bill-of-costs/` leaf is created on demand.

There is no fallback to any older folder name. A matter that has an older
bill-of-costs working folder from a previous run is starting again here.

## The state file

`bill-of-costs.json` sits in that folder. Plain JSON — no JavaScript wrapper, no
assignment statement. Whichever member runs first creates it; the others read it,
change their own part, and write the whole file back.

```json
{
  "styleOfCause": "Alpha Company Ltd. v. Beta Company Ltd.",
  "courtFileNumber": "S-241171",
  "registry": "Vancouver",
  "parties": {
    "plaintiff": ["ALPHA COMPANY LTD."],
    "defendant": ["BETA COMPANY LTD.", "GAMMA HOLDINGS INC."]
  },
  "partyClaimingCosts": "the Plaintiff, Alpha Company Ltd.",
  "costsOrder": "Order of Justice Example made 4 March 2026",
  "costsTerms": "Costs to the plaintiff in any event of the cause",
  "tariffScale": "Scale B",
  "unitValue": "110.00",
  "tariffItems": [
    { "no": "1", "description": "Correspondence, conferences, instructions, investigations or negotiations by a party until start of proceeding", "unitsClaimed": "3" }
  ],
  "disbursements": [
    { "date": "26 February 2024", "description": "Court filing fee — Notice of Civil Claim", "claimed": "200.00", "allowed": "", "category": "filing_fees" }
  ]
}
```

**Header** — `styleOfCause`, `courtFileNumber`, `registry`, `parties`,
`partyClaimingCosts`, `costsOrder`, `costsTerms`. Filled by whichever member runs
first, through the "Bill of costs details" elicitation form (below).

**Parties are role-keyed lists.** Each consumer derives the shape it needs: the
Form 62 filler wants one originating party string, one responding party string and
a role label for each; the Form 63 engine wants a list of plaintiffs and a list of
defendants. Storing lists keyed by role lets both be derived without either member
storing the other's shape.

**`disbursements[]`** — rows `{date, description, claimed, allowed, category}`,
written by `gather-disbursements`. `date` is its own field, not folded into the
description: the CSV agent parses it separately and the Form 62 template has a Date
column. `allowed` is always the empty string — the registrar fills it at the
assessment hearing. `claimed` is a plain decimal string with no currency symbol and
no thousands separator.

`category` is one of exactly these seven values:

`filing_fees`, `transcripts`, `expert_fees`, `photocopying`, `search_fees`,
`travel`, `other`.

Process serving, mediation and postage/courier have no category of their own; they
fold into `other`.

**`tariffScale`, `unitValue`, `tariffItems[]`** — written by `itemize-boc`.
`unitValue` is a plain decimal string. Each tariff item is
`{no, description, unitsClaimed}`, `unitsClaimed` a decimal string.

Form 63 (default judgment) bills use the header and `disbursements[]` only; they
never carry `tariffScale`, `unitValue` or `tariffItems[]`.

## The "Bill of costs details" form

Whichever member runs first and finds no state file renders one elicitation form
(`.claude/skills/shared/elicitation-widget.md`), inferring first and dropping any
group the conversation already answers:

1. Style of cause — `.elicit-textarea`
2. Court file number — short text input
3. Registry — short text input
4. Parties, by role — one `.elicit-textarea` per role, one name per line
5. Party claiming costs — short text input
6. Costs order and its terms — the order and the judge's name in a
   `.elicit-textarea`, the order date in an `elicit-date` input

Write the answers into the header and save the file before doing anything else.

## Sources of Authority

A bill of costs draws on different sources than a part-based form:

- **Facts** come from the practitioner's answers in the interview and from the
  disbursement CSV. Not from case data.
- **Law** — the Appendix B tariff — comes from the tariff reference file, validated
  by the tariff-checker subagent against live BC sources. Not from the matter's
  `6. LAW/` folder.
- **Prohibited:** training knowledge used as a substitute for either. If an
  interview answer is missing, ask. If a tariff reference cannot be verified, say so
  and let the practitioner decide.
