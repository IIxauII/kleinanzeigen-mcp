import * as cheerio from "cheerio";
import { text, type Selection } from "../dom.ts";
import { ParseError } from "../fetch/errors.ts";
import { log } from "../logging.ts";
import { parsePostingDate, type PostingDate } from "../search/posting-date.ts";
import { parsePrice, type Price } from "../search/price.ts";
import { collapse } from "../search/text.ts";
import { readFinalUrl } from "./listing-url.ts";
import type { ListingResult, Seller } from "./listing.ts";
import { readViewAdInit, type ViewAdInit } from "./view-ad-init.ts";

export type ParseOptions = {
  /** Where the redirects came to rest. The deleted-ad guard reads this and nothing else (SPEC 5.3). */
  finalUrl: string;
  /** The ad id that was asked for, which the page has to agree it is. */
  ad_id: string;
};

/** A node that has to be there: its absence is a DOM change, not a listing without one. */
function required($: cheerio.CheerioAPI, selector: string): Selection {
  const node = $.root().find(selector).first();
  if (node.length === 0) throw new ParseError(`no ${selector} on the listing detail page`);
  return node;
}

/**
 * The canonical URL, which is where **both** ids come from.
 *
 * `/s-anzeige/<slug>/<ad id>-<category id>-<location id>`, and **the third
 * number is the location id, not a user id** (SPEC 3.3, CONTEXT.md). Reading
 * the pair off one source is deliberate: the init states the category a second
 * time, and pairing a category from one source with a location from another
 * would produce a listing that was never anywhere.
 */
function canonical($: cheerio.CheerioAPI): {
  url: string;
  category_id: number | null;
  location_id: number | null;
} {
  const url = $('meta[property="og:url"]').first().attr("content");
  if (url === undefined) throw new ParseError("no og:url on the listing detail page");
  const codes = /\/\d+-(\d+)-(\d+)$/u.exec(new URL(url).pathname);
  // `…/<ad id>-0-0` and the bare `…/<ad id>` both carry no ids, and zero is
  // not one: a listing whose codes say nothing has nothing to say here.
  const id = (read: string | undefined): number | null => (read === undefined || read === "0" ? null : Number(read));
  return { url, category_id: id(codes?.[1]), location_id: id(codes?.[2]) };
}

/**
 * `02943 Sachsen - Weißwasser` — postcode, then the region and the locality.
 *
 * A real-estate listing prefixes a street, which has no field on this type and
 * is dropped rather than folded into the locality's name.
 */
function parseLocality(rendered: string): { postcode: string | null; location_name: string | null } {
  const parts = /\b(\d{5})\s+(.+)$/u.exec(collapse(rendered));
  if (parts === null) return { postcode: null, location_name: null };
  const names = parts[2]!.split(" - ");
  return { postcode: parts[1]!, location_name: collapse(names[names.length - 1]!) || null };
}

/**
 * The price, **from the JS init** — the source §3.1 names for this surface —
 * and held against the rendered string, which is a second reading of the same
 * value (SPEC 3.1, 5.8).
 *
 * The init carries the amount: `adPriceType` is the authoritative
 * discriminator and the rendered figure is rounded for display. The rendered
 * string carries a second opinion on the *shape*, and two readings that part
 * ways mean the page is not what this parser thinks it is.
 *
 * A rendering this parser cannot read at all is **not** that disagreement, and
 * does not fail the listing: the init has already said what the shape is, and
 * an unknown price *wording* is worth a shout on stderr rather than the whole
 * listing (SPEC 5.8, 6.4).
 */
function price(init: ViewAdInit, rendered: string): Price {
  const read = ((): Price => {
    switch (init.price_type) {
      case "FIXED":
        if (init.price_amount === null) throw new ParseError("a fixed price with no amount");
        return { kind: "Fixed", amount: init.price_amount };
      case "NEGOTIABLE":
        return init.price_amount === null
          ? { kind: "Negotiable" }
          : { kind: "Negotiable", amount: init.price_amount };
      case "GIVE_AWAY":
        return { kind: "Giveaway" };
      // The category has no price field, which is a normal state (SPEC 3.1).
      case "":
        return { kind: "Unpriced" };
    }
  })();

  let shown: Price;
  try {
    shown = parsePrice(rendered);
  } catch {
    log("price_unreadable", { level: "error", kind: read.kind });
    return read;
  }
  if (read.kind !== shown.kind) {
    throw new ParseError(`the init says ${read.kind} where the page renders ${shown.kind}`);
  }
  return read;
}

/**
 * The posting date, which this surface renders at **day precision only** — the
 * page carries no time at all (SPEC 3.2).
 *
 * The date is picked out of `#viewad-extra-info` rather than read as the whole
 * of it: the view counter shares that element, and it is filled in by script
 * after the page loads.
 */
function posted(rendered: string): PostingDate {
  const date = /\b(\d{2}\.\d{2}\.\d{4})\b/u.exec(collapse(rendered));
  if (date === null) throw new ParseError(`no posting date in ${JSON.stringify(collapse(rendered))}`);
  return parsePostingDate(date[1]!);
}

/**
 * The attribute list, **verbatim and in rendered order** (SPEC 3.3).
 *
 * A row whose value element has gone is a DOM change rather than an attribute
 * without a value: reading the whole row as a label would return a field that
 * is half there.
 */
function attributes($: cheerio.CheerioAPI): { label: string; value: string }[] {
  return $("#viewad-details .addetailslist--detail")
    .toArray()
    .map((row) => {
      const detail = $(row);
      const value = detail.find(".addetailslist--detail--value").first();
      if (value.length === 0) throw new ParseError(`the attribute ${JSON.stringify(text(detail))} has no value`);
      const label = collapse(detail.text().replace(value.text(), ""));
      if (label === "") throw new ParseError(`an attribute has no label`);
      return { label, value: text(value) };
    });
}

