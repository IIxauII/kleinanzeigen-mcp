import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ParseError } from "../fetch/errors.ts";
import { ListingResultSchema, type Listing } from "./listing.ts";
import { listingUrl } from "./listing-url.ts";
import { parseListingPage } from "./parse-listing-page.ts";

const fixture = (name: string): string =>
  readFileSync(new URL(`../../tests/fixtures/${name}.html`, import.meta.url), "utf8");

/** Every fixture's ad id is its position in the capture, redacted (SPEC 8.6). */
const AD_IDS = {
  "listing-private-offer": "3400000000",
  "listing-commercial": "3400000001",
  "listing-wanted": "3400000002",
  "listing-unpriced": "3400000003",
  "listing-giveaway-veiled": "3400000004",
} as const;

function parse(name: keyof typeof AD_IDS, body = fixture(name)): Listing {
  const ad_id = AD_IDS[name];
  const result = parseListingPage(body, { finalUrl: listingUrl(ad_id), ad_id });
  expect(ListingResultSchema.parse(result).status).toBe("ok");
  if (result.status !== "ok") throw new Error("unreachable");
  return result;
}

describe("one listing, read off its detail page", () => {
  it("reads the listing every field of the type is on", () => {
    const listing = parse("listing-private-offer");
    expect(listing).toMatchObject({
      ad_id: "3400000000",
      url: "https://www.kleinanzeigen.de/s-anzeige/synthetisches-inserat-0/3400000000-217-4070",
      title: "Synthetisches Inserat 0",
      price: { kind: "Fixed", amount: 730 },
      category_id: 217,
      location_id: 4070,
      postcode: "10000",
      location_name: "Königsbrück",
      posted: { value: "2026-08-24", precision: "day" },
      listing_type: "OFFER",
      image_count: 12,
    });
    expect(listing.description).toContain("Zweiter Absatz");
  });

  it("reads the posting date at day precision, which is all this surface has", () => {
    // The same listing is minute-precise in a search results page. The
    // discriminant is what keeps `18.08.2026` from claiming midnight (SPEC 3.2).
    for (const name of Object.keys(AD_IDS) as (keyof typeof AD_IDS)[]) {
      expect(parse(name).posted.precision).toBe("day");
    }
  });
});

describe("the attributes", () => {
  it("are verbatim German label and value pairs, in the order the page rendered them", () => {
    // No key mapping: `autos.km_i` and `global.zustand` are not in this DOM,
    // and a half-populated typed field is worse than an honest untyped one
    // (SPEC 3.3).
    expect(parse("listing-private-offer").attributes).toEqual([
      { label: "Art", value: "Damen" },
      { label: "Typ", value: "Cityräder" },
      { label: "Zustand", value: "Sehr Gut" },
    ]);
  });

  it("are empty where the category has none, which is not a failure", () => {
    expect(parse("listing-unpriced").attributes).toEqual([]);
  });
});

describe("the images", () => {
  it("are exactly what the page gave, at the size the page gave", () => {
    // No size-grammar rewriting: stripping `rule=` would mean owning a URL
    // vocabulary we neither control nor version (SPEC 3.3).
    const listing = parse("listing-private-offer");
    expect(listing.images).toHaveLength(12);
    expect(listing.images[0]).toBe(
      "https://img.kleinanzeigen.de/api/v1/prod-ads/images/00/00000000-0000-4000-8000-000000000000?rule=$_59.AUTO",
    );
    expect(listing.images.every((image) => image.includes("rule=$_59.AUTO"))).toBe(true);
    expect(listing.image_count).toBe(12);
  });

  it("leaves out the thumbnail strip, which is the same pictures at another size", () => {
    expect(parse("listing-private-offer").images.some((image) => image.includes("$_1.AUTO"))).toBe(false);
  });

  it("is an empty gallery on a listing with no pictures", () => {
    expect(parse("listing-unpriced")).toMatchObject({ images: [], image_count: 0 });
  });
});

