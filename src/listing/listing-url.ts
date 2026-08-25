import { z } from "zod";
import { ORIGIN } from "../search/search-url.ts";

/** The one path a listing is served at. Kleinanzeigen's own code calls it the VIP; we do not. */
const LISTING_PATH = `${ORIGIN}/s-anzeige/`;

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
  return `${LISTING_PATH}x/${ad_id}`;
}

/**
 * **The deleted-ad guard** (SPEC 5.3).
 *
 * A missing listing does not 404 and leaves no tombstone: it 301s to a
 * synthesised browse page, or to the homepage, and answers HTTP 200 with a
 * full page of *other* listings. So the only reading that distinguishes a
 * listing from a plausible impostor is where the redirects came to rest, and
 * the origin is part of that reading: a path prefix alone would accept
 * `https://kleinanzeigen.de.example.com/s-anzeige/…`.
 */
export function isListingDetailUrl(url: string): boolean {
  return url.startsWith(LISTING_PATH);
}
