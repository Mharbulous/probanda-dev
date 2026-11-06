// The four-bundle split as a checked contract (#186): scripts/bundle.mjs cuts every bundle from one
// source tree, so what each holds is whatever its imports reach. This reads the metafile esbuild
// wrote for each entry and refuses a source module that entry must not carry. Run it after
// `node scripts/bundle.mjs`.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const MCP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const DATA_SERVER_INTERNALS = [
  /^src\/case\/backend\.ts$/,
  /^src\/submission\/render-job\.ts$/,
  /^src\/kv\/backend/,
  /^src\/dispatch\.ts$/,
];

// Each fixed-port page listener answers its own bundle's routes only (src/local-page/ports.ts).
const HOUSEKEEPING_PAGES = /^src\/housekeeping\/server\.ts$/;
const LAWYER_PAGES = [/^src\/page-api\/server\.ts$/, /^src\/suggestions\//];

const DENIED = {
  index: [/^src\/file_ops\/move/, HOUSEKEEPING_PAGES],
  "file-manager-index": [...DATA_SERVER_INTERNALS, /^src\/schema\/(?!(?:file-ops|housekeeping|shared)\.ts$)/, ...LAWYER_PAGES],
  "timecamp-index": [...DATA_SERVER_INTERNALS, HOUSEKEEPING_PAGES, ...LAWYER_PAGES],
  "contacts-calendars-email-index": [...DATA_SERVER_INTERNALS, HOUSEKEEPING_PAGES, ...LAWYER_PAGES],
};

/** The source modules with bytes in the entry's bundle. The metafile's top-level `inputs` also lists
 * tree-shaken modules, so only the output's own `inputs` say what shipped. */
function modulesIn(entry) {
  const metafile = JSON.parse(readFileSync(join(MCP_ROOT, "build", `metafile-${entry}.json`), "utf-8"));
  const outputs = Object.values(metafile.outputs);
  assert.equal(outputs.length, 1, `${entry} should have one output`);
  return Object.entries(outputs[0].inputs)
    .filter(([, input]) => input.bytesInOutput > 0)
    .map(([path]) => path);
}

for (const [entry, denied] of Object.entries(DENIED)) {
  test(`the ${entry} bundle holds none of its denied modules`, () => {
    const modules = modulesIn(entry);
    assert.ok(modules.length > 0, `${entry}'s metafile lists no module`);
    assert.deepEqual(modules.filter((path) => denied.some((rx) => rx.test(path))), []);
  });
}

test("the metafile names modules the way the deny-lists expect", () => {
  assert.ok(modulesIn("index").includes("src/case/backend.ts"));
  assert.ok(modulesIn("index").includes("src/page-api/server.ts"));
  assert.ok(modulesIn("file-manager-index").includes("src/housekeeping/server.ts"));
});
