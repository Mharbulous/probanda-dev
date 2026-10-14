import { ValidationError } from "./errors.js";
import type { ToolDefinition } from "./schema-gen.js";

export type ToolInput = Record<string, unknown>;

export function validateToolInput(tool: ToolDefinition, input: unknown): ToolInput {
  if (input === undefined || input === null) return {};
  if (!isPlainObject(input)) {
    throw new ValidationError(`${tool.name} input must be an object`);
  }

  const schema = tool.inputSchema;
  const properties = schema.properties ?? {};
  const output: ToolInput = {};

  for (const key of Object.keys(input)) {
    if (!(key in properties)) {
      throw new ValidationError(`${tool.name} received unknown field "${key}"`);
    }
  }

  for (const required of schema.required ?? []) {
    if (!(required in input) || input[required] === undefined || input[required] === null || input[required] === "") {
      throw new ValidationError(`${tool.name}.${required} is required`);
    }
  }

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    output[key] = validateValue(`${tool.name}.${key}`, value, properties[key]);
  }

  return output;
}

function validateValue(label: string, value: unknown, schema: Record<string, unknown> | undefined): unknown {
  if (!schema) return value;
  if (value === null) return null;

  const type = schema.type;
  if (schema["x-encrypted"] && typeof value !== "string") {
    throw new ValidationError(`${label} is encrypted and must be a string`);
  }

  if (type === "string" && typeof value !== "string") {
    throw new ValidationError(`${label} must be a string`);
  }
  if (type === "number" && typeof value !== "number") {
    throw new ValidationError(`${label} must be a number`);
  }
  if (type === "boolean" && typeof value !== "boolean") {
    throw new ValidationError(`${label} must be a boolean`);
  }
  if (type === "object" && !isPlainObject(value)) {
    throw new ValidationError(`${label} must be an object`);
  }

  const allowedValues = schema.enum as unknown[] | undefined;
  if (allowedValues && !allowedValues.includes(value)) {
    throw new ValidationError(`${label} must be one of: ${allowedValues.join(", ")}`);
  }

  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
