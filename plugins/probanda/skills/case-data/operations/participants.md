# Operation: participants (resolve a name; record an alias or a tribunal member)

Read [`../shared/conventions.md`](../shared/conventions.md) first; derive the live `matter_root` per §2.2; halt on any tool error per §2.3. A **participant** is a party, a party's counsel, a witness (an expert is a witness) or a tribunal member, and an **alias** is another recorded spelling or a file code. Design: `../references/design-decisions.md` #65, #66.

Two paths: **resolve** (read-only, any caller) and **record** (a write, only on the practitioner's approval).

---

## Resolve — what could this name mean, and how is it spelt on file?

Callers: `/find-document` before it searches, the inbound-correspondence notice matching a sender, ingest's file-name check (`ingest-extract.md`), and any question like "who is Quilfether?".

Call `case_data__resolve_participant` with `matter_root` and the name exactly as given: a full name, a surname, `Surname, Given`, `J. Surname`, or a file code such as `SmithJ`. Do not normalise or correct it first; the resolver folds case, accents, apostrophes and hyphens itself.

Return the result to the caller as it came, and keep these rules when you report it:

- **`ok`** lists `matches`, exact ones first. Each match carries `role` (`party`, `counsel`, `witness`, `expert`, `tribunal`), `name`, `capacity` (a tribunal member's capacity, a party's proceeding roles, counsel's clients or an expert's field), `body` (a tribunal member's forum), `match`, `matched` (the recorded text that matched) and `search_terms` (every name, alias, file code and surname on record for that participant). A caller searching files searches every one of `search_terms`.
- **A `near` match is a lead, never an identity.** Say "near" and give its `distance` wherever you show one, for example "near match (1 letter off): Moira Quillfeather, arbitrator". Never write a near match's name as though the request had named that person, and never record anything because of one without asking (below).
- **More than one match** means the name is ambiguous. Show them all, and let the caller search for all of them or ask which one is meant.
- **`not_found`** is not an error. The caller searches the name as given, and says that no participant on record matched it.
- **`unavailable`** carries its reason (no case data for this matter, or a database behind the current schema). The caller carries on without the resolver and says why. A version reason is [`migrate.md`](migrate.md)'s business, not this operation's.

---

## Record — an alias, a file code, or a tribunal member

**No row is written without an approval turn.** Before every write, show the practitioner the exact row in plain words and ask, for example: *"Record "Guillfeather" as another spelling of Moira Quillfeather (arbitrator)?"* Write only on a clear yes in their reply to that question. Silence, a yes to something else, or a near match the resolver found is not approval. One question may list several rows, and a yes then covers exactly the rows listed.

Read [`../references/schema.sql`](../references/schema.sql) (`tribunal_members`, `participant_aliases`) before composing the script. Inline every text value as a SQL string literal with single quotes doubled; `case_data__execute` takes no `params`. `approved_on` is always `date('now','localtime')`, computed in the statement (conventions §10), never typed.

**An alias.** Choose the owner from the resolve result: a party's row; the same party's row with `of_counsel = 1` for that party's counsel; a witness's row; or a tribunal member's row. Exactly one owner is set. `alias_kind` is `file_code` for a file-name author/recipient token (`QuillfeatherM`), else `spelling`.

```sql
INSERT INTO main.participant_aliases
  (party_id, of_counsel, witness_id, tribunal_member_id, alias_text, alias_kind, approved_on, notes)
VALUES (<party_id|NULL>, <0|1>, <witness_id|NULL>, <tribunal_member_id|NULL>,
        '<alias>', '<spelling|file_code>', date('now','localtime'), <'<where it was seen>'|NULL>);
```

The unique index refuses the same alias twice for one owner, ignoring case. That refusal means the alias is already on record: report it, and do not retry.

**A tribunal member.** Record one when a document or the practitioner names a judge, associate judge, arbitrator, tribunal member or registrar the matter deals with, and the resolver does not already know them. `capacity` is the forum's own word, `tribunal_body` the forum's name, and `proceeding_id` is set only when they act in one proceeding of this matter.

```sql
INSERT INTO main.tribunal_members (name, capacity, tribunal_body, proceeding_id, notes)
VALUES ('<name>', <'<capacity>'|NULL>, <'<body>'|NULL>, <proceeding_id|NULL>, <'<note>'|NULL>);
```

Parties and witnesses are not created here. Those come from ingest ([`ingest.md`](ingest.md)) and order effects ([`order-effects.md`](order-effects.md)).

After the write, re-run **resolve** on the new alias or name and confirm that it comes back `exact`. Report the confirmation.
