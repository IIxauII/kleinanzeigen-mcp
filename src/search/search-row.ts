import { z } from "zod";
import { PostingDateSchema } from "./posting-date.ts";
import { PriceSchema } from "./price.ts";

export const LISTING_TYPES = ["OFFER", "WANTED"] as const;

export type ListingType = (typeof LISTING_TYPES)[number];

/**
 * One listing as a search results page renders it (SPEC 3.3).
 *
 * `promoted` is a flag rather than a separate array: a TOP listing is returned
 * **in place**, because dropping it would hide a genuinely matching listing
 * because its seller paid, and moving it would lose its position on the page
 * (SPEC 4.1).
 *
 * Two fields are nullable against §3.3's shape, and both are corrections the
 * live DOM forced — see the correction recorded in SPEC §3.3:
 *
 * - **`posted`** is absent on a TOP row. The site renders no date cell there at
 *   all, on every page sampled.
 * - **`description`** falls back to the visible snippet on a picture-less row,
 *   which carries no `ld+json` because the `ld+json` describes the image.
 */
export const SearchRowSchema = z.object({
  ad_id: z.string(),
  url: z.string(),
  title: z.string(),
  description: z.string(),
  price: PriceSchema,
  old_price: PriceSchema.optional(),
  postcode: z.string().nullable(),
  location_name: z.string().nullable(),
  posted: PostingDateSchema.nullable(),
  thumbnail: z.string().nullable(),
  image_count: z.number().int().nonnegative(),
  shipping: z.boolean(),
  listing_type: z.enum(LISTING_TYPES),
  promoted: z.boolean(),
  distance_km: z.number().nullable(),
});

export type SearchRow = z.infer<typeof SearchRowSchema>;
