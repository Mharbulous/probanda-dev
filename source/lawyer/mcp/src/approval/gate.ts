// The approval a gated tool holds before it changes anything, checked by the tool itself so the
// check runs on this computer wherever the session runs (Cowork's hooks cannot read the
// conversation: docs/Specs/2026-11-06_practice-quirks-entries-spec.md, "The gate").
//
// A call runs only when it carries one of two approvals for exactly this tool and these arguments:
// - `approval_proof`: what the approval hook (source/skills/shared/scripts/approval_gate.py) adds
//   once the practitioner has pasted the approval block. It is HMAC-SHA256 under the device
//   secret (../local-page/token.ts) of "approval\n<tool>\n<arguments as canonical JSON>", hex.
// - a click on Approve on this server's approval page for this call. A click is used by the first
//   call that runs, and is kept when that call fails, as a pasted approval is.
// Otherwise the tool changes nothing and returns {status: "approval_needed", url}: the page, which
// shows the step in the words of the paste block. Only the newest page link works.
//
// The page is a credential page (../key-request/page.ts): an ephemeral 127.0.0.1 port, state in
// memory only, so a restart drops every link and click. Approve posts JSON carrying a value the page
// holds, from the page's own origin, so another web page cannot press it.

import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { MAX_FORM, credentialListener, escape } from "../key-request/page.js";
import { STRICT_CSP, html, json, readBody } from "../local-page/reply.js";
import { deviceHmac, sameText } from "../local-page/token.js";
import type { Tool } from "../tool-list.js";
import type { ToolInput } from "../validate.js";
import { APPROVAL_TOOLS, pageText } from "./acts.js";

/** JSON with every object's keys sorted and no spaces: Python's json.dumps(sort_keys=True,
 * separators=(",", ":"), ensure_ascii=False) for the strings, integers and lists a gated call holds. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** The proof the approval hook gives for this call. */
export function proofFor(name: string, args: Record<string, unknown>, env: NodeJS.ProcessEnv): string {
  return deviceHmac(`approval\n${name}\n${canonicalJson(args)}`, env).toString("hex");
}

interface Pending {
  link: string;
  nonce: string;
  key: string;
  name: string;
  args: Record<string, unknown>;
}

/** The calls approved on the page and not yet run, by `<tool>\n<canonical arguments>`. */
const clicked = new Set<string>();
let pending: Pending | undefined;

/** `run` behind the approval check, for a tool named in acts.ts. */
export function gated<C>(name: string, run: (args: ToolInput, context: C) => unknown): Tool<C> {
  if (!APPROVAL_TOOLS.includes(name)) throw new Error(`${name} has no approval sentence`);
  return {
    name,
    handler: async (args, context) => {
      const { approval_proof: proof, ...rest } = args as Record<string, unknown>;
      if (typeof proof === "string" && sameText(proof, proofFor(name, rest, process.env))) return run(rest as ToolInput, context);
      const key = `${name}\n${canonicalJson(rest)}`;
      if (!clicked.delete(key)) return { status: "approval_needed", url: await servePage(name, rest, key) };
      try {
        return await run(rest as ToolInput, context);
      } catch (error) {
        clicked.add(key);
        throw error;
      }
    },
  };
}

async function servePage(name: string, args: Record<string, unknown>, key: string): Promise<string> {
  const link = randomBytes(24).toString("hex");
  pending = { link, nonce: randomBytes(24).toString("hex"), key, name, args };
  return `http://127.0.0.1:${await port()}/approve/${link}`;
}

async function handle(req: IncomingMessage, res: ServerResponse, link: string): Promise<void> {
  const current = pending;
  if (!current || link !== current.link) {
    return page(res, 404, "This link has expired", "<p>Return to Claude and ask for the step again.</p>");
  }
  if (req.method === "GET") return page(res, 200, "Approve this step", body(current));
  if (req.method !== "POST") return page(res, 405, "Not allowed", "");
  const host = req.headers.host ?? "";
  const sameOrigin = /^127\.0\.0\.1:\d+$/.test(host) && req.headers.origin === `http://${host}`;
  const isJson = (req.headers["content-type"] ?? "").split(";")[0].trim() === "application/json";
  let nonce: unknown;
  try {
    nonce = (JSON.parse(await readBody(req, MAX_FORM)) as { nonce?: unknown } | null)?.nonce;
  } catch {
    nonce = undefined;
  }
  if (!sameOrigin || !isJson || typeof nonce !== "string" || !sameText(nonce, current.nonce)) {
    return json(res, 403, { approved: false });
  }
  clicked.add(current.key);
  if (pending === current) pending = undefined;
  json(res, 200, { approved: true });
}

function body(current: Pending): string {
  const text = pageText(current.name, current.args);
  return (
    `<p class="warning">${escape(text.warning)}</p><p>${escape(text.step)}</p>` +
    "<p class=\"note\">Approve only a step you asked Probanda to take.</p>" +
    '<button id="approve" type="button">Approve</button><p id="result" role="status"></p>' +
    "<script>" +
    `const nonce=${JSON.stringify(current.nonce)};` +
    "document.getElementById('approve').addEventListener('click',async(e)=>{e.target.disabled=true;" +
    "const out=document.getElementById('result');" +
    "try{const r=await fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nonce})});" +
    "out.textContent=r.ok?'Approved. You can close this tab and tell Claude it is approved.':'Not approved: this link has expired. Return to Claude and ask for the step again.';}" +
    "catch{out.textContent='Not approved: Probanda did not answer. Return to Claude and ask for the step again.';}});" +
    "</script>"
  );
}

function page(res: ServerResponse, status: number, title: string, content: string): void {
  html(res, status,
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${escape(title)}</title><style>${STYLE}</style></head><body><main><h1>${escape(title)}</h1>${content}</main></body></html>`,
    { csp: STRICT_CSP });
}

const STYLE =
  "body{font-family:system-ui,sans-serif;margin:0;padding:16px;background:#fafafa;color:#222}" +
  "main{max-width:32rem;margin:2rem auto}.warning{font-weight:700}.note{color:#555;font-size:.9rem}" +
  "button{padding:.5rem 1rem;font-size:1rem}" +
  "@media (prefers-color-scheme: dark){body{background:#1e1e1e;color:#eee}.note{color:#aaa}}";

const port = credentialListener({ bundle: "mail", prefix: "approve", handle, failure: "<p>Return to Claude and ask for the step again.</p>" });
