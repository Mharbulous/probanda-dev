import { DataServerError, ValidationError } from "./errors.js";
import { buildToolDefinitions, type ToolDefinition } from "./schema-gen.js";
import { validateToolInput } from "./validate.js";
import { callLegalCommonsTool, isLegalCommonsToolName } from "./legal-commons/tools.js";
import type { LegalCommonsClient } from "./legal-commons/client.js";
import { callTroubleshootTool, isTroubleshootToolName } from "./troubleshoot/tools.js";

export interface DispatchContext {
  // Layer-3 pool client. Uses a static credential and has no auth/crypto gate —
  // legal-commons is public/matter-free (spec §7 1a). Every legal_commons touch
  // still fires a permission prompt; that invariant lives in the allowlist config
  // (PP-1), not here.
  legalCommons: LegalCommonsClient;
  // Troubleshooting store client: the same client class against a separate
  // Supabase project, with its own credential file. Same permission-prompt rule.
  troubleshoot: LegalCommonsClient;
}

let definitions: Map<string, ToolDefinition> | undefined;

export async function dispatchTool(
  context: DispatchContext,
  name: string,
  rawArgs: unknown
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const result = await callTool(context, name, rawArgs);
    return textResult(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const payload = err instanceof DataServerError
      ? { error: { code: err.code, message } }
      : { error: { code: "data_error", message } };
    return { ...textResult(payload), isError: true };
  }
}

export async function callTool(
  context: DispatchContext,
  name: string,
  rawArgs: unknown
): Promise<unknown> {
  const definition = toolDefinition(name);
  const args = validateToolInput(definition, rawArgs);

  if (isLegalCommonsToolName(name)) {
    return callLegalCommonsTool(context.legalCommons, name, args);
  }
  if (isTroubleshootToolName(name)) {
    return callTroubleshootTool(context, name, args);
  }

  throw new ValidationError(`Unknown tool "${name}"`);
}

function toolDefinition(name: string): ToolDefinition {
  if (!definitions) {
    definitions = new Map(buildToolDefinitions().map((tool) => [tool.name, tool]));
  }
  const definition = definitions.get(name);
  if (!definition) throw new ValidationError(`Unknown tool "${name}"`);
  return definition;
}

function textResult(result: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}
