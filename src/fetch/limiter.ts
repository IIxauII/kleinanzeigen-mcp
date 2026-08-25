/** A callback given the wait a request was held for, in ms, so the caller can log it (SPEC 6.4). */
export type OnWait = (waitedMs: number) => void;

export type Limiter = {
  run<T>(request: () => Promise<T>, onWait?: OnWait): Promise<T>;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * **One global serialised limiter, shared by every tool** — every request hits
 * one host, and per-tool budgets would let two tools stack up load the site
 * experiences as a single client (SPEC 2.8).
 *
 * Two guarantees, both unconditional:
 *
 * - **Never two requests at once.** Calls queue and run one at a time.
 * - **`gapMs` of quiet between them**, measured from the end of one request to
 *   the start of the next, so a slow response can never shorten the gap.
 *
 * **No bursting and no token bucket.** A burst is the exact shape
 * volume-driven blocking notices, and an adaptive limiter that tightens on
 * success is throttle-probing by another name.
 *
 * A cache hit never reaches here at all (SPEC 2.8).
 */
export function createLimiter(gapMs: number): Limiter {
  // The tail of the queue: each request chains onto the previous one, which is
  // what serialises them without a lock or a running counter.
  let tail: Promise<unknown> = Promise.resolve();
  let lastFinishedAt: number | null = null;

  return {
    run<T>(request: () => Promise<T>, onWait?: OnWait): Promise<T> {
      const run = tail.then(async () => {
        const waitMs =
          lastFinishedAt === null ? 0 : Math.max(0, lastFinishedAt + gapMs - Date.now());
        onWait?.(waitMs);
        if (waitMs > 0) await sleep(waitMs);
        try {
          return await request();
        } finally {
          // A failed request still consumed a slot on the site's side, so the
          // next one waits exactly as long as it would after a success.
          lastFinishedAt = Date.now();
        }
      });
      // The chain must survive a rejected request, or one failure would release
      // every queued request at once.
      tail = run.catch(() => undefined);
      return run;
    },
  };
}