/**
 * The seller's id, from whichever of its two homes this page has (SPEC 3.5).
 *
 * A **private** seller's is in the link to their own listings; a
 * **commercial** seller has no such link, and theirs is on the element behind
 * the imprint dialog, where it matches their shop page's `sellerId`. `userId`
 * in the JS init is present and empty on both, and is never a source.
 */
function sellerId($: cheerio.CheerioAPI, box: Selection): number | null {
  const own = /[?&]userId=(\d+)\b/u.exec(box.find('a[href*="userId="]').first().attr("href") ?? "");
  if (own !== null) return Number(own[1]);
  const commercial = $("#viewad-commercial-policy-documents").first().attr("data-user-id") ?? "";
  return /^\d+$/u.test(commercial) ? Number(commercial) : null;
}

/** `Aktiv seit 24.06.2014` → `2014-06`. The day is not carried: `member_since` is a month. */
function memberSince(details: string[]): string | null {
  for (const detail of details) {
    const date = /^Aktiv seit (\d{2})\.(\d{2})\.(\d{4})$/u.exec(detail);
    if (date !== null) return `${date[3]}-${date[2]}`;
  }
  return null;
}

/**
 * The seller box (SPEC 3.5).
 *
 * The seller id lives in two different places and **neither is on both kinds
 * of page**: a private seller's is in the link to their own listings, and a
 * commercial seller's — who has no such link — is on the imprint dialog's
 * policy-documents element, where it matches their shop page's `sellerId`.
 */
function seller($: cheerio.CheerioAPI, init: ViewAdInit): Seller {
  const box = required($, "#viewad-profile-box");
  const details = box
    .find(".userprofile-vip-details-text")
    .toArray()
    .map((detail) => text($(detail)));

  const shop = /^\/pro\/([^/?#]+)/u.exec(box.find('a[href^="/pro/"]').first().attr("href") ?? "");

  return {
    seller_id: sellerId($, box),
    // **Never defaulted to a pole**: a seller type that cannot be read is
    // unknown, and "not commercial" is a weaker claim than "private".
    seller_type: init.commercial === null ? null : init.commercial ? "COMMERCIAL" : "PRIVATE",
    name: text(box.find(".userprofile-vip").first()) || null,
    // **Never normalised** — not lower-cased, not stripped of its suffix.
    shop_slug: shop?.[1] ?? null,
    member_since: memberSince(details),
    badges: box
      .find(".userbadge")
      .toArray()
      .map((badge) => text($(badge)))
      .filter((badge) => badge !== ""),
  };
}

/**
 * One listing detail page as a domain object, or the discriminant that says
 * there is no listing there any more.
 *
 * **The guard comes first, and nothing is parsed behind it** (SPEC 5.3). A
 * missing listing does not 404 and leaves no tombstone: it 301s to a browse
 * page synthesised from the URL's own codes, or to the homepage, and answers
 * HTTP 200 with a full page of *other* listings. Every anchor below would find
 * something on such a page; a detail-fetch tool without this guard returns the
 * wrong listing, confidently.
 *
 * The ad id is checked for the same reason, one redirect further along: the
 * page has to agree it is the listing that was asked for.
 */
export function parseListingPage(body: string, options: ParseOptions): ListingResult {
  const landed = readFinalUrl(options.finalUrl);
  // A response that cannot say where it ended up — no URL, or one on a host
  // that is not the site's — is a failure, not a gone: only "we looked, and it
  // is not a listing" is an answer (SPEC 6.3).
  if (landed === "unreadable") {
    throw new ParseError(`the response came to rest at ${JSON.stringify(options.finalUrl)}, which says nothing`);
  }
  if (landed === "not-a-listing") return { status: "gone" };

  const $ = cheerio.load(body);
  const init = readViewAdInit(body);
  if (init.ad_id !== options.ad_id) {
    throw new ParseError(`asked for listing ${options.ad_id} and was served ${init.ad_id}`);
  }

  const title = required($, "#viewad-title");
  // **The sold label is a listing *type* marker and never a status.**
  // Kleinanzeigen publishes no sold state; this attribute is the wording an ad
  // would use if its seller marked it sold. `Gefunden` is the one reading
  // taken from it, because `isWantedAdType` reads false on confirmed want
  // listings (SPEC 3.4, 5.1).
  const soldLabel = title.attr("data-soldlabel");
  if (soldLabel === undefined) throw new ParseError("no data-soldlabel on #viewad-title");

  const images = $("#viewad-product img#viewad-image")
    .toArray()
    .map((image) => $(image).attr("src"))
    .filter((image) => image !== undefined);

  return {
    status: "ok",
    ad_id: init.ad_id,
    ...canonical($),
    title: text(title),
    // The full text, with the line breaks the page preserves.
    description: required($, "#viewad-description-text").text().trim(),
    price: price(init, $("#viewad-price").first().text()),
    ...parseLocality(required($, "#viewad-locality").text()),
    posted: posted(required($, "#viewad-extra-info").text()),
    // **Exactly what the page gave**, large gallery URLs and all, with no
    // size-grammar rewriting (SPEC 3.3).
    images,
    // **Derived, and it has to be**: a search row states its count in
    // `.galleryimage--counter`, and the only counters on a detail page belong
    // to the *other* listings at the foot of it. The gallery is the count.
    image_count: images.length,
    listing_type: soldLabel === "Gefunden" ? "WANTED" : "OFFER",
    attributes: attributes($),
    seller: seller($, init),
    flags: init.flags,
  };
}
