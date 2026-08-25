import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BLOCK_COOLDOWN_MS, BLOCK_MARKER } from "./breaker.ts";
import { createCache, FRESH_WINDOW_MS } from "./cache.ts";
import {
  createFetchCore,
  MAX_RETRIES,
  REQUEST_TIMEOUT_MS,
  RETRY_AFTER_CAP_MS,
  type FetchImpl,
} from "./core.ts";
import { FetchError, ParseError } from "./errors.ts";
import { USER_AGENT } from "../user-agent.ts";

const URL_A = "https://www.kleinanzeigen.de/s-fahrrad/k0";
const URL_B = "https://www.kleinanzeigen.de/s-auto/k0";

let stderr: string[];

beforeEach(() => {
  vi.useFakeTimers();
  stderr = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const logged = (event: string) =>
  stderr.map((line) => JSON.parse(line) as Record<string, unknown>).filter((l) => l.event === event);

/** A response body is readable once, so every reply is built fresh per call. */
type Reply = () => Response | Error;

const page =
  (body: string, init: ResponseInit = {}): Reply =>
  () =>
    new Response(body, init);

const fails =
  (error: Error): Reply =>
  () =>
    error;

/** Answers each call with the next scripted reply, or repeats the last one. */
function scripted(...replies: Reply[]): {
  impl: FetchImpl;
  calls: { url: string; at: number; init: RequestInit }[];
} {
  const calls: { url: string; at: number; init: RequestInit }[] = [];
  const impl: FetchImpl = async (url, init) => {
    const reply = replies[Math.min(calls.length, replies.length - 1)]!;
    calls.push({ url, at: Date.now(), init });
    const next = reply();
    if (next instanceof Error) throw next;
    return next;
  };
  return { impl, calls };
}

/** Fake timers mean a rejection lands during `advanceTimersByTimeAsync`, so it is caught up front. */
const settled = <T,>(promise: Promise<T>): Promise<T | unknown> => promise.catch((error: unknown) => error);

const core = (impl: FetchImpl, rateLimitMs = 1500, cache = createCache<unknown>()) =>
  createFetchCore({ rateLimitMs, fetchImpl: impl, cache });

const parseTotal = (body: string): { total: number } => {
  const match = /total:(\d+)/.exec(body);
  if (match === null) throw new ParseError("no total in the page");
  return { total: Number(match[1]) };
};

describe("the happy path", () => {
  it("parses, caches and stamps the envelope", async () => {
    const { impl, calls } = scripted(page("total:7"));
    const at = new Date();
    const result = await core(impl).fetch(URL_A, parseTotal);
    expect(result.data).toEqual({ total: 7 });
    expect(result.envelope).toEqual({
      fetched_at: at.toISOString(),
      stale: false,
      source_url: URL_A,
    });
    expect(calls).toHaveLength(1);
  });

  it("sends the project's User-Agent, which is not configurable", async () => {
    const { impl, calls } = scripted(page("total:1"));
    await core(impl).fetch(URL_A, parseTotal);
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["user-agent"]).toBe(USER_AGENT);
    expect(USER_AGENT).toMatch(/^kleinanzeigen-mcp\/\d+\.\d+\.\d+ \(\+https:\/\/github\.com\//);
  });

  it("times the request out rather than hanging an MCP call", async () => {
    const { impl, calls } = scripted(page("total:1"));
    await core(impl).fetch(URL_A, parseTotal);
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
    expect(REQUEST_TIMEOUT_MS).toBe(20_000);
  });

  it("logs metadata only — never a scrap of listing content", async () => {
    const { impl } = scripted(page("total:7 Damenrad Berlin 250 €"));
    await core(impl).fetch(URL_A, parseTotal);
    expect(stderr.join("")).not.toMatch(/Damenrad|Berlin|250/);
    expect(logged("fetch")[0]).toMatchObject({ url: URL_A, status: 200 });
  });
});

describe("the cache", () => {
  it("answers a fresh hit with no request and no limiter wait", async () => {
    const { impl, calls } = scripted(page("total:7"));
    const fetchCore = core(impl);
    const first = await fetchCore.fetch(URL_A, parseTotal);
    vi.advanceTimersByTime(FRESH_WINDOW_MS - 1);
    const second = await fetchCore.fetch(URL_A, parseTotal);
    expect(calls).toHaveLength(1);
    expect(second.data).toEqual({ total: 7 });
    expect(second.envelope).toEqual(first.envelope);
    expect(logged("cache_hit")).toHaveLength(1);
    expect(logged("limiter_wait")).toHaveLength(0);
  });

  it("refetches once the entry is no longer fresh", async () => {
    const { impl, calls } = scripted(page("total:7"), page("total:8"));
    const fetchCore = core(impl);
    await fetchCore.fetch(URL_A, parseTotal);
    vi.advanceTimersByTime(FRESH_WINDOW_MS);
    const result = await fetchCore.fetch(URL_A, parseTotal);
    expect(calls).toHaveLength(2);
    expect(result.data).toEqual({ total: 8 });
    expect(result.envelope.stale).toBe(false);
  });

  it("keys on the normalised URL, so parameter order does not fragment it", async () => {
    const { impl, calls } = scripted(page("total:7"));
    const fetchCore = core(impl);
    await fetchCore.fetch(`${URL_A}?radius=10&locationStr=Berlin`, parseTotal);
    const second = await fetchCore.fetch(`${URL_A}?locationStr=Berlin&radius=10`, parseTotal);
    expect(calls).toHaveLength(1);
    expect(second.envelope.source_url).toBe(`${URL_A}?locationStr=Berlin&radius=10`);
  });
});

describe("the limiter, from the core's side", () => {
  it("spaces two different URLs by the configured gap", async () => {
    const { impl, calls } = scripted(page("total:1"));
    const fetchCore = core(impl);
    const start = Date.now();
    const both = Promise.all([
      fetchCore.fetch(URL_A, parseTotal),
      fetchCore.fetch(URL_B, parseTotal),
    ]);
    await vi.advanceTimersByTimeAsync(5000);
    await both;
    expect(calls.map((call) => call.at)).toEqual([start, start + 1500]);
    expect(logged("limiter_wait")[0]).toMatchObject({ waited_ms: 1500 });
  });
});

describe("backoff on 429 and 5xx", () => {
  it("retries at most twice, doubling from the politeness gap", async () => {
    const { impl, calls } = scripted(page("boom", { status: 503 }));
    const start = Date.now();
    const failing = settled(core(impl).fetch(URL_A, parseTotal));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await failing).toBeInstanceOf(FetchError);
    expect(calls).toHaveLength(MAX_RETRIES + 1);
    expect(calls.map((call) => call.at)).toEqual([start, start + 1500, start + 1500 + 3000]);
  });

  it("succeeds on a retry and reports the result as fresh", async () => {
    const { impl, calls } = scripted(page("boom", { status: 500 }), page("total:4"));
    const pending = core(impl).fetch(URL_A, parseTotal);
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await pending;
    expect(calls).toHaveLength(2);
    expect(result.data).toEqual({ total: 4 });
    expect(result.envelope.stale).toBe(false);
  });

  it("honours Retry-After exactly, in place of the backoff", async () => {
    const { impl, calls } = scripted(
      page("slow down", { status: 429, headers: { "retry-after": "12" } }),
      page("total:2"),
    );
    const start = Date.now();
    const pending = core(impl).fetch(URL_A, parseTotal);
    await vi.advanceTimersByTimeAsync(30_000);
    await pending;
    expect(calls.map((call) => call.at)).toEqual([start, start + 12_000]);
    expect(logged("retry")[0]).toMatchObject({ delay_ms: 12_000, honoured_retry_after: true });
  });

  it("fails loud past the 60 s cap rather than sleeping through it", async () => {
    const { impl, calls } = scripted(
      page("slow down", { status: 429, headers: { "retry-after": "600" } }),
    );
    const pending = settled(core(impl).fetch(URL_A, parseTotal));
    await vi.advanceTimersByTimeAsync(600_000);
    expect(await pending).toMatchObject({ message: expect.stringContaining("Retry-After") });
    expect(calls).toHaveLength(1);
    expect(RETRY_AFTER_CAP_MS).toBe(60_000);
  });

  it("does not retry a 4xx that is not a 429", async () => {
    const { impl, calls } = scripted(page("nope", { status: 400 }));
    const pending = settled(core(impl).fetch(URL_A, parseTotal));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await pending).toMatchObject({ reason: "http_error" });
    expect(calls).toHaveLength(1);
  });

  it("does not retry a network failure either", async () => {
    const { impl, calls } = scripted(fails(new TypeError("fetch failed")));
    const pending = settled(core(impl).fetch(URL_A, parseTotal));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await pending).toMatchObject({ reason: "network" });
    expect(calls).toHaveLength(1);
  });

  it("reports a timeout as a timeout", async () => {
    const timeout = Object.assign(new Error("aborted"), { name: "TimeoutError" });
    const pending = settled(core(scripted(fails(timeout)).impl).fetch(URL_A, parseTotal));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await pending).toMatchObject({ reason: "timeout" });
  });
});

