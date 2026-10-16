// The drafting-data hops a migration from version `from` applies, one per version up to the
// engine's own TARGET_SCHEMA_VERSION, so a new hop extends the expected list instead of
// breaking every test that pins it (#1651).
const { currentSchemaVersion } = await import("../../build/submission/migrate.js");

export const hopsFrom = (from) =>
  Array.from({ length: currentSchemaVersion() - from }, (_, i) => ({ from: from + i, to: from + i + 1 }));
