// Entity shape shared by the practice registry (practice-registry.ts) and the
// local practice backend. The matter-data cloud `ENTITIES` array and its generated
// tool surface were removed at the three-layer teardown (B5, 2026-07-14); what
// remains is only the generic type vocabulary the surviving practice namespace
// builds its own registry on.

export type FieldType = "str" | "num" | "bool" | "obj";
export type ToolOperation = "upsert" | "query" | "delete";

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

export interface ForeignKeyDefinition {
  field: string;
  refTable: string;
}

export interface EntityDefinition {
  table: string;
  pk: string | string[];
  pkGenerated?: boolean;
  matterScoped?: boolean;
  toolBase?: string;
  operations?: ToolOperation[];
  fields: FieldDefinition[];
  fks?: ForeignKeyDefinition[];
  bitemporal?: boolean;
  reviewable?: boolean;
  humanReviewed?: boolean;
  notesEscalation?: boolean;
}

// Generic field-taxonomy helpers over any EntityDefinition. The practice
// registry still classifies its columns (encrypted / blind-index natural keys)
// even though the local backend stores plaintext, so these remain in use.
export function encryptedFields(entity: EntityDefinition): FieldDefinition[] {
  return entity.fields.filter((field) => field.encrypted);
}

export function blindIndexFields(entity: EntityDefinition): FieldDefinition[] {
  return entity.fields.filter((field) => field.blindIndex);
}
