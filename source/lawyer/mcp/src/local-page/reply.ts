// The response layer every local page listener shares: the request body reader, the JSON, HTML,
// text and file replies with their security headers, and the CORS headers a page opened from
// file:// needs (it sends `Origin: null`, and Chrome asks a Private Network Access preflight).

import { createReadStream } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";

/** A page that loads nothing from anywhere and posts only to its own origin. */
export const STRICT_CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

/** A request body over the cap. `status` is the reply it calls for. */
export class BodyTooLarge extends Error {
  readonly status = 413;
  constructor() {
    super("the request is too large");
  }
}

/** The request body as UTF-8 text. Rejects with BodyTooLarge, and drops the request, once it passes `max` bytes. */
export function readBody(req: IncomingMessage, max: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > max) {
        reject(new BodyTooLarge());
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

export interface ReplyOptions {
  /** The Content-Security-Policy header; none when unset. */
  csp?: string;
  /** Answer a page opened from file:// (corsHeaders). */
  cors?: IncomingMessage;
}

/** Echoes `Origin: null` and allows Chrome's Private Network Access preflight. */
export function corsHeaders(req: IncomingMessage): Record<string, string> {
  return {
    ...(req.headers.origin === "null" ? { "Access-Control-Allow-Origin": "null" } : {}),
    "Access-Control-Allow-Private-Network": "true",
    Vary: "Origin",
  };
}

function headers(type: string, options: ReplyOptions): Record<string, string> {
  return {
    ...(options.cors ? corsHeaders(options.cors) : {}),
    "Content-Type": type,
    ...(options.csp ? { "Content-Security-Policy": options.csp } : {}),
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  };
}

export function send(res: ServerResponse, status: number, type: string, body: string, options: ReplyOptions = {}): void {
  res.writeHead(status, headers(type, options));
  res.end(body);
}

export function json(res: ServerResponse, status: number, body: unknown, options: ReplyOptions = {}): void {
  send(res, status, "application/json; charset=utf-8", JSON.stringify(body), options);
}

export function html(res: ServerResponse, status: number, body: string, options: ReplyOptions = {}): void {
  send(res, status, "text/html; charset=utf-8", body, options);
}

export function text(res: ServerResponse, status: number, body: string, options: ReplyOptions = {}): void {
  send(res, status, "text/plain; charset=utf-8", body, options);
}

/** Streams the file at `path`: shown in the browser when `type` is given, else downloaded as `name`. */
export function file(res: ServerResponse, path: string, name: string, type: string | undefined): void {
  res.writeHead(200, {
    "Content-Type": type ?? "application/octet-stream",
    "Content-Disposition": `${type ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
  });
  createReadStream(path).on("error", () => res.destroy()).pipe(res);
}
