import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { pathToFileURL } from "node:url";

import { withCallLog } from "./call-log.js";
import { PracticeStore } from "./practice/store.js";
import { dispatchTool, type DispatchContext } from "./dispatch.js";
import { startPageApi } from "./page-api/server.js";
import { buildToolDefinitions } from "./schema-gen.js";
import { retryUnsent } from "./suggestions/send.js";

export { buildToolDefinitions } from "./schema-gen.js";
export { callTool, dispatchTool } from "./dispatch.js";

// Every namespace this runtime serves is local-backed: SQLite through the host
// Python `sqlite3` module, or the host file system. The full tool list is
// buildToolDefinitions(). The one cloud call is a practice write, which Probanda's
// Cloud must accept (practice/store.ts); there is no per-session login/unlock gate.
// The mail, calendar and contacts tools are the `contacts-calendars-email` server's
// (src/contacts-calendars-email-index.ts), not this one's.
export async function createDispatchContext(env: NodeJS.ProcessEnv = process.env): Promise<DispatchContext> {
  return { practiceDb: new PracticeStore(env) };
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

  // Every call is timed here, in one place (call-log.ts).
  const call = withCallLog(
    (name, args) => dispatchTool(context, name, args),
    new Set(buildToolDefinitions().map((tool) => tool.name))
  );
  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    call(request.params.name, request.params.arguments ?? {})
  );

  await server.connect(new StdioServerTransport());

  // The matter pages' localhost write path (page-api/server.ts). Never fatal: the tools work without it.
  startPageApi().catch((err) => console.error(`[page-api] listener off: ${err instanceof Error ? err.message : String(err)}`));

  // Suggestions not yet sent are sent again once per server start (suggestions/send.ts), in the
  // background, so a slow or unreachable cloud never holds up the tools. Never fatal.
  retryUnsent().catch((err) => console.error(`[suggestions] retry skipped: ${err instanceof Error ? err.message : String(err)}`));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  start().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    process.exit(1);
  });
}
