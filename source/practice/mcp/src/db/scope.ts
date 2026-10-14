import { AmbiguousMatchError, NotFoundError } from "../errors.js";
import type { EntityDefinition } from "../registry.js";

export interface SelectOptions {
  limit?: number;
}

// UnscopedAdmin is the data surface the local practice backend subclasses
// (practice/backend.ts): LocalPracticeAdmin overrides every method to shell out
// to host Python sqlite3. In the litigation runtime there is no cloud REST
// backend, so these base-class bodies are never reached — they exist only to give
// the subclass its method shape. The cloud MatterScope class and the RestClient
// were removed when the Supabase surface was split out into the legal-commons
// plugin.
export class UnscopedAdmin {
  private mustOverride(method: string): never {
    throw new Error(`UnscopedAdmin.${method} must be overridden by a concrete backend`);
  }

  async query(
    _entity: EntityDefinition,
    _filters: Record<string, string> = {},
    _options: SelectOptions = {}
  ): Promise<Record<string, unknown>[]> {
    return this.mustOverride("query");
  }

  async insert(
    _entity: EntityDefinition,
    _row: Record<string, unknown>,
    _onConflict?: string
  ): Promise<Record<string, unknown>[]> {
    return this.mustOverride("insert");
  }

  async insertMany(
    _entity: EntityDefinition,
    _rows: Record<string, unknown>[],
    _onConflict?: string
  ): Promise<Record<string, unknown>[]> {
    return this.mustOverride("insertMany");
  }

  async update(
    _entity: EntityDefinition,
    _filters: Record<string, string>,
    _row: Record<string, unknown>
  ): Promise<Record<string, unknown>[]> {
    return this.mustOverride("update");
  }

  async delete(
    _entity: EntityDefinition,
    _filters: Record<string, string>
  ): Promise<Record<string, unknown>[]> {
    return this.mustOverride("delete");
  }
}

export function exactlyOne(
  rows: Record<string, unknown>[],
  what: string,
  action: "insert" | "update" | "delete" | "query" = "query"
): Record<string, unknown> {
  if (rows.length === 0) throw new NotFoundError(`No ${what} row matched the ${action}`);
  if (rows.length > 1) throw new AmbiguousMatchError(`${rows.length} ${what} rows matched the ${action}`);
  return rows[0];
}
