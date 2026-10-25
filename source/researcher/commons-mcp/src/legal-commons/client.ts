import { TransportError, ValidationError } from "../errors.js";
import type { LegalCommonsConfig } from "./config.js";

const TIMEOUT_MS = 60_000;

// Slim PostgREST client for the layer-3 pool. Deliberately separate from
// src/db/rest.ts (which is bound to the per-session JWT tokenProvider and the
// default `public` schema): legal-commons uses a static credential and a
// non-public Postgres schema reached via PostgREST profile headers
// (Accept-Profile / Content-Profile). Keeping it separate leaves the legacy
// REST path untouched. Retrieval is in-Postgres (FTS + trigram + citation/tag joins)
// so there is no external embeddings call here.

export interface SelectOptions {
  limit?: number;
  order?: string;
}

export class LegalCommonsClient {
  // `reload` reads the credential store again. Only the pool's client has one:
  // the lawyer plugin's cloud_key__configure_credential saves the key from
  // another process, so a pool client that started with none must look again.
  constructor(
    private readonly config: LegalCommonsConfig,
    private readonly reload?: () => Promise<Pick<LegalCommonsConfig, "staticKey" | "credentialError">>
  ) {}

  // Picks up a key saved since this process started. Called before every pool
  // and Suggestion Box tool; costs a store read only while no key is held.
  async reloadKeyIfUnset(): Promise<void> {
    if (this.config.staticKey || !this.reload) return;
    const { staticKey, credentialError } = await this.reload();
    if (staticKey) this.setStaticKey(staticKey);
    else this.config.credentialError = credentialError;
  }

  // Sets the key live for the rest of this process's life: troubleshoot's
  // configure_credential uses it, and so does reloadKeyIfUnset.
  setStaticKey(staticKey: string): void {
    this.config.staticKey = staticKey;
    // A newly supplied key supersedes whatever unreadable file was found at
    // startup, so the stale reason must not keep riding on later errors.
    delete this.config.credentialError;
  }

  staticKey(): string {
    return this.config.staticKey;
  }

  // The troubleshooting store has no baked URL, so its configure_credential
  // sets the project URL live beside the key. The pool never calls this.
  setProjectUrl(url: string): void {
    this.config.supabaseUrl = url;
  }

  projectUrl(): string {
    return this.config.supabaseUrl;
  }

  hasStaticKey(): boolean {
    return Boolean(this.config.staticKey);
  }

  // Enough to tell two keys apart across a rotation, not enough to reconstruct
  // one. Short values are reported as configured with no hint rather than
  // leaking most of themselves.
  redactedKeyHint(): string | null {
    const key = this.config.staticKey;
    if (!key) return null;
    return key.length < 20 ? null : `${key.slice(0, 10)}…${key.slice(-4)}`;
  }

  async get(
    table: string,
    filters: Record<string, string> = {},
    options: SelectOptions = {}
  ): Promise<Record<string, unknown>[]> {
    const params = new URLSearchParams(filters);
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    if (options.order) params.set("order", options.order);
    const qs = params.toString();
    const result = await this.request("GET", `/rest/v1/${table}${qs ? `?${qs}` : ""}`, undefined, {
      Accept: "application/json",
      "Accept-Profile": this.config.schema,
    });
    return (result ?? []) as Record<string, unknown>[];
  }

  async rpc(fn: string, body: Record<string, unknown> = {}): Promise<unknown> {
    return this.request("POST", `/rest/v1/rpc/${fn}`, body, { "Content-Profile": this.config.schema });
  }

  // One of the pool's Edge Functions. The body carries the input, never the address.
  async callFunction(name: string, body: Record<string, unknown> = {}): Promise<unknown> {
    return this.request("POST", `/functions/v1/${name}`, body, {});
  }

