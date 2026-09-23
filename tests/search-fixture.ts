import { readFileSync } from "node:fs";

/**
 * Captured live, minimised to the DOM the parser reads and redacted, by
 * `npm run capture:search-fixtures` (SPEC 8.6).
 */
export const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}.html`, import.meta.url), "utf8");

/**
 * `body` with `pattern` rewritten, and **loud when it rewrote nothing**.
 *
 * A doctoring that silently stops matching leaves its test asserting against an
 * undoctored page — which is exactly how the degenerate-signature guard rotted:
 * the literal `39.183` stopped matching the moment the fixture was recaptured,
 * the replace became a no-op, and the test went on passing
 * ([#81](https://github.com/IIxauII/kleinanzeigen-mcp/issues/81)). Throwing
 * here is what makes that failure loud instead.
 *
 * Doctor where the **parser** reads, not where the markup happens to be
 * styled: a utility class is not an anchor, and a restyle would disarm the
 * test without breaking the parser.
 */
export function rewrite(body: string, pattern: RegExp, replacement: string, what: string): string {
  const doctored = body.replace(pattern, replacement);
  if (doctored === body) throw new Error(`nothing matched when doctoring ${what}`);
  return doctored;
}

/**
 * A fixture with the summary the parser reads rewritten to `summary`, anchored
 * on **the element** rather than on the fixture's own counts — `rewrite`'s
 * guard, specialised to the one doctoring the parser and tool tests both need.
 *
 * It lives here rather than in either test file because it was duplicated in
 * both, and the copies had already begun to diverge: the rot #81 describes is
 * a helper going quiet, so two of it is the same bug re-arming.
 */
export function withSummary(name: string, summary: string): string {
  return rewrite(
    fixture(name),
    /(id="srp-breadcrumb-summary"[^>]*>)[^<]*/u,
    `$1${summary}`,
    `${name}: #srp-breadcrumb-summary`,
  );
}
