import { afterEach, describe, expect, it, vi } from "vitest";
import { USER_AGENT } from "../../src/user-agent.ts";
import { createGet, REQUEST_GAP_MS, SiteError } from "./site.ts";

type Call = { url: string; at: number; headers: Record<string, string> };

/** Records what was asked for and when, and answers whatever the test set up. */
function recorder(answer: (url: string) => Response | Promise<Response> = () => new Response("ok")) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    calls.push({
      url: String(input),
      at: Date.now(),
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    return Promise.resolve(answer(String(input)));
  };
  return { calls, fetchImpl };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("the maintenance scripts' GET", () => {
  it("holds the 1500 ms gap between requests, however fast the caller asks", async () => {
    // Fake timers, because the gap is the point and a real one would put 1.5 s
    // of wall clock in the suite for every request (SPEC 8.6).
    vi.useFakeTimers();
    const { calls, fetchImpl } = recorder();
    const get = createGet({ fetchImpl, onRequest: () => {} });

    const first = get("https://example.test/a");
    await vi.runAllTimersAsync();
    await first;

    const second = get("https://example.test/b");
    await vi.runAllTimersAsync();
    await second;

    expect(calls.map((call) => call.url)).toEqual([
      "https://example.test/a",
      "https://example.test/b",
    ]);
    expect(calls[1]!.at - calls[0]!.at).toBeGreaterThanOrEqual(REQUEST_GAP_MS);
    expect(REQUEST_GAP_MS).toBe(1500);
  });

  it("holds one gap for every caller, because the closure owns it", async () => {
    // Two legs of the same run start from different modules; the gap would be
    // no gap at all if each caller carried its own (SPEC 2.8).
    vi.useFakeTimers();
    const { calls, fetchImpl } = recorder();
    const get = createGet({ fetchImpl, onRequest: () => {} });

    const both = Promise.all([get("https://example.test/a"), get("https://example.test/b")]);
    await vi.runAllTimersAsync();
    await both;

    expect(calls).toHaveLength(2);
    expect(calls[1]!.at - calls[0]!.at).toBeGreaterThanOrEqual(REQUEST_GAP_MS);
  });

  it("identifies itself with the project's User-Agent, as the running server does", async () => {
    const { calls, fetchImpl } = recorder();
    await createGet({ fetchImpl, gapMs: 0, onRequest: () => {} })("https://example.test/a");
    expect(calls[0]!.headers).toEqual({ "user-agent": USER_AGENT });
  });

  it("throws a SiteError on a status that is not ok, naming the url and the status", async () => {
    const { fetchImpl } = recorder(() => new Response("", { status: 503 }));
    const get = createGet({ fetchImpl, gapMs: 0, onRequest: () => {} });
    await expect(get("https://example.test/a")).rejects.toThrow(SiteError);
    await expect(get("https://example.test/a")).rejects.toThrow(
      "GET https://example.test/a answered 503",
    );
  });

  it("turns a refused connection into the same SiteError, not a raw fetch failure", async () => {
    const fetchImpl: typeof fetch = () => Promise.reject(new TypeError("fetch failed"));
    const get = createGet({ fetchImpl, gapMs: 0, onRequest: () => {} });
    await expect(get("https://example.test/a")).rejects.toThrow(
      "GET https://example.test/a failed: fetch failed",
    );
  });

  it("says what it fetched and how much of it came back", async () => {
    const lines: string[] = [];
    const { fetchImpl } = recorder(() => new Response("12345"));
    await createGet({ fetchImpl, gapMs: 0, onRequest: (line) => lines.push(line) })(
      "https://example.test/a",
    );
    expect(lines).toEqual(["GET https://example.test/a → 200, 5 chars"]);
  });
});
