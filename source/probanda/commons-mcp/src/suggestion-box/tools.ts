import { ValidationError } from "../errors.js";
import { findRedactionHits } from "../troubleshoot/redact.js";
import { persistSuggestionBoxCredential, type SuggestionBoxCredential, type SuggestionBoxState } from "./config.js";

// Runtime logic for the Suggestion Box namespace: a suggestion about the plugin
// that the practitioner expressly submits is posted as one GitHub issue on the
// private repo held in stored configuration. A post carries a title and a body
// and nothing else. The repo is checked to be private when it is configured and
// again before every post, so nothing here can post to a public repo.
// Tool definitions live in schema-gen.ts.

const NOT_CONFIGURED_HINT =
  "the Suggestion Box is not configured: call suggestion_box__configure_credential once with the private " +
  "repo (owner/name) and a token limited to that repo with Issues: Read and write";

const GITHUB_API = "https://api.github.com";
const REPO_FORM = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const TOKEN_FORM = /^[\x21-\x7E]+$/;
// GitHub's token-type prefixes. The hint shows one of these and the last four
// characters, so it never shows any of the secret part beyond those four.
const TOKEN_PREFIX = /^(?:github_pat_|gh[pousr]_)/;

export function isSuggestionBoxToolName(name: string): boolean {
  return name.startsWith("suggestion_box__");
}

export function callSuggestionBoxTool(
  state: SuggestionBoxState,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  switch (name) {
    case "suggestion_box__submit":
      return submit(state, args);
    case "suggestion_box__configure_credential":
      return configureCredential(state, args);
    case "suggestion_box__configure_status":
      return configureStatus(state);
    default:
      throw new ValidationError(`Unknown suggestion_box tool "${name}"`);
  }
}

// GitHub refuses a call with no User-Agent. The value is fixed so that it never
// names the machine or the user.
function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "probanda-suggestion-box",
  };
}

// One request. A message built here names the status and never the token.
async function github(token: string, path: string, init: { method: string; body?: string }): Promise<Response> {
  try {
    return await fetch(`${GITHUB_API}${path}`, {
      method: init.method,
      headers: init.body === undefined ? headers(token) : { ...headers(token), "Content-Type": "application/json" },
      body: init.body,
    });
  } catch (error) {
    throw new ValidationError(`GitHub could not be reached: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Refuses unless the token can see the repo and the repo is private. A token
// with no access to the repo gets 404, which refuses too.
async function requirePrivateRepo(credential: SuggestionBoxCredential): Promise<void> {
  const reply = await github(credential.token, `/repos/${credential.repo}`, { method: "GET" });
  if (reply.status === 401) throw new ValidationError("GitHub refused the token (401)");
  if (reply.status === 404) {
    throw new ValidationError("GitHub found no such repo for that token (404): the name is wrong or the token has no access to it");
  }
  if (reply.status !== 200) throw new ValidationError(`GitHub answered ${reply.status} for the repo`);
  const repo = (await reply.json()) as { private?: unknown };
  if (repo.private !== true) {
    throw new ValidationError("that repo is not private: the Suggestion Box posts only to a private repo");
  }
}

// submit — the one post. The redaction screen runs first and refuses before any
// network call; its message names the kinds hit, never the text.
async function submit(state: SuggestionBoxState, args: Record<string, unknown>): Promise<unknown> {
  const credential = state.credential;
  if (!credential) {
    throw new ValidationError(state.credentialError ? `${NOT_CONFIGURED_HINT} (the stored credential could not be read: ${state.credentialError})` : NOT_CONFIGURED_HINT);
  }
  const title = String(args.title ?? "").trim();
  const body = String(args.body ?? "").trim();
  if (!title) throw new ValidationError("submit requires a title");
  if (!body) throw new ValidationError("submit requires a body");
  const hits = findRedactionHits({ title, body });
  if (hits.length > 0) {
    throw new ValidationError(`submit refused: ${hits.join(", ")}; rewrite the suggestion generically and resubmit`);
  }

  await requirePrivateRepo(credential);
  const reply = await github(credential.token, `/repos/${credential.repo}/issues`, {
    method: "POST",
    body: JSON.stringify({ title, body, labels: ["suggestion"] }),
  });
  if (reply.status !== 201) throw new ValidationError(`GitHub answered ${reply.status}, so the suggestion was not posted`);
  const issue = (await reply.json()) as { number: number; html_url: string };
  return { issue_number: issue.number, url: issue.html_url };
}

// configure_credential — probe, then set live, then persist, reporting a failed
// persist as the store's tool does. A pair that fails the probe is not saved and
// leaves the previous credential in place.
async function configureCredential(state: SuggestionBoxState, args: Record<string, unknown>): Promise<unknown> {
  const repo = String(args.repo || "").trim();
  const token = String(args.token || "").trim();
  if (!REPO_FORM.test(repo)) throw new ValidationError("configure_credential requires repo as owner/name");
  if (!token) throw new ValidationError("configure_credential requires token");
  // fetch refuses a header holding a control or non-ASCII character, and its
  // message for that quotes the header, so such a token is refused here first.
  if (!TOKEN_FORM.test(token)) {
    throw new ValidationError("configure_credential requires a token of printable characters with no spaces");
  }

  const credential = { repo, token };
  try {
    await requirePrivateRepo(credential);
  } catch (error) {
    throw new ValidationError(`not saved: ${error instanceof Error ? error.message : String(error)}`);
  }
  state.credential = credential;
  delete state.credentialError;

  try {
    await persistSuggestionBoxCredential(credential);
  } catch (error) {
    return {
      configured: true,
      persisted: false,
      warning:
        "the credential works and is active for this session, but could not be saved to disk, so it " +
        `must be supplied again after a restart: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  return { configured: true, persisted: true };
}

// configure_status — answers rather than throwing when nothing is configured,
// and never returns the token itself.
async function configureStatus(state: SuggestionBoxState): Promise<unknown> {
  const token = state.credential?.token ?? "";
  return {
    configured: state.credential !== null,
    repo: state.credential?.repo ?? null,
    token_hint: token.length < 20 ? null : `${token.match(TOKEN_PREFIX)?.[0] ?? ""}…${token.slice(-4)}`,
  };
}
