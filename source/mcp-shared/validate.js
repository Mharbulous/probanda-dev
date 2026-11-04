import { ValidationError } from "./errors.js";

// The one tool-input validator: it enforces what a tool's inputSchema publishes, at any depth, so
// the schema the model sees and the checks that run are one source of truth. Plain JavaScript for
// the reason given in dpapi-store.js.
//
// A `properties` map holds field names and each of its entries is a schema, so a field that is
// itself named `pattern` or `items` is a field. The top level refuses an unknown field whatever
// its schema says; a nested object does so only under `additionalProperties: false`. A null field
// passes every rule, as it always has. A top-level required field that is null or "" counts as
// missing, as it always has; a nested one need only be present, because schemas publish required
// fields that may be null (the rule overlay's amending_instrument.oic).

export function validateToolInput(tool, input) {
  if (input === undefined || input === null) return {};
  if (!isPlainObject(input)) {
    throw new ValidationError(`${tool.name} input must be an object`);
  }

  const schema = tool.inputSchema;
  refuseUnknown(tool.name, input, schema.properties ?? {});
  for (const required of schema.required ?? []) {
    if (input[required] === undefined || input[required] === null || input[required] === "") {
      throw new ValidationError(`${tool.name}.${required} is required`);
    }
  }

  const output = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    checkValue(`${tool.name}.${key}`, value, schema.properties?.[key]);
    output[key] = value;
  }
  return output;
}

function refuseUnknown(label, value, properties) {
  for (const key of Object.keys(value)) {
    if (!Object.hasOwn(properties, key)) {
      throw new ValidationError(`${label} received unknown field "${key}" (allowed: ${Object.keys(properties).join(", ")})`);
    }
  }
}

function checkValue(label, value, schema, nullAllowed = true) {
  if (!schema || (value === null && nullAllowed)) return;

  if (schema["x-encrypted"] && typeof value !== "string") {
    throw new ValidationError(`${label} is encrypted and must be a string`);
  }
  checkType(label, value, schema.type);

  if (schema.enum && !schema.enum.includes(value)) {
    throw new ValidationError(`${label} must be one of: ${schema.enum.join(", ")}`);
  }
  if (typeof value === "string" && schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
    throw new ValidationError(`${label} must match ${schema.pattern}`);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) throw new ValidationError(`${label} must be at least ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) throw new ValidationError(`${label} must be at most ${schema.maximum}`);
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((item, index) => {
      if (schema.items.type === "string" && typeof item !== "string") throw new ValidationError(`${label} must be an array of strings`);
      checkValue(`${label}[${index}]`, item, schema.items, false);
    });
  }
  if (isPlainObject(value)) {
    if (schema.additionalProperties === false) refuseUnknown(label, value, schema.properties ?? {});
    for (const required of schema.required ?? []) {
      if (value[required] === undefined) throw new ValidationError(`${label}.${required} is required`);
    }
    for (const [key, field] of Object.entries(value)) {
      if (field !== undefined) checkValue(`${label}.${key}`, field, schema.properties?.[key]);
    }
  }
}

const TYPE_CHECKS = {
  string: [(value) => typeof value === "string", "a string"],
  number: [(value) => typeof value === "number", "a number"],
  integer: [(value) => Number.isInteger(value), "an integer"],
  boolean: [(value) => typeof value === "boolean", "a boolean"],
  object: [isPlainObject, "an object"],
  array: [Array.isArray, "an array"],
  null: [(value) => value === null, "null"],
};

function checkType(label, value, type) {
  if (type === undefined) return;
  const types = Array.isArray(type) ? type : [type];
  if (!types.some((name) => TYPE_CHECKS[name][0](value))) {
    throw new ValidationError(`${label} must be ${types.map((name) => TYPE_CHECKS[name][1]).join(" or ")}`);
  }
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
