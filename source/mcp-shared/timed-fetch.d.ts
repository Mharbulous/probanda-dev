// Types for timed-fetch.js. Keep in step with it.

export interface TimedFetchOptions {
  /** The request, without a signal: this helper sets it. */
  init?: RequestInit;
  /** Default 60 s. */
  timeoutMs?: number;
  redact?: (message: string) => string;
  /** With it, a network failure reads `<label> could not be reached (<detail>)`. */
  label?: string;
  fetch?: typeof globalThis.fetch;
}

export declare function timedFetch(url: string, options?: TimedFetchOptions): Promise<Response>;
