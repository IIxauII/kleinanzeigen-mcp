import { ParseError } from "../fetch/errors.ts";
import { decodeFlattened } from "./flattened.ts";
import { readShopAds } from "./shop-ads.ts";
import type { ShopRow } from "./shop.ts";

/**
 * A deeper page of a shop's inventory, off the RPC (SPEC 4.3, 5.2).
 *
 * **The shop page itself does not paginate.** `?pageNum=2` and `?page=2` both
 * return a byte-identical page 1 and `/pro/<slug>/seite:2` answers 404, so a
 * Decathlon-sized shop would be capped at 25 of 170 by the page alone. Paging
 * is this RPC or nothing.
 *
 * **Paging past the end terminates cleanly and is reported as such**: page 3
 * of a 30-listing shop answers HTTP 200 with `ads: []` in 444 bytes, and an
 * empty page is an answer — the walk has ended — not an error and not a
 * missing page (SPEC 5.2, 6.3).
 */
export function parseShopAds(body: string, now?: Date): { listings: ShopRow[] } {
  if (body.trim() === "") {
    // The RPC answers an unknown `brandName` with HTTP 204 and a zero-byte
    // body. The request path refuses a 204 outright (SPEC 4.5's rule, applied
    // once in `fetch/core.ts`), so an empty body reaching here at any other
    // status is the encoding having changed under us.
    throw new ParseError("the shop inventory RPC answered with an empty body");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new ParseError("the shop inventory RPC did not answer with JSON");
  }
  const { listings } = readShopAds(decodeFlattened(payload), now);
  return { listings };
}
