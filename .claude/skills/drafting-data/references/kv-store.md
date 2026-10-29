# kv_store

Schema v80 adds `kv_store`, one generic table keyed by `(namespace, key)`, so that a new attribute of a row becomes a value here with no further DDL (migrations.sql 79 -> 80).

- **Values are JSON.** `value` holds one JSON text. `updated_at` is the time of the write.
- **The server tool that writes a value validates it.**
- **No namespace or key per tag type or link role** (Commandment 5). A namespace never encodes the rulebook.
- **Job or process state only.** A value never holds matter text that is revised, because the table carries no revision triggers: a write here moves no revision and re-renders nothing.
- **The namespace says what the value describes, and the key names the row**, for example `<table>:<id>`.
