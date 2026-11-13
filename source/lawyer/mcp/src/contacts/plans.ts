// Where the address-book tools keep their plans and the copies of cards they change, on
// this machine only. A plan is one JSON file that its apply tool updates as it goes, so a
// stopped run continues where it left off. Nothing here is removed: the files are small,
// and a backup is the only way back for a merged card.

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { defaultStateDir } from "../../../../mcp-shared/dpapi-store.js";
import { DataServerError, ValidationError } from "../errors.js";
import type { DavContext } from "../dav/session.js";

export const contactsStateDir = (): string => defaultStateDir(process.env, "contacts");

export const revNow = (): string => new Date().toISOString().replace(/\.\d+Z$/, "Z");

export const newPlanId = (): string => randomBytes(8).toString("hex");

const PLAN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface Plan {
  kind: string;
  plan_id: string;
  created_at: string;
  book_url: string;
  status: "planned" | "writing" | "done";
}

/** A folder under the state folder, made if missing. */
export function stateFolder(...parts: string[]): string {
  const dir = join(contactsStateDir(), ...parts);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const planPath = (planId: string): string => join(stateFolder("plans"), `${planId}.json`);

export function savePlan(plan: Plan): void {
  writeFileSync(planPath(plan.plan_id), JSON.stringify(plan, null, 2), "utf-8");
}

export function loadPlan<T extends Plan>(planId: unknown, kind: T["kind"]): T {
  if (typeof planId !== "string" || !/^[0-9a-f]{16}$/.test(planId)) throw new ValidationError("plan_id must be the id a scan returned");
  if (!existsSync(planPath(planId))) throw new DataServerError(`No plan ${planId} on this computer. Scan again.`, "contacts_plan_missing");
  const plan = JSON.parse(readFileSync(planPath(planId), "utf-8")) as T;
  if (plan.kind !== kind) throw new ValidationError(`Plan ${planId} is not a plan for this tool.`);
  return plan;
}

/**
 * Checks a plan may start (`starting`) or continue, against the address book as it is now.
 * A plan starts once, within a week of its scan, and only on the book it was scanned from.
 */
export function requireRunnable(plan: Plan, starting: boolean, bookUrl: string, continueTool: string): void {
  if (plan.book_url !== bookUrl) throw new DataServerError("The address book is not the one this plan was made for. Scan again.", "contacts_plan_stale");
  if (starting) {
    if (plan.status !== "planned") throw new DataServerError(`Plan ${plan.plan_id} was already started. Continue it with ${continueTool}.`, "contacts_plan_started");
    if (Date.now() - Date.parse(plan.created_at) > PLAN_MAX_AGE_MS) throw new DataServerError(`Plan ${plan.plan_id} is more than a week old. Scan again.`, "contacts_plan_stale");
  } else if (plan.status === "planned") {
    throw new DataServerError(`Plan ${plan.plan_id} has not been started, and this tool starts nothing.`, "contacts_plan_not_started");
  }
}

const DEFAULT_BUDGET_MS = 20_000;

/** When one call should stop and hand back, so a long plan runs over several calls. Tests shorten it. */
export const deadline = (context: DavContext): number =>
  Date.now() + ((context as { contactsBudgetMs?: number }).contactsBudgetMs ?? DEFAULT_BUDGET_MS);

/** Version marks compared without the quoting and weak prefix servers vary on. */
export const sameEtag = (a: string | null | undefined, b: string | null | undefined): boolean => {
  const bare = (etag: string | null | undefined) => (etag ?? "").replace(/^W\//, "").replace(/^"|"$/g, "");
  return bare(a) !== "" && bare(a) === bare(b);
};
