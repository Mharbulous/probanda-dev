import { persistApiKey } from "./dpapi-store.js";

// Every CanLII request goes through one CanliiClient: it holds the key, keeps the
// rate limit (2 req/sec, 1 concurrent, 5000/day, per CanLII API terms), redacts
// the key from errors and maps HTTP failures. fetch, the clock and the key store
// are injectable so the tools can be tested without the network or DPAPI.

export type KeySource = "env" | "stored" | "none";

export interface CanliiClientOptions {
	fetch?: typeof fetch;
	now?: () => number;
	sleep?: (ms: number) => Promise<void>;
	persistKey?: (key: string) => Promise<void>;
}

const API_BASE = "https://api.canlii.org/v1/";
const MIN_INTERVAL_MS = 500;
const DAILY_LIMIT = 5000;
export const TIMEOUT_MS = 60_000;

export function sanitizeError(message: string): string {
	return message.replace(/api_key=[^&\s]*/gi, "api_key=REDACTED");
}

export class CanliiClient {
	// The key is optional: the server must start without it so canlii tools stay
	// registered. Requests fail at point of use with instructions to add the key,
	// rather than blocking the base practice at startup. Mutable so
	// configure_credential can update it live, mid-session, without a restart.
	key = "";
	keySource: KeySource = "none";
	// Set when a persisted credential existed but could not be decrypted/read (e.g.
	// a DPAPI key invalidated by a Windows profile change). Rides on the "not
	// configured" error so the cause is named rather than silently swallowed.
	credentialError: string | undefined;

	readonly persistKey: (key: string) => Promise<void>;
	readonly now: () => number;
	private readonly fetchImpl: typeof fetch;
	private readonly sleep: (ms: number) => Promise<void>;

	// A promise queue serializes all requests, so no two API calls run at once.
	private queue: Promise<void> = Promise.resolve();
	private dailyCount = 0;
	private dailyResetDate: string;
	private lastRequestTime = 0;

	constructor(options: CanliiClientOptions = {}) {
		this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
		this.now = options.now ?? Date.now;
		this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
		this.persistKey = options.persistKey ?? persistApiKey;
		this.dailyResetDate = new Date(this.now()).toDateString();
	}

	missingKeyMessage(): string {
		return "CanLII API key not configured. Case-law and legislation lookup is an optional feature. " +
			"To enable it, either set the CANLII_API_KEY environment variable (Claude Code CLI inherits it), " +
			"or — if the environment variable is not reaching this server, which is the case in Cowork — call " +
			"the canlii configure_credential tool with your key. Request a free research key via CanLII's " +
			"feedback form. Every other litigation feature works without it." +
			(this.credentialError
				? ` (Note: a saved key exists on this machine but could not be read — ${this.credentialError} — ` +
				  "so re-supply it via configure_credential.)"
				: "");
	}

	// One rate-limited, keyed request. `path` is relative to the v1 API root; the
	// key goes first in the query, then `params`.
	request(path: string, params?: URLSearchParams): Promise<Response> {
		if (!this.key) {
			return Promise.reject(new Error(this.missingKeyMessage()));
		}
		const query = new URLSearchParams({ api_key: this.key });
		for (const [name, value] of params ?? []) query.append(name, value);
		const url = `${API_BASE}${path}?${query.toString()}`;
		const run = this.queue.then(async () => {
			const today = new Date(this.now()).toDateString();
			if (today !== this.dailyResetDate) {
				this.dailyCount = 0;
				this.dailyResetDate = today;
			}
			if (this.dailyCount >= DAILY_LIMIT) {
				throw new Error("Daily API limit reached (5,000 queries). Try again tomorrow.");
			}
			const elapsed = this.now() - this.lastRequestTime;
			if (elapsed < MIN_INTERVAL_MS) {
				await this.sleep(MIN_INTERVAL_MS - elapsed);
			}
			this.lastRequestTime = this.now();
			this.dailyCount++;
			try {
				return await this.fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
			} catch (error) {
				// The detail must never carry the URL: it holds api_key.
				const detail = sanitizeError(error instanceof Error ? error.message : String(error));
				throw new Error(`network: CanLII could not be reached (${detail})`);
			}
		});
		// A failed request must not leave the queue rejected, or every later
		// request would fail with the same error.
		this.queue = run.then(() => undefined, () => undefined);
		return run;
	}

	// A keyed request whose reply must be 2xx JSON. A non-2xx reply throws
	// `<failure> (<status>)`.
	async getJson(path: string, failure: string, params?: URLSearchParams): Promise<unknown> {
		const response = await this.request(path, params);
		if (!response.ok) {
			throw new Error(`${failure} (${response.status})`);
		}
		return readJson(response);
	}

	// A page outside the CanLII API (BC Laws), so it takes no key and no rate limit.
	async fetchText(url: string): Promise<string> {
		const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		return response.text();
	}
}

export async function readJson(response: Response): Promise<unknown> {
	const text = await response.text();
	try {
		return JSON.parse(text);
	} catch {
		const flat = text.replace(/\s+/g, " ").trim();
		throw new Error(`CanLII returned a reply that is not JSON: ${flat.length > 200 ? `${flat.slice(0, 200)}…` : flat}`);
	}
}