describe("the price", () => {
  it("is a negotiable price with no amount where the page shows a bare VB", () => {
    // Structurally unconfusable with a giveaway: different variants, not one
    // variant with a missing number (SPEC 3.1).
    expect(parse("listing-wanted").price).toEqual({ kind: "Negotiable" });
  });

  it("is Unpriced where the category has no price field, never a parse failure", () => {
    expect(parse("listing-unpriced").price).toEqual({ kind: "Unpriced" });
  });

  it("is a giveaway where the site says so", () => {
    expect(parse("listing-giveaway-veiled").price).toEqual({ kind: "Giveaway" });
  });

  it("refuses a page whose two price sources disagree", () => {
    // The rendered string and `adPriceType` are independent readings of one
    // value, and a page where they part ways is a page this parser no longer
    // understands (SPEC 5.8).
    const doctored = fixture("listing-private-offer").replace("adPriceType: 'FIXED'", "adPriceType: 'GIVE_AWAY'");
    expect(() => parse("listing-private-offer", doctored)).toThrow(ParseError);
  });
});

describe("the listing states", () => {
  it("are three flags, and reads a veil the live page actually sets", () => {
    // `showDeletedVeil: true` came off a page still being served — the flags
    // are not the "always false" prior research assumed (SPEC 3.4).
    expect(parse("listing-giveaway-veiled").flags).toEqual({
      expired: false,
      paused: false,
      deleted_veil: true,
    });
    expect(parse("listing-private-offer").flags).toEqual({
      expired: false,
      paused: false,
      deleted_veil: false,
    });
  });

  it("read expired and paused off the same init", () => {
    const doctored = fixture("listing-private-offer")
      .replace("adExpired:false", "adExpired:true")
      .replace("showPausedVeil: false", "showPausedVeil: true");
    expect(parse("listing-private-offer", doctored).flags).toMatchObject({ expired: true, paused: true });
  });

  it("carry no active member, and no reserved member", () => {
    // Active is observable only as the absence of everything else, and a
    // public page carries no reserved field at all (SPEC 3.4).
    const flags = parse("listing-private-offer").flags;
    expect(Object.keys(flags).sort()).toEqual(["deleted_veil", "expired", "paused"]);
  });

  it("never reads the sold label as a status", () => {
    // `data-soldlabel` is the wording an ad *would* use if its seller marked
    // it sold. Kleinanzeigen publishes no sold state (SPEC 3.4).
    const listing = parse("listing-private-offer");
    expect(JSON.stringify(listing)).not.toContain("Verkauft");
    expect(listing).not.toHaveProperty("sold");
  });
});

describe("the listing type", () => {
  it("reads a want listing off the sold label, never off the broken JS flag", () => {
    // `isWantedAdType` is `false` in this very fixture's init, on a listing
    // whose label is `Gefunden` (SPEC 5.1).
    expect(fixture("listing-wanted")).toContain("isWantedAdType: false");
    expect(parse("listing-wanted").listing_type).toBe("WANTED");
  });

  it("reads everything else as an offer", () => {
    expect(parse("listing-private-offer").listing_type).toBe("OFFER");
    expect(parse("listing-giveaway-veiled").listing_type).toBe("OFFER");
  });

  it("refuses a page with no sold label at all", () => {
    // Want listings are ~0.5% of inventory, so a missing label read as OFFER
    // would be right often enough to hide that the marker had moved.
    const doctored = fixture("listing-wanted").replace(' data-soldlabel="Gefunden"', "");
    expect(() => parse("listing-wanted", doctored)).toThrow(ParseError);
  });
});

