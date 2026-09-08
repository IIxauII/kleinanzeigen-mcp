import * as cheerio from "cheerio";
import { text, type Selection } from "../dom.ts";
import { ParseError } from "../fetch/errors.ts";
import { parsePostingDate } from "./posting-date.ts";
import { parsePrice } from "./price.ts";
import { type SearchRow } from "./search-row.ts";
import { LISTINGS_PER_PAGE } from "./ceiling.ts";
import { ORIGIN } from "./search-url.ts";
import { collapse, germanNumber } from "./text.ts";

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
  degenerateForm: boolean;
  /** The clock `Heute` and `Gestern` resolve against, in Berlin. */
  now?: Date;
};

/**
 * `N - M von T`, and **the numbers only**.
 *
 * The trailing noun phrase in this same span is a live label bug — `/s-sammeln/c234`
 * renders `… von 2.293.257 Comics in Deutschland` for a different category — so
 * it is never parsed, and neither is `rel="canonical"`, a facet pre-count or an
 * applied-filter chip (SPEC 5.5).
 */
const SUMMARY = /(\d[\d.]*)\s*-\s*(\d[\d.]*)\s+von\s+(\d[\d.]*)/u;

/**
 * The site's own words for an empty result: `Es wurden keine Ergebnisse … gefunden`
 * (SPEC 5.6).
 *
 * This is a **positive** marker, not the absence of one. §5.5's rule forbids
 * reading an applied scope, filter or sort off the markup; it does not forbid
 * recognising the page the site renders when nothing matched — and requiring
 * that recognition is what keeps a renamed results container a loud parse
 * failure instead of a quiet "nothing matched" (SPEC 5.8).
 */
const NO_RESULTS = /Es wurden keine Ergebnisse/u;

/** `13353 Wedding (3 km)`, or `14482 Potsdam (ca. 20 km)`, or neither half of it. */
function parseWhere(rendered: string): {
  postcode: string | null;
  location_name: string | null;
  distance_km: number | null;
} {
  const collapsed = collapse(rendered);
  const distance = /\((?:ca\.\s*)?([\d.,]+)\s*km\)\s*$/u.exec(collapsed);
  const place = (distance === null ? collapsed : collapsed.slice(0, distance.index)).trim();
  const postcode = /^(\d{5})\b\s*/u.exec(place);
  const name = (postcode === null ? place : place.slice(postcode[0].length)).trim();
  return {
    postcode: postcode?.[1] ?? null,
    location_name: name === "" ? null : name,
    distance_km: distance === null ? null : germanNumber(distance[1]!),
  };
}

/**
 * The ~200-character description the row's `ld+json` carries, which is longer
 * than the visible snippet (SPEC 5.1).
 *
 * A **picture-less** row has no `ld+json` at all — the block describes the
 * image — so there the visible snippet is the reading rather than a parse
 * failure. Losing *both* is a DOM change, and shouts (SPEC 5.8).
 */
function description(article: Selection, ad_id: string): string {
  const block = article.find("script[type='application/ld+json']").first();
  if (block.length > 0) {
    try {
      const payload = JSON.parse(block.text()) as { description?: unknown };
      if (typeof payload.description === "string") return payload.description;
    } catch {
      throw new ParseError(`row ${ad_id}'s ld+json is not JSON`);
    }
  }
  const snippet = text(article.find("p.aditem-main--middle--description").first());
  if (snippet === "") throw new ParseError(`row ${ad_id} has no description on either surface`);
  return snippet;
}

/**
 * A **TOP row carries no date cell at all** — see SPEC §3.3's correction — so
 * `null` is its honest reading and nobody else's. An organic row that lost its
 * date lost it to a DOM change, and must not arrive looking promoted-shaped
 * (SPEC 5.8).
 */
function posting(rendered: string, promoted: boolean, ad_id: string, now?: Date) {
  if (rendered !== "") return parsePostingDate(rendered, now);
  if (promoted) return null;
  throw new ParseError(`organic row ${ad_id} has no posting date`);
}

/**
 * The row's title, off **either** heading the site renders: the linked
 * `<h2><a>`, and the unlinked `<h2><span class="ellipsis ref-not-linked">` it
 * uses for a sizeable minority of rows — 13 of 27 on `?keywords=ps5` — which
 * carries its target in `data-url` rather than an `href`.
 *
 * The unlinked form costs the parser nothing else: the row's own `data-href`
 * is what the URL is read from either way. Reading only the anchor turned this
 * variant into a `ParseError` that failed the **whole page**, since one
 * unreadable row fails the parse (SPEC 5.8).
 *
 * A row carrying neither heading did lose it to a DOM change, and shouts.
 */
function heading(article: Selection, ad_id: string): string {
  const title = text(article.find("h2 a, h2 span.ellipsis").first());
  if (title === "") throw new ParseError(`row ${ad_id} has no title`);
  return title;
}

function parseRow($: cheerio.CheerioAPI, article: Selection, promoted: boolean, now?: Date): SearchRow {
  const ad_id = article.attr("data-adid");
  const href = article.attr("data-href");
  if (ad_id === undefined || href === undefined) throw new ParseError("a row lost its ad id");

  const title = heading(article, ad_id);

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
    description: description(article, ad_id),
    price: parsePrice(priced.text()),
    // A price drop appears only where the site renders one (SPEC 3.1).
    ...(wasPriced.length > 0 ? { old_price: parsePrice(wasPriced.text()) } : {}),
    // `postcode`, `location_name` and the distance that renders only under an
    // active radius all come off one line (SPEC 3.3).
    ...parseWhere(text(article.find(".aditem-main--top--left").first())),
    posted: posting(posted, promoted, ad_id, now),
    thumbnail: image.attr("src") ?? null,
    // The counter is the total; a row with one image renders none at all, and
    // a picture-less row has no image either.
    image_count: /^\d[\d.]*$/u.test(counter) ? germanNumber(counter) : image.length > 0 ? 1 : 0,
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
    // No results container, no range, and the site saying so in its own words:
    // the honest empty set, which is safe to return as a real answer only
    // because a block is never an empty list (SPEC 5.4, 5.6).
    if (numbers !== null) throw new ParseError("a summary range with no #srchrslt-adtable");
    if (!NO_RESULTS.test(text(summary))) {
      throw new ParseError("no #srchrslt-adtable, and the page does not say nothing matched");
    }
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

  const range = { from: germanNumber(numbers[1]!), to: germanNumber(numbers[2]!) };
  const total = germanNumber(numbers[3]!);

  if (options.degenerateForm && total === 1 && range.from === 1 && range.to === 1) {
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
