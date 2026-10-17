import { TransportError } from "../errors.js";

export interface RestConfig {
  url: string;
  anonKey: string;
  tokenProvider: (forceRefresh?: boolean) => Promise<string>;
}

export interface SelectOptions {
  limit?: number;
  offset?: number;
  order?: string;
}

export class RestClient {
  private readonly url: string;
  private readonly anonKey: string;
  private readonly tokenProvider: (forceRefresh?: boolean) => Promise<string>;

  constructor(config: RestConfig) {
    this.url = config.url.replace(/\/$/, "");
    this.anonKey = config.anonKey;
    this.tokenProvider = config.tokenProvider;
  }

  async get(
    table: string,
    filters: Record<string, string> = {},
    options: SelectOptions = {}
  ): Promise<Record<string, unknown>[]> {
    const params = new URLSearchParams(filters);
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    if (options.offset !== undefined) params.set("offset", String(options.offset));
    if (options.order) params.set("order", options.order);
    const qs = params.toString();
    const result = await this.request("GET", `/rest/v1/${table}${qs ? `?${qs}` : ""}`, undefined, {
      Accept: "application/json",
    });
    return (result ?? []) as Record<string, unknown>[];
  }

  async post(table: string, body: unknown, onConflict?: string): Promise<Record<string, unknown>[]> {
    const path = onConflict
      ? `/rest/v1/${table}?on_conflict=${onConflict}`
      : `/rest/v1/${table}`;
    const result = await this.request("POST", path, body, {
      Prefer: "return=representation,resolution=merge-duplicates",
    });
    return (result ?? []) as Record<string, unknown>[];
  }

  async patch(
    table: string,
    filters: Record<string, string>,
    body: unknown
  ): Promise<Record<string, unknown>[]> {
    const qs = new URLSearchParams(filters).toString();
    const result = await this.request("PATCH", `/rest/v1/${table}?${qs}`, body, {
      Prefer: "return=representation",
    });
    return (result ?? []) as Record<string, unknown>[];
  }

  async delete(table: string, filters: Record<string, string>): Promise<Record<string, unknown>[]> {
    const qs = new URLSearchParams(filters).toString();
    const result = await this.request("DELETE", `/rest/v1/${table}?${qs}`, undefined, {
      Prefer: "return=representation",
    });
    return (result ?? []) as Record<string, unknown>[];
  }

  async rpc(fn: string, body: Record<string, unknown> = {}): Promise<unknown> {
    return this.request("POST", `/rest/v1/rpc/${fn}`, body);
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {}
  ): Promise<unknown> {
    const bodyText = body === undefined ? undefined : JSON.stringify(body);
    let token = await this.tokenProvider(false);
    let response = await this.fetch(method, path, token, bodyText, extraHeaders);
    let text = await response.text();

    if (response.status === 401) {
      token = await this.tokenProvider(true);
      response = await this.fetch(method, path, token, bodyText, extraHeaders);
      text = await response.text();
    }

    if (!response.ok) {
      throw new TransportError(
        `Supabase ${method} ${path} failed (${response.status}): ${text || response.statusText}`,
        response.status
      );
    }
    if (!text) return null;
    return JSON.parse(text);
  }

  private fetch(
    method: string,
    path: string,
    token: string,
    bodyText: string | undefined,
    extraHeaders: Record<string, string>
  ): Promise<Response> {
    const headers: Record<string, string> = {
      apikey: this.anonKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...extraHeaders,
    };
    return fetch(`${this.url}${path}`, {
      method,
      headers,
      body: bodyText,
    });
  }
}
