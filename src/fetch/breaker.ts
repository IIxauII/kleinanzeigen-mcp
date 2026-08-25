/**
 * The literal string the site serves on an **IP-range** ban. Matched
 * explicitly, because the block also presents as HTTP 200 with zero listings
 * and nothing else in the markup distinguishes it from an honest empty set
 * (SPEC 5.4).
 */
export const BLOCK_MARKER = "IP-Bereich vorübergehend gesperrt";

/**
 * How long the breaker refuses requests after a block.
 *
 * No source names a duration — not the spec, not the ADRs, not the research —
 * so this is a judgement call, not a measurement: long enough that the server
 * is not probing an IP-range ban, short enough that one session recovers
 * without a restart. **Fixed in code**: the delay is the operator's dial, the
 * breaker is the project's compliance stance (SPEC 8.4, ADR-0003).
 */
export const BLOCK_COOLDOWN_MS = 15 * 60_000;

export type Breaker = {
  /** Milliseconds left on the cooldown, or `null` when requests may go out. */
  blockedFor(): number | null;
  trip(): void;
};

/** Detects the block page. A page reporting zero results is **not** one (SPEC 5.4, 5.6). */
export function isBlockPage(body: string): boolean {
  return body.includes(BLOCK_MARKER);
}

/**
 * A block trips this breaker and further requests are refused for a fixed
 * cooldown, with the refusal saying so. **A block is never retried** — the site
 * has already said stop, and retrying is the one response that makes it worse
 * (SPEC 5.4, ADR-0003).
 */
export function createBreaker(cooldownMs: number = BLOCK_COOLDOWN_MS): Breaker {
  let blockedUntil: number | null = null;

  return {
    blockedFor(): number | null {
      if (blockedUntil === null) return null;
      const left = blockedUntil - Date.now();
      if (left > 0) return left;
      blockedUntil = null;
      return null;
    },
    trip(): void {
      blockedUntil = Date.now() + cooldownMs;
    },
  };
}