describe("the seller", () => {
  it("is a private seller with an id, a tenure and badges", () => {
    expect(parse("listing-private-offer").seller).toEqual({
      seller_id: 21000000,
      seller_type: "PRIVATE",
      name: "Musterverkäufer 0",
      shop_slug: null,
      member_since: "2014-06",
      badges: ["TOP Zufriedenheit", "Besonders freundlich", "Sehr zuverlässig"],
    });
  });

  it("is a commercial seller with a shop slug, kept exactly as written", () => {
    // Case-sensitive, and the numeric suffix is part of the address: two
    // sellers can share a name (SPEC 3.5).
    expect(parse("listing-commercial").seller).toMatchObject({
      seller_type: "COMMERCIAL",
      shop_slug: "Synthetisches-Musterhaus-GmbH-1",
      member_since: "2018-10",
    });
  });

  it("reads a commercial seller's id from the one element that carries it", () => {
    // A commercial listing has no `userId` link at all; the id sits on the
    // imprint dialog's policy-documents element, and matches the shop page's
    // own `sellerId`.
    expect(parse("listing-commercial").seller.seller_id).toBe(21000001);
  });

  it("says unknown rather than private where the page does not say", () => {
    const doctored = fixture("listing-private-offer").replace("isCommercialUser: false,", "");
    expect(parse("listing-private-offer", doctored).seller.seller_type).toBeNull();
  });

  it("has no shop slug on a private seller, because there is no shop page", () => {
    expect(parse("listing-wanted").seller.shop_slug).toBeNull();
  });
});

describe("the ids in the URL", () => {
  it("reads the third number as the location id, never as a user id", () => {
    // The seller id is 21000000 on this fixture; 4070 is where the listing is
    // (SPEC 3.3, CONTEXT.md).
    const listing = parse("listing-private-offer");
    expect(listing).toMatchObject({ category_id: 217, location_id: 4070 });
    expect(listing.seller.seller_id).not.toBe(4070);
  });

  it("agrees with the category the init states, which is a second source for it", () => {
    for (const [name, ad_id] of Object.entries(AD_IDS) as [keyof typeof AD_IDS, string][]) {
      const stated = /adL2CategoryId: '(\d+)'/u.exec(fixture(name));
      expect(String(parse(name).category_id), `${name} (${ad_id})`).toBe(stated?.[1]);
    }
  });
});

describe("the deleted-ad guard", () => {
  it("answers gone when the redirects came to rest somewhere that is not a listing", () => {
    // The nastiest failure mode on the board, because it looks like data: a
    // missing listing 301s to a browse page and answers 200 with a full page
    // of *other* listings (SPEC 5.3).
    const otherListings = fixture("search-page-1");
    expect(
      parseListingPage(otherListings, {
        finalUrl: "https://www.kleinanzeigen.de/s-fahrraeder/weisswasser/c217l4069",
        ad_id: "1000000000",
      }),
    ).toEqual({ status: "gone" });
  });

  it("parses nothing at all once it has said gone", () => {
    // Not even a page that would throw on every anchor it looked for.
    expect(parseListingPage("", { finalUrl: "https://www.kleinanzeigen.de/", ad_id: "1000000000" })).toEqual({
      status: "gone",
    });
  });

  it("refuses a response that cannot say where it ended up, rather than calling it gone", () => {
    // "We could not tell" is a failure; only "we looked, and it is not a
    // listing" is an answer.
    expect(() =>
      parseListingPage(fixture("listing-wanted"), { finalUrl: "", ad_id: "3400000002" }),
    ).toThrow(ParseError);
  });

  it("refuses a listing page that is not the listing that was asked for", () => {
    // Landing on a *different* listing is the same failure the guard exists
    // for, one redirect further along.
    expect(() =>
      parseListingPage(fixture("listing-wanted"), {
        finalUrl: listingUrl("3400000000"),
        ad_id: "3400000000",
      }),
    ).toThrow(ParseError);
  });
});

describe("what a page that has moved does", () => {
  it("shouts rather than returning a listing with holes in it", () => {
    for (const gone of ["#viewad-title", "#viewad-locality", "#viewad-extra-info", "#viewad-profile-box"]) {
      const doctored = fixture("listing-private-offer").replace(gone.slice(1), "viewad-moved-on");
      expect(() => parse("listing-private-offer", doctored), gone).toThrow(ParseError);
    }
  });
});
