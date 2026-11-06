// waitFor, the one poll loop behind every wait tool, run on a fake clock.

import assert from "node:assert/strict";
import test from "node:test";

const { waitFor } = await import("../build/local-page/wait.js");

/** A clock that only moves when the loop sleeps. */
function fakeClock() {
  let t = 1_000;
  const sleeps = [];
  return {
    now: () => t,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
    sleeps,
  };
}

test("a value ready at once is returned without sleeping", async () => {
  const clock = fakeClock();
  assert.deepEqual(await waitFor(() => "done", { budgetMs: 45_000, pollMs: 300, ...clock }), { value: "done" });
  assert.deepEqual(clock.sleeps, []);
});

test("it checks every pollMs and returns the first value the check gives, sync or async", async () => {
  const clock = fakeClock();
  let calls = 0;
  const out = await waitFor(async () => (++calls === 4 ? { status: "approved" } : undefined), { budgetMs: 45_000, pollMs: 300, ...clock });
  assert.deepEqual(out, { value: { status: "approved" } });
  assert.equal(calls, 4);
  assert.deepEqual(clock.sleeps, [300, 300, 300]);
});

test("when the budget runs out it returns pending with the time waited, the last sleep cut to fit", async () => {
  const clock = fakeClock();
  let calls = 0;
  const out = await waitFor(() => void calls++, { budgetMs: 1_000, pollMs: 300, ...clock });
  assert.deepEqual(out, { pending: true, waited_ms: 1_000 });
  assert.deepEqual(clock.sleeps, [300, 300, 300, 100]);
  assert.equal(calls, 5, "one check at the start, one after each sleep");
});

test("a check that throws ends the wait with that error", async () => {
  const clock = fakeClock();
  await assert.rejects(waitFor(() => { throw new Error("corrupt"); }, { budgetMs: 1_000, pollMs: 300, ...clock }), /corrupt/);
});

test("by default it sleeps on timers, so the event loop keeps running while it waits", async () => {
  let ticks = 0;
  const timer = setInterval(() => ticks++, 5);
  try {
    const started = Date.now();
    const out = await waitFor(() => (Date.now() - started >= 60 ? "late" : undefined), { budgetMs: 2_000, pollMs: 20 });
    assert.deepEqual(out, { value: "late" });
    assert.ok(ticks > 0);
  } finally {
    clearInterval(timer);
  }
});
