import { ParseError } from "../fetch/errors.ts";
import { decodeFlattened } from "./flattened.ts";
import { integer, list, optionalString, record, string } from "./read.ts";
import { SHOP_PATH } from "./shop-request.ts";
import type { ShopCandidate } from "./shop.ts";

/**
 * A page of the shop directory (SPEC 4.5).
 *
 * The action answers in the **same flattened index table** the inventory RPC
 * uses, so there is no third decoder here — `decodeFlattened` undoes the
 * encoding and what is left is an ordinary object with `metadata` and
 * `brandingCards`.
 */
export type ShopDirectoryPage = {
  matches: ShopCandidate[];
  /** `metadata.totalHits` — **the whole match set, not this page** (SPEC 4.5). */
  count: number;
};

/**
 * `userId` is a **string** in this payload and a number on the shop page, and
 * the glossary is the tie-breaker: a seller id is the numeric identifier of a
 * seller, so both surfaces hand a caller the same kind of value and one shop
 * can be recognised across the two.
 *
 * Anything that is not a run of digits is **loud**. A seller id the encoding
 * has respelled must not arrive as a plausible number (SPEC 5.8).
 */
function readSellerId(value: unknown, what: string): number {
  if (typeof value !== "string" || !/^\d+$/u.test(value)) {
    throw new ParseError(`${what} states an unreadable userId ${JSON.stringify(value)}`);
  }
  const seller_id = Number(value);
  if (!Number.isSafeInteger(seller_id) || seller_id <= 0) {
    throw new ParseError(`${what} states an unreadable userId ${JSON.stringify(value)}`);
  }
  return seller_id;
}

/**
 * `urlExtension` is the whole path — `/pro/<slug>` — and the slug is the
 * segment after it, taken verbatim.
 *
 * A path that is not a shop page's is **loud rather than repaired**. Handing
 * back a slug carved out of `/s-anzeige/…` would send the caller's next
 * `get_shop` call at a listing, and guessing which part of an unexpected path
 * is the handle is exactly the guess §3.5 forbids.
 */
function readSlug(urlExtension: string, what: string): string {
  if (!urlExtension.startsWith(SHOP_PATH)) {
    throw new ParseError(`${what} states ${JSON.stringify(urlExtension)}, which is not a shop page`);
  }
  const shop_slug = urlExtension.slice(SHOP_PATH.length);
  if (shop_slug === "" || shop_slug.includes("/")) {
    throw new ParseError(`${what} states ${JSON.stringify(urlExtension)}, which is not one shop's handle`);
  }
  return shop_slug;
}

/**
 * One candidate.
 *
 * The name, the handle, the identity and the inventory count are required, and
 * their absence is the encoding having moved rather than a shop without one
 * (SPEC 5.8). **The logo and the location are genuinely optional** — a shop
 * that has published neither is a real shape — so they are `null` rather than a
 * stand-in and rather than a failure.
 */
function readCandidate(value: unknown, index: number): ShopCandidate {
  const what = `directory candidate ${index}`;
  const card = record(value, what);
  return {
    name: string(card, "title", what),
    shop_slug: readSlug(string(card, "urlExtension", what), what),
    seller_id: readSellerId(card["userId"], what),
    location: optionalString(card["location"]),
    ads_online: integer(card, "liveAds", what),
    logo_url: optionalString(card["logoUrl"]),
  };
}

export function parseShopDirectory(body: string): ShopDirectoryPage {
  if (body.trim() === "") {
    // The action answers a `pageSize` past its ceiling with HTTP 204 and a
    // zero-byte body. The request path refuses a 204 outright (SPEC 4.5's rule,
    // applied once in `fetch/core.ts`) and this server never sends a request
    // that provokes one, so an empty body reaching here at any other status is
    // the encoding having changed under us.
    throw new ParseError("the shop directory answered with an empty body");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new ParseError("the shop directory did not answer with JSON");
  }
  const page = record(decodeFlattened(payload), "the shop directory's answer");
  const metadata = record(page["metadata"], "the shop directory's metadata");
  return {
    matches: list(page["brandingCards"], "the shop directory's candidates").map(readCandidate),
    count: integer(metadata, "totalHits", "the shop directory's metadata"),
  };
}
