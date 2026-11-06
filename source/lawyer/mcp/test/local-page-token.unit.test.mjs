// The page tokens already embedded in rendered pages (Loose Threads, Past suggestions, suggestion
// cards, /files/open links) must keep their exact bytes after the move to local-page/token.ts.
// The expected values were computed by page-api/token.ts before the move, from a fixed secret.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const token = await import("../build/page-api/token.js");

function device(config = {}) {
  const dir = mkdtempSync(join(tmpdir(), "local-page-token-"));
  const path = join(dir, "probanda.json");
  writeFileSync(path, JSON.stringify(config));
  writeFileSync(join(dir, "page-api.secret"), Buffer.from(Array.from({ length: 32 }, (_, i) => i)));
  return { env: { ...process.env, COCLERK_CONFIG_PATH: path }, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("every page token keeps the bytes it had before the move", () => {
  const d = device();
  try {
    const PAGE = "3c80ee04f3fbc6a9eb414da56027b7bdbdda5e962103885f0e2e94bd37d42a04";
    const SUGGESTION = "e6ac8ec1287962d240255334a4e902666bd776a2e961b2cb52de0c663569ef9f";
    const FILE = "39ae737aa6a239602afac5afcb34c28407e9fe5cf655503310e7130462a75b18";
    const CARD = "fc52ec8678775a4e69f40bd51d11ed6b97f412b753df571846f94310dddabde7";
    assert.equal(token.pageApiToken("C:\\db\\main.sqlite", 7, d.env), PAGE);
    assert.equal(token.pageApiSuggestionToken("rec-1", d.env), SUGGESTION);
    assert.equal(token.pageApiFileToken("C:\\x\\a b.pdf", d.env), FILE);
    assert.equal(token.pageApiCardToken("card-1", d.env), CARD);
    assert.equal(token.pageApiFileUrl("C:\\x\\a b.pdf", d.env), `http://127.0.0.1:47615/files/open?path=C%3A%5Cx%5Ca%20b.pdf&token=${FILE}`);

    assert.equal(token.pageApiTokenValid(PAGE, "C:\\db\\main.sqlite", 7, d.env), true);
    assert.equal(token.pageApiTokenValid(PAGE, "C:\\db\\main.sqlite", 8, d.env), false);
    assert.equal(token.pageApiSuggestionTokenValid(SUGGESTION, "rec-1", d.env), true);
    assert.equal(token.pageApiSuggestionTokenValid(CARD, "rec-1", d.env), false);
    assert.equal(token.pageApiFileTokenValid(FILE, "C:\\x\\a b.pdf", d.env), true);
    assert.equal(token.pageApiFileTokenValid(FILE.slice(1), "C:\\x\\a b.pdf", d.env), false);
    assert.equal(token.pageApiCardTokenValid(CARD, "card-1", d.env), true);
    assert.equal(token.pageApiCardTokenValid(SUGGESTION, "card-1", d.env), false);
  } finally {
    d.cleanup();
  }
});

test("the lawyer port is page_ports.lawyer, else page_api_port, else 47615; file-manager defaults to 47616", async () => {
  const { pagePort } = await import("../build/local-page/ports.js");
  const cases = [
    [{}, 47615, 47616],
    [{ page_api_port: 50001 }, 50001, 47616],
    [{ page_api_port: 50001, page_ports: { lawyer: 50002, "file-manager": 50003 } }, 50002, 50003],
  ];
  for (const [config, lawyer, fileManager] of cases) {
    const d = device(config);
    try {
      assert.equal(pagePort("lawyer", d.env), lawyer, JSON.stringify(config));
      assert.equal(token.pageApiPort(d.env), lawyer, JSON.stringify(config));
      assert.equal(pagePort("file-manager", d.env), fileManager, JSON.stringify(config));
    } finally {
      d.cleanup();
    }
  }
  const bad = device({ page_api_port: "47615" });
  try {
    assert.throws(() => token.pageApiPort(bad.env), (err) => err.code === "invalid_page_api_port" && /page_api_port must be a whole number/.test(err.message));
  } finally {
    bad.cleanup();
  }
  for (const config of [{ page_ports: { "file-manager": 0 } }, { page_ports: [] }]) {
    const d = device(config);
    try {
      assert.throws(() => pagePort("file-manager", d.env), (err) => err.code === "invalid_page_ports", JSON.stringify(config));
    } finally {
      d.cleanup();
    }
  }
});
