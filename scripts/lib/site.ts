/**
 * The fetch half the maintenance scripts share: the two dataset generators and
 * the drift check all talk to the same site under the same politeness rule.
 *
 * It is deliberately **not** `src/fetch/core.ts`. That path carries the
 * server's cache, its breaker and its one operator knob
 * (`KLEINANZEIGEN_MCP_RATE_LIMIT_MS`), and an operator's knob for their own
 * machine must never retune a maintenance job. The 1500 ms gap here is the
 * project's stance rather than a performance setting (SPEC 7, 2.8).
 */
import { USER_AGENT } from "../../src/user-agent.ts";

export const ORIGIN = "https://www.kleinanzeigen.de";
export const CITIES_SITEMAP_URL = `${ORIGIN}/sitemap_cities.xml`;
export const KATALOG_URL = `${ORIGIN}/s-katalog-orte.html`;

/** Personal-scale politeness: serialised, no bursting (SPEC 2.8). */
export const REQUEST_GAP_MS = 1500;

/**
 * A leg of a maintenance run that did not produce readable bytes — the request
 * failed, or it answered 200 carrying none of what it was fetched for.
 *
 * The two are one class on purpose: to a caller they mean the same thing, which
 * is that this leg learnt nothing. A block presents as HTTP 200 with an empty
 * list (ADR-0003), so the status is never the test.
 */
export class SiteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SiteError";
  }
}

/** One GET, already serialised against the last one. Throws `SiteError`. */
export type Get = (url: string) => Promise<string>;

export type GetOptions = {
  gapMs?: number;
  fetchImpl?: typeof fetch;
  /** Where the per-request line goes. Silent by default; the scripts pass stderr. */
  note?: (message: string) => void;
};

/**
 * A serialised GET holding the fixed gap between calls, whoever calls it.
 * The gap lives in the returned closure, so two legs of the same run cannot
 * overlap by being started from different modules.
 */
export function createGet({
  gapMs = REQUEST_GAP_MS,
  fetchImpl = fetch,
  note = () => {},
}: GetOptions = {}): Get {
  let lastRequestAt = 0;

  return async (url) => {
    const wait = lastRequestAt + gapMs - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestAt = Date.now();

    let response: Response;
    try {
      response = await fetchImpl(url, { headers: { "user-agent": USER_AGENT } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SiteError(`GET ${url} failed: ${message}`);
    }
    if (!response.ok) throw new SiteError(`GET ${url} answered ${response.status}`);
    const body = await response.text();
    note(`GET ${url} → ${response.status}, ${body.length} chars`);
    return body;
  };
}