  // Table writes for the amend ops. Minting still goes through push_principle
  // (it needs one transaction); amends are single-statement corrections, so they
  // go straight to PostgREST — the service_role grant already covers tables.
  // `updated_at` is not trigger-maintained in this schema; callers set it.
  async insert(table: string, row: Record<string, unknown>): Promise<Record<string, unknown>[]> {
    const result = await this.request("POST", `/rest/v1/${table}`, row, {
      Accept: "application/json",
      "Content-Profile": this.config.schema,
      Prefer: "return=representation",
    });
    return (result ?? []) as Record<string, unknown>[];
  }

  async patch(
    table: string,
    filters: Record<string, string>,
    body: Record<string, unknown>
  ): Promise<Record<string, unknown>[]> {
    const qs = this.requireFilters(table, "PATCH", filters);
    const result = await this.request("PATCH", `/rest/v1/${table}?${qs}`, body, {
      Accept: "application/json",
      "Content-Profile": this.config.schema,
      Prefer: "return=representation",
    });
    return (result ?? []) as Record<string, unknown>[];
  }

  async delete(table: string, filters: Record<string, string>): Promise<Record<string, unknown>[]> {
    const qs = this.requireFilters(table, "DELETE", filters);
    const result = await this.request("DELETE", `/rest/v1/${table}?${qs}`, undefined, {
      Accept: "application/json",
      "Content-Profile": this.config.schema,
      Prefer: "return=representation",
    });
    return (result ?? []) as Record<string, unknown>[];
  }

  // An unfiltered PATCH/DELETE would hit every row in the table. The pool holds
  // live practitioner work product, so make that unrepresentable rather than
  // trusting every call site to remember.
  private requireFilters(table: string, method: string, filters: Record<string, string>): string {
    const qs = new URLSearchParams(filters).toString();
    if (!qs) {
      throw new ValidationError(`refusing unfiltered ${method} on ${this.config.label ?? "legal_commons"}.${table} — it would affect every row`);
    }
    return qs;
  }

  private async request(
    method: string,
    path: string,
    body: unknown,
    extraHeaders: Record<string, string>
  ): Promise<unknown> {
    if (!this.config.staticKey) {
      throw new ValidationError(
        (this.config.notConfiguredHint ??
          "legal-commons is not configured: this computer has no Probanda key. If the practitioner has one, " +
          "call cloud_key__configure_credential and have them paste it on the page it serves; if not, " +
          "call key_request__submit so they can ask Probanda for one. A developer may instead set " +
          "LEGAL_COMMONS_SUPABASE_KEY in the runtime environment (Claude Code CLI).") +
        // A stored-but-unreadable credential is a different problem with a
        // different fix than never having configured one; say which it is.
        (this.config.credentialError
          ? ` A stored credential was found but could not be read (${this.config.credentialError}) — ` +
            "reconfiguring will replace it."
          : "")
      );
    }
    const url = this.config.supabaseUrl.replace(/\/$/, "");
    const label = this.config.label ?? "legal_commons";
    let res: Response;
    try {
      res = await fetch(`${url}${path}`, {
        method,
        redirect: "manual",
        headers: {
          apikey: this.config.staticKey,
          Authorization: `Bearer ${this.config.staticKey}`,
          "Content-Type": "application/json",
          ...extraHeaders,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      // No response at all, so no status.
      const detail = error instanceof Error ? error.message : String(error);
      throw new TransportError(`${label} could not be reached (${detail})`);
    }
    const text = await res.text();
    if (res.status >= 300 && res.status < 400) {
      throw new TransportError(`${label} redirected ${method} ${path} (HTTP ${res.status}); the request was not followed`, res.status);
    }
    if (!res.ok) {
      throw new TransportError(`${label} ${method} ${path} failed (${res.status}): ${text || res.statusText}`, res.status);
    }
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new TransportError(`${label} ${method} ${path} returned a reply that is not JSON: ${snippet(text)}`, res.status);
    }
  }
}

function snippet(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 200 ? `${flat.slice(0, 200)}…` : flat;
}
