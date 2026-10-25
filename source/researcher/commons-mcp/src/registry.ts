// Field vocabulary used by the hand-written tool schemas in schema-gen.ts.

export type FieldType = "str" | "num" | "bool" | "obj";

export interface FieldDefinition {
  name: string;
  type: FieldType;
  enum?: string[];
  encrypted?: boolean;
  blindIndex?: boolean;
  requiredOnCreate?: boolean;
  queryable?: boolean;
  system?: boolean;
}
