import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ParseError } from "../fetch/errors.ts";
import { parseShopAds } from "./parse-shop-ads.ts";
import { ShopRowSchema } from "./shop.ts";

const fixture = (name: string): string =>
  readFileSync(new URL(`../../tests/fixtures/${name}.json`, import.meta.url), "utf8");

const NOW = new Date("2026-08-25T12:00:00Z");

describe("a deeper page of a shop's inventory, read off the RPC", () => {
  it("reads the page the shop page itself cannot serve", () => {
    // `?pageNum=2` returns a byte-identical page 1 and the path form 404s, so
    // this is the only surface a page 2 exists on (SPEC 5.2).
    const { listings } = parseShopAds(fixture("shop-ads-page-2"), NOW);
    expect(listings).toHaveLength(5);
    for (const row of listings) ShopRowSchema.parse(row);
    expect(listings[0]).toMatchObject({
      ad_id: "3400000000",
      title: "Synthetisches Inserat 0",
      price: { kind: "Fixed", amount: 60 },
      posted: { value: "2026-07-29", precision: "day" },
      image_count: 8,
      tags: ["41"],
    });
  });

  it("gives every row the same place where the encoding stored it once", () => {
    const { listings } = parseShopAds(fixture("shop-ads-page-2"), NOW);
    expect(new Set(listings.map((row) => row.location_name)).size).toBe(1);
  });

  it("terminates cleanly past the end, as an answer and not an error", () => {
    // Page 3 of a 30-listing shop: `ads: []` in 444 bytes. An empty page is
    // the walk having ended (SPEC 5.2, 6.3).
    expect(parseShopAds(fixture("shop-ads-empty"), NOW)).toEqual({ listings: [] });
  });

  it("refuses an empty body rather than reporting an empty inventory", () => {
    // The RPC answers an unknown `brandName` with HTTP 204 and no body. Read
    // as zero listings it would report an empty shop nobody looked at
    // (SPEC 4.5).
    expect(() => parseShopAds("", NOW)).toThrow(ParseError);
    expect(() => parseShopAds("<html>", NOW)).toThrow(ParseError);
  });

  it("shouts where a listing lost a field the encoding always carries", () => {
    expect(() => parseShopAds(JSON.stringify([{ ads: 1, categoriesSearchData: 3 }, [2], {}, []]), NOW)).toThrow(
      ParseError,
    );
  });
});
