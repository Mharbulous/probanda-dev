// Composes a board page from its template files (map #125; decision #127).
//
// A board's entry `.html` template pulls in its parts with `@@include(<name>)@@` and marks the
// data line with `@@data@@`. `files` maps each name to the text scripts/templates.mjs inlined, so
// composing reads no file. The board writer and the preview tool share this one composer, and a
// render stays `head + "window.X = " + json + ";\n" + tail`.

const INCLUDE = /@@include\(([^)]*)\)@@/g;
const DATA = "@@data@@";

export interface ComposedTemplate {
  head: string;
  tail: string;
}

function expand(name: string, files: Readonly<Record<string, string>>, chain: string[]): string {
  if (chain.includes(name)) throw new Error(`template include cycle: ${[...chain, name].join(" -> ")}`);
  const text = files[name];
  if (text === undefined) {
    throw new Error(`template "${name}" is missing${chain.length ? ` (included by "${chain.at(-1)}")` : ""}`);
  }
  return text.replace(INCLUDE, (_, inner: string) => expand(inner, files, [...chain, name]));
}

/** Resolves `entry`'s includes from `files` and splits the page at its one data marker. Fails on a missing include, a marker count other than one, or any leftover `@@`. */
export function composeTemplate(entry: string, files: Readonly<Record<string, string>>): ComposedTemplate {
  const page = expand(entry, files, []);
  const parts = page.split(DATA);
  if (parts.length !== 2) throw new Error(`template "${entry}" has ${parts.length - 1} ${DATA} markers; it needs exactly one`);
  const [head, tail] = parts;
  if (head.includes("@@") || tail.includes("@@")) throw new Error(`template "${entry}" holds a leftover @@ after composing`);
  return { head, tail };
}
