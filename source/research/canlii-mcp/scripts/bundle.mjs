import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outfile = resolve(root, "dist", "canlii-mcp.js");

// Read the version at build time and inline it via `define` — the packaged plugin
// ships only dist/, so the bundle must not require("../package.json") at runtime.
const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));

await mkdir(dirname(outfile), { recursive: true });
await build({
  entryPoints: [resolve(root, "src", "index.ts")],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  absWorkingDir: root,
  tsconfig: resolve(root, "tsconfig.json"),
  define: { __CANLII_VERSION__: JSON.stringify(pkg.version) },
  outfile,
});
