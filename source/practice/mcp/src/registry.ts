// Entity shape shared by the practice registry (practice-registry.ts) and the
// local practice backend. The case-data cloud `ENTITIES` array and its generated
// tool surface were removed at the three-layer teardown (B5, 2026-07-14); what
// remains is only the generic type vocabulary the surviving practice namespace
// builds its own registry on.

export type FieldType = "str" | "num" | "bool" | "obj";

export interface FieldDefinition {
  name: string;
  type: FieldType;
  enum?: string[];
  system?: boolean;
}

export interface ForeignKeyDefinition {
  field: string;
  refTable: string;
}

export interface EntityDefinition {
  table: string;
  pk: string | string[];
  pkGenerated?: boolean;
  matterScoped?: boolean;
  fields: FieldDefinition[];
  fks?: ForeignKeyDefinition[];
}
