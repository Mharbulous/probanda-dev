// One outgoing request with a timeout. It owns the signal and the network-error message and
// returns the Response unparsed, because each caller reads its replies its own way. Plain
// JavaScript for the reason given in dpapi-store.js.

const DEFAULT_TIMEOUT_MS = 60_000;

// The error it throws keeps the original's name and cause, which callers read to tell a timeout or
// a connection reset from other failures. `redact` cleans the message, and `label` names the
// service in the shared wording. `fetch` defaults to the global one, looked up at each call.
export async function timedFetch(url, { init, timeoutMs = DEFAULT_TIMEOUT_MS, redact, label, fetch = globalThis.fetch } = {}) {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    const detail = redact ? redact(raw) : raw;
    const failure = new Error(label ? `${label} could not be reached (${detail})` : detail, { cause: error?.cause });
    if (error instanceof Error) failure.name = error.name;
    throw failure;
  }
}
