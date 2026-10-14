import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { pathToFileURL } from "node:url";

import { LocalPracticeAdmin } from "./practice/backend.js";
import { dispatchTool, type DispatchContext } from "./dispatch.js";
import { startPageApi } from "./page-api/server.js";
import { buildToolDefinitions } from "./schema-gen.js";

export { buildToolDefinitions } from "./schema-gen.js";
export { callTool, dispatchTool } from "./dispatch.js";

// Every namespace this runtime serves is local-backed: SQLite through the host
// Python `sqlite3` module, or the host file system. The full tool list is
// buildToolDefinitions(). There is no Supabase surface and no per-session
// login/unlock gate, so the context holds only the local practice backend.
export async function createDispatchContext(env: NodeJS.ProcessEnv = process.env): Promise<DispatchContext> {
  const practiceDb = new LocalPracticeAdmin(env);
  return { practiceDb };
}

export async function start(): Promise<void> {
  const context = await createDispatchContext();
  const server = new Server(
    { name: "litigation-mcp", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: buildToolDefinitions(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    dispatchTool(
      context,
      request.params.name,
      request.params.arguments ?? {}
    )
  );

  await server.connect(new StdioServerTransport());

  // The matter pages' localhost write path (page-api/server.ts). Never fatal: the tools work without it.
  startPageApi().catch((err) => console.error(`[page-api] listener off: ${err instanceof Error ? err.message : String(err)}`));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  start().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    process.exit(1);
  });
}
