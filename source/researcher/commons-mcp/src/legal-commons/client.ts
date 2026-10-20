import { TransportError, ValidationError } from "../errors.js";
import type { LegalCommonsConfig } from "./config.js";

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
  constructor(private readonly config: LegalCommonsConfig) {}

  // Lets legal_commons__configure_credential take effect immediately for the
  // rest of this process's life, without waiting for the next MCP server
  // restart to re-read the persisted credential file.
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
          "call legal_commons__configure_credential and have them paste it on the page it serves; if not, " +
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
    const res = await fetch(`${url}${path}`, {
      method,
      headers: {
        apikey: this.config.staticKey,
        Authorization: `Bearer ${this.config.staticKey}`,
        "Content-Type": "application/json",
        ...extraHeaders,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new TransportError(`${this.config.label ?? "legal_commons"} ${method} ${path} failed (${res.status}): ${text || res.statusText}`, res.status);
    }
    return text ? JSON.parse(text) : null;
  }
}
