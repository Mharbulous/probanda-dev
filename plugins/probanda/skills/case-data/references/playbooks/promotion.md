# Playbook: promotion (privileged → producible)

**Fires when:** a privileged source becomes producible — the client waives privilege, or the lawyer decides the material is no longer privileged and must be disclosed.

## Why this is a two-row pattern, not a move

`privileged.sqlite` is a physically separate database from `main.sqlite`. SQLite cannot declare a cross-database foreign key, so no FK path can ever connect privileged material to admissible evidence (`main.evidence_links`, `main.positions`). That firewall means promotion can never *move* a row from privileged to main — it can only *add* a new main-side row that happens to describe the same underlying document. **Promotion never deletes.** The `privileged.privileged_sources` row stays forever; it is the permanent record of how the document was originally discovered and treated.

## Steps

1. Resolve the pointer and read `shared/conventions.md` first, as with every operation.
2. Confirm with the user that the source is being promoted (client intent/waiver — this is a judgment call, never a schema check).
3. Read the row from `privileged.privileged_sources` to get its `file_path` and `file_hash`.
4. Insert a **new** row into `main.sources`:
   - `file_hash` = the same hash as the privileged row (this is the join key for lineage).
   - `category` = the appropriate `main.sources.category` value (`court | correspondence | production | work_product | disbursements`) based on what the document actually is now that it is producible.
   - `title`, `description`, `date`, `file_path`, `proceeding_id`, `filed_by_party_id` populated from the privileged row / user confirmation as applicable.
   - `listed` = 0 unless the user confirms it should already be on the list of documents (see `lod-amendment.md` if it needs to be added later).
   - `verified` = 0 (or 2 if any field carries a prefixed note — see `shared/conventions.md` §5).
5. **Do not delete or modify** the `privileged.privileged_sources` row. It remains exactly as it was.
6. The two-row lineage is discoverable by matching `file_hash` across `main.sources` and `privileged.privileged_sources` — this is the only linkage; there is no FK.
7. Run the dump (`shared/conventions.md` §8) after the mutation.
8. Report both rows to the user: the new `main.sources` row (id, category, file_path) and the retained `privileged.privileged_sources` row (id, category), and state that the lineage is by matching `file_hash`.

## What this playbook does not do

- It does not touch `privileged.fact_provenance` — see `provenance.md` for facts learned from the source.
- It does not create `main.evidence_links` rows automatically. If the newly-producible document is itself proof of a fact, link it separately, following the normal evidence-linking rules for the operation that discovers the link.
