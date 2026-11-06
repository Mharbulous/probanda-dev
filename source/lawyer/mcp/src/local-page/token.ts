// The tokens a local page carries, computed from a per-device secret so that every process on the
// device, and every restart, gives and accepts the same token. Nothing is kept in memory.
//
// A token is HMAC-SHA256(secret, message), hex. The message is `<kind>\n<target>`, except for a
// "proceeding" token (a Loose Threads page: `db_path\nproceeding_id`), which predates the prefixes
// and keeps its bare target, so links already rendered keep working. A db_path is absolute, so it
// never collides with a prefixed message.
//
// The secret is 32 random bytes in `page-api.secret` beside probanda.json, created on first need
// with an exclusive create.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { configPath } from "../config-path.js";

export type TokenKind = "proceeding" | "suggestion" | "file" | "card";

const SECRET_FILE = "page-api.secret";
const SECRET_BYTES = 32;

/** The secret's path: beside probanda.json. */
export function secretPath(env: NodeJS.ProcessEnv): string {
  return join(dirname(configPath(env)), SECRET_FILE);
}

/** The per-device secret, created on first need. The bytes are written to a temp file first and
 * linked into place, which fails if the file exists, so a reader never sees a part-written secret
 * and two processes creating it at once agree on one. */
function deviceSecret(env: NodeJS.ProcessEnv): Buffer {
  const path = secretPath(env);
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    const temp = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    writeFileSync(temp, randomBytes(SECRET_BYTES), { flag: "wx" });
    try {
      linkSync(temp, path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    } finally {
      unlinkSync(temp);
    }
  }
  const secret = readFileSync(path);
  if (secret.length !== SECRET_BYTES) throw new Error(`${path} holds ${secret.length} bytes, not ${SECRET_BYTES}; delete it and re-render the page`);
  return secret;
}

/** HMAC-SHA256 of `message` under the device secret. */
export function deviceHmac(message: string, env: NodeJS.ProcessEnv): Buffer {
  return createHmac("sha256", deviceSecret(env)).update(message).digest();
}

/** Whether two strings are equal, compared in constant time. */
export function sameText(given: string, expected: string): boolean {
  const a = Buffer.from(given, "utf-8");
  const b = Buffer.from(expected, "utf-8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The token a page carries for one target of one kind. */
export function signTarget(kind: TokenKind, target: string, env: NodeJS.ProcessEnv): string {
  return deviceHmac(kind === "proceeding" ? target : `${kind}\n${target}`, env).toString("hex");
}

/** Whether `token` is the one signTarget gives, compared in constant time. */
export function verifyTarget(kind: TokenKind, target: string, token: string, env: NodeJS.ProcessEnv): boolean {
  return sameText(token, signTarget(kind, target, env));
}
