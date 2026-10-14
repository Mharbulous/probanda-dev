import { join } from "node:path";

import { defaultStateDir, readProtectedJson, writeProtectedJson } from "../dpapi-store.js";

// Suggestion Box config. An accepted suggestion about the plugin is posted as a
// GitHub issue on one private repo. The repo's name and the token that reaches it
// live only in a DPAPI file written by suggestion_box__configure_credential: no
// repo name is baked into this runtime, and there is no environment route.

export interface SuggestionBoxCredential {
  /** `owner/name`. */
  repo: string;
  token: string;
}

// Held on the dispatch context and replaced in place by configure_credential.
export interface SuggestionBoxState {
  credential: SuggestionBoxCredential | null;
  // First line of the reason a stored credential could not be read, if any.
  credentialError?: string;
}

export function credentialPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(defaultStateDir(env, "suggestion-box"), "credential.json.dpapi");
}

// Same startup discipline as loadTroubleshootConfig: nothing here throws, so
// start() always reaches the tool that fixes the credential. An unreadable
// credential degrades to unconfigured and says why on stderr.
export async function loadSuggestionBoxConfig(env: NodeJS.ProcessEnv = process.env): Promise<SuggestionBoxState> {
  try {
    const persisted = await readProtectedJson<SuggestionBoxCredential>(credentialPath(env), null);
    if (persisted?.repo && persisted.token) return { credential: { repo: persisted.repo, token: persisted.token } };
    return { credential: null };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `suggestion-box: stored credential at ${credentialPath(env)} could not be read — ` +
      `${detail}\nStarting unconfigured; call suggestion_box__configure_credential to replace it.\n`
    );
    return { credential: null, credentialError: detail.split("\n")[0].trim() };
  }
}

// Called by suggestion_box__configure_credential. `protect` is forced true for
// the same reason as the store's: never write a real secret as plaintext.
export async function persistSuggestionBoxCredential(
  credential: SuggestionBoxCredential,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  await writeProtectedJson(credentialPath(env), credential, true);
}
