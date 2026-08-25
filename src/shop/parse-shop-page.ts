import * as cheerio from "cheerio";
import { ParseError } from "../fetch/errors.ts";
import { SITE_HOSTS } from "../search/search-url.ts";
import { islandProps } from "./island-props.ts";
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

const SHOP_PATH = "/pro/";

/** The island that carries the inventory and most of the profile. */
const PROFILE_ISLAND = "BrandProfilePage";

/** The island that carries the two fields the profile island does not: the name and the logo. */
const ACTIONS_ISLAND = "ProfileActions";

/** The name's second source, for a page that renders no profile actions. */
const BADGES_ISLAND = "UserBadges";

/** `sellerType` as the site spells it on a shop page. Anything else is not a shop (SPEC 3.5). */
const COMMERCIAL = "commercial";

const optionalString = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;

/**
 * `storeId` arrives as a string here and as a number nowhere — and it is *not*
 * the seller id, though the contact island labels it `sellerId`. That
 * mislabelling is the reason this reads only the profile island's spelling.
 */
function readStoreId(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d+$/u.test(value)) return null;
  const id = Number(value);
  return id > 0 ? id : null;
}

/** The profile prose, which the island nests one level down and a shop may not have at all. */
function readAbout(value: unknown): string | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return optionalString((value as Record<string, unknown>)["description"]);
}

export function parseShopPage(body: string, { finalUrl, now }: ParseShopPageOptions): ShopPage {
  let host: string;
  let path: string;
  try {
    ({ host, pathname: path } = new URL(finalUrl));
  } catch {
    throw new ParseError(`the shop page came to rest at an unreadable URL ${JSON.stringify(finalUrl)}`);
  }
  // A response that cannot say where it ended up is a **failure**, never a
  // `gone`: only "we looked, and it is not a shop page" is an answer (SPEC 5.3).
  if (!SITE_HOSTS.has(host)) {
    throw new ParseError(`the shop page came to rest on ${host}, which is not the site`);
  }
  if (!path.startsWith(SHOP_PATH)) return { status: "gone" };

  const $ = cheerio.load(body);
  const profile = islandProps($, PROFILE_ISLAND);
  if (profile === null) throw new ParseError(`no ${PROFILE_ISLAND} island on the shop page`);

  const seller_id = profile["sellerId"];
  if (typeof seller_id !== "number" || !Number.isInteger(seller_id) || seller_id <= 0) {
    return { status: "gone" };
  }
  // Belt and braces on the same reading: a real shop page says `commercial`,
  // and the page a missing shop synthesises says `private`.
  if (profile["sellerType"] !== COMMERCIAL) return { status: "gone" };

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

  const { listings, categories } = readShopAds(profile["initialAds"], now);

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
