// The field shape schema-gen.ts builds tool input schemas from. The case-data cloud
// `ENTITIES` array and its generated tool surface were removed at the three-layer
// teardown (B5, 2026-07-14), and the practice table registry when practice.db became
// generic items (docs/Plans/2026-10-14_practice-db-conversion.md).

export type FieldType = "str" | "num" | "bool" | "obj";

export interface FieldDefinition {
  name: string;
  type: FieldType;
  enum?: string[];
  system?: boolean;
}
