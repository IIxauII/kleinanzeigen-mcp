/**
 * The cache key: the exact fetched URL after query-string normalisation, so
 * parameter order cannot fragment the cache (SPEC 6.1).
 *
 * Only the query string is normalised, and only by sorting: repeated keys keep
 * their relative order, and **the path is never touched** — a shop slug is
 * case-sensitive and may carry a collision suffix, so normalising one would
 * merge two different sellers (SPEC 3.5). The fragment is dropped; it is never
 * sent.
 */
export function normaliseUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  const params = [...parsed.searchParams.entries()];
  params.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  parsed.search = params.length === 0 ? "" : new URLSearchParams(params).toString();
  return parsed.toString();
}
