# Declared layout — the layout block of a type file and of `venue.md`

This file is the single source of truth for the **layout block**: the fenced JSON block that opens every type file in `/draft`'s knowledge tree and every `venue.md`. Its readers are `/draft`, `/localize` and its helper, and the runtime, which validates the block and stores it on a Writing at creation. Those components reference this file and do not restate it. It has no `SKILL.md` and is never wrapped. It ships only inside the litigation `.plugin`'s `skill-source/` mirror.

Where the files sit in the tree, how an item's `rule_ref`, passage and source are recorded, and how a firm confirms or corrects an item are in `shared/knowledge-tree.md`. Paper, margins and type are not layout. They belong to the venue physical-format file in `/publish`'s tree, whose contract is `shared/declared-format.md`.

Provenance: spec `Engineering/1. Design/2026-09-24_draft-generalization-and-localize-spec.md` §6 pieces 1 and 3, as amended on #1047 (2026-09-25).

## 1. The block and its validator

- **Placement.** The block is the first fenced `json` block in the file, after the front matter. A type file and a `venue.md` each carry exactly one. The prose below it is guidance for the drafting session and is not part of the contract.
- **The runtime is the single validator.** No skill, script or model checks the block on its own terms. The runtime validates it wherever a block is written or read for use: at `knowledge__write`, when a `corrected` value is substituted, and at Writing creation. It fails hard on any violation, naming the file, the field and the rule broken. There is no default for a missing required field and no repair of a malformed one.
- **Typography is not in the contract.** A block that declares a typeface, font size, line spacing, margins or paper fails.

## 2. Fields every type declares

| Field | Value | Rule |
|---|---|---|
| `renderer` | `bespoke` or `general` | `bespoke` renders through a filler registered for the venue key plus the stored kind. A `bespoke` type with no registered filler fails at compose, naming the venue, the kind and the missing filler. A `_NoVenue` type never has a filler. `general` renders through the general renderer. |
| `needs_forum_parts` | `true` or `false` | Whether the Writing prints parts only a forum supplies (a caption, a file number). A type declaring `true` that resolves under `_NoVenue` fails validation. |
| `title` | string | The Writing's title. `/publish` names the output from it. |
| `exhibit_numbering` | `proceeding` or `writing` | Whether exhibits number across the whole proceeding or restart for this Writing. |

`renderer` and `needs_forum_parts` never carry a `rule_ref` (section 7). They cannot be confirmed or corrected.

No type declares a folder code: each Writing's folder is named after the document (`shared/workspace-output-rule.md`). A type file an older build wrote may still carry `folder_code`. It is accepted, never cited, and read only to find a Writing folder an older build named with it.

## 3. Parts (`general` types only)

A `general` type declares `parts`, an ordered array. The renderer prints them in array order. A `bespoke` type declares no `parts`.

Each part is an object:

| Member | Value |
|---|---|
| `heading` | string, the part's heading as printed, or `null` for a part with none |
| `heading_numbering` | `none`, `part-roman`, `part-arabic` or `letter` |
| `paragraph_numbering` | `none`, `restart` or `continue` |
| `source` | one name from section 4 |
| `text` | the fixed sentence, present only when `source` is `literal` |
| `rule_ref` | present only when the part is cited (section 7) |

## 4. The `source` vocabulary

`source` is a closed vocabulary owned by the runtime. A part's `source` is one of:

- a **projection**, which prints Writing content the runtime already holds: `caption`, `orders-sought`, `facts`, `legal-basis`, `material-relied-on`, `witness-statements`, `positions`, `hearing-details`, `parties`, `addressee`, `sender`, `signature-block`, `terms`, `form-source`
- `slot:<name>`, a free-text slot. The part declares the slot and the Writing holds its text. A venue part that matches no projection is declared as a slot, never guessed.
- `literal`, a fixed sentence carried in the part's `text`

Four projections carry rules of their own:

