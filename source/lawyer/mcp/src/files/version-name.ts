import { readdirSync } from "node:fs";

/**
 * The next free name for `<stem><ext>` in `dir`: the bare name when no version is present, else
 * `<stem> vN<ext>`, N one above the highest version present (the bare name counts as v1). Only a
 * scan: the caller claims the name with an exclusive create and re-scans when another session took it.
 */
export function nextVersionName(dir: string, stem: string, ext: string): string {
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const version = new RegExp(`^${escape(stem)}(?: v(\\d+))?${escape(ext)}$`, "i");
  let highest = 0;
  for (const name of readdirSync(dir)) {
    const match = version.exec(name);
    if (match) highest = Math.max(highest, match[1] === undefined ? 1 : Number(match[1]));
  }
  return highest === 0 ? `${stem}${ext}` : `${stem} v${highest + 1}${ext}`;
}
