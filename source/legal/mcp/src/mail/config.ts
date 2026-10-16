import { join } from "node:path";

import { defaultStateDir, readProtectedJson, writeProtectedJson } from "../../../../mcp-shared/dpapi-store.js";
import { isValidTimeZone } from "../dav/tz.js";

// The IMAP mail credential (docs/Plans/2026-10-15_imap-mail.md, step 1). One
// credential per machine, set once on mail__configure_credential's local page
// (page.ts, so the password never passes through the chat) and kept
// in a DPAPI file beside the other Coclerk credentials. The pattern is the
// commons server's Suggestion Box config: load at start without throwing,
// probe before saving, never return the password. The calendar__* and
// contacts__* tools read with the same password (CalDAV and CardDAV), so the
// calendar and contacts fields are optional parts of this one credential: a
// file saved before they existed loads unchanged, and those tools then report
// dav_not_configured.

export interface MailCredential {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  /** Recorded for the practitioner's reference only; nothing is sent from it. */
  fromAddress?: string;
  /** CalDAV and CardDAV sign-in name, tried before `username` (for iCloud, the Apple ID). */
  davUsername?: string;
  caldavUrl?: string;
  carddavUrl?: string;
  /** IANA time zone the calendar tools read and show times in. */
  timezone?: string;
}

const DAV_FIELDS = ["davUsername", "caldavUrl", "carddavUrl", "timezone"] as const;

// Held on the dispatch context and replaced in place by configure_credential.
export interface MailState {
  credential: MailCredential | null;
  // First line of the reason a stored credential could not be read, if any.
  credentialError?: string;
  // Why the last save left calendar or contacts out, kept in memory for mail__configure_status.
  davSignIn?: { calendar?: string; contacts?: string };
}

export function credentialPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(defaultStateDir(env, "mail"), "mail.json.dpapi");
}

const ENV_TRIO = ["PROBANDA_MAIL_HOST", "PROBANDA_MAIL_USERNAME", "PROBANDA_MAIL_PASSWORD"] as const;

// A developer override: host, username and password together, or none of them.
// When set, env wins outright and the file is not read, as loadCommonsKey does.
function envCredential(env: NodeJS.ProcessEnv): MailState | undefined {
  const set = ENV_TRIO.filter((name) => env[name]);
  if (set.length === 0) return undefined;
  if (set.length < ENV_TRIO.length) {
    return { credential: null, credentialError: `${ENV_TRIO.join(", ")} must be set together` };
  }
  const port = env.PROBANDA_MAIL_PORT ? Number(env.PROBANDA_MAIL_PORT) : 993;
  if (env.PROBANDA_TIMEZONE && !isValidTimeZone(env.PROBANDA_TIMEZONE)) {
    return { credential: null, credentialError: `PROBANDA_TIMEZONE "${env.PROBANDA_TIMEZONE}" is not an IANA time zone` };
  }
  return {
    credential: {
      host: env.PROBANDA_MAIL_HOST as string,
      port,
      secure: true,
      username: env.PROBANDA_MAIL_USERNAME as string,
      password: env.PROBANDA_MAIL_PASSWORD as string,
      ...(env.PROBANDA_MAIL_FROM ? { fromAddress: env.PROBANDA_MAIL_FROM } : {}),
      ...(env.PROBANDA_DAV_USERNAME ? { davUsername: env.PROBANDA_DAV_USERNAME } : {}),
      ...(env.PROBANDA_CALDAV_URL ? { caldavUrl: env.PROBANDA_CALDAV_URL } : {}),
      ...(env.PROBANDA_CARDDAV_URL ? { carddavUrl: env.PROBANDA_CARDDAV_URL } : {}),
      ...(env.PROBANDA_TIMEZONE ? { timezone: env.PROBANDA_TIMEZONE } : {}),
    },
  };
}

// Nothing here throws, so start() always reaches the tool that fixes the
// credential. An unreadable file degrades to unconfigured, says why on stderr,
// and is left in place.
export async function loadMailConfig(env: NodeJS.ProcessEnv = process.env): Promise<MailState> {
  const fromEnv = envCredential(env);
  if (fromEnv) return fromEnv;
  try {
    const stored = await readProtectedJson<Partial<MailCredential>>(credentialPath(env), null);
    if (!stored) return { credential: null };
    const { host, port, secure, username, password, fromAddress } = stored;
    if (typeof host !== "string" || typeof username !== "string" || typeof password !== "string" || typeof port !== "number") {
      throw new Error("the stored file is not a mail credential");
    }
    const credential: MailCredential = {
      host,
      port,
      secure: secure !== false,
      username,
      password,
      ...(typeof fromAddress === "string" ? { fromAddress } : {}),
    };
    for (const key of DAV_FIELDS) {
      const value = stored[key];
      if (typeof value === "string" && value) credential[key] = value;
    }
    return { credential };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `mail: stored credential at ${credentialPath(env)} could not be read — ` +
      `${detail}\nStarting unconfigured; set it again through mail__configure_credential's sign-in page.\n`
    );
    return { credential: null, credentialError: detail.split("\n")[0].trim() };
  }
}

// Called once the sign-in page's password signs in. `protect` is forced true: a real
// password is never written as plaintext.
export async function persistMailCredential(
  credential: MailCredential,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  await writeProtectedJson(credentialPath(env), credential, true);
}