- `addressee` and `sender` print the address and sender lines, which are the Writing's own text. They never read party roles. Who receives the Writing comes from the proceeding's service list, not from these lines.
- `signature-block` prints the signer's block (section 5, `signer`). The lines depend on the signer and on `letterhead`:
  - A `party` signer: a blank signing space, then the party's name.
  - A `lawyer` signer on a layout with `letterhead: true` (a letter): the roster `closing` and a blank line, a blank signing space unless the lawyer is the person on this machine, then the lawyer's name, designation and the firm name. No counsel line.
  - A `lawyer` signer on a layout without `letterhead: true`: no closing. A blank signing space unless the lawyer is the person on this machine, then the lawyer's name, designation, the firm name, and a counsel line, `Counsel for the {role}`, the same wording for every venue. The role is the role of the first party marked as the client, pluralised when more than one party in the proceeding shares that role. When no party is marked as the client, the line is a gap that shows on the mockup and never reaches the filed face.
  - The sentence "All of which is respectfully submitted." is not part of the block. A type that wants it declares a `literal` part before the `signature-block`.
- `terms` prints the Writing's ordered clauses. It serves any `_NoVenue` document with numbered operative clauses, such as a release, an undertaking or a settlement agreement. A slot cannot carry clauses because a slot holds no provenance, and `orders-sought` is relief asked of a forum.
- `form-source` stands for the saved copy of the published form whose fixed wording the Writing copies, which `/drafting-data` links to the Writing. Linked, it prints only a comment naming that document, which never reaches the filed face. Unlinked, it is a gap, rendered for the human and withheld from the forum, and the filed render refuses until a copy is linked. A venue's stock `unstructured` type declares it.

An unknown name fails at Writing creation. Adding a projection is a runtime change and a change to this file, made together.

## 5. Optional fields

| Field | Value | Rule |
|---|---|---|
| `goal_criteria` | array of names from section 6 | The Milestone's goal criteria for this type. |
| `companions` | array of names from section 6 | The companion documents rendered with this type. |
| `page_limit` | positive integer, pages | Shown only on the mockup, under a "Page budget" heading, which never reaches the filed face. |
| `letterhead` | `true` or `false` | `true` marks a letter: it renders through the firm letterhead and lets `signature-block` print the roster `closing`. Allowed on `general` types only. |
| `signer` | `lawyer` (the default) or `party` | Who signs. `lawyer` is a roster lawyer of the firm. `party` is a party to the proceeding, such as the client signing a release. `party` is allowed only where `letterhead` is not `true`, because a letterhead render requires a roster lawyer as signer. |
| `ingest_inputs` | array of document type ids from `shared/document-types.md`, any but a `never_ingest` type | The document types whose files this Writing's jobs read. The practitioner's folder map says which folders hold them. Session entry checks ingest coverage of those folders when the opened filing has a Ready job, and `/draft` refuses to claim a job on this filing while any of them holds an un-ingested file. With no folder map the check cannot run, and the session says so and offers setup. A type that reads no matter folder omits the key; an empty array fails. |

## 6. The goal-criteria and companion vocabularies

Both are closed and owned by the runtime. A name outside them fails.

**`goal_criteria` members.** Each is a condition on the Writing's Milestone card, met when nothing on the Writing's forum documents counts against it.

| Member | Card text |
|---|---|
| `orders-sought` | Every order asked for has a legal basis and a submission behind it |
| `orders-positioned` | Every order the applicant asks for has a position |
| `primary-authority` | Every proposition of law rests on primary authority |
| `excerpts` | Every excerpt is quoted, pinpointed and checked |
| `noting-up` | Note up all cited authorities |
| `evidence` | Every fact is proved by evidence in hand |
| `open-items` | Nothing is left open on the form |
| `opposing-points` | Every opposing point is answered |
| `counsel-review` | Counsel has reviewed every paragraph |
| `terms-traced` | Every clause traces to the offer or acceptance |
| `recipients` | The Writing is addressed to a recipient |
| `hearing-date` | The hearing date is recorded |

`terms-traced` counts 📑, 📌 and 📍 on clause rows. It is defined here and nowhere else.

`recipients` is met once the Writing has a recipient it is addressed to, a `To` recipient, which `/drafting-data` records. Without one, a Writing with only `cc` recipients included, the general renderer prints the line `🧩 no To recipient` where the `To` lines go, rendered for the human and withheld from the filed face, and this criterion counts it. It is a held criterion: the pre-send hold keeps the Writing from being recorded as sent until it is met or waived. It never refuses the filed render. A Writing created before its type declared `recipients` keeps its stored layout and is not held on it; a re-snapshot picks the criterion up.

On a `general` type, `open-items` also counts each 🧩 gap line the renderer prints: a part with no text, a projection with no rows, and a signer not chosen. It does not count `🧩 no To recipient` on a type that declares `recipients`, which counts it instead. So every `general` type that declares `goal_criteria` declares `open-items`, before `counsel-review`.

