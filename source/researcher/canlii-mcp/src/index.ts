#!/usr/bin/env node
// REGRESSION-PRONE: CanLII-first research has recurred repeatedly. See docs/design/2026-09-24 research-lawyer Westlaw-first fix plan.md before editing. Tests: legal-research/tests/.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";
import { CanliiClient } from "./client.js";
import { loadApiKey } from "./dpapi-store.js";
import { createServer } from "./tools.js";

export { errorResponse } from "./tools.js";

// Version is injected at bundle time by esbuild `define` (scripts/bundle.mjs).
// Do NOT read package.json at runtime: the packaged plugin ships only dist/, so a
// runtime require("../package.json") crashes the server at startup in the installed copy.
declare const __CANLII_VERSION__: string;

async function main() {
	const client = new CanliiClient();
	// Resolved before the transport connects: env var first (Claude Code CLI
	// inherits the user env), then the DPAPI-persisted credential — the only path
	// that reaches Cowork's LocalSystem VM service, see dpapi-store.ts.
	const resolved = await loadApiKey();
	client.key = resolved.key;
	client.keySource = resolved.source;
	client.credentialError = resolved.error;
	if (resolved.error) {
		process.stderr.write(
			`canlii-mcp: stored credential could not be read — ${resolved.error}\n` +
			"Starting without a key; call configure_credential to supply one.\n"
		);
	}

	const server = createServer(client, __CANLII_VERSION__);
	const transport = new StdioServerTransport();
	await server.connect(transport);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
	main().catch((error) => {
		console.error("Fatal error:", error);
		process.exit(1);
	});
}
