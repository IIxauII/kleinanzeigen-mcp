import { z } from "zod";
import { ORIGIN, SITE_HOSTS } from "../search/search-url.ts";

/** The shop page. Private sellers have none (SPEC 2.2, 4.3). */
export const SHOP_PATH = "/pro/";

/** The paging RPC. No CSRF token, no cookies, no session (SPEC 2.2). */
const SHOP_ADS_ACTION = "/_actions/proPublicWeb.brandProfile.getAds/";

/**
 * **Fixed in code and not exposed** (SPEC 4.3, 8.4).
 *
 * It is the shop page's own page size, which is what keeps page 1 — read off
 * the island — and page 2 — read off the RPC — from overlapping or skipping a
 * listing between them. The RPC honours larger values (100 verified) and how
 * deep it goes before clamping is unprobed (SPEC 9.15), neither of which is a
 * reason to hand the caller a dial that would silently reshape every page
 * boundary.
 */
export const SHOP_PAGE_SIZE = 25;

/**
 * `get_shop`'s arguments (SPEC 4.3). Strict, for the same reason the search
 * surface is: an argument that does not exist must not look answered.
 *
 * The slug is **refused rather than repaired**. A handle carrying a path
 * separator, a query or a fragment is a URL somebody pasted, and deciding
 * which part of it to believe is exactly the guess §3.5 forbids.
 */
export const GetShopArgsSchema = z.strictObject({
  shop_slug: z
    .string()
    .min(1)
    // A backslash is refused alongside the three obvious separators: WHATWG
    // reads `\` as a path separator for a special scheme, so `..\..\x` would
    // leave `/pro/` entirely and spend a rate-limited request on a URL nobody
    // asked for.
    .regex(
      /^[^/\\?#]+$/u,
      "shop_slug is the handle on its own — the segment after /pro/, without the rest of the URL",
    )
    // `.` and `..` are not handles; both resolve away from the shop page entirely.
    .refine((slug) => slug !== "." && slug !== "..", { message: "shop_slug is not a path traversal" }),
  page: z.number().int().min(1).optional(),
  keywords: z.string().optional(),
  category_id: z.number().int().positive().optional(),
  location_id: z.number().int().positive().optional(),
  // Whole euros, as the site's own bounds are. A fractional or exponent-form
  // bound would reach the action as `"19.99"` or `"1e+21"`, which it validates
  // as a string and answers however it likes.
  min_price: z.number().int().nonnegative().optional(),
  max_price: z.number().int().nonnegative().optional(),
});

export type GetShopArgs = z.infer<typeof GetShopArgsSchema>;

/**
 * Whether this call narrows the inventory at all.
 *
 * It decides which surface answers, and it has to: **the shop page renders one
 * thing only** — the shop's first 25 listings, unfiltered — so a filtered page
 * 1 is the RPC's to answer even though its page number says otherwise. The
 * filters are genuinely server-side there, which is what admits them under
 * §2.6's rule at all.
 */
export function isFiltered(args: GetShopArgs): boolean {
  return (
    args.keywords !== undefined ||
    args.category_id !== undefined ||
    args.location_id !== undefined ||
    args.min_price !== undefined ||
    args.max_price !== undefined
  );
}

/** `/pro/<slug>` — the slug as given, byte for byte (SPEC 3.5). */
export function shopPageUrl(shop_slug: string): string {
  return new URL(`${SHOP_PATH}${shop_slug}`, ORIGIN).toString();
}

/**
 * What the URL a fetch came to rest on says about what was served.
 *
 * Three answers rather than two, and the module that builds the URL is the one
 * that reads it back — the same pairing `listing-url.ts` makes, for the same
 * reason: "not a shop page" and "we cannot tell" are different things and only
 * the first is an answer (SPEC 5.3, 6.3).
 */
export type FinalUrl = "shop" | "not-a-shop" | "unreadable";

export function readFinalUrl(url: string): FinalUrl {
  let host: string;
  let path: string;
  try {
    ({ host, pathname: path } = new URL(url));
  } catch {
    return "unreadable";
  }
  if (!SITE_HOSTS.has(host)) return "unreadable";
  return path.startsWith(SHOP_PATH) ? "shop" : "not-a-shop";
}

export type ShopAdsRequest = { url: string; body: Record<string, unknown> };

/**
 * One page of the inventory RPC.
 *
 * Every wire name is the site's, and this is the one place the mapping from
 * `snake_case` arguments lives (SPEC 11.5). **The price bounds go over as
 * strings**: the action validates them as such and answers a numeric bound
 * with HTTP 400 and a field-level complaint, while the two ids are validated
 * as numbers and a string id is refused the same way.
 */
export function shopAdsRequest(args: GetShopArgs): ShopAdsRequest {
  const body: Record<string, unknown> = { brandName: args.shop_slug };
  if (args.keywords !== undefined) body["keywords"] = args.keywords;
  if (args.category_id !== undefined) body["categoryId"] = args.category_id;
  if (args.location_id !== undefined) body["locationId"] = args.location_id;
  if (args.min_price !== undefined) body["minPrice"] = String(args.min_price);
  if (args.max_price !== undefined) body["maxPrice"] = String(args.max_price);
  body["pageSize"] = SHOP_PAGE_SIZE;
  body["pageNum"] = args.page ?? 1;
  return { url: new URL(SHOP_ADS_ACTION, ORIGIN).toString(), body };
}
