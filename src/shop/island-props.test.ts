import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import { ParseError } from "../fetch/errors.ts";
import { decodeIslandProps, islandProps } from "./island-props.ts";

const decode = (raw: unknown): Record<string, unknown> =>
  decodeIslandProps(JSON.stringify(raw), "TestIsland");

/** The page's own spelling, entities and all — cheerio undoes them, and a test should prove it. */
const page = (island: string, props: unknown): cheerio.CheerioAPI =>
  cheerio.load(
    `<astro-island opts="${JSON.stringify({ name: island, value: true })
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")}" props="${JSON.stringify(props)
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")}"></astro-island>`,
  );

describe("the island props decoder", () => {
  it("reads a pair per value, recursively", () => {
    expect(decode({ adsOnline: [0, 30], brandName: [0, "a-shop"], about: [0, { summary: [0, "x"] }] })).toEqual({
      adsOnline: 30,
      brandName: "a-shop",
      about: { summary: "x" },
    });
  });

  it("reads an array as its own type, whose elements are pairs in turn", () => {
    expect(decode({ ads: [1, [[0, { id: [0, 1] }], [0, { id: [0, 2] }]]] })).toEqual({
      ads: [{ id: 1 }, { id: 2 }],
    });
  });

  it("reads a one-element pair as a value the page does not have", () => {
    // `"about":[0]` is how the shop page spells a shop with no profile prose.
    expect(decode({ about: [0], initialAds: [0, null] })).toEqual({ about: undefined, initialAds: null });
  });

  it("refuses a type code it does not know rather than reading past it", () => {
    // Astro encodes Date, Map, Set, RegExp, BigInt and URL under codes of
    // their own. Decoding `[3, "…"]` as a string would hand the parser a date
    // it would then read as text (SPEC 5.8).
    expect(() => decode({ posted: [3, "2026-08-25"] })).toThrow(ParseError);
    expect(() => decode({ tags: [0, ["a"]] })).toThrow(ParseError);
    expect(() => decode({ brandName: "a-shop" })).toThrow(ParseError);
  });

  it("finds an island by the stable name in opts, not by its hashed component URL", () => {
    const $ = page("BrandProfilePage", { adsOnline: [0, 7] });
    expect(islandProps($, "BrandProfilePage")).toEqual({ adsOnline: 7 });
  });

  it("answers null for an island the page does not carry", () => {
    // A shop with no profile actions renders no ProfileActions island, and a
    // missing island is the page saying so rather than a parse failure.
    expect(islandProps(page("BrandProfilePage", {}), "ProfileActions")).toBeNull();
  });
});
