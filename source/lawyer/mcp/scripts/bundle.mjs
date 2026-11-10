import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { generateResolver } from "./resolver.mjs";
import { generate } from "./templates.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outfile = resolve(root, "dist", "litigation-mcp.js");
// The file-manager plugin's `files` server: a second entry point built from this
// same source, serving only the file_ops__* and housekeeping__* tools
// (src/file-manager-index.ts, docs/Plans/2026-10-14_file-admin-plugin.md).
const fileManagerOutfile = resolve(root, "..", "..", "file-manager", "files-mcp", "dist", "file-manager-mcp.js");
// The billing plugin's `timecamp` server: a third entry point, serving only the
// TimeCamp API tools (src/timecamp-index.ts, docs/Specs/2026-10-15_timecamp-api-connector-spec.md).
const timecampOutfile = resolve(root, "..", "..", "billing", "timecamp-mcp", "dist", "timecamp-mcp.js");
// The lawyer plugin's `contacts-calendars-email` server: a fourth entry point, serving only the
// mail, calendar and contacts tools (src/contacts-calendars-email-index.ts).
const contactsCalendarsEmailOutfile = resolve(
  root, "..", "contacts-calendars-email-mcp", "dist", "contacts-calendars-email-mcp.js"
);

// The repo root is resolved at RUNTIME now (src/repo-root.ts), not baked in
// here at build time. A baked root is a per-build-machine literal in a
// tracked artifact: it churned the bundle on every rebuild and broke on any
// second machine whose username (or checkout path) differed from the one
// that last built it. See src/repo-root.ts for the resolution chain.

// The build stamp (issue #452, src/build-stamp.ts) is a hash of the bundled
// code, never a timestamp: it changes exactly when the code does, so a
// no-change rebuild leaves the tracked bundle byte-identical. Build with a
// placeholder, hash that output, then write the hash over every placeholder --
// the define (read at runtime) and the first-line banner (read from the repo's
// tracked copy by an already-running server).
const STAMP_PLACEHOLDER = "__LITIGATION_BUILD_STAMP_PLACEHOLDER__";

// The drafting-data schema version this bundle is built against (issue #812,
// src/submission/schema-ceiling.ts). Read from the /drafting-data gatekeeper's
// migrate_engine.py -- the SSOT for that number -- so the bundle STATES what its
// renderers understand instead of asking the working tree at run time, which is
// the same file a pending migration comes from and therefore always agrees with
// it. Baked before the hash, so a schema bump changes the build stamp too.
const engineFile = resolve(
  root, "..", "..", "..",
  ".claude", "skills", "drafting-data", "references", "scripts", "migrate_engine.py"
);
const engineText = await readFile(engineFile, "utf-8");
const schemaMatch = /^TARGET_SCHEMA_VERSION\s*=\s*(\d+)\s*$/m.exec(engineText);
if (!schemaMatch) {
  throw new Error(`no TARGET_SCHEMA_VERSION found in ${engineFile} -- cannot state this bundle's schema ceiling`);
}
const submissionSchemaVersion = Number(schemaMatch[1]);

// The board templates' generated modules (scripts/templates.mjs) are gitignored, so write them
// before bundling: a bundle run alone, without `npm run build`, still finds them.
generate();
// Likewise the case-data resolver's generated module (scripts/resolver.mjs).
generateResolver();

// imapflow's CommonJS dependencies (libmime and others) require Node built-ins when imported,
// which esbuild's ESM output refuses without a real `require` in scope. The bundles that hold it get one;
// it resolves built-ins only, so the bundle stays self-contained.
const REQUIRE_SHIM =
  'import { createRequire as __bundleCreateRequire } from "node:module";\n' +
  "const require = __bundleCreateRequire(import.meta.url);";

// tsdav's ISO 8601 regexes hold `\d:\d`, which the bundle-no-host-path checks read as a drive
// path ("d:\"). `\d[:]\d` matches exactly the same text, so the bundle keeps the checks clean
// without loosening them. The build fails if tsdav stops holding the pattern, so this never
// silently goes stale.
const tsdavRegexes = {
  name: "tsdav-iso-regex",
  setup(b) {
    b.onLoad({ filter: /[\\/]node_modules[\\/]tsdav[\\/]dist[\\/]tsdav\.mjs$/ }, async (args) => {
      const source = await readFile(args.path, "utf-8");
      const contents = source.replaceAll("\\d:\\d", "\\d[:]\\d");
      if (contents === source) throw new Error(`tsdav-iso-regex: no \\d:\\d left in ${args.path}; drop this plugin`);
      return { contents, loader: "js" };
    });
  },
};

async function bundle(entry, out, extraBanner = "") {
  await mkdir(dirname(out), { recursive: true });
  const result = await build({
    entryPoints: [resolve(root, "src", entry)],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "esm",
    absWorkingDir: root,
    tsconfig: resolve(root, "tsconfig.json"),
    // imapflow's logger calls pino() at import, and pino writes to stdout, the MCP channel:
    // a silent shim replaces it (src/mail/pino-shim.ts). Inert for an entry point without imapflow.
    alias: { pino: resolve(root, "src", "mail", "pino-shim.ts") },
    plugins: [tsdavRegexes],
    banner: { js: `// build-stamp: ${STAMP_PLACEHOLDER}${extraBanner ? `\n${extraBanner}` : ""}` },
    define: {
      __LITIGATION_BUILD_STAMP__: JSON.stringify(STAMP_PLACEHOLDER),
      __LITIGATION_SUBMISSION_SCHEMA_VERSION__: JSON.stringify(submissionSchemaVersion),
    },
    outfile: out,
    write: false,
    metafile: true,
  });
  const text = result.outputFiles[0].text;
  const stamp = createHash("sha256").update(text).digest("hex").slice(0, 12);
  await writeFile(out, text.replaceAll(STAMP_PLACEHOLDER, stamp));
  // Which source modules this bundle holds, read by test/bundle-modules.unit.test.mjs.
  const metafile = resolve(root, "build", `metafile-${entry.replace(/\.ts$/, "")}.json`);
  await mkdir(dirname(metafile), { recursive: true });
  await writeFile(metafile, JSON.stringify(result.metafile));
}

await bundle("index.ts", outfile, REQUIRE_SHIM);
await bundle("file-manager-index.ts", fileManagerOutfile);
// pdf_pages__images and file_ops__comment_pdf load PDFium's WebAssembly from beside the data and files
// bundles, which esbuild cannot inline. PDFium's licence ships with it, and THIRD-PARTY-NOTICES.txt:
// the licences of @embedpdf/pdfium, PDFium and the libraries compiled into the wasm, copied from upstream.
const pdfium = resolve(root, "node_modules", "@embedpdf", "pdfium");
for (const out of [outfile, fileManagerOutfile]) {
  await copyFile(resolve(pdfium, "dist", "pdfium.wasm"), resolve(dirname(out), "pdfium.wasm"));
  await copyFile(resolve(pdfium, "LICENSE.pdfium"), resolve(dirname(out), "PDFIUM-LICENSE.txt"));
  await copyFile(resolve(root, "THIRD-PARTY-NOTICES.txt"), resolve(dirname(out), "THIRD-PARTY-NOTICES.txt"));
}
await bundle("timecamp-index.ts", timecampOutfile);
await bundle("contacts-calendars-email-index.ts", contactsCalendarsEmailOutfile, REQUIRE_SHIM);
