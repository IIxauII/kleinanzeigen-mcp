import type { FailureReason } from "../envelope.ts";

/**
 * An operational failure: the request path could not produce data and no stale
 * entry existed to fall back on (SPEC 6.2). Tools surface these as MCP
 * `isError`; domain outcomes — "nothing matched", "this listing is gone" — are
 * normal results with a discriminant and never travel as one of these
 * (SPEC 6.3).
 */
export class FetchError extends Error {
  constructor(
    readonly reason: FailureReason,
    message: string,
  ) {
    super(message);
    this.name = "FetchError";
  }
}

/**
 * One failed attempt, internal to the request path.
 *
 * It carries the reason that becomes `stale_reason` if a stale entry exists,
 * and — for the two retryable statuses only — what the site asked us to wait.
 * **A block is never constructed as retryable** (SPEC 5.4).
 */
export class RequestFailure extends Error {
  constructor(
    readonly reason: FailureReason,
    message: string,
    readonly retryable = false,
    readonly retryAfter: number | null = null,
  ) {
    super(message);
    this.name = "RequestFailure";
  }
}

/** A parser could not read the page. Thrown by a parse callback, caught by the request path (SPEC 5.8). */
export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}
