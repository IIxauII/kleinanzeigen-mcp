import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CACHE_MAX_ENTRIES, createCache, FRESH_WINDOW_MS } from "./cache.ts";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("the in-memory cache", () => {
  it("holds the spec's two numbers: 5 minutes fresh, ~200 entries", () => {
    expect(FRESH_WINDOW_MS).toBe(5 * 60_000);
    expect(CACHE_MAX_ENTRIES).toBe(200);
  });

  it("returns a stored entry with the time it was fetched", () => {
    const cache = createCache<{ total: number }>();
    const at = new Date();
    cache.set("https://x.de/a", { total: 3 });
    const entry = cache.get("https://x.de/a");
    expect(entry).toEqual({ value: { total: 3 }, fetched_at: at.toISOString(), fresh: true });
  });

  it("misses on a key it never stored", () => {
    expect(createCache<number>().get("https://x.de/a")).toBeNull();
  });

  it("stops being fresh after 5 minutes without being evicted", () => {
    const cache = createCache<number>();
    const at = new Date();
    cache.set("https://x.de/a", 1);
    vi.advanceTimersByTime(FRESH_WINDOW_MS - 1);
    expect(cache.get("https://x.de/a")?.fresh).toBe(true);
    vi.advanceTimersByTime(1);
    const stale = cache.get("https://x.de/a");
    expect(stale).toEqual({ value: 1, fetched_at: at.toISOString(), fresh: false });
    vi.advanceTimersByTime(24 * 60 * 60_000);
    expect(cache.get("https://x.de/a")?.value).toBe(1);
  });

  it("evicts by LRU and by nothing else", () => {
    const cache = createCache<number>(3);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    cache.get("a");
    cache.set("d", 4);
    expect(cache.get("b")).toBeNull();
    expect(cache.get("a")?.value).toBe(1);
    expect(cache.get("c")?.value).toBe(3);
    expect(cache.get("d")?.value).toBe(4);
    expect(cache.size()).toBe(3);
  });

  it("counts a stale read as a use, so a stale entry is not evicted for being old", () => {
    const cache = createCache<number>(2);
    cache.set("a", 1);
    vi.advanceTimersByTime(FRESH_WINDOW_MS + 1);
    cache.set("b", 2);
    expect(cache.get("a")?.fresh).toBe(false);
    cache.set("c", 3);
    expect(cache.get("a")?.value).toBe(1);
    expect(cache.get("b")).toBeNull();
  });

  it("refreshes the timestamp when a key is fetched again", () => {
    const cache = createCache<number>();
    cache.set("a", 1);
    vi.advanceTimersByTime(FRESH_WINDOW_MS + 1);
    const at = new Date();
    cache.set("a", 2);
    expect(cache.get("a")).toEqual({ value: 2, fetched_at: at.toISOString(), fresh: true });
    expect(cache.size()).toBe(1);
  });
});
