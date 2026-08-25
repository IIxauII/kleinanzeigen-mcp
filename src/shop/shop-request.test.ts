import { describe, expect, it } from "vitest";
import {
  GetShopArgsSchema,
  isFiltered,
  shopAdsRequest,
  shopPageUrl,
  SHOP_PAGE_SIZE,
} from "./shop-request.ts";

const args = (overrides: Record<string, unknown> = {}) =>
  GetShopArgsSchema.parse({ shop_slug: "Autohaus-CCC-GmbH", ...overrides });

describe("get_shop's arguments", () => {
  it("takes the slug byte for byte and never repairs it", () => {
    // The site resolves a slug case-insensitively, but a numeric collision
    // suffix is load-bearing, so nothing here tidies the handle (SPEC 3.5).
    expect(args().shop_slug).toBe("Autohaus-CCC-GmbH");
    expect(shopPageUrl("Autohaus-CCC-GmbH")).toBe("https://www.kleinanzeigen.de/pro/Autohaus-CCC-GmbH");
    expect(shopPageUrl("autohaus-meyer-gmbh-1")).not.toBe(shopPageUrl("Autohaus-Meyer-GmbH"));
  });

  it("refuses a pasted URL rather than deciding which part of it to believe", () => {
    for (const slug of ["/pro/a-shop", "a-shop?page=2", "a-shop#top", "https://www.kleinanzeigen.de/pro/a", "", ".", ".."]) {
      expect(GetShopArgsSchema.safeParse({ shop_slug: slug }).success).toBe(false);
    }
  });

  it("refuses an argument the surface does not have", () => {
    // Strict, for the reason the search surface is: an argument that does not
    // exist must not look answered (SPEC 2.6).
    expect(GetShopArgsSchema.safeParse({ shop_slug: "a-shop", page_size: 100 }).success).toBe(false);
    expect(GetShopArgsSchema.safeParse({ shop_slug: "a-shop", sort: "SORTING_DATE" }).success).toBe(false);
    expect(GetShopArgsSchema.safeParse({ shop_slug: "a-shop", poster_type: "COMMERCIAL" }).success).toBe(false);
  });

  it("does not expose the page size", () => {
    // Fixed in code at 25, which is what keeps page 1 off the island and
    // page 2 off the RPC from overlapping (SPEC 4.3, 8.4).
    expect(SHOP_PAGE_SIZE).toBe(25);
    expect(Object.keys(GetShopArgsSchema.shape)).not.toContain("page_size");
  });
});

describe("the inventory RPC's request", () => {
  it("sends the page size and the page number the server chose", () => {
    expect(shopAdsRequest(args({ page: 4 }))).toEqual({
      url: "https://www.kleinanzeigen.de/_actions/proPublicWeb.brandProfile.getAds/",
      body: { brandName: "Autohaus-CCC-GmbH", pageSize: 25, pageNum: 4 },
    });
  });

  it("sends the price bounds as strings and the two ids as numbers", () => {
    // The action validates them that way and answers the other spelling with
    // HTTP 400 and a field-level complaint.
    expect(
      shopAdsRequest(
        args({ keywords: "kajak", category_id: 153, location_id: 24218, min_price: 20, max_price: 40 }),
      ).body,
    ).toEqual({
      brandName: "Autohaus-CCC-GmbH",
      keywords: "kajak",
      categoryId: 153,
      locationId: 24218,
      minPrice: "20",
      maxPrice: "40",
      pageSize: 25,
      pageNum: 1,
    });
  });

  it("knows a call that narrows the inventory from one that does not", () => {
    // It decides which surface answers: the shop page renders the first 25
    // listings unfiltered and nothing else, so a filtered page 1 is the RPC's.
    expect(isFiltered(args())).toBe(false);
    expect(isFiltered(args({ page: 2 }))).toBe(false);
    for (const filter of [
      { keywords: "x" },
      { category_id: 1 },
      { location_id: 1 },
      { min_price: 0 },
      { max_price: 5 },
    ]) {
      expect(isFiltered(args(filter))).toBe(true);
    }
  });
});
