import * as cheerio from "cheerio";
import { ParseError } from "../fetch/errors.ts";
import { parsePostingDate } from "./posting-date.ts";
import { parsePrice } from "./price.ts";
import { type SearchRow } from "./search-row.ts";
import { LISTINGS_PER_PAGE, ORIGIN } from "./search-url.ts";

/** What one fetched page yields, before the envelope and the caller's own arguments join it. */
export type SearchPage = {
  listings: SearchRow[];
  total: number | null;
  range: { from: number; to: number } | null;
  clamped: boolean;
  organic_count: number;
  promoted_count: number;
};

export type ParseOptions = {
  /** The page that was asked for. The clamp is detected against this and nothing else. */
  page: number;
  /** Whether §5.7's `1 - 1 von 1` signature would be garbage rather than data for this query. */
  degenerate_form: boolean;
  /** The clock `Heute` and `Gestern` resolve against, in Berlin. */
  now?: Date;
};

/** `Cheerio<Element>`, spelled without reaching past cheerio into `domhandler`. */
type Row = ReturnType<ReturnType<cheerio.CheerioAPI["root"]>["find"]>;

/**
 * `N - M von T`, and **the numbers only**.
 *
 * The trailing noun phrase in this same span is a live label bug — `/s-sammeln/c234`
 * renders `… von 2.293.257 Comics in Deutschland` for a different category — so
 * it is never parsed, and neither is `rel="canonical"`, a facet pre-count or an
 * applied-filter chip (SPEC 5.5).
 */
const SUMMARY = /(\d[\d.]*)\s*-\s*(\d[\d.]*)\s+von\s+(\d[\d.]*)/u;

/** German grouping, as the summary and the row counters write it. */
const count = (text: string): number => Number(text.replaceAll(".", ""));

const text = (node: Row): string => node.text().replace(/\s+/gu, " ").trim();

/** `13353 Wedding (3 km)`, or `14482 Potsdam (ca. 20 km)`, or neither half of it. */
function parseWhere(rendered: string): {
  postcode: string | null;
  location_name: string | null;
  distance_km: number | null;
} {
  const collapsed = rendered.replace(/\s+/gu, " ").trim();
  const distance = /\((?:ca\.\s*)?([\d.,]+)\s*km\)\s*$/u.exec(collapsed);
  const place = (distance === null ? collapsed : collapsed.slice(0, distance.index)).trim();
  const postcode = /^(\d{5})\b\s*/u.exec(place);
  const name = (postcode === null ? place : place.slice(postcode[0].length)).trim();
  return {
    postcode: postcode?.[1] ?? null,
    location_name: name === "" ? null : name,
    distance_km:
      distance === null ? null : Number(distance[1]!.replaceAll(".", "").replace(",", ".")),
  };
}

/**
 * The ~200-character description the row's `ld+json` carries, which is longer
 * than the visible snippet (SPEC 5.1).
 *
 * A picture-less row has no `ld+json` at all — the block describes the image —
 * so the visible snippet is the fallback rather than a parse failure.
 */
function description($: cheerio.CheerioAPI, article: Row): string {
  const block = article.find("script[type='application/ld+json']").first();
  if (block.length > 0) {
    try {
      const payload = JSON.parse(block.text()) as { description?: unknown };
      if (typeof payload.description === "string") return payload.description;
    } catch {
      throw new ParseError("a row's ld+json is not JSON");
    }
  }
  return text(article.find("p.aditem-main--middle--description").first());
}