describe("the block breaker", () => {
  const blocked = (): Reply => page(`{"title": "${BLOCK_MARKER}."}`);

  it("never retries a block", async () => {
    const { impl, calls } = scripted(blocked());
    const pending = settled(core(impl).fetch(URL_A, parseTotal));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await pending).toMatchObject({ reason: "block" });
    expect(calls).toHaveLength(1);
  });

  it("never lets a block reach the parser, so it cannot become an empty result", async () => {
    const parse = vi.fn(parseTotal);
    const pending = settled(core(scripted(blocked()).impl).fetch(URL_A, parse));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await pending).toMatchObject({ reason: "block" });
    expect(parse).not.toHaveBeenCalled();
  });

  it("refuses later requests for the cooldown, without opening a socket, and says so", async () => {
    const { impl, calls } = scripted(blocked());
    const fetchCore = core(impl);
    await expect(fetchCore.fetch(URL_A, parseTotal)).rejects.toMatchObject({ reason: "block" });
    await expect(fetchCore.fetch(URL_B, parseTotal)).rejects.toThrow(/blocked.*cooldown/);
    expect(calls).toHaveLength(1);
    expect(logged("breaker_open")[0]).toMatchObject({ cooldown_left_ms: BLOCK_COOLDOWN_MS });
  });

  it("lets a request through once the cooldown has run out", async () => {
    const { impl, calls } = scripted(blocked(), page("total:5"));
    const fetchCore = core(impl);
    await expect(fetchCore.fetch(URL_A, parseTotal)).rejects.toMatchObject({ reason: "block" });
    vi.advanceTimersByTime(BLOCK_COOLDOWN_MS);
    const pending = fetchCore.fetch(URL_A, parseTotal);
    await vi.advanceTimersByTimeAsync(5000);
    expect((await pending).data).toEqual({ total: 5 });
    expect(calls).toHaveLength(2);
  });
});

