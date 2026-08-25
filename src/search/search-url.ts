import { z } from "zod";
import { SELLER_TYPES } from "../listing/listing.ts";
import { LISTING_TYPES } from "./search-row.ts";

export const ORIGIN = "https://www.kleinanzeigen.de";

// `ad_type` and `poster_type` are the site's own argument spellings (SPEC 4.1),
// and their values are the listing types and seller types `CONTEXT.md` already
// names — so each enum is that one, not a second copy under a name the
// glossary tells us to avoid.
export const POSTER_TYPES = SELLER_TYPES;
export const SHIPPING_CARRIERS = ["DHL", "HERMES"] as const;
export const SORTS = ["SORTING_DATE", "PRICE_AMOUNT", "PRICE_AMOUNT_DESC"] as const;

export type Sort = (typeof SORTS)[number];

/**
 * `search_listings`' arguments (SPEC 4.1). `snake_case` throughout, and enum
 * values keep the site's exact spelling so nothing maps on the wire
 * (SPEC 11.5).
 */
export const SearchQuerySchema = z
  // **Strict**, because an argument that does not exist must not look answered.
  // Sort-by-distance, category attribute filters and multi-carrier search have
  // no server-side form, so they are absent from this surface — and absent has
  // to mean refused rather than accepted-and-ignored, or an agent that guesses
  // `attributes` reads a nationwide result as a filtered one (SPEC 2.6).
  .strictObject({
    keywords: z.string().optional(),
    category_id: z.number().int().positive().optional(),
    location_id: z.number().int().positive().optional(),
    location: z.string().optional(),
    radius: z.number().int().nonnegative().optional(),
    min_price: z.number().nonnegative().optional(),
    max_price: z.number().nonnegative().optional(),
    ad_type: z.enum(LISTING_TYPES).optional(),
    poster_type: z.enum(POSTER_TYPES).optional(),
    shipping: z.boolean().optional(),
    shipping_carrier: z.enum(SHIPPING_CARRIERS).optional(),
    buy_now: z.boolean().optional(),
    sort: z.enum(SORTS).optional(),
    page: z.number().int().min(1).optional(),
  })
  // The only two refinements on the surface, and both mark a question the site
  // **cannot be asked** rather than one it would answer with an honest empty
  // set (SPEC 11.4). Everything else the site can answer is left to the site.
  .refine((query) => query.location === undefined || query.location_id === undefined, {
    message:
      "location and location_id are mutually exclusive: they resolve at different stages, so the result would silently be one or the other",
    path: ["location"],
  })
  .refine(
    (query) =>
      query.radius === undefined || query.location !== undefined || query.location_id !== undefined,
    {
      message:
        "radius requires location or location_id: a radius with nothing to be a radius of returns a nationwide result the caller believes was scoped",
      path: ["radius"],
    },
  );

export type SearchQuery = z.infer<typeof SearchQuerySchema>;

/**
 * The path code, which is driven only by `category_id` and `location_id` —
 * **`k0` is a literal token**, `k1`/`k9` 404, and leading slugs are cosmetic
 * and never emitted (SPEC 2.2).
 */
function pathCode({ category_id, location_id }: SearchQuery): string {
  if (category_id !== undefined && location_id !== undefined) return `c${category_id}l${location_id}`;
  if (category_id !== undefined) return `c${category_id}`;
  if (location_id !== undefined) return `l${location_id}`;
  return "k0";
}

/**
 * The URL for one page of a search query.
 *
 * **The keyword never becomes a path segment** — it always rides `?keywords=`,
 * so nothing here slugifies, transliterates an umlaut, or decides how a space
 * is spelled in a path (SPEC 11.2). Slugless `seite:N` addresses a page
 * directly, which is what makes page N cost exactly one request (SPEC 2.5).
 *
 * Every wire parameter name is the site's, and this is the one place the
 * mapping from `snake_case` arguments lives (SPEC 11.5).
 */
export function searchUrl(query: SearchQuery): string {
  const page = query.page ?? 1;
  const seite = page > 1 ? `seite:${page}/` : "";
  const url = new URL(`/s-${seite}${pathCode(query)}`, ORIGIN);

  const set = (key: string, value: string | number | boolean): void => {
    url.searchParams.set(key, String(value));
  };
  if (query.keywords !== undefined) set("keywords", query.keywords);
  if (query.location !== undefined) set("locationStr", query.location);
  if (query.radius !== undefined) set("radius", query.radius);
  if (query.min_price !== undefined) set("minPrice", query.min_price);
  if (query.max_price !== undefined) set("maxPrice", query.max_price);
  if (query.ad_type !== undefined) set("adType", query.ad_type);
  if (query.poster_type !== undefined) set("posterType", query.poster_type);
  // A genuine tri-state, and **both literals are serialised**: `false` is
  // `pickup only`, a real filter, not an omission. It stays even beside a
  // carrier — `shipping=false` with a carrier is an honest empty set the caller
  // is entitled to ask for, and dropping it would answer a different question
  // (SPEC 4.1, 5.6).
  if (query.shipping !== undefined) set("shipping", query.shipping);
  if (query.shipping_carrier !== undefined) set("shippingCarrier", query.shipping_carrier);
  // `buy_now: false` is a no-op that returns the baseline: the two `false`s do
  // **not** share a serialisation rule (SPEC 4.1).
  if (query.buy_now === true) set("buyNowEnabled", true);
  // Sent only when the caller asks for one; the applied sort cannot be read
  // back, so the envelope reports what was sent (SPEC 4.1).
  if (query.sort !== undefined) set("sortingField", query.sort);

  return url.toString();
}

/**
 * Whether §5.7's degenerate signature could apply to this query.
 *
 * The guard is for a **keywordless** query whose only narrowing inputs are
 * `category_id` and/or `location_id`. A bare category or location holds
 * thousands of listings, so `1 - 1 von 1` from one is the known-garbage
 * signature rather than data — and any other input makes one an honest answer.
 */
export function isDegenerateForm(query: SearchQuery): boolean {
  const narrowing = [
    query.keywords,
    query.location,
    query.radius,
    query.min_price,
    query.max_price,
    query.ad_type,
    query.poster_type,
    query.shipping,
    query.shipping_carrier,
    query.buy_now,
  ];
  return (
    narrowing.every((input) => input === undefined) &&
    (query.category_id !== undefined || query.location_id !== undefined)
  );
}
