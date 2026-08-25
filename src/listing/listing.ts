import { z } from "zod";
import { PostingDateSchema } from "../search/posting-date.ts";
import { PriceSchema } from "../search/price.ts";
import { LISTING_TYPES } from "../search/search-row.ts";

/**
 * Whether a seller is `PRIVATE` or `COMMERCIAL` — **an enum, not a boolean**
 * (SPEC 3.5).
 *
 * "Not private" is a weaker claim than "commercial", and a seller type that
 * cannot be read is unknown rather than private. The search surface spells the
 * same two values `poster_type`, which is the site's argument name for them.
 */
export const SELLER_TYPES = ["PRIVATE", "COMMERCIAL"] as const;

export type SellerType = (typeof SELLER_TYPES)[number];

/**
 * The observable listing states, as **three flags rather than an enum**
 * (SPEC 3.4).
 *
 * `CONTEXT.md` names four site-side states; this is the narrower set a
 * logged-out reader can actually see:
 *
 * - **Active has no member.** It is observable only as the absence of
 *   everything else, so an `ACTIVE` enum value would be a claim the page
 *   cannot support.
 * - **Reserved is not represented at all.** A public page carries no field for
 *   it; kleinanzeigen surfaces the marker through watchlists and conversations,
 *   both of which require an account.
 * - **Deleted is not here either** — it is not a flag but the absence of a
 *   listing, and it arrives as `status: "gone"` (SPEC 5.3). `deleted_veil` is
 *   a different thing: a page still being served, behind a veil.
 */
export const ListingFlagsSchema = z.object({
  expired: z.boolean(),
  paused: z.boolean(),
  deleted_veil: z.boolean(),
});

export type ListingFlags = z.infer<typeof ListingFlagsSchema>;

export const SellerSchema = z.object({
  seller_id: z.number().int().positive().nullable(),
  seller_type: z.enum(SELLER_TYPES).nullable(),
  name: z.string().nullable(),
  /**
   * **Case-sensitive, may carry a numeric collision suffix, and is never
   * normalised**: `Autohaus-Meyer-GmbH` and `autohaus-meyer-gmbh-1` are two
   * different sellers (SPEC 3.5). Commercial sellers only — a private seller
   * has no shop page.
   */
  shop_slug: z.string().nullable(),
  member_since: z.string().nullable(),
  badges: z.array(z.string()),
});

export type Seller = z.infer<typeof SellerSchema>;

/**
 * One category-specific field as the page renders it: **a verbatim German
 * label and value, in rendered order, with no key mapping** (SPEC 3.3).
 *
 * The machine keys — `autos.km_i`, `global.zustand` — live in `robots.txt` and
 * in filter URLs but **not in this page's DOM**, so the typed key and the
 * readable value are on different surfaces. A mapping table for ~40
 * unenumerable keys across 159 categories has no verification path, and a
 * half-populated typed field is worse than an honest untyped one.
 */
export const AttributeSchema = z.object({ label: z.string(), value: z.string() });

export const ListingSchema = z.object({
  ad_id: z.string(),
  url: z.string(),
  title: z.string(),
  description: z.string(),
  price: PriceSchema,
  category_id: z.number().int().positive().nullable(),
  /** **The third number in a listing URL is the location id**, never a user id (SPEC 3.3). */
  location_id: z.number().int().positive().nullable(),
  postcode: z.string().nullable(),
  location_name: z.string().nullable(),
  /** Always `precision: "day"` from this surface — the page renders no time (SPEC 3.2). */
  posted: PostingDateSchema,
  /** The large gallery URLs, **exactly as the page gave them** — no size-grammar rewriting. */
  images: z.array(z.string()),
  image_count: z.number().int().nonnegative(),
  listing_type: z.enum(LISTING_TYPES),
  attributes: z.array(AttributeSchema),
  seller: SellerSchema,
  flags: ListingFlagsSchema,
});

export type Listing = z.infer<typeof ListingSchema>;

/**
 * What one call to `get_listing` yields: the listing, or the discriminant that
 * says there is none (SPEC 4.2).
 *
 * **`gone` is a normal result, not an error.** "This listing no longer exists"
 * is an answer; dressing it as an error invites the agent to retry it
 * (SPEC 6.3). And it carries no listing fields at all, so there is nothing on
 * it a caller could read as a half-answer.
 */
export const ListingResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ok"), ...ListingSchema.shape }),
  z.object({ status: z.literal("gone") }),
]);

export type ListingResult = z.infer<typeof ListingResultSchema>;
