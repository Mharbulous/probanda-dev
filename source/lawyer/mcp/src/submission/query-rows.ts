// The one typed read over drafting_data__query's generic primitive (issue #184). It holds no SQL:
// each caller still owns its own query, and this only casts the backend's rows to the caller's shape.

import { submissionDataQuery } from "./backend.js";

export function rows<T>(dbPath: string, sql: string, params: unknown[] = []): T[] {
  return submissionDataQuery(dbPath, sql, params).rows as unknown as T[];
}
