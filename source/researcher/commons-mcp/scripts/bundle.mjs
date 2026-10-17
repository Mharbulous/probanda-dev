import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outfile = resolve(root, "dist", "legal-commons-mcp.js");

await mkdir(dirname(outfile), { recursive: true });
await build({
  entryPoints: [resolve(root, "src", "index.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  absWorkingDir: root,
  tsconfig: resolve(root, "tsconfig.json"),
  outfile,
});
