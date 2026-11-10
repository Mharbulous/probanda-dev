# What supports this charge?

Use when the practitioner asks what supports a line on an issued invoice. The answer comes from stored records alone: fetch nothing and read no source again.

1. Call `practice_data__invoice_lines_query` with the matter and the invoice number, for the frozen copy's path and hash (`snapshot_path`, `snapshot_hash`). With neither, say the invoice was not issued with a frozen copy, and show the invoice's recorded lines and entries.
2. Run `scripts/defend_line.py` with `--snapshot`, `--hash`, and `--date` and `--person` if the practitioner named a line. Run it with the host Python (`python`; if that is the WindowsApps stub, the interpreter `COCLERK_PYTHON` names).
3. Show its answer as it stands. It covers the time entries, the evidence, the practitioner's rulings, any estimate and its basis, each trim or write-off, the invoice's description and the rate's source.
4. If it says the frozen copy has changed, say so first. Then give the recorded lines from step 1, and say they cannot be checked against the copy.
5. Add any adjustment from step 1 made since the invoice issued. The frozen copy cannot hold those.
