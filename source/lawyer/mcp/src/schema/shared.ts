import { type FieldDefinition } from "../registry.js";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, Record<string, unknown>>;
    required?: string[];
    additionalProperties: false;
  };
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    openWorldHint?: boolean;
  };
}

function schemaFor(field: FieldDefinition): Record<string, unknown> {
  const type =
    field.type === "num" ? "number" :
    field.type === "bool" ? "boolean" :
    field.type === "obj" ? "object" :
    "string";
  const schema: Record<string, unknown> = { type };
  if (field.enum) {
    schema.enum = field.type === "num" ? field.enum.map(Number) : field.enum;
  }
  return schema;
}

export function objectSchema(
  fields: FieldDefinition[],
  required: string[] = []
): ToolDefinition["inputSchema"] {
  return {
    type: "object",
    properties: Object.fromEntries(fields.map((field) => [field.name, schemaFor(field)])),
    required: required.length > 0 ? required : undefined,
    additionalProperties: false,
  };
}

export const SQL_PARAMS = { type: "array", items: {}, description: "Scalars only. Bind a list as one JSON string: IN (SELECT value FROM json_each(?))" };
