// Highlight runs, named the way Word's highlighter names them so the practitioner reads
// "yellow" and "bright green", not "#00ff00".

export interface HighlightRun {
  text: string;
  /** "" while collecting = not highlighted; never "" in a returned list. */
  colour: string;
}

const WORD_PALETTE: Record<string, string> = {
  ffff00: "yellow",
  "00ff00": "bright green",
  "00ffff": "turquoise",
  ff00ff: "pink",
  "0000ff": "blue",
  ff0000: "red",
  "000080": "dark blue",
  "008080": "teal",
  "008000": "green",
  "800080": "violet",
  "800000": "dark red",
  "808000": "dark yellow",
  "808080": "gray 50%",
  c0c0c0: "gray 25%",
  "000000": "black",
};

const CSS_NAMES: Record<string, string> = {
  yellow: "ffff00",
  lime: "00ff00",
  aqua: "00ffff",
  cyan: "00ffff",
  fuchsia: "ff00ff",
  magenta: "ff00ff",
  blue: "0000ff",
  red: "ff0000",
  navy: "000080",
  teal: "008080",
  green: "008000",
  purple: "800080",
  maroon: "800000",
  olive: "808000",
  gray: "808080",
  grey: "808080",
  silver: "c0c0c0",
  black: "000000",
};

/** "No highlight" values a style or Word may carry. */
const NONE = new Set(["", "none", "transparent", "inherit", "initial", "unset", "white", "window", "#fff", "#ffffff", "ffffff", "auto"]);

/** A colour as Word's highlighter names it, else its #rrggbb, else the value as given; null for none. */
export function colourName(value: string): string | null {
  let v = value.trim().toLowerCase();
  if (NONE.has(v)) return null;
  if (CSS_NAMES[v]) v = CSS_NAMES[v];
  const rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(v);
  if (rgb) v = rgb.slice(1).map((n) => Number(n).toString(16).padStart(2, "0")).join("");
  v = v.replace(/^#/, "");
  if (/^[0-9a-f]{3}$/.test(v)) v = v.replace(/./g, (c) => c + c);
  if (v === "ffffff") return null;
  if (WORD_PALETTE[v]) return WORD_PALETTE[v];
  return /^[0-9a-f]{6}$/.test(v) ? `#${v}` : value.trim();
}

/** Adjacent runs of one colour joined, whitespace collapsed, unhighlighted and empty runs dropped. */
export function mergeRuns(runs: HighlightRun[]): HighlightRun[] {
  const merged: HighlightRun[] = [];
  let current: HighlightRun | undefined;
  for (const run of runs) {
    if (current && run.colour === current.colour) {
      current.text += run.text;
      continue;
    }
    current = { ...run };
    merged.push(current);
  }
  return merged
    .filter((r) => r.colour !== "")
    .map((r) => ({ text: r.text.replace(/\s+/g, " ").trim(), colour: r.colour }))
    .filter((r) => r.text !== "");
}
