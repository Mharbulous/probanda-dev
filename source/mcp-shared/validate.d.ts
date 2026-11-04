// Types for validate.js. Keep in step with it.

export type ToolInput = Record<string, unknown>;

export declare function validateToolInput(
  tool: { name: string; inputSchema: { properties?: Record<string, unknown>; required?: string[] } },
  input: unknown
): ToolInput;
