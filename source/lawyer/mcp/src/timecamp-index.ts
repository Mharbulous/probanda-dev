// The timekeeper plugin's `timecamp` server: the TimeCamp API connector
// (docs/Specs/2026-10-15_timecamp-api-connector-spec.md). A third entry point
// in this package, bundled by scripts/bundle.mjs to
// source/timekeeper/timecamp-mcp/dist/timecamp-mcp.js. It imports nothing from
// the data server's stores, so the bundle holds none of their schema text.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { pathToFileURL } from "node:url";

import { loadToken } from "./timecamp/client.js";
import { dispatchTimecampTool, timecampToolDefinitions } from "./timecamp/tools.js";

export async function start(): Promise<void> {
  const state = await loadToken();
  const server = new Server(
    { name: "timecamp-mcp", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: timecampToolDefinitions(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    dispatchTimecampTool(state, request.params.name, request.params.arguments ?? {})
  );

  await server.connect(new StdioServerTransport());
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  start().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    process.exit(1);
  });
}
