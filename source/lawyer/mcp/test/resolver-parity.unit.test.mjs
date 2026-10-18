import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..", "..", "..");

test("runtime and maintenance resolvers retain the live-selection helper", () => {
  const runtime = readFileSync(join(repo, "source", "lawyer", "mcp", "src", "case", "backend.ts"), "utf-8");
  const maintenance = readFileSync(
    join(repo, ".claude", "skills", "case-data", "references", "scripts", "resolve_paths.py"),
    "utf-8",
  );

  for (const [name, source] of [["runtime", runtime], ["maintenance", maintenance]]) {
    assert.match(source, /def resolve_case_data_dir\(/, `${name} resolver lost live selection`);
    assert.match(source, /main\.sqlite/);
  }
});
