import { saveCommonsKey } from "../../../../mcp-shared/commons-key.js";
import { loadCloudKey } from "../cloud-key.js";
import { ValidationError } from "../errors.js";
import { serveKeyPage } from "./page.js";

// cloud_key__configure_credential: sets Probanda's one Cloud key on this
// computer, the file every server reads through source/mcp-shared/commons-key.js
// (practice writes here, the Suggestion Box and the legal commons in the
// researcher plugin). Cowork never injects a plugin's userConfig secret into its
// MCP server's environment, so the key is pasted on a local page (page.ts) and
// never passes through the chat. This server reads the file on every call, so a
// saved key takes effect at once. The commons server re-reads it while it holds none.

export async function configureCloudKey(env: NodeJS.ProcessEnv = process.env): Promise<unknown> {
  const url = await serveKeyPage((typed) => saveKey(typed, env));
  return {
    status: "awaiting_key",
    url,
    next:
      "Send the practitioner this link and ask them to paste the key on that page, never in chat. " +
      "When they say it is done, call practice_data__config_status: cloud_credential then reads present. " +
      "The link works only on this computer, until a new link is made or the server restarts.",
  };
}

async function saveKey(typed: string, env: NodeJS.ProcessEnv): Promise<void> {
  // Trim: a key pasted from a password manager routinely carries a trailing
  // newline, which would otherwise persist and surface later as an opaque 401.
  const staticKey = typed.trim();
  if (!staticKey) throw new ValidationError("paste the key");
  // The publishable key is the other key on the same Supabase project and the
  // easy one to grab by mistake. It reaches nothing Probanda's key reaches.
  if (staticKey.startsWith("sb_publishable_")) {
    throw new ValidationError(
      "that is the project's publishable key, which cannot reach Probanda's Cloud. " +
      "Paste the key Probanda gave you for this computer instead"
    );
  }
  await probe((await loadCloudKey(env)).supabaseUrl, staticKey);
  try {
    await saveCommonsKey(staticKey, env);
  } catch (error) {
    throw new ValidationError(
      `the key works, but this computer could not save it: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// One cheap authenticated call, so a wrong but plausible key fails here with a
// clear cause instead of on a later write. An empty body to items-sync reads
// nothing: it gets 401 for a wrong key and a 200 refusal (no tenant) for a good
// one (cloud/items/README.md). The data server reaches Probanda's Cloud only
// through the items functions and the key-request functions (check_plugin.py,
// bundle-purity).
async function probe(supabaseUrl: string, staticKey: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${supabaseUrl.replace(/\/$/, "")}/functions/v1/items-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: staticKey },
      body: "{}",
    });
  } catch (error) {
    throw new ValidationError(
      `Probanda's Cloud did not answer, so the key was not checked or saved: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (!res.ok) {
    throw new ValidationError(`that key did not work against Probanda's Cloud (${res.status}): ${(await res.text()) || res.statusText}`);
  }
}
