// The file-manager plugin's `files` server: the same MCP setup as index.ts, serving
// only buildFileManagerToolDefinitions() (file_ops__* and housekeeping__*).
// Bundled by scripts/bundle.mjs to source/file-manager/files-mcp/dist/file-manager-mcp.js.
// It does not start the page API (index.ts, fixed port), which belongs to the
// legal plugin's `data` server. The housekeeping approval page server
// (port 0) runs in this process, so serve_page and wait_approval stay together.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { pathToFileURL } from "node:url";

import { dispatchFileManagerTool } from "./file-manager-dispatch.js";
import { buildFileManagerToolDefinitions } from "./schema-gen.js";

export async function start(): Promise<void> {
  const server = new Server(
    { name: "file-manager-mcp", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: buildFileManagerToolDefinitions(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    dispatchFileManagerTool(request.params.name, request.params.arguments ?? {})
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
