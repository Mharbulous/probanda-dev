// The one poll loop behind every wait tool: check once at once, then every pollMs, until the check
// gives a value or the budget runs out. The sleep is a timer, never a blocking wait, so a page
// listener on the same event loop keeps answering while a wait is in flight.

export interface WaitOptions {
  budgetMs: number;
  pollMs: number;
  /** Test seam: the pause between checks. */
  sleep?: (ms: number) => Promise<void>;
  /** Test seam: the clock, in ms. */
  now?: () => number;
}

export type WaitOutcome<T> = { value: T } | { pending: true; waited_ms: number };

const timerSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Runs `check` until it returns something other than undefined. A check that throws ends the wait. */
export async function waitFor<T>(check: () => T | undefined | Promise<T | undefined>, options: WaitOptions): Promise<WaitOutcome<T>> {
  const sleep = options.sleep ?? timerSleep;
  const now = options.now ?? Date.now;
  const started = now();
  for (;;) {
    const value = await check();
    if (value !== undefined) return { value };
    const waited = now() - started;
    if (waited >= options.budgetMs) return { pending: true, waited_ms: waited };
    await sleep(Math.min(options.pollMs, options.budgetMs - waited));
  }
}
