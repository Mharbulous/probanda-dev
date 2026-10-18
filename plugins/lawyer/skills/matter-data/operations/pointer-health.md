# Pointer health

Read `../shared/conventions.md` first.

For one active matter, pass the live host `matter_root` to a trivial
`matter_data__query` (`SELECT 1 AS ok`). Report exactly one line:

- `Pointer health: healthy` when the query succeeds without a warning;
- `Pointer health: healed — <warning>` when resolution reports breadcrumb drift;
- `Pointer health: unhealthy — <named error and remediation>` when it fails.

For a read-only firm sweep in a local E1 environment, run:

```text
python references/scripts/check_pointers.py "<Litigation - Documents root>" [--config "<AppData\Roaming\Coclerk\probanda.json>"]
```

The CLI validates pointer schema and roots, all three SQLite files and headers,
staged `PRAGMA user_version`, the evidence-dump header, stored-versus-selected
resolution, and optional firm roots. It never writes or heals pointers and exits
non-zero for any unhealthy row. Never run this direct-file utility in a mediated
sandbox; use the host-side query check there.
