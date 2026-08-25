import type { Envelope, FailureReason } from "../envelope.ts";
import { log } from "../logging.ts";
import { USER_AGENT } from "../user-agent.ts";
import { createBreaker, isBlockPage, type Breaker } from "./breaker.ts";
import { createCache, type Cache } from "./cache.ts";
import { FetchError, ParseError } from "./errors.ts";
import { createLimiter, type Limiter } from "./limiter.ts";
import { normaliseUrl } from "./normalise-url.ts";

/** At most 2 retries, and only on 429/5xx. **Never on a block** (SPEC 2.8, 5.4). */
export const MAX_RETRIES = 2;

/** `Retry-After` is honoured exactly up to here, then the call fails loud (SPEC 2.8, ADR-0003). */
export const RETRY_AFTER_CAP_MS = 60_000;

/**
 * Fixed in code alongside the breaker (SPEC 8.4). A request that has not
 * answered in 20 s has failed as far as an interactive MCP call is concerned,
 * and the stale rule covers what happens next.
 */
export const REQUEST_TIMEOUT_MS = 20_000;

export type FetchImpl = (url: string, init: RequestInit) => Promise<Response>;

/** What a tool gets back: its own parsed value, plus the envelope every result carries (SPEC 3.6). */
export type Fetched<T> = {
  data: T;
  envelope: Envelope;
};

/**
 * Reads a page into a domain object. Receives the response so a tool can assert
 * on the final URL after redirects — the deleted-ad guard needs it (SPEC 5.3).
 *
 * Throwing is how a parser reports that the DOM moved: it takes the same path
 * as a network failure (SPEC 6.2) and shouts on stderr on the way (SPEC 5.8).
 */
export type Parse<T> = (body: string, response: Response) => T;

export type FetchCore = {
  fetch<T>(url: string, parse: Parse<T>): Promise<Fetched<T>>;
};

