import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ParseError } from "../fetch/errors.ts";
import { parseShopPage, type ShopPage } from "./parse-shop-page.ts";
import { shopPageUrl } from "./shop-request.ts";
import { ShopRowSchema, ShopSchema } from "./shop.ts";

const fixture = (name: string): string =>
  readFileSync(new URL(`../../tests/fixtures/${name}.html`, import.meta.url), "utf8");

/** Every fixture's slug is the redacted one the capture wrote (SPEC 8.6). */
const SLUG = "Synthetisches-Musterhaus-GmbH-0";

const NOW = new Date("2026-08-25T12:00:00Z");

const parse = (name: string, finalUrl = shopPageUrl(SLUG)): ShopPage =>
  parseShopPage(fixture(name), { finalUrl, now: NOW });

function ok(name: string): Extract<ShopPage, { status: "ok" }> {
  const page = parse(name);
  if (page.status !== "ok") throw new Error(`${name} did not parse as a shop`);
  ShopSchema.parse(page.shop);
  for (const row of page.listings) ShopRowSchema.parse(row);
  return page;
}

describe("page 1 of a shop, read off the shop page's islands", () => {
  it("reads the profile and the first 25 listings out of one blob", () => {
    // Profile *and* inventory in one request is the whole reason page 1 is the
    // page rather than the RPC (SPEC 4.3, 5.1).
    const { shop, listings } = ok("shop-page");
    expect(shop).toEqual({
      shop_slug: SLUG,
      name: "Synthetisches Musterhaus GmbH 0",
      seller_id: 21000000,
      store_id: 60000,
      ads_online: 30,
      about: expect.stringContaining("Synthetischer Beschreibungstext"),
      logo_url: expect.stringContaining("?rule=$_12.JPG"),
      categories: [
        { category_id: 17, count: 4 },
        { category_id: 80, count: 1 },
        { category_id: 153, count: 6 },
        { category_id: 185, count: 13 },
        { category_id: 210, count: 6 },
      ],
    });
    expect(listings).toHaveLength(25);
  });

  it("carries the shop's own per-category breakdown, which sums to ads_online", () => {
    // The unfiltered breakdown is the whole shop's, which is what lets a
    // caller see past the 25 listings this page renders (SPEC 5.1).
    for (const name of ["shop-page", "shop-page-unpriced"]) {
      const { shop } = ok(name);
      expect(shop.categories.reduce((total, node) => total + node.count, 0)).toBe(shop.ads_online);
    }
  });

  it("does not promise ads_online equals the listings it returned", () => {
    // Three shop counts exist and no authority among them is known, so the
    // site's figure is reported as the site states it (SPEC 9.14).
    const { shop, listings } = ok("shop-page");
    expect(shop.ads_online).toBe(30);
    expect(listings).toHaveLength(25);
  });

  it("echoes the slug back case-sensitively, suffix and all, and never normalises it", () => {
    // `Autohaus-Meyer-GmbH` and `autohaus-meyer-gmbh-1` are different sellers
    // (SPEC 3.5).
    const { shop } = ok("shop-page");
    expect(shop.shop_slug).toBe(SLUG);
    expect(shop.shop_slug).not.toBe(SLUG.toLowerCase());
  });

  it("reads a listing the shop surface renders no price for as Unpriced", () => {
    // A shop listing a job and a flat beside its stock has listings the site
    // gives no price field at all — a state, never a parse failure (SPEC 3.1).
    const { listings } = ok("shop-page-unpriced");
    expect(listings.map((row) => row.price.kind)).toEqual([
      "Negotiable",
      "Negotiable",
      "Fixed",
      "Negotiable",
      "Unpriced",
      "Unpriced",
      "Fixed",
      "Unpriced",
      "Fixed",
      "Fixed",
    ]);
  });

  it("reads both posting-date precisions, exactly as a search results page does", () => {
    const { listings } = ok("shop-page");
    expect(listings[0]!.posted).toEqual({ value: "2026-08-25T14:05:00+02:00", precision: "minute" });
    expect(listings[24]!.posted).toEqual({ value: "2026-07-31", precision: "day" });
  });

  it("keeps the size tags the shop cards carry and a search row does not", () => {
    const { listings } = ok("shop-page");
    expect(listings.filter((row) => row.tags.length > 0).map((row) => row.tags)).toEqual([
      ["L"],
      ["45.5"],
      ["XXXL"],
    ]);
  });

  it("answers gone for a slug that names no shop, though the page is HTTP 200 and shop-shaped", () => {
    // The trap: that page carries a BrandProfilePage island whose props say
    // `sellerType: "private"`. Read alone it claims a private seller was
    // found, when no seller was found at all.
    expect(parse("shop-page-unknown")).toEqual({ status: "gone" });
  });

  it("answers gone where the redirects came to rest somewhere other than a shop page", () => {
    expect(parse("shop-page", "https://www.kleinanzeigen.de/s-fahrraeder/c217")).toEqual({ status: "gone" });
  });

  it("fails rather than answering gone where it cannot tell what it was served", () => {
    // "We looked, and it is not a shop" is an answer; "we cannot say where we
    // ended up" is a failure, and the two must not collapse (SPEC 5.3).
    expect(() => parse("shop-page", "https://kleinanzeigen.de.example.com/pro/x")).toThrow(ParseError);
    expect(() => parse("shop-page", "not a url")).toThrow(ParseError);
  });

  it("accepts the apex spelling of the site's own host", () => {
    expect(parse("shop-page", `https://kleinanzeigen.de/pro/${SLUG}`).status).toBe("ok");
  });

  it("shouts rather than guessing where the page carries no island at all", () => {
    expect(() => parseShopPage("<html><body></body></html>", { finalUrl: shopPageUrl(SLUG) })).toThrow(ParseError);
  });
});
