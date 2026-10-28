// A server's tools as a list of {name, handler} entries, dispatched by name (#183). Each
// entry point keeps its own list, so a bundle holds only the handlers its list imports:
// there is no global registry. Definitions stay in src/schema/*.ts and are paired with the
// list by name.
import { DataServerError, ValidationError } from "./errors.js";
import type { ToolDefinition } from "./schema-gen.js";
import { validateToolInput, type ToolInput } from "./validate.js";

export type ToolReply = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

export interface Tool<C, F = undefined> {
  name: string;
  handler: (args: ToolInput, context: C) => unknown;
  /** What a server needs to know about the tool before it runs it, such as practice's file and read tools. */
  flags?: F;
}

/** A tool whose handler takes typed arguments. validateToolInput has checked them against the
 * tool's inputSchema, but nothing ties `Args` to that schema at compile time: this is the one cast. */
export function defineTool<Args, C = void, F = undefined>(
  name: string,
  handler: (args: Args, context: C) => unknown,
  flags?: F
): Tool<C, F> {
  return { name, handler: (args, context) => handler(args as unknown as Args, context), flags };
}

/** A server's `call` (validate, then run the handler) and `dispatch` (`call` as an MCP reply). On
 * first use it pairs every definition with exactly one handler, and fails every call if they differ. */
export function dispatchFrom<C>(
  buildDefinitions: () => ToolDefinition[],
  tools: Tool<C>[],
  replyText: (name: string, result: unknown) => string = jsonText
): {
  call: (context: C, name: string, rawArgs: unknown) => Promise<unknown>;
  dispatch: (context: C, name: string, rawArgs: unknown) => Promise<ToolReply>;
} {
  let table: Map<string, PairedTool<C>> | undefined;
  const call = async (context: C, name: string, rawArgs: unknown): Promise<unknown> => {
    table ??= pairTools(buildDefinitions(), tools);
    const entry = table.get(name);
    if (!entry) throw new ValidationError(`Unknown tool "${name}"`);
    return entry.handler(validateToolInput(entry.definition, rawArgs), context);
  };
  return { call, dispatch: (context, name, rawArgs) => toolReply(name, () => call(context, name, rawArgs), replyText) };
}

export type PairedTool<C, F = undefined> = { definition: ToolDefinition; handler: Tool<C, F>["handler"]; flags?: F };

/** Each definition with its one list entry, by name. Throws if any definition, entry or name is unpaired. */
export function pairTools<C, F = undefined>(definitions: ToolDefinition[], tools: Tool<C, F>[]): Map<string, PairedTool<C, F>> {
  const entries = new Map<string, Tool<C, F>>();
  const problems: string[] = [];
  for (const tool of tools) {
    if (entries.has(tool.name)) problems.push(`${tool.name} is listed twice`);
    entries.set(tool.name, tool);
  }
  const table = new Map<string, PairedTool<C, F>>();
  for (const definition of definitions) {
    const tool = entries.get(definition.name);
    if (tool) table.set(definition.name, { definition, handler: tool.handler, flags: tool.flags });
    else problems.push(`no handler for ${definition.name}`);
  }
  for (const name of entries.keys()) {
    if (!table.has(name)) problems.push(`no definition for ${name}`);
  }
  if (problems.length) throw new DataServerError(`The tool list and its definitions differ: ${problems.join("; ")}`, "internal_error");
  return table;
}

/** A definition by name, read once: for dispatch.ts until its `if` chain moves onto a tool list. */
export function definitionLookup(buildDefinitions: () => ToolDefinition[]): (name: string) => ToolDefinition {
  let definitions: Map<string, ToolDefinition> | undefined;
  return (name) => {
    definitions ??= new Map(buildDefinitions().map((tool) => [tool.name, tool]));
    const definition = definitions.get(name);
    if (!definition) throw new ValidationError(`Unknown tool "${name}"`);
    return definition;
  };
}

/** `run`'s result as an MCP reply, or its error as an isError reply carrying the error's code. */
export async function toolReply(
  name: string,
  run: () => Promise<unknown>,
  replyText: (name: string, result: unknown) => string = jsonText
): Promise<ToolReply> {
  try {
    return { content: [{ type: "text", text: replyText(name, await run()) }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const payload = err instanceof DataServerError
      ? { error: { code: err.code, message } }
      : { error: { code: "data_error", message } };
    return { content: [{ type: "text", text: jsonText(name, payload) }], isError: true };
  }
}

export function jsonText(_name: string, result: unknown): string {
  return JSON.stringify(result, null, 2);
}
