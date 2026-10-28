# Folder map: where this practitioner keeps each kind of document

Every practitioner files differently, so Probanda assumes no layout. Each practitioner has their own folder map: for each document type in `shared/document-types.md`, the folders in a matter where they keep it. The skills that scan, route or check a matter's documents read it through `practice_data__folder_map`. The map belongs to the roster person this device names (Step 4), so it is set up once per person and holds on every device they use.

Two folders are not part of the map, because Probanda files its own work there:

| Folder | Used for |
|---|---|
| one folder in each matter whose name starts with `0. DRAFT` | drafts, Milestones, published court documents and superseded versions |
| `6. LAW\<issue>\` in each matter | filing legal research and downloaded authorities |

When the practitioner's matters lack either, say what it is used for and advise adding it to each matter or to their matter template. A practitioner who keeps drafts or authorities there maps those types to them like any other folder.

## Procedure (step 6 of setup)

1. Call `practice_data__folder_map` with no arguments. Keep its `document_types`. When it says this device names no person, run Step 4 first, then call it again. With `status` `ok`, a map is already recorded: show it under `/show-me` as a table of type name and folders, and ask whether to keep it or revise it. Keep ends this step.
2. List a typical matter folder's subfolders, two levels deep, read only. Open no file in it.
3. Propose a map: for each document type, the subfolders that hold it, judged from the folder names and the type definitions. One type may have several folders, and one folder may serve several types. Write each folder as a glob relative to the matter folder, with `*` where matters differ (a court file number, a party's name, a trailing plural). Leave out a type the practitioner does not seem to keep. Name every subfolder the proposal does not use.
4. Show the proposal, one row per type: its name, its definition and its folders.
5. Call `practice_data__set_folder_map` with the whole map. Relay a refusal word for word and correct the map.
6. Change nothing on disk. Setup never creates, renames or moves a folder inside a matter. The practitioner makes any change they choose.

A kind of document that fits no type is proposed as a new type through `/suggestion`.
