// Tests write loose threads as seeds rows through the unguarded fixture path, as a database from before
// the store held them, then move them. The marker is dropped so a later batch in one test moves too.

import { runKv } from "../../build/kv/backend.js";
import { looseThreadsPath } from "../../build/loose-threads/backend.js";
import { moveSeedsOnce } from "../../build/loose-threads/migrate.js";
import { submissionDataExecute } from "../../build/submission/backend.js";

/** Moves whatever `seeds` holds to the store. */
export async function moveSeeds(dbPath) {
  await moveSeedsOnce(dbPath);
  runKv({ op: "delete", db_path: looseThreadsPath(dbPath), namespace: "meta", key: "seeds_moved", exclusive: true }, { label: "test", timeoutMs: 20000, env: process.env });
}

/** Runs a fixture script, then moves any thread it wrote. */
export async function executeThenMove(dbPath, script) {
  await submissionDataExecute(dbPath, script);
  await moveSeeds(dbPath);
}
