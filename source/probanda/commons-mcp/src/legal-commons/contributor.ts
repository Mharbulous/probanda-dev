import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { defaultStateDir } from "../dpapi-store.js";

// The opaque id this install contributes and verifies rule periods under. The
// pool has one shared key and no user identity, so the id is advisory: it names
// no one and is minted here on first use, never passed in by a caller. Not a
// secret, so it is stored plain beside the pool credential.

export function contributorPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(defaultStateDir(env), "contributor-id.json");
}

export async function contributorId(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const path = contributorPath(env);
  try {
    return (JSON.parse(await readFile(path, "utf8")) as { id: string }).id;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(dirname(path), { recursive: true });
  try {
    // "wx": a second process minting at the same moment loses, and reads the winner.
    await writeFile(path, JSON.stringify({ id: randomUUID() }), { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  return (JSON.parse(await readFile(path, "utf8")) as { id: string }).id;
}
