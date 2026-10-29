// One read per tool call. A read made through oncePerCall inside inOneCall runs once and its result
// is shared by every later caller in that call, however deep; outside inOneCall it runs every time.
// The memo belongs to the call's own async context, so a concurrent call and a background job
// started after the call returns never see it.

import { AsyncLocalStorage } from "node:async_hooks";

const memo = new AsyncLocalStorage<Map<unknown, unknown>>();

/** Runs `fn` with a fresh memo. */
export function inOneCall<T>(fn: () => T): T {
  return memo.run(new Map(), fn);
}

/** `read()`, run once per `key` inside inOneCall and every time outside it. */
export function oncePerCall<T>(key: unknown, read: () => T): T {
  const reads = memo.getStore();
  if (reads === undefined) return read();
  if (!reads.has(key)) reads.set(key, read());
  return reads.get(key) as T;
}
