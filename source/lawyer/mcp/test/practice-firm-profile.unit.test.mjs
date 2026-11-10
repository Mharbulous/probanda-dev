import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { crc32, deflateRawSync } from "node:zlib";

const { firm_profile, upsert_firm_profile, SIGNER_FIELDS, TOKENS } = await import("../build/tools/practice/firm-profile.js");

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_RELS = "http://schemas.openxmlformats.org/package/2006/relationships";
const IMAGE_REL = `${R}/image`;

const CONFIG = {
  version: 1,
  firm: { address: "1 Example Street", email: "", fax: "" },
  review: { scope: "full", comments: "at_end" },
  accounting: { system: "UNITY", csv_mapping: { date_format: "YYYY-MM-DD" } },
};

const ENTRY = {
  key: "pe",
  name: "Pat Example",
  designation: "Barrister & Solicitor",
  role: "lawyer",
  email: "pat@example.com",
  direct_line: "555-0100",
  closing: "Yours truly,",
  initials: "PE",
};

// A case data root under a temporary APPDATA, as practice-paths.unit.test.mjs builds one.
function fixture(t) {
  const scratch = mkdtempSync(join(tmpdir(), "coclerk-firm-profile-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const appData = join(scratch, "appdata");
  const root = join(scratch, "0. CASE DATA");
  mkdirSync(join(appData, "Probanda"), { recursive: true });
  mkdirSync(root);
  const configPath = join(appData, "Probanda", "probanda.json");
  const config = { ...CONFIG, case_data_root: root };
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  const firmDir = join(root, "_practice", "firm");
  return {
    scratch,
    config,
    configPath,
    env: { APPDATA: appData },
    firmDir,
    firmPath: join(firmDir, "firm.json"),
    letterheadPath: join(firmDir, "letterhead.docx"),
  };
}

function run(text, props = "") {
  return `<w:r>${props}<w:t>${text}</w:t></w:r>`;
}

const LANG = '<w:rPr><w:lang w:val="en-CA"/></w:rPr>';
const HEADER_RUNS = [
  run("{{AUTHOR_NAME}}", LANG),
  run("{{AUTHOR_EMAIL}}", LANG),
  run("{{DIRECT_LINE}}"),
  run("{{FILE_NUMBER}}"),
].join("");

// The parts publish/tests/support.py `template_parts` builds (one header
// carrying the four tokens behind a logo, an empty body ending in a sectPr), plus an optional
// footer and a theme naming the heading and body faces.
function templateParts({ header = HEADER_RUNS, footer, major = "Calibri", minor = "Calibri" } = {}) {
  const footerRel = footer ? `<Relationship Id="rIdFooter" Type="${R}/footer" Target="footer1.xml"/>` : "";
  const parts = {
    "[Content_Types].xml":
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="png" ContentType="image/png"/>' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/header3.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/word/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
      "</Types>",
    "_rels/.rels":
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      `<Relationships xmlns="${PKG_RELS}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`,
    "word/_rels/document.xml.rels":
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      `<Relationships xmlns="${PKG_RELS}">` +
      `<Relationship Id="rIdHeader" Type="${R}/header" Target="header3.xml"/>` +
      `<Relationship Id="rIdStyles" Type="${R}/styles" Target="styles.xml"/>` +
      `<Relationship Id="rIdTheme" Type="${R}/theme" Target="theme/theme1.xml"/>` +
      `${footerRel}</Relationships>`,
    "word/document.xml":
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
      // Body text is not checked: a split token here must not refuse the registration.
      `<w:p>${run("{{AUTHOR_")}${run("NAME}}")}</w:p>` +
      '<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/><w:pgSz w:w="12240" w:h="15840"/>' +
      '<w:pgMar w:top="2410" w:right="900" w:bottom="1440" w:left="993" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>' +
      "</w:body></w:document>",
    "word/header3.xml":
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      `<w:hdr xmlns:w="${W}" xmlns:r="${R}"><w:p>${run("[logo rIdLogo]")}${header}</w:p></w:hdr>`,
    "word/_rels/header3.xml.rels":
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      `<Relationships xmlns="${PKG_RELS}"><Relationship Id="rIdLogo" Type="${IMAGE_REL}" Target="media/logo.png"/></Relationships>`,
    "word/media/logo.png": Buffer.from("89504e470d0a1a0a", "hex"),
    "word/styles.xml":
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr>` +
      '<w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi" w:cstheme="minorBidi"/><w:lang w:val="en-CA"/>' +
      "</w:rPr></w:rPrDefault></w:docDefaults></w:styles>",
    "word/theme/theme1.xml":
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme"><a:themeElements><a:fontScheme name="Office">' +
      `<a:majorFont><a:latin typeface="${major}" panose="020F0302020204030204"/><a:ea typeface=""/></a:majorFont>` +
      `<a:minorFont><a:latin typeface="${minor}" panose="020F0502020204030204"/><a:ea typeface=""/></a:minorFont>` +
      "</a:fontScheme></a:themeElements></a:theme>",
  };
  if (footer) {
    parts["word/footer1.xml"] =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      `<w:ftr xmlns:w="${W}" xmlns:r="${R}"><w:p>${footer}</w:p></w:ftr>`;
  }
  return parts;
}

// A deflated zip, as Word writes a .docx.
function zip(parts) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(parts)) {
    const nameBytes = Buffer.from(name, "utf-8");
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf-8");
    const packed = deflateRawSync(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, packed);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const count = Object.keys(parts).length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

function writeLetterhead(f, name, options) {
  const path = join(f.scratch, name);
  writeFileSync(path, zip(templateParts(options)));
  return path;
}

function writeFirm(f, firm) {
  mkdirSync(f.firmDir, { recursive: true });
  writeFileSync(f.firmPath, JSON.stringify(firm));
}

const readJson = (path) => JSON.parse(readFileSync(path, "utf-8"));

test("firm_profile returns the firm name, the roster, the letterhead path and this machine's person", async (t) => {
  const f = fixture(t);
  writeFirm(f, { firm_name: "Example Law Corporation", roster: [{ ...ENTRY, active: true }] });
  writeFileSync(f.letterheadPath, zip(templateParts()));
  writeFileSync(f.configPath, JSON.stringify({ ...f.config, person: "pe" }));

  assert.deepEqual(await firm_profile(f.env), {
    firm_name: "Example Law Corporation",
    roster: [{ ...ENTRY, active: true }],
    letterhead: f.letterheadPath,
    invoice_template: null,
    person: "pe",
    practice_quirks: null,
  });
});

test("firm_profile returns a null letterhead and a null person when neither is set", async (t) => {
  const f = fixture(t);
  writeFirm(f, { firm_name: "Example Law Corporation", roster: [] });

  assert.deepEqual(await firm_profile(f.env), {
    firm_name: "Example Law Corporation",
    roster: [],
    letterhead: null,
    invoice_template: null,
    person: null,
    practice_quirks: null,
  });

  // An empty or null person counts as unset.
  for (const person of ["", null]) {
    writeFileSync(f.configPath, JSON.stringify({ ...f.config, person }));
    assert.equal((await firm_profile(f.env)).person, null);
  }
});

test("firm_profile refuses a person that is not a string or names no roster entry", async (t) => {
  const f = fixture(t);
  writeFirm(f, { firm_name: "Example Law Corporation", roster: [{ ...ENTRY, active: true }] });

  writeFileSync(f.configPath, JSON.stringify({ ...f.config, person: "zz" }));
  await assert.rejects(firm_profile(f.env), (err) => {
    assert.ok(err.message.includes(`person "zz" in ${f.configPath} is not a key in the firm roster (${f.firmPath})`), err.message);
    assert.ok(err.message.includes("practice_data__upsert_firm_profile"), err.message);
    return true;
  });

  writeFileSync(f.configPath, JSON.stringify({ ...f.config, person: 7 }));
  await assert.rejects(firm_profile(f.env), /person in .* must be a string/);
});

test("firm_profile fails hard, naming the missing firm.json or firm name with its path", async (t) => {
  const f = fixture(t);
  await assert.rejects(firm_profile(f.env), (err) => {
    assert.ok(err.message.includes(`firm.json (${f.firmPath})`), err.message);
    assert.ok(!err.message.includes("letterhead.docx"), err.message);
    return true;
  });

  // firm.json present but with an empty firm name.
  writeFirm(f, { firm_name: "", roster: [] });
  await assert.rejects(firm_profile(f.env), (err) => {
    assert.ok(err.message.includes(`firm_name in ${f.firmPath}`), err.message);
    return true;
  });
});

test("registration refuses split tokens, naming each token and its part, and writes nothing", async (t) => {
  const f = fixture(t);
  const source = writeLetterhead(f, "split.docx", {
    header: run("{{AUTHOR_NAME}}") + run("{{AUTHOR_") + run("EMAIL}}"),
    footer: run("File: {{FILE_") + run("NUMBER}}") + run("{{DIRECT_LINE}}"),
  });
  const configBefore = readFileSync(f.configPath, "utf-8");
  const signature = join(f.scratch, "sig.png");
  writeFileSync(signature, Buffer.from("89504e470d0a1a0a", "hex"));

  await assert.rejects(
    upsert_firm_profile({ firm_name: "Example Law Corporation", signature, letterhead: source }, f.env),
    (err) => {
      assert.ok(err.message.includes("{{AUTHOR_EMAIL}} in word/header3.xml"), err.message);
      assert.ok(err.message.includes("{{FILE_NUMBER}} in word/footer1.xml"), err.message);
      assert.ok(!err.message.includes("{{AUTHOR_NAME}} in"), "an intact token and a split body token are not reported");
      assert.ok(!err.message.includes("{{DIRECT_LINE}} in"), err.message);
      return true;
    }
  );
  assert.equal(existsSync(f.firmDir), false, "no firm folder, firm.json or letterhead written");
  assert.equal(readFileSync(f.configPath, "utf-8"), configBefore, "probanda.json untouched");
});

test("registration with differing theme faces reports them and still registers the file as-is", async (t) => {
  const f = fixture(t);
  const source = writeLetterhead(f, "leap.docx", { major: "Calibri Light", minor: "Calibri" });

  const result = await upsert_firm_profile({ letterhead: source }, f.env);
  assert.deepEqual(result.theme_faces_differ, { major: "Calibri Light", minor: "Calibri" });
  assert.deepEqual(result.changed, ["letterhead"]);
  assert.deepEqual(result.written, [f.letterheadPath]);
  assert.ok(readFileSync(f.letterheadPath).equals(readFileSync(source)), "copied byte for byte");
});

test("registration with an omitted token succeeds", async (t) => {
  const f = fixture(t);
  const source = writeLetterhead(f, "no-direct-line.docx", {
    header: run("{{AUTHOR_NAME}}") + run("{{AUTHOR_EMAIL}}") + run("{{FILE_NUMBER}}"),
  });

  const result = await upsert_firm_profile({ letterhead: source }, f.env);
  assert.equal(result.theme_faces_differ, undefined);
  assert.deepEqual(result.written, [f.letterheadPath]);
  assert.ok(existsSync(f.letterheadPath));
});

test("an entry marked inactive stays on the roster, its other fields kept", async (t) => {
  const f = fixture(t);
  await upsert_firm_profile({ firm_name: "Example Law Corporation", roster_entry: ENTRY }, f.env);
  const second = { ...ENTRY, key: "ss", name: "Sam Staff", role: "staff", initials: "SS" };
  const added = await upsert_firm_profile({ roster_entry: second }, f.env);
  assert.deepEqual(added.roster_entry, { key: "ss", created: true });

  const retired = await upsert_firm_profile({ roster_entry: { key: "pe", active: false } }, f.env);
  assert.deepEqual(retired.roster_entry, { key: "pe", created: false });
  const firm = readJson(f.firmPath);
  assert.equal(firm.firm_name, "Example Law Corporation");
  assert.equal(firm.roster.length, 2);
  assert.deepEqual(firm.roster[0], { ...ENTRY, active: false });
  assert.deepEqual(firm.roster[1], { ...second, active: true });
});

test("an active lawyer missing a signer field registers, with signer_fields_missing naming the fields", async (t) => {
  const f = fixture(t);
  const blank = await upsert_firm_profile({ firm_name: "Example Law Corporation", roster_entry: { ...ENTRY, direct_line: "" } }, f.env);
  assert.deepEqual(blank.signer_fields_missing, [{ key: "pe", fields: ["direct_line"] }]);
  assert.deepEqual(readJson(f.firmPath).roster[0], { ...ENTRY, direct_line: "", active: true });

  const filled = await upsert_firm_profile({ roster_entry: { key: "pe", direct_line: "555-0100" } }, f.env);
  assert.equal(filled.signer_fields_missing, undefined);

  // An entry written without an active key counts as active, as the letterhead renderer reads it.
  writeFirm(f, { firm_name: "Example Law Corporation", roster: [{ ...ENTRY, initials: "", closing: "" }] });
  const updated = await upsert_firm_profile({ roster_entry: { key: "pe", email: "pat@example.org" } }, f.env);
  assert.deepEqual(updated.signer_fields_missing, [{ key: "pe", fields: ["closing", "initials"] }]);
});

test("SIGNER_FIELDS matches the letterhead renderer's own list", () => {
  const renderer = readFileSync(new URL("../../../../source/skills/publish/scripts/render_letterhead.py", import.meta.url), "utf-8");
  const tuple = renderer.match(/^SIGNER_FIELDS = \(([^)]*)\)/m);
  assert.ok(tuple, "render_letterhead.py has no SIGNER_FIELDS tuple");
  assert.deepEqual([...tuple[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]), SIGNER_FIELDS);
});

test("TOKENS matches the letterhead renderer's own list", () => {
  const renderer = readFileSync(new URL("../../../../source/skills/publish/scripts/render_letterhead.py", import.meta.url), "utf-8");
  const tuple = renderer.match(/^TOKENS = \(([^)]*)\)/m);
  assert.ok(tuple, "render_letterhead.py has no TOKENS tuple");
  assert.deepEqual([...tuple[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]), TOKENS);
});

test("signer_fields_missing covers every active lawyer on the roster, on a letterhead-only call too", async (t) => {
  const f = fixture(t);
  writeFirm(f, {
    firm_name: "Example Law Corporation",
    roster: [
      { ...ENTRY, email: "" },
      { ...ENTRY, key: "ql", initials: "QL" },
      { ...ENTRY, key: "rl", closing: "", active: false },
      { ...ENTRY, key: "ss", role: "staff", direct_line: "" },
      { ...ENTRY, key: "tl", direct_line: "", initials: "" },
    ],
  });
  const result = await upsert_firm_profile({ letterhead: writeLetterhead(f, "letterhead.docx") }, f.env);
  assert.deepEqual(result.signer_fields_missing, [
    { key: "pe", fields: ["email"] },
    { key: "tl", fields: ["direct_line", "initials"] },
  ]);
});

test("preparer_initials_missing names this machine's person when its entry has blank initials", async (t) => {
  const f = fixture(t);
  const staff = { ...ENTRY, key: "ss", name: "Sam Staff", role: "staff", initials: "" };
  await upsert_firm_profile({ firm_name: "Example Law Corporation", roster_entry: ENTRY }, f.env);
  await upsert_firm_profile({ roster_entry: staff }, f.env);

  const blankPerson = await upsert_firm_profile({ person: "ss" }, f.env);
  assert.equal(blankPerson.preparer_initials_missing, "ss");
  assert.equal(readJson(f.configPath).person, "ss");

  const filledPerson = await upsert_firm_profile({ person: "pe" }, f.env);
  assert.equal(filledPerson.preparer_initials_missing, undefined);

  const otherBlanked = await upsert_firm_profile({ roster_entry: { key: "ss", initials: "" } }, f.env);
  assert.equal(otherBlanked.preparer_initials_missing, undefined);
  const personBlanked = await upsert_firm_profile({ roster_entry: { key: "pe", initials: "" } }, f.env);
  assert.equal(personBlanked.preparer_initials_missing, "pe");
  assert.equal(readJson(f.firmPath).roster[0].initials, "");
});

test("no signer_fields_missing for a complete lawyer, a staff entry or an inactive lawyer", async (t) => {
  const f = fixture(t);
  const complete = await upsert_firm_profile({ firm_name: "Example Law Corporation", roster_entry: ENTRY }, f.env);
  assert.equal(complete.signer_fields_missing, undefined);
  const staff = { ...ENTRY, key: "ss", role: "staff", direct_line: "" };
  assert.equal((await upsert_firm_profile({ roster_entry: staff }, f.env)).signer_fields_missing, undefined);
  const retired = await upsert_firm_profile({ roster_entry: { key: "pe", direct_line: "", active: false } }, f.env);
  assert.equal(retired.signer_fields_missing, undefined);
});

test("person and signature land in Probanda's probanda.json and both Coclerk names, and every other key survives", async (t) => {
  const f = fixture(t);
  const legacyFolder = join(f.configPath, "..", "..", "Coclerk");
  mkdirSync(legacyFolder);
  await upsert_firm_profile({ firm_name: "Example Law Corporation", roster_entry: ENTRY }, f.env);

  await assert.rejects(upsert_firm_profile({ person: "nobody" }, f.env), /person "nobody" is not a key in the firm roster/);
  const signature = join(f.scratch, "signature.png");
  writeFileSync(signature, Buffer.from("89504e470d0a1a0a", "hex"));
  const result = await upsert_firm_profile({ person: "pe", signature }, f.env);
  assert.deepEqual(result.changed, ["person", "signature"]);
  // While the Coclerk folder exists, an older copy of the plugin still reads it: every name gets the same content.
  assert.deepEqual(result.written, [f.configPath, join(legacyFolder, "probanda.json"), join(legacyFolder, "coclerk.json")]);
  for (const p of result.written) assert.deepEqual(readJson(p), { ...f.config, person: "pe", signature });
});

test("a person is refused when there is no roster, and accepted with this call's own new roster entry", async (t) => {
  const f = fixture(t);
  const configBefore = readFileSync(f.configPath, "utf-8");

  await assert.rejects(upsert_firm_profile({ person: "pe" }, f.env), (err) => {
    assert.equal(err.name, "ValidationError");
    assert.ok(err.message.includes(`${f.firmPath} is absent or has no roster`), err.message);
    return true;
  });
  assert.equal(readFileSync(f.configPath, "utf-8"), configBefore, "probanda.json untouched");
  assert.equal(existsSync(f.firmDir), false);

  const result = await upsert_firm_profile({ roster_entry: ENTRY, person: "pe" }, f.env);
  assert.deepEqual(result.changed, ["roster_entry", "person"]);
  assert.equal(readJson(f.configPath).person, "pe");
  assert.deepEqual(readJson(f.firmPath).roster, [{ ...ENTRY, active: true }]);
});

test("a signature whose file is absent is refused and nothing is written", async (t) => {
  const f = fixture(t);
  const configBefore = readFileSync(f.configPath, "utf-8");
  const signature = join(f.scratch, "absent.png");

  await assert.rejects(upsert_firm_profile({ firm_name: "Example Law Corporation", signature }, f.env), (err) => {
    assert.equal(err.name, "NotFoundError");
    assert.ok(err.message.includes(`signature file not found: ${signature}`), err.message);
    return true;
  });
  assert.equal(readFileSync(f.configPath, "utf-8"), configBefore, "probanda.json untouched");
  assert.equal(existsSync(f.firmDir), false, "no firm folder or firm.json written");
});

test("cc_on_counsel_email lands in firm.json as roster keys, [] clears it, and an unknown key is refused writing nothing", async (t) => {
  const f = fixture(t);
  writeFirm(f, { firm_name: "Example Law Corporation", roster: [{ ...ENTRY, active: true }] });

  const result = await upsert_firm_profile({ cc_on_counsel_email: [ENTRY.key] }, f.env);
  assert.deepEqual(result.changed, ["cc_on_counsel_email"]);
  assert.deepEqual(readJson(f.firmPath).cc_on_counsel_email, [ENTRY.key]);
  assert.deepEqual((await firm_profile(f.env)).cc_on_counsel_email, [ENTRY.key]);

  const before = readFileSync(f.firmPath, "utf-8");
  await assert.rejects(upsert_firm_profile({ cc_on_counsel_email: ["nobody"] }, f.env), /cc_on_counsel_email names key\(s\) not in the firm roster .*nobody/);
  await assert.rejects(upsert_firm_profile({ cc_on_counsel_email: "x" }, f.env), /cc_on_counsel_email must be a list of roster keys/);
  assert.equal(readFileSync(f.firmPath, "utf-8"), before, "firm.json untouched");

  await upsert_firm_profile({ cc_on_counsel_email: [] }, f.env);
  assert.equal("cc_on_counsel_email" in readJson(f.firmPath), false);
  assert.equal((await firm_profile(f.env)).cc_on_counsel_email, undefined, "unset, firm_profile carries none");
});

test("input validation failures are hard errors", async (t) => {
  const f = fixture(t);
  await assert.rejects(upsert_firm_profile({}, f.env), /needs at least one of firm_name, roster_entry, person, signature, practice_quirks, letterhead/);
  await assert.rejects(upsert_firm_profile({ roster_entry: { ...ENTRY, role: "partner" } }, f.env), /role must be one of: lawyer, staff/);
  await assert.rejects(
    upsert_firm_profile({ roster_entry: { key: "new", name: "New Person" } }, f.env),
    /"new" is new, so it needs every field\. Missing: designation, role, email, direct_line, closing, initials/
  );
  await assert.rejects(upsert_firm_profile({ letterhead: join(f.scratch, "absent.docx") }, f.env), /letterhead source not found/);
  assert.equal(existsSync(f.firmDir), false);
});

test("the invoice template is registered beside the letterhead and its path returned", async (t) => {
  const f = fixture(t);
  await upsert_firm_profile({ firm_name: "Example Law Corporation" }, f.env);
  assert.equal((await firm_profile(f.env)).invoice_template, null);
  const source = join(f.scratch, "corrected.docx");
  writeFileSync(source, zip(templateParts()));
  const result = await upsert_firm_profile({ invoice_template: source }, f.env);
  const registered = join(f.firmDir, "invoice.docx");
  assert.deepEqual(result.changed, ["invoice_template"]);
  assert.deepEqual(result.written, [registered]);
  assert.ok(readFileSync(registered).equals(readFileSync(source)), "copied byte for byte");
  assert.equal((await firm_profile(f.env)).invoice_template, registered);
});

test("an invoice template that is not a .docx is refused and nothing is written", async (t) => {
  const f = fixture(t);
  const source = join(f.scratch, "not.docx");
  writeFileSync(source, "not a zip");
  await assert.rejects(upsert_firm_profile({ invoice_template: source }, f.env), /invoice template .* is not a \.docx/);
  await assert.rejects(upsert_firm_profile({ invoice_template: join(f.scratch, "absent.docx") }, f.env), /invoice template source not found/);
  assert.equal(existsSync(f.firmDir), false);
});

test("style merges into what is set and is returned", async (t) => {
  const f = fixture(t);
  await upsert_firm_profile({ firm_name: "Example Law Corporation", style: { font: { name: "Georgia", size_pt: 10 } } }, f.env);
  assert.equal((await firm_profile(f.env)).style.font.name, "Georgia");
  await upsert_firm_profile({ style: { table: { banded_rows: true } } }, f.env);
  assert.deepEqual((await firm_profile(f.env)).style, { font: { name: "Georgia", size_pt: 10 }, table: { banded_rows: true } });
  await assert.rejects(upsert_firm_profile({ style: "teal" }, f.env), /style must be an object/);
});
