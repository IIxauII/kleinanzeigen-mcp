/**
 * The cache key: the exact fetched URL after query-string normalisation, so
 * parameter order cannot fragment the cache (SPEC 6.1).
 *
 * The pairs are sorted **as written**, never re-encoded: `URLSearchParams`
 * would re-spell a space as `+` and rewrite percent-escapes, and keywords ride
 * the query string (SPEC 11.2), where the rule is to pass the caller's string
 * through untouched (SPEC 4.5). Sorting raw text changes the order and nothing
 * else, which is what makes it safe to fetch the normalised URL itself.
 *
 * **The path is never touched** — a shop slug is case-sensitive and may carry a
 * collision suffix, so normalising one would merge two different sellers
 * (SPEC 3.5). The fragment is dropped; it is never sent.
 */
export function normaliseUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  const query = parsed.search.replace(/^\?/, "");
  if (query === "") {
    parsed.search = "";
    return parsed.toString();
  }
  const pairs = query.split("&").filter((pair) => pair !== "");
  const keyOf = (pair: string): string => pair.split("=", 1)[0] ?? pair;
  pairs.sort((a, b) => {
    const [left, right] = [keyOf(a), keyOf(b)];
    return left < right ? -1 : left > right ? 1 : 0;
  });
  parsed.search = pairs.length === 0 ? "" : `?${pairs.join("&")}`;
  return parsed.toString();
}