export type FetchCoreOptions = {
  rateLimitMs: number;
  fetchImpl?: FetchImpl;
  limiter?: Limiter;
  breaker?: Breaker;
  cache?: Cache<unknown>;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Seconds, or an HTTP-date. Anything else is no `Retry-After` at all. */
function retryAfterMs(response: Response): number | null {
  const header = response.headers.get("retry-after");
  if (header === null) return null;
  const seconds = Number(header.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(header);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - Date.now());
}

const isRetryableStatus = (status: number): boolean => status === 429 || status >= 500;

/** Every failure carries the reason that becomes `stale_reason` if a stale entry exists. */
class Failure extends Error {
  constructor(
    readonly reason: FailureReason,
    message: string,
  ) {
    super(message);
  }
}

function networkFailure(error: unknown): Failure {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  return name === "TimeoutError" || name === "AbortError"
    ? new Failure("timeout", `request timed out after ${REQUEST_TIMEOUT_MS} ms`)
    : new Failure("network", message);
}

/**
 * The single request path every network tool sits on.
 *
 * In order: a fresh cache hit answers with no request and never touches the
 * limiter; the breaker refuses outright while a block is cooling down; the
 * limiter serialises what is left; 429/5xx back off exponentially at most
 * twice; a block trips the breaker and is never retried; and any failure at
 * all — block, network, timeout, 5xx after retries **or parse failure** —
 * falls back to a stale entry if one exists and fails loud if not
 * (SPEC 2.8, 5.4, 6.1, 6.2).
 */
export function createFetchCore(options: FetchCoreOptions): FetchCore {
  const fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
  const limiter = options.limiter ?? createLimiter(options.rateLimitMs);
  const breaker = options.breaker ?? createBreaker();
  const cache = options.cache ?? createCache<unknown>();

  /** Backoff starts at the operator's politeness gap and doubles: 1500 ms, then 3000 ms by default. */
  const backoffMs = (retry: number): number => options.rateLimitMs * 2 ** retry;

  async function attempt<T>(url: string, parse: Parse<T>): Promise<T> {
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await limiter.run(
        () =>
          fetchImpl(url, {
            headers: { "user-agent": USER_AGENT, "accept-language": "de-DE,de;q=0.9" },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            redirect: "follow",
          }),
        (waitedMs) => {
          if (waitedMs > 0) log("limiter_wait", { url, waited_ms: waitedMs });
        },
      );
    } catch (error) {
      throw networkFailure(error);
    }

    let body: string;
    try {
      body = await response.text();
    } catch (error) {
      throw networkFailure(error);
    }
    log("fetch", { url, status: response.status, ms: Date.now() - startedAt, bytes: body.length });

    // Checked before the status, because the block presents as HTTP 200 with
    // zero listings just as readily as it does as an error page (SPEC 5.4).
    if (isBlockPage(body)) {
      breaker.trip();
      log("block_detected", { level: "error", url, status: response.status });
      throw new Failure("block", "kleinanzeigen has blocked this IP range; requests are paused");
    }

    if (!response.ok) {
      const retryAfter = retryAfterMs(response);
      const failure = new Failure("http_error", `HTTP ${response.status}`);
      if (!isRetryableStatus(response.status)) throw failure;
      throw Object.assign(failure, { retryable: true, retryAfter });
    }

    try {
      return parse(body, response);
    } catch (error) {
      const message = error instanceof ParseError ? error.message : String(error);
      throw new Failure("parse_failure", message);
    }
  }

  async function fetchFresh<T>(url: string, parse: Parse<T>): Promise<T> {
    for (let retry = 0; ; retry++) {
      try {
        return await attempt(url, parse);
      } catch (error) {
        const failure =
          error instanceof Failure ? error : new Failure("network", String(error));
        const retryable = (failure as { retryable?: boolean }).retryable === true;
        if (!retryable || retry >= MAX_RETRIES) throw failure;

        const retryAfter = (failure as { retryAfter?: number | null }).retryAfter ?? null;
        if (retryAfter !== null && retryAfter > RETRY_AFTER_CAP_MS) {
          // Sleeping past the cap is indistinguishable from a hang to a client
          // that has no way to learn why (SPEC 2.8).
          log("retry_after_over_cap", { url, retry_after_ms: retryAfter, cap_ms: RETRY_AFTER_CAP_MS });
          throw new Failure(
            "http_error",
            `${failure.message}, Retry-After ${retryAfter} ms is past the ${RETRY_AFTER_CAP_MS} ms cap`,
          );
        }

        const delayMs = retryAfter ?? backoffMs(retry);
        log("retry", { url, attempt: retry + 1, delay_ms: delayMs, honoured_retry_after: retryAfter !== null });
        await sleep(delayMs);
      }
    }
  }

  return {
    async fetch<T>(url: string, parse: Parse<T>): Promise<Fetched<T>> {
      const key = normaliseUrl(url);
      const cached = cache.get(key) as { value: T; fetched_at: string; fresh: boolean } | null;
      if (cached !== null && cached.fresh) {
        // No request, and the limiter is skipped entirely (SPEC 2.8).
        log("cache_hit", { url: key, fetched_at: cached.fetched_at });
        return { data: cached.value, envelope: { fetched_at: cached.fetched_at, stale: false, source_url: key } };
      }

      const blockedFor = breaker.blockedFor();
      const failure = blockedFor === null ? null : new Failure("block", `blocked; ${blockedFor} ms of cooldown left`);
      if (failure !== null) log("breaker_open", { level: "error", url: key, cooldown_left_ms: blockedFor });

      try {
        if (failure !== null) throw failure;
        const data = await fetchFresh(key, parse);
        cache.set(key, data);
        const stored = cache.get(key)!;
        return { data, envelope: { fetched_at: stored.fetched_at, stale: false, source_url: key } };
      } catch (error) {
        const failed = error instanceof Failure ? error : new Failure("network", String(error));
        // The parser breaking is the one failure a stale serve can hide, so it
        // shouts whether or not the fallback succeeds (SPEC 5.8, ADR-0002).
        if (failed.reason === "parse_failure") {
          log("parse_failure", { level: "error", url: key, message: failed.message });
        } else {
          log("fetch_failed", { url: key, reason: failed.reason, message: failed.message });
        }

        const stale = cache.get(key) as { value: T; fetched_at: string } | null;
        if (stale === null) throw new FetchError(failed.reason, failed.message);
        log("stale_serve", { url: key, reason: failed.reason, fetched_at: stale.fetched_at });
        return {
          data: stale.value,
          envelope: {
            fetched_at: stale.fetched_at,
            stale: true,
            stale_reason: failed.reason,
            source_url: key,
          },
        };
      }
    },
  };
}

let core: FetchCore | null = null;

/** One core, one limiter, shared by every tool. Called once, at startup (SPEC 2.8). */
export function configureFetchCore(options: FetchCoreOptions): FetchCore {
  core = createFetchCore(options);
  return core;
}

export function getFetchCore(): FetchCore {
  if (core === null) throw new Error("the fetch core is not configured");
  return core;
}

/** Test seam only: the core is process-global, and each test wants its own. */
export function resetFetchCore(): void {
  core = null;
}
