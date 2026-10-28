// matter_data__stage_result: an extractor hands its result to the host (/matter-data
// design-decisions.md #76). A Cowork agent's Write lands in its Linux sandbox, which this server
// cannot read (#194), so the agent passes its JSON object here instead and gets back an id that
// matter_data__ingest_authority takes in place of a path. The tool takes no path and no matter, so
// the agent learns nothing of the matter and can write nowhere else.

import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { ValidationError } from "../errors.js";

/** A staged result outlives any rerun or verify-before-retry, which come within minutes. */
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const RESULT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function stagedResultsDir(env: NodeJS.ProcessEnv): string {
  return join(env.LOCALAPPDATA || homedir(), "Coclerk", "extract-results");
}

/** The staged file for `resultId`, which must be an id this tool returned. */
export function stagedResultPath(resultId: unknown, env: NodeJS.ProcessEnv): string {
  if (typeof resultId !== "string" || !RESULT_ID.test(resultId)) {
    throw new ValidationError(`result_id must be the id matter_data__stage_result returned; got ${JSON.stringify(resultId)}`);
  }
  return join(stagedResultsDir(env), `${resultId}.json`);
}

export function stageResult(result: unknown, env: NodeJS.ProcessEnv = process.env): { result_id: string; bytes: number } {
  if (result === null || typeof result !== "object" || Array.isArray(result)) {
    throw new ValidationError("result must be the extractor's JSON object");
  }
  const dir = stagedResultsDir(env);
  mkdirSync(dir, { recursive: true });
  const now = Date.now();
  for (const name of readdirSync(dir)) {
    const file = join(dir, name);
    if (name.endsWith(".json") && now - statSync(file).mtimeMs > KEEP_MS) unlinkSync(file);
  }
  const resultId = randomUUID();
  const text = JSON.stringify(result);
  writeFileSync(join(dir, `${resultId}.json`), text, "utf-8");
  return { result_id: resultId, bytes: Buffer.byteLength(text, "utf-8") };
}
