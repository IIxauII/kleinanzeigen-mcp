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

export type ViewAdInit = {
  ad_id: string;
  /** `FIXED` | `NEGOTIABLE` | `GIVE_AWAY` | `''`, the site's own spelling (SPEC 3.1). */
  price_type: string;
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
const INIT = /Belen\.Search\.ViewAdView\.init\(\{([\s\S]*?)\n\s*\}\);/u;

/** The site quotes strings both ways inside one call, and spaces them both ways too. */
const string = (block: string, key: string): string | null =>
  new RegExp(`\\b${key}\\s*:\\s*(?:'([^']*)'|"([^"]*)")`, "u").exec(block)?.slice(1).find((value) => value !== undefined) ?? null;

const boolean = (block: string, key: string): boolean | null => {
  const read = new RegExp(`\\b${key}\\s*:\\s*(true|false)\\b`, "u").exec(block);
  return read === null ? null : read[1] === "true";
};

/** `adPrice: 730.00`, or `adPrice: null` where the listing states no amount. */
const amount = (block: string, key: string): number | null => {
  const read = new RegExp(`\\b${key}\\s*:\\s*(null|\\d+(?:\\.\\d+)?)`, "u").exec(block);
  return read === null || read[1] === "null" ? null : Number(read[1]);
};

/** A flag that is gone is a state claimed rather than observed, so it is loud (SPEC 5.8). */
function flag(block: string, key: string): boolean {
  const read = boolean(block, key);
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
  const init = INIT.exec(body);
  if (init === null) throw new ParseError("no Belen.Search.ViewAdView.init({…}) on the page");
  const block = init[1]!;

  const ad_id = string(block, "adId");
  if (ad_id === null) throw new ParseError("the JS init carries no adId");
  const price_type = string(block, "adPriceType");
  if (price_type === null) throw new ParseError("the JS init carries no adPriceType");

  return {
    ad_id,
    price_type,
    price_amount: amount(block, "adPrice"),
    commercial: boolean(block, "isCommercialUser"),
    flags: {
      expired: flag(block, "adExpired"),
      paused: flag(block, "showPausedVeil"),
      deleted_veil: flag(block, "showDeletedVeil"),
    },
  };
}
