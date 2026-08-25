import { ParseError } from "../fetch/errors.ts";
import type { ListingFlags } from "./listing.ts";

/**
 * The keys this reader takes out of `Belen.Search.ViewAdView.init({…})`, which
 * is the listing detail page's richest single source (SPEC 5.1).
 *
 * Exported so the fixture capture keeps exactly these lines and no others: a
 * fixture carrying the whole init would carry login URLs and CSRF tokens with
 * it.
 */
export const INIT_KEYS = [
  "adId",
  "adPriceType",
  "adPrice",
  "adExpired",
  "showPausedVeil",
  "showDeletedVeil",
  "isCommercialUser",
] as const;

/**
 * The site's own spelling of a price's shape, `''` included: the empty one is
 * a category with no price field, which is a state rather than an absence
 * (SPEC 3.1).
 *
 * A union rather than a `string`, so the one `switch` that reads it is
 * exhaustive at compile time and an unknown fifth value fails here — at the
 * reading — instead of somewhere downstream (SPEC 8.1).
 */
export const PRICE_TYPES = ["FIXED", "NEGOTIABLE", "GIVE_AWAY", ""] as const;

export type PriceType = (typeof PRICE_TYPES)[number];

export type ViewAdInit = {
  ad_id: string;
  price_type: PriceType;
  price_amount: number | null;
  /** `null` where the page does not say — a seller type that cannot be read is unknown (SPEC 3.5). */
  commercial: boolean | null;
  flags: ListingFlags;
};

/**
 * The init call, and **only** what is inside it.
 *
 * Scoping matters: a detail page carries other listings at the foot of it —
 * the seller's, and the related ones — each with markup of its own, so a value
 * read off the whole body could belong to a listing nobody asked for.
 */
export const VIEW_AD_INIT = /Belen\.Search\.ViewAdView\.init\(\{([\s\S]*?)\n\s*\}\);/u;

/** The site quotes strings both ways inside one call, and spaces them both ways too. */
const readString = (block: string, key: string): string | null =>
  new RegExp(`\\b${key}\\s*:\\s*(?:'([^']*)'|"([^"]*)")`, "u").exec(block)?.slice(1).find((value) => value !== undefined) ?? null;

const readBoolean = (block: string, key: string): boolean | null => {
  const read = new RegExp(`\\b${key}\\s*:\\s*(true|false)\\b`, "u").exec(block);
  return read === null ? null : read[1] === "true";
};

/** `adPrice: 730.00`, or `adPrice: null` where the listing states no amount. */
const readAmount = (block: string, key: string): number | null => {
  const read = new RegExp(`\\b${key}\\s*:\\s*(null|\\d+(?:\\.\\d+)?)`, "u").exec(block);
  return read === null || read[1] === "null" ? null : Number(read[1]);
};

/** A flag that is gone is a state claimed rather than observed, so it is loud (SPEC 5.8). */
function flag(block: string, key: string): boolean {
  const read = readBoolean(block, key);
  if (read === null) throw new ParseError(`the JS init carries no ${key}`);
  return read;
}

/**
 * The detail page's JS init as typed values (SPEC 5.1).
 *
 * **`isWantedAdType` is not among them, and never will be** — the flag reads
 * `false` on confirmed want listings, including the one captured as a fixture.
 * The listing type is read off `data-soldlabel` instead.
 */
export function readViewAdInit(body: string): ViewAdInit {
  const init = VIEW_AD_INIT.exec(body);
  if (init === null) throw new ParseError("no Belen.Search.ViewAdView.init({…}) on the page");
  const block = init[1]!;

  const ad_id = readString(block, "adId");
  if (ad_id === null) throw new ParseError("the JS init carries no adId");
  const price_type = readString(block, "adPriceType");
  if (price_type === null) throw new ParseError("the JS init carries no adPriceType");
  if (!(PRICE_TYPES as readonly string[]).includes(price_type)) {
    throw new ParseError(`unknown adPriceType ${JSON.stringify(price_type)}`);
  }

  return {
    ad_id,
    price_type: price_type as PriceType,
    price_amount: readAmount(block, "adPrice"),
    commercial: readBoolean(block, "isCommercialUser"),
    flags: {
      expired: flag(block, "adExpired"),
      paused: flag(block, "showPausedVeil"),
      deleted_veil: flag(block, "showDeletedVeil"),
    },
  };
}
