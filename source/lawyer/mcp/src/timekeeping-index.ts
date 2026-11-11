// The billing plugin's `timekeeping` server: the same MCP setup as file-manager-index.ts, serving
// only buildTimekeepingToolDefinitions() (time_pipeline__* and review_date__*, issue 284).
// Bundled by scripts/bundle.mjs to source/billing/timekeeping-mcp/dist/timekeeping-mcp.js.
// It imports nothing from TimeCamp: TimeCamp is one practitioner's tool, never a core dependency of billing.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { pathToFileURL } from "node:url";

import { buildTimekeepingToolDefinitions } from "./schema-gen.js";
import { dispatchTimekeepingTool } from "./timekeeping-dispatch.js";

export async function start(): Promise<void> {
  const server = new Server(
    { name: "timekeeping-mcp", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: buildTimekeepingToolDefinitions(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    dispatchTimekeepingTool(request.params.name, request.params.arguments ?? {})
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
