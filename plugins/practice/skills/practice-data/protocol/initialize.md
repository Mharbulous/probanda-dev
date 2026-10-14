# Database Initialization Protocol

Run this protocol when `coclerk.json` does not exist at `AppData\Roaming\Coclerk\coclerk.json` relative to the current user's home directory. If `COCLERK_CONFIG_PATH` is set, test the file it names instead (see practice-data's Configuration section), and if that file is missing, stop and report it: never create or write the Roaming file in its place.

This protocol writes **only the config file**. It never creates a database and never
chooses a database location: the practice database always lives at
`<case_data_root>\_practice\practice.db`, and the MCP runtime creates it — schema and
all — on first connect. There is nothing to place by hand, and placing one by hand is
how stray databases appear.

## Step 1 — Ask the user to identify their case-data folder

Tell the user:

> "I need to know where your practice data should live. Coclerk keeps it in a `0. CASE DATA` folder alongside your matter folders — matter information, retainer balances, deadlines. It stays on your computer and is never sent anywhere. Point me at that folder (or at where you'd like it created) and grant me access so I can read and update it."

Use `request_cowork_directory` to have the user select that folder. If the user doesn't
grant access, stop and explain that the folder is needed to locate the database.

Record its absolute path as `case_data_root`. Do **not** ask for a database name or a
database folder — the filename is fixed (`practice.db`, overridable only by the
`COCLERK_DB_NAME` env var for tests) and the `_practice\` subfolder is created by the
runtime.

## Step 2 — Ask for accounting system

Use AskUserQuestion:

> "What accounting system do you use for your practice?"

Options:
1. **UNITY** — "UNITY Accounting / UNITY4"
2. **QuickBooks** — "QuickBooks Online or Desktop"
3. **Clio** — "Clio Manage"
4. **Other** — "You'll be prompted to type the name"

## Step 3 — Privacy and Data Storage Briefing

Before writing the config, brief the user on how their data will be handled. Cover all three points conversationally — do not dump a wall of text:

1. **Local storage.** The database will remain on their local computer. Claude will only query it in response to their requests during active sessions. No client data is uploaded to Anthropic's servers as part of the database workflow.

2. **Training opt-out.** Recommend visiting Claude's privacy settings and disabling the option that allows Anthropic to use conversations to train models. This adds an extra layer of protection for any client information that comes up in conversation. Provide the direct path: *Settings > Privacy > "Improve Claude" toggle*.

3. **Client name exclusion (optional).** For additional privacy, the user may choose to exclude client names from the database entirely, storing only client numbers and matter numbers. Explain the trade-off clearly: if names are excluded, Claude will not be able to recognize client names mentioned in conversation or tasks — the user would need to refer to clients by those numbers instead. Ask the user whether they want to include or exclude client names.

If the user chooses to exclude names, record this preference — it is saved in the next
step as `accounting.exclude_client_names`. When the flag is `true`, any import workflow
must skip the client name column and store `NULL` for the client name.

## Step 4 — Write coclerk.json

Resolve the path `AppData\Roaming\Coclerk\coclerk.json` relative to the current user's home directory (do not hardcode any username). Create the folder if it doesn't exist. When `COCLERK_CONFIG_PATH` is set, write nothing here: the file it names is the authority (practice-data's Configuration section).

Write the config file in exactly this shape — `case_data_root` is the key the runtime
reads, and a config lacking it fails path resolution:

```json
{
  "version": 1,
  "case_data_root": "<absolute path to the folder selected in Step 1>",
  "accounting": {
    "system": "<accounting system from Step 2>",
    "exclude_client_names": false
  }
}
```

Set `accounting.exclude_client_names` to `true` if the user opted to exclude client names in Step 3.

An existing config must be **updated in place**, preserving any keys already present
(notably `accounting.csv_mapping`, which the import workflows populate later).

The configured `case_data_root` must already exist. The runtime deliberately
refuses a missing root instead of creating a phantom `_practice` tree. If a
practice tool reports that `case_data_root` does not exist after a Windows
profile or library move, update this key to the current `0. CASE DATA` path;
`COCLERK_DB_PATH` remains the explicit test/override seam.

## Step 5 — Confirm and return to the calling skill

Verify the config resolves by invoking any read operation through this skill (for
example **matter-lookup**). An empty result is fine on a fresh install — a
path-resolution error is not, and means `case_data_root` is wrong.

Tell the user: "Your practice database is set up under `<case_data_root>\_practice\`. You're all set."

Initialization is complete. Hand control back to whichever skill triggered practice-data. That skill can now proceed with its normal workflow.