describe("the one stale-serve rule", () => {
  const staleCase = async (second: Reply) => {
    const { impl, calls } = scripted(page("total:7"), second);
    const fetchCore = core(impl);
    const fresh = await fetchCore.fetch(URL_A, parseTotal);
    vi.advanceTimersByTime(FRESH_WINDOW_MS);
    const pending = fetchCore.fetch(URL_A, parseTotal);
    await vi.advanceTimersByTimeAsync(120_000);
    return { result: await pending, fresh, calls };
  };

  it.each([
    ["a block", page(`x ${BLOCK_MARKER} x`), "block"],
    ["a network failure", fails(new TypeError("fetch failed")), "network"],
    ["a 5xx after retries", page("boom", { status: 502 }), "http_error"],
    ["a parse failure", page("the DOM moved"), "parse_failure"],
  ])("serves the stale entry flagged on %s", async (_name, second, reason) => {
    const { result, fresh } = await staleCase(second);
    expect(result.data).toEqual({ total: 7 });
    expect(result.envelope).toEqual({
      fetched_at: fresh.envelope.fetched_at,
      stale: true,
      stale_reason: reason,
      source_url: URL_A,
    });
  });

  it("shouts on stderr on a parse failure even though the stale serve succeeded", async () => {
    const { result } = await staleCase(page("the DOM moved"));
    expect(result.envelope.stale).toBe(true);
    expect(logged("parse_failure")[0]).toMatchObject({ level: "error", url: URL_A });
    expect(logged("stale_serve")[0]).toMatchObject({ reason: "parse_failure" });
  });

  it("fails loud when there is nothing stale to fall back on", async () => {
    const pending = settled(core(scripted(page("the DOM moved")).impl).fetch(URL_A, parseTotal));
    await vi.advanceTimersByTimeAsync(60_000);
    const error = await pending;
    expect(error).toBeInstanceOf(FetchError);
    expect(error).toMatchObject({ reason: "parse_failure" });
  });

  it("keeps serving the same stale entry rather than pretending it refreshed", async () => {
    const { impl } = scripted(page("total:7"), fails(new TypeError("fetch failed")));
    const fetchCore = core(impl);
    const fresh = await fetchCore.fetch(URL_A, parseTotal);
    vi.advanceTimersByTime(FRESH_WINDOW_MS);
    const first = await fetchCore.fetch(URL_A, parseTotal);
    vi.advanceTimersByTime(60_000);
    const second = await fetchCore.fetch(URL_A, parseTotal);
    expect(second.envelope.fetched_at).toBe(fresh.envelope.fetched_at);
    expect(second.envelope).toEqual(first.envelope);
  });
});
