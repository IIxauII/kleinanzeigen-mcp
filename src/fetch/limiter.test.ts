import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLimiter } from "./limiter.ts";

/** Fake timers throughout: a serialised 1500 ms limiter is not something to wait for (SPEC 8.6). */
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("the global serialised limiter", () => {
  it("lets the first request through with no wait", async () => {
    const limiter = createLimiter(1500);
    const started = vi.fn();
    const run = limiter.run(async () => {
      started();
      return "ok";
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toHaveBeenCalledTimes(1);
    expect(await run).toBe("ok");
  });

  it("holds the full gap between one response and the next request", async () => {
    const limiter = createLimiter(1500);
    const startedAt: number[] = [];
    const request = () =>
      limiter.run(async () => {
        startedAt.push(Date.now());
        await new Promise((resolve) => setTimeout(resolve, 400));
      });
    const start = Date.now();
    void request();
    void request();

    await vi.advanceTimersByTimeAsync(400 + 1499);
    expect(startedAt).toEqual([start]);
    await vi.advanceTimersByTimeAsync(1);
    expect(startedAt).toEqual([start, start + 400 + 1500]);
  });

  it("never runs two requests at once, however many are queued", async () => {
    const limiter = createLimiter(1500);
    let inFlight = 0;
    let peak = 0;
    const request = () =>
      limiter.run(async () => {
        peak = Math.max(peak, ++inFlight);
        await new Promise((resolve) => setTimeout(resolve, 100));
        inFlight--;
      });
    const all = Promise.all([request(), request(), request(), request()]);
    await vi.advanceTimersByTimeAsync(60_000);
    await all;
    expect(peak).toBe(1);
  });

  it("does not burst: n requests take (n-1) gaps, never one window of n", async () => {
    const limiter = createLimiter(1000);
    const startedAt: number[] = [];
    const start = Date.now();
    const all = Promise.all(
      [0, 1, 2].map(() => limiter.run(async () => void startedAt.push(Date.now()))),
    );
    await vi.advanceTimersByTimeAsync(10_000);
    await all;
    expect(startedAt).toEqual([start, start + 1000, start + 2000]);
  });

  it("still spaces the next request after a failed one", async () => {
    const limiter = createLimiter(1500);
    const startedAt: number[] = [];
    const start = Date.now();
    const failing = limiter.run(async () => {
      startedAt.push(Date.now());
      throw new Error("boom");
    });
    const after = limiter.run(async () => void startedAt.push(Date.now()));
    await expect(failing).rejects.toThrow("boom");
    await vi.advanceTimersByTimeAsync(1500);
    await after;
    expect(startedAt).toEqual([start, start + 1500]);
  });

  it("reports the wait it imposed, so it can be logged", async () => {
    const limiter = createLimiter(1000);
    const waits: number[] = [];
    const onWait = (ms: number) => void waits.push(ms);
    const all = Promise.all([
      limiter.run(async () => undefined, onWait),
      limiter.run(async () => undefined, onWait),
    ]);
    await vi.advanceTimersByTimeAsync(5000);
    await all;
    expect(waits).toEqual([0, 1000]);
  });

  it("imposes no gap at all when the operator sets zero", async () => {
    const limiter = createLimiter(0);
    const startedAt: number[] = [];
    const start = Date.now();
    const all = Promise.all(
      [0, 1, 2].map(() => limiter.run(async () => void startedAt.push(Date.now()))),
    );
    await vi.advanceTimersByTimeAsync(0);
    await all;
    expect(startedAt).toEqual([start, start, start]);
  });
});
