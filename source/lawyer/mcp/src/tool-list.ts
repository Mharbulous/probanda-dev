// A server's tools as a list of {name, handler} entries, dispatched by name (#183). Each
// entry point keeps its own list, so a bundle holds only the handlers its list imports:
// there is no global registry. Definitions stay in src/schema/*.ts and are paired with the
// list by name.
import { DataServerError, ValidationError } from "./errors.js";
import type { ToolDefinition } from "./schema-gen.js";
import { validateToolInput, type ToolInput } from "./validate.js";

export type ToolReply = {
  content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
  isError?: boolean;
};

/** A handler's result with PNGs that go in the reply after its text, in order. */
export class WithImages {
  constructor(readonly result: unknown, readonly images: Buffer[]) {}
}

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

/** Set, never sent, on an isError reply whose error is a fault (not a tool's own refusal), for the call log (call-log.ts). */
export const FAULT = Symbol("fault");

/** `run`'s result as an MCP reply, or its error as an isError reply carrying the error's code. */
export async function toolReply(
  name: string,
  run: () => Promise<unknown>,
  replyText: (name: string, result: unknown) => string = jsonText
): Promise<ToolReply> {
  try {
    const result = await run();
    if (result instanceof WithImages) {
      return {
        content: [
          { type: "text", text: replyText(name, result.result) },
          ...result.images.map((png) => ({ type: "image" as const, data: png.toString("base64"), mimeType: "image/png" })),
        ],
      };
    }
    return { content: [{ type: "text", text: replyText(name, result) }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const payload = err instanceof DataServerError
      ? { error: { code: err.code, message, ...(err.details ? { details: err.details } : {}) } }
      : { error: { code: "data_error", message } };
    const reply: ToolReply = { content: [{ type: "text", text: jsonText(name, payload) }], isError: true };
    if (!(err instanceof DataServerError) || err.code === "internal_error" || err.code === "python_timeout") {
      Object.defineProperty(reply, FAULT, { value: true });
    }
    return reply;
  }
}

// Tools whose replies carry outside text (email, calendar, contacts, web pages, knowledge and
// law-folder files). Each reply, success or error, gains a last top-level `content_source` key
// naming the source, so the model reads the text as data, never as instructions.
const CONTENT_SOURCES: Record<string, string> = {
  mail__get_email: "email",
  mail__get_latest_emails: "email",
  mail__search_emails: "email",
  mail__find_thread_messages: "email",
  mail__find_email_by_message_id: "email",
  mail__download_attachment: "email attachment",
  mail__dedupe_scan: "email",
  mail__dedupe_read_comparison: "email",
  mail__dedupe_plan_tier2: "email",
  calendar__list_events: "calendar",
  calendar__get_event: "calendar",
  contacts__search: "contacts",
  contacts__get: "contacts",
  contacts__import_scan: "contacts",
  contacts__import_apply: "contacts",
  contacts__import_apply_continue: "contacts",
  contacts__merge_scan: "contacts",
  contacts__merge_plan: "contacts",
  contacts__merge_apply: "contacts",
  contacts__merge_apply_continue: "contacts",
  contacts__restore_card: "contacts",
  contacts__read_report: "contacts",
  drafting_forms__read_message: "email file",
  sources__fetch: "web page",
  sources__check: "web page",
  knowledge__read: "knowledge file",
  research_filing__law_folder_text: "law folder file",
  research_filing__legislation_search: "law folder file",
  research_filing__matter_folder: "matter folder file",
  research_filing__research_folder: "research folder file",
};

export function jsonText(name: string, result: unknown): string {
  const source = Object.hasOwn(CONTENT_SOURCES, name) ? CONTENT_SOURCES[name] : undefined;
  if (source === undefined) return JSON.stringify(result, null, 2);
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    throw new DataServerError(`${name} returned a ${Array.isArray(result) ? "list" : typeof result}, not an object to label`, "internal_error");
  }
  return JSON.stringify({ ...result, content_source: source }, null, 2);
}
