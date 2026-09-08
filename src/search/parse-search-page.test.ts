import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ParseError } from "../fetch/errors.ts";
import { parseSearchPage } from "./parse-search-page.ts";
import { ORIGIN } from "./search-url.ts";

/**
 * Captured live, minimised to the DOM the parser reads and redacted, by
 * `npm run capture:search-fixtures` (SPEC 8.6). Every count asserted below is
 * the live page's own: 34 slots, 27 of them listings, 2 of those promoted.
 */
const fixture = (name: string): string =>
  readFileSync(new URL(`../../tests/fixtures/${name}.html`, import.meta.url), "utf8");

/** Fixed so `Heute` and `Gestern` resolve against a known Berlin day. */
const NOW = new Date("2026-08-25T12:00:00Z");

const parse = (name: string, page = 1, degenerateForm = false) =>
  parseSearchPage(fixture(name), { page, degenerateForm, now: NOW });

describe("the rows of a search results page", () => {
  it("drops the slots that carry no ad id, silently", () => {
    // 34 `li.ad-listitem` on the live page, 7 of them ad banners (SPEC 5.1).
    const page = parse("search-page-1");
    expect(fixture("search-page-1").match(/class="ad-listitem/gu)).toHaveLength(34);
    expect(page.listings).toHaveLength(27);
    expect(page.listings.every((listing) => listing.ad_id !== "")).toBe(true);
  });

  it("carries every field the search-row type names", () => {
    const listing = parse("search-page-1").listings[3]!;
    expect(listing).toEqual({
      ad_id: "3400000004",
      url: "https://www.kleinanzeigen.de/s-anzeige/synthetisches-inserat-4/3400000004-217-0000",
      title: "Synthetisches Inserat 4",
      // The ~200-character text off the row's `ld+json`, not the shorter
      // visible snippet (SPEC 5.1).
      description: expect.stringContaining("Er ist lang genug"),
      price: { kind: "Negotiable", amount: 380 },
      old_price: { kind: "Fixed", amount: 450 },
      postcode: "10548",
      location_name: "Bad Grönenbach",
      posted: { value: "2026-08-25T14:14:00+02:00", precision: "minute" },
      thumbnail: expect.stringContaining("rule=$_2.AUTO"),
      image_count: 9,
      shipping: false,
      listing_type: "OFFER",
      promoted: false,
      // Rendered only under an active radius, which this page was fetched with.
      distance_km: 3,
    });
    expect(listing.description.length).toBeGreaterThan(190);
  });

  it("reads a distance the site hedged with `ca.`", () => {
    expect(parse("search-page-1").listings.map((listing) => listing.distance_km)).toContain(20);
  });

  it("leaves distance null where no radius was in play", () => {
    expect(parse("search-page-50").listings.every((listing) => listing.distance_km === null)).toBe(
      true,
    );
  });

  it("counts a row's images off the gallery counter, and a counterless row as one", () => {
    const counts = parse("search-page-1").listings.map((listing) => listing.image_count);
    expect(counts).toContain(18);
    expect(counts).toContain(1);
    expect(counts.every((count) => Number.isInteger(count) && count >= 0)).toBe(true);
  });

  it("falls back to the visible snippet on a picture-less row", () => {
    // Such a row carries no `ld+json`, because that block describes the image.
    // See SPEC §3.3's correction.
    const listing = parse("search-wanted").listings.find((row) => row.thumbnail === null)!;
    expect(listing.image_count).toBe(0);
    expect(listing.description).not.toBe("");
  });

  it("carries every one of the four price shapes off one real page", () => {
    const kinds = new Set(parse("search-wanted").listings.map((listing) => listing.price.kind));
    expect([...kinds].sort()).toEqual(["Fixed", "Giveaway", "Negotiable", "Unpriced"]);
  });

  it("keeps a bare VB as a negotiable price with no amount", () => {
    const bare = parse("search-wanted").listings.find(
      (listing) => listing.price.kind === "Negotiable" && listing.price.amount === undefined,
    );
    expect(bare).toBeDefined();
  });

  it("reads listing type off the Gesuch tag", () => {
    // **Never `isWantedAdType`** — the JS flag reads false on confirmed want
    // listings (SPEC 5.1).
    expect(parse("search-wanted").listings.every((l) => l.listing_type === "WANTED")).toBe(true);
    expect(parse("search-page-1").listings.every((l) => l.listing_type === "OFFER")).toBe(true);
  });

  it("never reads listing type off the broken isWantedAdType flag", () => {
    // The JS flag reads false on confirmed want listings, so a page that
    // asserts the opposite must not move a single row (SPEC 5.1).
    const doctored = fixture("search-page-1").replace(
      "</body>",
      "<script>Belen.Search.SrpView.init({isWantedAdType: true});</script></body>",
    );
    const page = parseSearchPage(doctored, { page: 1, degenerateForm: false, now: NOW });
    expect(page.listings.every((listing) => listing.listing_type === "OFFER")).toBe(true);
  });

  it("reads both posting-date precisions off one page", () => {
    const posted = parse("search-old-dates").listings.map((listing) => listing.posted);
    expect(posted).toContainEqual({ value: "2026-08-25T14:14:00+02:00", precision: "minute" });
    expect(posted).toContainEqual({ value: "2026-08-24T22:00:00+02:00", precision: "minute" });
    expect(posted).toContainEqual({ value: "2026-08-23", precision: "day" });
  });

  it("reads the unlinked heading the site renders on a sizeable minority of rows", () => {
    // `<h2><span class="ellipsis ref-not-linked" data-url="…">` rather than
    // `<h2><a href="…">`. Reading only the anchor made one such row a
    // `ParseError` that failed the whole page, and 9 of this fixture's 27 rows
    // are unlinked.
    const body = fixture("search-unlinked-title");
    expect(body.match(/ref-not-linked/gu)).toHaveLength(9);
    const page = parse("search-unlinked-title");
    expect(page.listings).toHaveLength(27);
    expect(page.listings.every((listing) => listing.title !== "")).toBe(true);
  });

  it("reads an unlinked row's url off the row, not off the heading it has no anchor for", () => {
    const page = parse("search-unlinked-title");
    expect(page.listings.every((listing) => listing.url.startsWith(`${ORIGIN}/s-anzeige/`))).toBe(
      true,
    );
  });
});

describe("TOP listings", () => {
  it("are returned flagged and in place, not dropped and not moved", () => {
    const { listings, organic_count, promoted_count } = parse("search-page-1");
    expect(listings.slice(0, 2).map((listing) => listing.promoted)).toEqual([true, true]);
    expect(listings.slice(2).some((listing) => listing.promoted)).toBe(false);
    // The envelope states the counts, so the caller never infers them from the
    // array length — which is 27 while the range reads 1 - 25 (SPEC 4.1).
    expect({ organic_count, promoted_count }).toEqual({ organic_count: 25, promoted_count: 2 });
    expect(listings).toHaveLength(27);
  });

  it("carry no posting date, which the row reports as null", () => {
    // See SPEC §3.3's correction: the site renders no date cell on a TOP row.
    const { listings } = parse("search-page-1");
    expect(listings.filter((listing) => listing.posted === null).map((l) => l.promoted)).toEqual([
      true,
      true,
    ]);
  });
});

describe("the results summary", () => {
  it("is read as numbers and nothing else", () => {
    expect(parse("search-page-1")).toMatchObject({ total: 39183, range: { from: 1, to: 25 } });
    expect(parse("search-page-50", 50)).toMatchObject({
      total: 931917,
      range: { from: 1226, to: 1250 },
    });
  });

  it("never reads the trailing noun phrase, which is a live label bug", () => {
    // `/s-sammeln/c234` renders `… von 2.293.257 Comics in Deutschland` for a
    // category that is not Comics. Nothing in the result may echo it (SPEC 5.5).
    const doctored = fixture("search-page-1").replace(
      /1 - 25 von 39\.183[^<]*/u,
      "1 - 25 von 2.293.257 Comics in Deutschland",
    );
    const page = parseSearchPage(doctored, { page: 1, degenerateForm: false, now: NOW });
    expect(page.total).toBe(2293257);
    expect(JSON.stringify(page)).not.toContain("Comics");
  });

  it("never reads a total off rel=\"canonical\" or a facet pre-count", () => {
    // Canonical lies about location scope, and the unfiltered `Direkt kaufen`
    // pre-count is a threefold overstatement. Every total comes off the
    // summary of the *filtered* request (SPEC 5.5).
    const doctored = fixture("search-page-1")
      .replace("<body>", '<body><link rel="canonical" href="/s-fahrrad/k0" />')
      .replace(
        "</body>",
        '<div class="browsebox"><span class="j-count">793.124</span></div></body>',
      );
    const page = parseSearchPage(doctored, { page: 1, degenerateForm: false, now: NOW });
    expect(page.total).toBe(39183);
  });
});

describe("the page-50 clamp", () => {
  it("is detected statelessly, from the page asked for and the range reported", () => {
    // Page 51 re-serves page 50 at HTTP 200 with a full, plausible page
    // (SPEC 2.4).
    expect(parse("search-page-51-clamped", 51).clamped).toBe(true);
    expect(parse("search-page-50", 50).clamped).toBe(false);
    expect(parse("search-page-1", 1).clamped).toBe(false);
  });

  it("needs no previous page: the same body clamps or does not by the page asked for", () => {
    const body = fixture("search-page-51-clamped");
    const options = { degenerateForm: false, now: NOW };
    expect(parseSearchPage(body, { ...options, page: 50 }).clamped).toBe(false);
    expect(parseSearchPage(body, { ...options, page: 51 }).clamped).toBe(true);
    expect(parseSearchPage(body, { ...options, page: 100 }).clamped).toBe(true);
  });

  it("never infers depth from row counts, because a clamped page is full", () => {
    const clamped = parse("search-page-51-clamped", 51);
    expect(clamped.clamped).toBe(true);
    expect(clamped.listings).toHaveLength(27);
    expect(clamped.organic_count).toBe(25);
  });
});

describe("an empty result", () => {
  it("is a normal result, not a failure", () => {
    // Safe only because §5.4 removed the block that presents the same way.
    expect(parse("search-empty")).toEqual({
      listings: [],
      total: 0,
      range: null,
      clamped: false,
      organic_count: 0,
      promoted_count: 0,
    });
  });
});

describe("the loud failures", () => {
  it("throws when the summary is gone", () => {
    const doctored = fixture("search-page-1").replaceAll("breadcrump-summary", "moved-on");
    expect(() => parseSearchPage(doctored, { page: 1, degenerateForm: false })).toThrow(ParseError);
  });

  it("throws when the summary carries no range", () => {
    const doctored = fixture("search-page-1").replace(/1 - 25 von 39\.183[^<]*/u, "Ergebnisse");
    expect(() => parseSearchPage(doctored, { page: 1, degenerateForm: false })).toThrow(ParseError);
  });

  it("throws when an organic row lost its date cell, which only a TOP row honestly lacks", () => {
    // A TOP row's empty date cell is normal; the same emptiness on an organic
    // row is a DOM change and must not arrive as null (SPEC 3.3's correction).
    const doctored = fixture("search-page-1").replaceAll(
      /<i class="icon icon-small icon-calendar-open"[^>]*><\/i>\s*(Heute|Gestern)[^\n<]*/gu,
      "",
    );
    expect(() => parseSearchPage(doctored, { page: 1, degenerateForm: false, now: NOW })).toThrow(
      /organic row \d+ has no posting date/u,
    );
  });

  it("throws when a row carries neither heading the site renders", () => {
    // Losing the anchor is the site's own unlinked variant and normal; losing
    // both it and the unlinked span is a DOM change, and shouts (SPEC 5.8).
    const doctored = fixture("search-unlinked-title").replaceAll(
      /<h2 class="text-module-begin">[\s\S]*?<\/h2>/gu,
      '<h2 class="text-module-begin"></h2>',
    );
    expect(() => parseSearchPage(doctored, { page: 1, degenerateForm: false, now: NOW })).toThrow(
      /row \d+ has no title/u,
    );
  });

  it("throws when a row has a description on neither surface", () => {
    const doctored = fixture("search-page-1")
      .replaceAll(/<script type="application\/ld\+json">[\s\S]*?<\/script>/gu, "")
      .replaceAll(/<p class="aditem-main--middle--description">[\s\S]*?<\/p>/gu, "");
    expect(() => parseSearchPage(doctored, { page: 1, degenerateForm: false, now: NOW })).toThrow(
      /has no description on either surface/u,
    );
  });

  it("throws when the results container is gone and the page never says nothing matched", () => {
    // Otherwise a renamed container would arrive as a quiet `total: 0` instead
    // of the loud failure a DOM change owes the operator (SPEC 5.8).
    const doctored = fixture("search-empty").replace("Es wurden keine Ergebnisse", "Ergebnisse");
    expect(() => parseSearchPage(doctored, { page: 1, degenerateForm: false })).toThrow(
      /does not say nothing matched/u,
    );
  });

  it("throws on the degenerate `1 - 1 von 1` signature, never returning it as data", () => {
    // A bare category or location holds thousands of listings, so exactly one
    // is not a number that query can honestly produce (SPEC 5.7).
    const doctored = fixture("search-page-1").replace(/1 - 25 von 39\.183[^<]*/u, "1 - 1 von 1");
    const options = { page: 1, now: NOW };
    expect(() => parseSearchPage(doctored, { ...options, degenerateForm: true })).toThrow(
      ParseError,
    );
    // The same page from a query that could honestly return one is data.
    expect(parseSearchPage(doctored, { ...options, degenerateForm: false }).total).toBe(1);
  });
});
