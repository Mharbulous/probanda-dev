# Folder layout: the defaults and how to map a practitioner's own

The skills assume the layout of the practice Probanda was built for. Each convention is owned where its "Owned by" entry says, and that owner stays the source of truth. This table lists the conventions only so that setup can compare. It does not restate them.

| Default | Owned by | How it is found | Used for |
|---|---|---|---|
| `0. CASE DATA\` beside the matter folders, holding `_practice\` and one `<matter_id> <short_name>\` folder per matter | `matter-data/shared/conventions.md` §2.1 | Probanda's own. Setup creates it (step 3). matter-data's initialize creates the per-matter folders | every practice and matter-data tool |
| `4. LAWYER BRIEF\` directly in each matter folder | `matter-data/shared/conventions.md` §2.2 (root proof) | fixed name | proving a matter folder before case data is set up or written |
| `0. DRAFT*\` in each matter folder, exactly one | the data server, which looks for the one folder whose name starts with `0. DRAFT` | name prefix | drafts, Job Boards and published court documents |
| `6. LAW\<issue>\` in each matter folder | the data server's research filing tools | fixed name `6. LAW` | filing legal research and downloaded authorities |
| `2. SOLICITOR CLIENT`, `3. CORRESPONDENCE`, `5. COURT FILE#…`, `7. DISCOVERY`, `8. TRIAL BRIEF`, `9. DISBURSEMENTS` | the litigation-matter filing profile | matched by keyword, not by exact name | file naming and filing reviews, finding correspondence and court documents |
| A matter template at `<document root>\ADMIN\0. TEMPLATE\L### Litigation\` | `matter-data/operations/matter-skeleton.md` | fixed path. When it is missing, matter-skeleton asks the practitioner | setting up a new matter's folders |

## Procedure (step 6 of setup)

1. Ask the practitioner to name one typical matter folder. List its subfolders, read only. Open no file in it.
2. Show a table under `/show-me` with these columns: each default from the table above, the practitioner's subfolder that matches it under the "How it is found" rule (or "none"), and what it is used for.
3. For each row:
   - **Matched:** nothing to do.
   - **Keyword-matched default with no match:** say that Probanda will find nothing of that type in this practitioner's matters until a folder whose name contains the keyword exists.
   - **Fixed-name or prefix default (`4. LAWYER BRIEF`, `0. DRAFT`, `6. LAW`) with no match:** advise the practitioner to add a folder with that name to each matter, or to their matter template, and say what it is used for.
   - **The template is missing:** say that matter-data will ask where it is when it sets up a new matter.
4. Change nothing. Setup never creates, renames or moves a folder inside a matter. The practitioner makes any change they choose. Nothing about the mapping is recorded.
