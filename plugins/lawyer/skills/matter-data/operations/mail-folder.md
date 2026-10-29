# Operation: mail-folder

Read [`../shared/conventions.md`](../shared/conventions.md) first; derive the live `matter_root` per §2.2 and halt on any tool error per §2.3.

The matter's mail folder is the path of the folder in the practitioner's mailbox that holds this matter's correspondence, exactly as `mail__list_folders` returns it. How the folder is found and checked is [`../../shared/matter-mail.md`](../../shared/matter-mail.md); this operation only reads and records it. It is not a matter-level completeness key: `profile` never reports it missing. Decision #77.

## Read

```sql
SELECT value FROM matter_metadata WHERE key = 'mail_folder';
```

Return the value, or say that no mail folder is recorded. No row is not an error.

## Record

Record only a folder the caller has checked with `mail__folder_status`. Run Read first, so the report can name the old value. `matter_data__execute` takes no bind parameters (§2.4), so pass the path as a quoted SQL literal with every `'` doubled, byte for byte as given, double spaces included:

```sql
INSERT OR REPLACE INTO matter_metadata (key, value) VALUES ('mail_folder', '<path>');
```

Run it in one `matter_data__execute` call. Report the old value, if any, and the new one.
