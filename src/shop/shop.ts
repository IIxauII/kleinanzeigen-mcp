import { z } from "zod";
import { PostingDateSchema } from "../search/posting-date.ts";
import { PriceSchema } from "../search/price.ts";

/** A shop's own breakdown of its inventory. The name is never a handle (CONTEXT.md). */
export const ShopCategorySchema = z.object({
  category_id: z.number().int().positive(),
  count: z.number().int().nonnegative(),
});

/**
 * A commercial seller's profile, as the shop page's islands carry it
 * (SPEC 3.5).
 *
 * **`shop_slug` is the caller's spelling, echoed back and never normalised.**
 * The site resolves a slug case-insensitively — `/pro/Autohaus-CCC-GmbH` and
 * `/pro/autohaus-ccc-gmbh` both answer with seller `82731513` — but a
 * *numeric collision suffix* is load-bearing: `Autohaus-Meyer-GmbH` and
 * `autohaus-meyer-gmbh-1` are two different sellers, so nothing here trims,
 * lower-cases or otherwise tidies the handle it was given.
 *
 * **`ads_online` is the site's own figure and is promised to be nothing else**
 * — in particular not the summed length of the pages this tool returns. Three
 * shop counts exist, no authority among them is known, and this is the one the
 * shop page states (SPEC 9.14).
 */
export const ShopSchema = z.object({
  shop_slug: z.string(),
  name: z.string(),
  seller_id: z.number().int().positive(),
  store_id: z.number().int().positive().nullable(),
  ads_online: z.number().int().nonnegative(),
  about: z.string().nullable(),
  logo_url: z.string().nullable(),
  /** Sums exactly to `ads_online` — this is the *unfiltered* breakdown, see `parse-shop-ads.ts`. */
  categories: z.array(ShopCategorySchema),
});

export type Shop = z.infer<typeof ShopSchema>;

/**
 * One listing as a shop surface renders it — **a different row from a search
 * results page's, deliberately** (SPEC 4.3's correction).
 *
 * The island and the RPC carry twelve fields per listing between them, and the
 * four a `SearchRow` would still need are in neither: there is no shipping
 * tag, no `Gesuch` marker, no postcode and no promoted slot anywhere on the
 * shop surface. Defaulting them would put `shipping: false` on a listing that
 * ships and `listing_type: "OFFER"` on a want listing, so they are **absent
 * rather than guessed** — the same reading that makes an unreadable seller
 * type unknown rather than private (SPEC 3.5).
 *
 * `tags` is the one field the shop surface has that a search row does not: the
 * size a clothing or footwear listing is filed under, which the shop cards
 * render and the results page does not.
 *
 * Two of the twelve fields the encodings carry are deliberately left behind:
 * **`retinaImage`** is the same picture at `rule=$_35` rather than `rule=$_2`,
 * derivable from `thumbnail` and identifying nothing new, and
 * **`hasVirtualTour`** was `false` on all 65 listings sampled and has no field
 * on any type here.
 */
export const ShopRowSchema = z.object({
  ad_id: z.string(),
  url: z.string(),
  title: z.string(),
  description: z.string(),
  price: PriceSchema,
  /** `Köln - Porz` — the shop surface renders a locality and never a postcode. */
  location_name: z.string(),
  /** Both precisions appear here, exactly as on a search results page (SPEC 3.2). */
  posted: PostingDateSchema,
  thumbnail: z.string(),
  image_count: z.number().int().nonnegative(),
  tags: z.array(z.string()),
});

export type ShopRow = z.infer<typeof ShopRowSchema>;