function parseRow($: cheerio.CheerioAPI, article: Row, promoted: boolean, now?: Date): SearchRow {
  const ad_id = article.attr("data-adid");
  const href = article.attr("data-href");
  if (ad_id === undefined || href === undefined) throw new ParseError("a row lost its ad id");

  const title = text(article.find("h2 a").first());
  if (title === "") throw new ParseError(`row ${ad_id} has no title`);

  const priced = article.find("p.aditem-main--middle--price-shipping--price").first();
  const wasPriced = article.find("p.aditem-main--middle--price-shipping--old-price").first();
  const posted = text(article.find(".aditem-main--top--right").first());
  const image = article.find(".aditem-image img").first();
  const counter = text(article.find(".galleryimage--counter").first());
  const tags = article
    .find("span.simpletag")
    .toArray()
    .map((tag) => text($(tag)));

  return {
    ad_id,
    url: new URL(href, ORIGIN).toString(),
    title,
    description: description($, article),
    price: parsePrice(priced.text()),
    // A price drop appears only where the site renders one (SPEC 3.1).
    ...(wasPriced.length > 0 ? { old_price: parsePrice(wasPriced.text()) } : {}),
    // `postcode`, `location_name` and the distance that renders only under an
    // active radius all come off one line (SPEC 3.3).
    ...parseWhere(text(article.find(".aditem-main--top--left").first())),
    // A TOP row carries no date cell at all — see SPEC §3.3's correction.
    posted: posted === "" ? null : parsePostingDate(posted, now),
    thumbnail: image.attr("src") ?? null,
    // The counter is the total; a single-image row renders none at all.
    image_count: counter !== "" ? count(counter) : image.length > 0 ? 1 : 0,
    shipping: tags.includes("Versand möglich"),
    // **Never `isWantedAdType`** — the JS flag is broken and reads false on
    // confirmed want listings. The row's `Gesuch` tag is the reading (SPEC 5.1).
    listing_type: tags.includes("Gesuch") ? "WANTED" : "OFFER",
    promoted,
  };
}

/**
 * One search results page as a domain object.
 *
 * Three things here are the whole point of the tool, and each is a number
 * rather than a caveat:
 *
 * - **The stated total and the reachable ceiling stay separate.** Collapsing
 *   them into `min(stated, 1250)` is exactly the "25 results vs 25 of 40 000"
 *   failure this surface exists to avoid — the ceiling joins the result in the
 *   tool, beside the total (SPEC 2.4, 4.1).
 * - **Clamp detection is stateless.** Page N's honest range starts at
 *   `(N − 1) × 25 + 1`; a reported start that differs means the site silently
 *   re-served an earlier page. No previous page and no query-scoped state, so
 *   it coexists with ADR-0002. **Depth is never inferred from row counts** — a
 *   clamped page is full (SPEC 2.4).
 * - **An empty listing array is a normal result**, which is only safe because a
 *   block is never an empty list (SPEC 5.4, 5.6, 6.3).
 */
export function parseSearchPage(body: string, options: ParseOptions): SearchPage {
  const $ = cheerio.load(body);

  const summary = $("span.breadcrump-summary").first();
  if (summary.length === 0) throw new ParseError("no span.breadcrump-summary on the page");
  const numbers = SUMMARY.exec(text(summary));

  const table = $("#srchrslt-adtable");
  if (table.length === 0) {
    // No results container and no range: the honest empty set (SPEC 5.6).
    if (numbers !== null) throw new ParseError("a summary range with no #srchrslt-adtable");
    return {
      listings: [],
      total: 0,
      range: null,
      clamped: false,
      organic_count: 0,
      promoted_count: 0,
    };
  }
  if (numbers === null) throw new ParseError("no `N - M von T` numbers in span.breadcrump-summary");

  const listings: SearchRow[] = [];
  table.find("> li.ad-listitem").each((_, slot) => {
    const li = $(slot);
    const article = li.find("article.aditem[data-adid]").first();
    // 5–8 slots per page carry no ad id. They are ad banners, not listings, and
    // they are dropped **silently** (SPEC 5.1).
    if (article.length === 0) return;
    listings.push(parseRow($, article, li.hasClass("is-topad"), options.now));
  });

  const range = { from: count(numbers[1]!), to: count(numbers[2]!) };
  const total = count(numbers[3]!);

  if (options.degenerate_form && total === 1 && range.from === 1 && range.to === 1) {
    // `1 - 1 von 1` from a bare category or location is known garbage, not a
    // result: that query holds thousands of listings (SPEC 5.7).
    throw new ParseError("the degenerate `1 - 1 von 1` signature, which is garbage rather than data");
  }

  const promoted_count = listings.filter((listing) => listing.promoted).length;
  return {
    listings,
    total,
    range,
    clamped: range.from !== (options.page - 1) * LISTINGS_PER_PAGE + 1,
    organic_count: listings.length - promoted_count,
    promoted_count,
  };
}
