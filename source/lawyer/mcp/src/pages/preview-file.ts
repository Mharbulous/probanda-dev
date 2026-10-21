// Board previews (map #125; contract #138, names #139, built #142): composing a board's template
// with a session's overrides, and writing the preview file. Shared by pages__preview in the lawyer
// `data` server and housekeeping__preview in file-manager's `files` server, so it imports no board.
//
// A preview is `<page file name> preview <n>.html`, at the lowest n not yet taken, and is never
// overwritten. A tool returns its path, never its HTML: no session reads a preview (shared/html-pages.md).
//
// A fixture preview (placeholder data only) goes in the fixture preview folder and ends with the
// fixture marker line. suggestion_box__submit (#146) accepts a preview only from that folder and only
// with that last line, so the folder is one fixed path every Probanda server on the machine computes
// alike, in the OS temp folder, rather than a plugin's own data folder.

import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type ComposedTemplate, composeTemplate, type TemplateSet } from "../compose-template.js";
import { ValidationError } from "../errors.js";

export const FIXTURE_PREVIEW_FOLDER = "Probanda fixture previews";

/** The fixture preview folder: `<OS temp folder>\Probanda fixture previews`. */
export function fixturePreviewDir(): string {
  return join(tmpdir(), FIXTURE_PREVIEW_FOLDER);
}

/** The last line of every fixture preview, after the page's own text. */
export const FIXTURE_PREVIEW_MARKER = "<!-- probanda-fixture-preview -->";

/** `set` composed with `overrides` (file name to text) in place of its inlined files. An override
 * naming no file of the set is refused, so a misspelt name never previews the unchanged page. */
export function composeWithOverrides(set: TemplateSet, overrides: Readonly<Record<string, string>> = {}): ComposedTemplate {
  const unknown = Object.keys(overrides).filter((name) => !Object.hasOwn(set.files, name));
  if (unknown.length > 0) {
    throw new ValidationError(`overrides name no template file of this page: ${unknown.join(", ")}. Its files are ${Object.keys(set.files).join(", ")}.`);
  }
  const notText = Object.keys(overrides).filter((name) => typeof overrides[name] !== "string");
  if (notText.length > 0) throw new ValidationError(`each override is a file's whole text, a string: ${notText.join(", ")} is not`);
  return composeTemplate(set.entry, { ...set.files, ...overrides });
}

/** Writes `<base> preview <n>.html` in `dir` (made if missing) and returns its path. A fixture
 * preview gains the marker as its last line. */
export function writePreview(dir: string, base: string, html: string, fixture: boolean): string {
  mkdirSync(dir, { recursive: true });
  const text = fixture ? `${html}${html.endsWith("\n") ? "" : "\n"}${FIXTURE_PREVIEW_MARKER}\n` : html;
  for (let n = 1; ; n++) {
    const path = join(dir, `${base} preview ${n}.html`);
    try {
      writeFileSync(path, text, { flag: "wx" });
      return path;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
}
