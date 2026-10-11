// A knowledge-tree fixture for the knowledge__* and sources__check tests: an extracted
// .plugin install (as skill-source-install.unit.test.mjs builds one) whose `skills/`
// holds every tree-owning skill and the `shared/` install marker, plus a case data root under a temporary
// APPDATA, whose `_practice\knowledge\` is the overlay. No checkout resolves.

import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const TREE_SKILLS = ["draft", "publish", "assemble", "legal-research", "docket-clerk"];
// The runtime's shipped-folder lookup (src/knowledge/tree.ts SHIPPED_DIR): docket-clerk ships under shared/.
const SHIPPED_DIR = { "docket-clerk": "shared/docket-clerk" };

function write(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

export function knowledgeFixture(t) {
  const scratch = mkdtempSync(join(tmpdir(), "coclerk-knowledge-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const installRoot = join(scratch, "install");
  write(join(installRoot, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "litigation", version: "9.9.9" }));
  for (const skill of TREE_SKILLS) mkdirSync(join(installRoot, "skills", ...(SHIPPED_DIR[skill] ?? skill).split("/"), "references"), { recursive: true });
  mkdirSync(join(installRoot, "skills", "shared"), { recursive: true });
  const appData = join(scratch, "appdata");
  const caseRoot = join(scratch, "0. CASE DATA");
  mkdirSync(caseRoot);
  write(join(appData, "Coclerk", "coclerk.json"), JSON.stringify({ case_data_root: caseRoot }));
  const overlay = join(caseRoot, "_practice", "knowledge");
  const shippedPath = (rel) => {
    const [skill, ...rest] = rel.split("/");
    return join(installRoot, "skills", ...(SHIPPED_DIR[skill] ?? skill).split("/"), "references", ...rest);
  };
  const localPath = (rel) => join(overlay, ...rel.split("/"));
  return {
    scratch,
    installRoot,
    overlay,
    caseRoot,
    seams: {
      env: { APPDATA: appData, COCLERK_REPO_ROOT_AUTODETECT: "0" },
      installRoot,
      // Practice data holding one matter, numbered L8443.
      lookUpMatter: async (mattNum) => (mattNum.replace(/^\./, "") === "L8443" ? [{ matt_num: "L8443" }] : []),
    },
    shippedPath,
    localPath,
    /** Write a file into the shipped tree at a knowledge path (`draft/CAN/...`). */
    shipped: (rel, text) => write(shippedPath(rel), typeof text === "string" ? text : JSON.stringify(text, null, 2)),
    /** Write a file into the overlay at a knowledge path. */
    local: (rel, text) => write(localPath(rel), typeof text === "string" ? text : JSON.stringify(text, null, 2)),
  };
}

/**
 * A matter folder laid out as /case-data lays one out: `<scratch>\<name>\coclerk.json`, whose
 * `case_data_dir` is `<case data root>\<name>` (created). `pointer` is the pointer's raw text when a
 * string, otherwise fields merged over the default; `null` writes no pointer at all.
 */
export function matterFixture(f, pointer = {}, name = "L1 Test") {
  const matterRoot = join(f.scratch, name);
  const caseDataDir = join(f.caseRoot, name);
  mkdirSync(matterRoot, { recursive: true });
  mkdirSync(caseDataDir, { recursive: true });
  if (pointer !== null) {
    const text =
      typeof pointer === "string"
        ? pointer
        : JSON.stringify({ schema_version: 5, matter_root: matterRoot, case_data_dir: caseDataDir, evidence_sql_path: join(caseDataDir, "main.sqlite"), ...pointer });
    writeFileSync(join(matterRoot, "coclerk.json"), text);
  }
  return { matterRoot, caseDataDir };
}

/**
 * Points process.env at the fixture's APPDATA for a dispatch-level call (dispatch passes no seams),
 * restoring it after the test. `userFile: false` deletes the per-user coclerk.json first.
 */
export function useProcessEnv(t, f, { userFile = true } = {}) {
  const keys = ["APPDATA", "COCLERK_CONFIG_PATH", "COCLERK_CASE_DATA_ROOT"];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });
  delete process.env.COCLERK_CONFIG_PATH;
  delete process.env.COCLERK_CASE_DATA_ROOT;
  process.env.APPDATA = f.seams.env.APPDATA;
  if (!userFile) rmSync(join(f.seams.env.APPDATA, "Coclerk", "coclerk.json"));
}

/** The runtime's passage hash (src/knowledge/sidecar.ts passageHash): whitespace collapsed, sha256 hex. */
export function passageHash(passage) {
  return createHash("sha256").update(passage.replace(/\s+/g, " ").trim(), "utf8").digest("hex");
}

/** A knowledge file: YAML front matter, then a fenced json block, then prose. */
export function knowledgeFile(front, block, prose = "Guidance for the drafting session.\n") {
  const head = front ? `---\n${front.trim()}\n---\n` : "";
  const body = block === undefined ? "" : "```json\n" + JSON.stringify(block, null, 2) + "\n```\n\n";
  return `${head}# Fixture\n\n${body}${prose}`;
}

export function errorOf(fn) {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error("expected a throw, got none");
}
