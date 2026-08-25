/** Fresh window, uniform for search and detail alike. A split TTL was rejected (SPEC 6.1). */
export const FRESH_WINDOW_MS = 5 * 60_000;

/** The bound. **LRU is the only eviction rule; there is no time ceiling** (SPEC 6.1, ADR-0002). */
export const CACHE_MAX_ENTRIES = 200;

export type CacheEntry<T> = {
  value: T;
  fetched_at: string;
  fresh: boolean;
};

export type Cache<T> = {
  get(key: string): CacheEntry<T> | null;
  set(key: string, value: T): void;
  size(): number;
};

/**
 * **In memory only. Never on disk. Dies with the process** (ADR-0002).
 *
 * The value is a **parsed domain object**; raw HTML is discarded the moment
 * parsing finishes, so the server never holds a page copy longer than it takes
 * to read it.
 *
 * An entry past the fresh window is **not evicted** — it stops being fresh and
 * becomes servable only under the stale rule (SPEC 6.2). TTL is a freshness
 * marker, not a timer, which is why nothing here runs on a schedule.
 *
 * There is no bypass and no clear-cache tool: every result carries
 * `fetched_at`, and that timestamp is the answer (SPEC 6.1).
 */
export function createCache<T>(maxEntries: number = CACHE_MAX_ENTRIES): Cache<T> {
  // A Map iterates in insertion order, so delete-then-set moves a key to the
  // most-recently-used end and the first key is always the least recent.
  const entries = new Map<string, { value: T; fetchedAt: number }>();

  return {
    get(key: string): CacheEntry<T> | null {
      const entry = entries.get(key);
      if (entry === undefined) return null;
      entries.delete(key);
      entries.set(key, entry);
      return {
        value: entry.value,
        fetched_at: new Date(entry.fetchedAt).toISOString(),
        fresh: Date.now() - entry.fetchedAt < FRESH_WINDOW_MS,
      };
    },
    set(key: string, value: T): void {
      entries.delete(key);
      entries.set(key, { value, fetchedAt: Date.now() });
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next();
        if (oldest.done === true) break;
        entries.delete(oldest.value);
      }
    },
    size: () => entries.size,
  };
}
