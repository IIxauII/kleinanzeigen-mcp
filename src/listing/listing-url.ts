import { z } from "zod";
import { ORIGIN } from "../search/search-url.ts";

/** The one path a listing is served at. Kleinanzeigen's own code calls it the VIP; we do not. */
const LISTING_PATH = "/s-anzeige/";

/** Both spellings of the site's own host. A redirect may come to rest on either. */
const HOSTS = new Set([new URL(ORIGIN).host, "kleinanzeigen.de"]);

/**
 * `get_listing`'s argument: **the ad id only** (SPEC 4.2).
 *
 * The slug and the trailing category and location codes in a listing URL are
 * cosmetic — `/s-anzeige/x/<ad_id>` resolves on its own — so they are not
 * asked of the caller. And a decorated id is **refused rather than trimmed**:
 * accepting a URL here would mean deciding which of its parts to believe, and
 * the id is the only load-bearing one.
 */
export const GetListingArgsSchema = z.strictObject({
  ad_id: z
    .string()
    .regex(
      /^\d+$/u,
      "ad_id is the ad id on its own — the digits, without the slug or the category and location codes that decorate a listing URL",
    ),
});

export type GetListingArgs = z.infer<typeof GetListingArgsSchema>;

/** The slugless form, which resolves on the ad id alone (SPEC 2.2, 4.2). */
export function listingUrl(ad_id: string): string {
  return `${ORIGIN}${LISTING_PATH}x/${ad_id}`;
}

/**
 * What the URL a fetch came to rest on says about what was served.
 *
 * Three answers rather than two, because "not a listing" and "we cannot tell"
 * are different things and only the first is an answer (SPEC 5.3, 6.3).
 */
export type FinalUrl = "listing" | "not-a-listing" | "unreadable";

/**
 * **The deleted-ad guard** (SPEC 5.3).
 *
 * A missing listing does not 404 and leaves no tombstone: it 301s to a
 * synthesised browse page, or to the homepage, and answers HTTP 200 with a
 * full page of *other* listings. So the only reading that distinguishes a
 * listing from a plausible impostor is where the redirects came to rest — and
 * the **host** is half of that reading twice over:
 *
 * - a path check alone would accept `https://kleinanzeigen.de.example.com/s-anzeige/…`
 * - a check against one spelling of the site's host alone would call the apex
 *   host's own listing page a deleted listing
 *
 * Anywhere else — an unparseable URL, an empty one, a host that is not the
 * site's — is `unreadable` rather than `not-a-listing`: the caller is owed a
 * failure there, never the answer "this listing is gone".
 */
export function readFinalUrl(url: string): FinalUrl {
  let host: string;
  let path: string;
  try {
    ({ host, pathname: path } = new URL(url));
  } catch {
    return "unreadable";
  }
  if (!HOSTS.has(host)) return "unreadable";
  return path.startsWith(LISTING_PATH) ? "listing" : "not-a-listing";
}
