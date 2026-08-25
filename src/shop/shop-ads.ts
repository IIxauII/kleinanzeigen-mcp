import { ParseError } from "../fetch/errors.ts";
import { parsePostingDate } from "../search/posting-date.ts";
import { parsePrice } from "../search/price.ts";
import { ORIGIN } from "../search/search-url.ts";
import type { ShopCategorySchema, ShopRow } from "./shop.ts";
import type { z } from "zod";

/**
 * The inventory block, which is the **one shape the two shop decoders agree
 * on**.
 *
 * The island props carry it as `initialAds` and the RPC returns it as its
 * whole payload, and once each encoding has been undone the object is the
 * same: `ads`, plus `categoriesSearchData`. So the reading of it lives here
 * once, and neither decoder grows a second opinion about what a shop listing
 * is.
 */

type Category = z.infer<typeof ShopCategorySchema>;

export type ShopAds = {
  listings: ShopRow[];
  categories: Category[];
};

const record = (value: unknown, what: string): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ParseError(`${what} is not an object`);
  }
  return value as Record<string, unknown>;
};

const list = (value: unknown, what: string): unknown[] => {
  if (!Array.isArray(value)) throw new ParseError(`${what} is not a list`);
  return value;
};

const string = (source: Record<string, unknown>, key: string, what: string): string => {
  const value = source[key];
  if (typeof value !== "string" || value === "") throw new ParseError(`${what} has no ${key}`);
  return value;
};

const integer = (source: Record<string, unknown>, key: string, what: string): number => {
  const value = source[key];
  if (typeof value !== "number" || !Number.isInteger(value)) throw new ParseError(`${what} has no ${key}`);
  return value;
};

/**
 * One listing off a shop surface.
 *
 * **An absent `price` is `Unpriced`, not a failure**: whole categories carry
 * no price field, and a shop that lists a job or a flat alongside its stock
 * has listings the site renders no price for at all (SPEC 3.1). Every other
 * field is required, and its absence is a DOM change rather than a listing
 * without one (SPEC 5.8).
 */
function readRow(value: unknown, index: number, now?: Date): ShopRow {
  const listing = record(value, `shop listing ${index}`);
  const ad_id = String(integer(listing, "id", `shop listing ${index}`));
  const what = `shop listing ${ad_id}`;
  const price = listing["price"];
  if (price !== undefined && typeof price !== "string") throw new ParseError(`${what} has an unreadable price`);
  const tags = listing["tags"];
  if (tags !== undefined && !Array.isArray(tags)) throw new ParseError(`${what} has unreadable tags`);
  return {
    ad_id,
    url: new URL(string(listing, "url", what), ORIGIN).toString(),
    title: string(listing, "title", what),
    description: string(listing, "description", what),
    // `parsePrice` reads the rendered string, and the empty one it treats as
    // Unpriced is the same state the shop payload spells by leaving the field
    // out entirely.
    price: parsePrice(price ?? ""),
    location_name: string(listing, "location", what),
    posted: parsePostingDate(string(listing, "date", what), now),
    thumbnail: string(listing, "image", what),
    image_count: integer(listing, "imageCount", what),
    tags: (tags ?? []).map((tag, position) => {
      if (typeof tag !== "string") throw new ParseError(`${what} tag ${position} is not a string`);
      return tag;
    }),
  };
}

/**
 * The per-category breakdown the shop surface publishes beside its listings.
 *
 * **It is a breakdown of the answered query, not a fixed property of the
 * shop.** Unfiltered it names top-level categories and sums exactly to
 * `ads_online`; under a category filter it drops a level and names
 * subcategories of it. Only the unfiltered reading reaches a caller, which is
 * why `Shop.categories` can promise the sum (SPEC 4.3's correction).
 */
function readCategory(value: unknown, index: number): Category {
  const node = record(value, `shop category ${index}`);
  return {
    category_id: integer(node, "id", `shop category ${index}`),
    count: integer(node, "totalAds", `shop category ${index}`),
  };
}

/**
 * `now` is a seam, not a knob: `Heute` and `Gestern` resolve against the
 * **Berlin** calendar date, and a test needs to stand at 00:30 to prove it
 * (SPEC 3.2).
 */
export function readShopAds(value: unknown, now?: Date): ShopAds {
  const block = record(value, "the shop's inventory block");
  return {
    listings: list(block["ads"], "the shop's listings").map((ad, index) => readRow(ad, index, now)),
    categories: list(block["categoriesSearchData"], "the shop's category breakdown").map(readCategory),
  };
}
