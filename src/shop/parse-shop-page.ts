import * as cheerio from "cheerio";
import { ParseError } from "../fetch/errors.ts";
import { islandProps } from "./island-props.ts";
import { optionalString } from "./read.ts";
import { readFinalUrl } from "./shop-request.ts";
import { readShopAds } from "./shop-ads.ts";
import type { Shop, ShopRow } from "./shop.ts";

export type ParseShopPageOptions = {
  /** Where the redirects came to rest. Read before anything else on the page is. */
  finalUrl: string;
  /** A seam, not a knob: `Heute` resolves against the Berlin date (SPEC 3.2). */
  now?: Date;
};

/**
 * Page 1 of a shop: **profile and the first 25 listings in one blob, one
 * request** (SPEC 4.3, 5.1).
 *
 * `gone` is a normal result, not an error — and here that is not a nicety, it
 * is the guard the surface needs. **An unknown slug answers HTTP 200 with a
 * complete, well-formed shop page**: `/pro/dieser-shop-gibt-es-nicht-xyz123`
 * returns 111 kB, renders the header and the footer, and carries a
 * `BrandProfilePage` island whose props are a profile-shaped object —
 * `adsOnline: 0`, `initialAds: null`, no `sellerId`, no `storeId`, and
 * **`sellerType: "commercial"` replaced by `"private"`**. That last field is
 * the trap: read on its own it says a private seller was found, when what
 * happened is that no seller was found at all.
 *
 * So the identity is the reading. A shop that does not name a `sellerId` is
 * not a shop, and nothing else on the page is parsed (SPEC 5.3's shape,
 * applied to the shop surface).
 */
export type ShopPage = { status: "ok"; shop: Shop; listings: ShopRow[] } | { status: "gone" };

/** The island that carries the inventory and most of the profile. */
const PROFILE_ISLAND = "BrandProfilePage";

/** The island that carries the two fields the profile island does not: the name and the logo. */
const ACTIONS_ISLAND = "ProfileActions";

/** The name's second source, for a page that renders no profile actions. */
const BADGES_ISLAND = "UserBadges";

/** `sellerType` as the site spells it on a shop page. Anything else is not a shop (SPEC 3.5). */
const COMMERCIAL = "commercial";

/**
 * `storeId` arrives as a string here and as a number nowhere — and it is *not*
 * the seller id, though the contact island labels it `sellerId`. That
 * mislabelling is the reason this reads only the profile island's spelling.
 *
 * **Absent is `null`; anything else is loud.** A shop without a store id is a
 * real shape, and `undefined` is how the page spells it. A `storeId` that
 * arrives as a *number* would be the encoding having moved, and reporting that
 * as "this shop has none" is exactly the silence §5.8 forbids.
 */
function readStoreId(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d+$/u.test(value)) {
    throw new ParseError(`the shop states an unreadable storeId ${JSON.stringify(value)}`);
  }
  const id = Number(value);
  return id > 0 ? id : null;
}

/** The profile prose, which the island nests one level down and a shop may not have at all. */
function readAbout(value: unknown): string | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return optionalString((value as Record<string, unknown>)["description"]);
}

export function parseShopPage(body: string, { finalUrl, now }: ParseShopPageOptions): ShopPage {
  // A response that cannot say where it ended up is a **failure**, never a
  // `gone`: only "we looked, and it is not a shop page" is an answer (SPEC 5.3).
  const landed = readFinalUrl(finalUrl);
  if (landed === "unreadable") {
    throw new ParseError(`the shop page came to rest at ${JSON.stringify(finalUrl)}, which is not the site`);
  }
  if (landed === "not-a-shop") return { status: "gone" };

  const $ = cheerio.load(body);
  const profile = islandProps($, PROFILE_ISLAND);
  if (profile === null) throw new ParseError(`no ${PROFILE_ISLAND} island on the shop page`);

  const seller_id = profile["sellerId"];
  if (typeof seller_id !== "number" || !Number.isInteger(seller_id) || seller_id <= 0) {
    return { status: "gone" };
  }
  // A page that names a seller and then denies they are commercial is a
  // contradiction rather than an answer, so it is **loud**. It is deliberately
  // not a second `gone`: the site changing this string's spelling would then
  // report every shop as missing, silently, which is the failure §5.8 exists
  // to keep visible.
  if (profile["sellerType"] !== COMMERCIAL) {
    throw new ParseError(`shop ${seller_id} says sellerType ${JSON.stringify(profile["sellerType"])}`);
  }

  const shop_slug = profile["brandName"];
  if (typeof shop_slug !== "string" || shop_slug === "") {
    throw new ParseError("the shop page names no slug");
  }
  const ads_online = profile["adsOnline"];
  if (typeof ads_online !== "number" || !Number.isInteger(ads_online) || ads_online < 0) {
    throw new ParseError(`shop ${shop_slug} states no ads_online`);
  }

  const actions = islandProps($, ACTIONS_ISLAND);
  const badges = islandProps($, BADGES_ISLAND);
  const name = optionalString(actions?.["title"]) ?? optionalString(badges?.["companyName"]);
  if (name === null) throw new ParseError(`shop ${shop_slug} names no company`);

  // **A shop with nothing online has no inventory block at all** — the same
  // `initialAds: null` the missing shop's page carries. Reading it as an empty
  // inventory is safe only *here*, past the identity guard, and only where the
  // shop agrees it has nothing: a `null` block on a shop stating listings is
  // the encoding having moved, and an empty list would hide it (SPEC 5.4, 5.8).
  const inventory = profile["initialAds"];
  const { listings, categories } =
    (inventory === null || inventory === undefined) && ads_online === 0
      ? { listings: [], categories: [] }
      : readShopAds(inventory, now);

  return {
    status: "ok",
    shop: {
      // The island echoes the slug that was asked for rather than a canonical
      // spelling of it, which is the same string this server sent and the same
      // string the caller gave. Nothing normalises it (SPEC 3.5).
      shop_slug,
      name,
      seller_id,
      store_id: readStoreId(profile["storeId"]),
      ads_online,
      about: readAbout(profile["about"]),
      logo_url: optionalString(actions?.["logoUrl"]),
      categories,
    },
    listings,
  };
}
