import assert from "node:assert/strict";
import test from "node:test";

const { isDraftFolder, supersededDestinationProblem, zoneProblem } = await import("../build/files/zones.js");

const ROOT = "C:\\Matters\\Smith";
const at = (rel) => `${ROOT}\\${rel}`;

// [path, which purposes refuse it]. Every purpose not listed allows it.
const CASES = [
  [at("3. CORRESPONDENCE\\a.pdf"), []],
  [at("4. LAWYER BRIEF\\privileged\\p.pdf"), ["read", "scan", "write", "move-from", "move-to", "run-files"]],
  [at("4. LAWYER BRIEF\\Disclosed\\d.pdf"), ["read", "scan", "write", "move-from", "move-to", "run-files"]],
  ["C:\\privileged\\Smith\\3. CORRESPONDENCE\\a.pdf", ["read", "scan", "write", "move-from", "move-to", "run-files"]],
  [at("TRASH\\a.pdf"), ["read", "scan", "write", "move-from", "move-to"]],
  [at("3. CORRESPONDENCE\\TRASH\\a.pdf"), ["read", "scan", "write"]],
  [at("0. CASE DATA\\main.sqlite"), ["read", "scan", "write", "move-from", "move-to"]],
  [at("3. CORRESPONDENCE\\0. CASE DATA\\a.pdf"), ["read", "scan", "write", "move-from"]],
  [at("0. DRAFT\\a.docx"), ["scan", "move-to"]],
  [at("0. DRAFTS 2026\\a.docx"), ["scan", "move-to"]],
  [at("1. CLIENT\\a.pdf"), ["move-to"]],
  [at("3. CORRESPONDENCE\\1. Old\\a.pdf"), []],
];

for (const [path, refusing] of CASES) {
  for (const purpose of ["read", "scan", "write", "move-from", "move-to", "run-files"]) {
    const refused = refusing.includes(purpose);
    test(`zoneProblem ${purpose} ${refused ? "refuses" : "allows"} ${path}`, () => {
      const problem = zoneProblem(purpose, path, ROOT);
      if (refused) assert.equal(typeof problem, "string");
      else assert.equal(problem, null);
    });
  }
}

test("zoneProblem matches folder names in any case and never a substring", () => {
  assert.equal(typeof zoneProblem("read", at("x\\PRIVILEGED\\a.pdf")), "string");
  assert.equal(zoneProblem("read", at("x\\privileged notes\\a.pdf")), null);
  assert.equal(zoneProblem("read", at("x\\Trash can\\a.pdf")), null);
});

test("zoneProblem move-from refuses the matter root and its pointer file", () => {
  assert.equal(typeof zoneProblem("move-from", ROOT, ROOT), "string");
  assert.equal(typeof zoneProblem("move-from", at("probanda.json"), ROOT), "string");
  assert.equal(typeof zoneProblem("move-from", at("Coclerk.json"), ROOT), "string");
  assert.equal(zoneProblem("move-from", at("3. CORRESPONDENCE\\probanda.json"), ROOT), null);
});

test("zoneProblem move-to keeps its destination wording", () => {
  assert.equal(zoneProblem("move-to", at("4. x\\privileged"), ROOT), "a privileged or disclosed folder is never a destination");
  assert.equal(zoneProblem("move-to", at("TRASH"), ROOT), "TRASH is never a destination");
  assert.equal(zoneProblem("move-to", at("1. CLIENT"), ROOT), "1. CLIENT is never a destination");
});

test("zoneProblem move-to with draftUnchanged allows only the 0. DRAFT folder itself", () => {
  assert.equal(zoneProblem("move-to", at("0. DRAFT"), ROOT, true), null);
  assert.equal(
    zoneProblem("move-to", at("0. DRAFT\\sub"), ROOT, true),
    "Move to 0. DRAFT unchanged moves only into the matter's 0. DRAFT folder"
  );
  assert.equal(typeof zoneProblem("move-to", at("3. CORRESPONDENCE"), ROOT, true), "string");
});

test("isDraftFolder and supersededDestinationProblem keep their rules", () => {
  assert.equal(isDraftFolder("0. DRAFT 2026"), true);
  assert.equal(isDraftFolder("1. CLIENT"), false);
  assert.equal(supersededDestinationProblem(["0. DRAFT", "Superseded"], "0. DRAFT"), null);
  assert.equal(typeof supersededDestinationProblem(["0. DRAFT"], "0. DRAFT"), "string");
});
