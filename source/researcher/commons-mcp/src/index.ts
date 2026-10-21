import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { pathToFileURL } from "node:url";

import { dispatchTool, type DispatchContext } from "./dispatch.js";
import { LegalCommonsClient } from "./legal-commons/client.js";
import { loadLegalCommonsConfig } from "./legal-commons/config.js";
import { buildToolDefinitions } from "./schema-gen.js";
import { loadTroubleshootConfig } from "./troubleshoot/config.js";

export { buildToolDefinitions } from "./schema-gen.js";
export { callTool, dispatchTool } from "./dispatch.js";

// The legal-commons runtime serves two namespaces, each against its own
// static-credential Supabase project: the layer-3 `legal_commons__*` pool and
// the `troubleshoot__*` store of generic tooling fixes. Both are matter-free
// with no per-session login/unlock gate, so the context holds one client per
// project. A third namespace, `suggestion_box__*`, saves an expressly submitted
// suggestion about the plugin in Probanda's Cloud with the pool's client and
// key. Local practice/case data lives in the Probanda plugin's runtime.
export async function createDispatchContext(env: NodeJS.ProcessEnv = process.env): Promise<DispatchContext> {
  const poolConfig = await loadLegalCommonsConfig(env);
  const legalCommons = new LegalCommonsClient(poolConfig, () => loadLegalCommonsConfig(env));
  // The store's env guard compares against the pool's loaded URL and key, so it
  // is handed this config rather than loading the pool's credential a second time.
  const troubleshoot = new LegalCommonsClient(await loadTroubleshootConfig(env, poolConfig));
  return { legalCommons, troubleshoot };
}

export async function start(): Promise<void> {
  const context = await createDispatchContext();
  const server = new Server(
    { name: "legal-commons-mcp", version: "0.5.0" },
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
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  start().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    process.exit(1);
  });
}
