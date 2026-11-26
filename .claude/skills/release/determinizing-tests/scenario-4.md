# Scenario 4: Server src changed with no bundle rebuild

## Input

Clone at cc362afc plus one local commit appending a comment line to source/lawyer/mcp/src/call-log.ts. The clone is a scratch copy of probanda-dev; it runs that commit's own `scripts/`.

## Expected behavior

--check exits 0 (dist/ unchanged). release_changes.py exits 1 with `rebuild: source/lawyer/mcp` for each plugin that ships a server built from that folder. Those plugins form the release set; the bundle commands are tsc then bundle.mjs for source/lawyer/mcp.