`noting-up` counts 📇 on each authority's line and each citation in the Writing's text that no authority row tracks: a neutral, reporter or statute citation, with or without a pinpoint, and a case name in italics. The runtime's citation scan finds them on every document that goes to the forum or the recipient, and `/drafting-data`'s `references/filing-checklists.md` §6b defines it. Every type that can carry a citation declares `noting-up`, which is every type in `/draft`'s tree. A Writing created before its type declared it keeps its stored layout and is not held on it; a re-snapshot picks the criterion up.

`hearing-date` is met once the Writing's hearing date is recorded, which `/drafting-data` records. It records a fact and is not a drafting criterion, so it never holds counsel's review, the filing-ready declaration or the gate.

`gate` alone is universal. Every card carries it and no type declares it. It prints after the declared criteria and before `hearing-date`, and it is unmet while any job on the board other than a gate job or a stock job is open, naming those jobs. A type that declares no `goal_criteria` shows a card saying none are declared, and that card never fires the filing-ready declaration.

`deadline:<type>` rows come from the practice link, never the type file: when `lawyer:docket-clerk` links a hearing anchor to the Writing, each of that anchor's deadlines prints as a row after `hearing-date`, met once the practitioner marks it met, in its anchor's date order (ADR 0013, second 2026-10-04 amendment). A type cannot declare one, and the card shows none on a type that declares no `goal_criteria`.

The card prints the declared criteria in their declared order, which is the order the practitioner works in. Counsel's review waits on the criteria declared above `counsel-review`.

**`companions` members.** One: `written-arguments`. A type whose venue document is itself the written argument does not declare it. Evidence indexes, witness statements and the documents of a bespoke multi-document package stay outside this vocabulary.

## 7. `rule_ref` on layout items

A layout item that rests on a published rule, a practitioner's instruction or another admitted source carries that item's `rule_ref`, the key under which the file records the item's passage and source (`shared/knowledge-tree.md` "Record contract").

- A part carries it as its `rule_ref` member.
- A cited scalar is written as `{ "value": <scalar>, "rule_ref": "<ref>" }` in place of the bare scalar. Only `title`, `page_limit` and `exhibit_numbering` in a type file, and the fields of a `venue.md` block, may be cited.
- An uncited item carries no `rule_ref`. A file may leave every item uncited.

## 8. The `venue.md` block

Where `venue.md` may exist is `shared/knowledge-tree.md` "Folder grammar". Its block holds the venue heading fields. At Writing creation the runtime merges them into the type's block before it validates and stores the result.

| Field | Value |
|---|---|
| `caption_lines` | string or array of strings: the court-name line or lines of the caption |
| `file_number_label` | string: the label before the file number |
| `registry_label` | string, or `null` where the venue has no registry |
| `party_roles` | object mapping each role key to its printed label |
| `display_label` | string: the venue's short name as shown to the practitioner |

A field outside this table fails. A venue key the renderer does not know fails hard and never renders with another venue's heading fields. A caption prints its registry row only for a venue whose `registry_label` is not null. It prints the file-number row for a venue with a registry, and for a venue with none only when the proceeding has a stored file number.

## 9. `corrected` values in this tree

How a correction is recorded and validated is `shared/knowledge-tree.md` "Confirmation sidecar". In this tree its value takes these shapes, and the validator it is substituted into is section 1's:

- A `parts[]` entry takes the whole part object: `heading`, `heading_numbering`, `paragraph_numbering` and `source` (with `text` for `literal`).
- A cited scalar takes the scalar.
- A cited prose-guidance item takes a string.
- A `venue.md` field takes the field's own type: a string or string array for `caption_lines`, a string for a label, an object for `party_roles`.

## Example

A fictitious `general` type, for shape only. It is not a shipped file.

```json
{
  "renderer": "general",
  "needs_forum_parts": false,
  "title": { "value": "Example letter", "rule_ref": "example-title" },
  "exhibit_numbering": "writing",
  "letterhead": true,
  "goal_criteria": ["primary-authority", "excerpts", "noting-up", "open-items", "counsel-review"],
  "parts": [
    { "heading": null, "heading_numbering": "none", "paragraph_numbering": "none", "source": "addressee" },
    { "heading": null, "heading_numbering": "none", "paragraph_numbering": "none", "source": "slot:body" },
    { "heading": null, "heading_numbering": "none", "paragraph_numbering": "none", "source": "signature-block" }
  ]
}
```
