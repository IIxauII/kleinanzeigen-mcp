import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ParseError } from "../fetch/errors.ts";
import { decodeFlattened } from "./flattened.ts";
import { parseShopDirectory } from "./parse-directory.ts";

const fixture = (name: string): string =>
  readFileSync(new URL(`../../tests/fixtures/${name}.json`, import.meta.url), "utf8");

/**
 * A payload built by re-flattening a decoded fixture would prove only that our
 * decoder reads our encoder, so the fixture's own index table is edited in
 * place instead — one slot at a time, exactly the way the capture redacts it.
 */
type Payload = { values: unknown[]; card: Record<string, number> };

/** The fixture's index table, and the first candidate's key → slot map inside it. */
function payload(name: string): Payload {
  const values = JSON.parse(fixture(name)) as unknown[];
  const root = values[0] as Record<string, number>;
  const card = values[(values[root["brandingCards"]!] as number[])[0]!] as Record<string, number>;
  return { values, card };
}

function withCardField(name: string, key: string, held: unknown): string {
  const { values, card } = payload(name);
  const slot = card[key];
  if (slot === undefined) throw new Error(`the fixture's first card has no ${key}`);
  values[slot] = held;
  return JSON.stringify(values);
}

function withoutCardField(name: string, key: string): string {
  const { values, card } = payload(name);
  delete card[key];
  return JSON.stringify(values);
}

describe("the shop directory", () => {
  it("reads a page of candidates off the flattened payload", () => {
    const { matches } = parseShopDirectory(fixture("shop-directory"));
    expect(matches).toHaveLength(50);
    expect(matches[0]).toEqual({
      name: "Synthetisches Musterhaus GmbH 0",
      shop_slug: "Synthetisches-Musterhaus-GmbH-0",
      seller_id: 21000000,
      location: "Musterstadt",
      ads_online: 52,
      logo_url:
        "https://img.kleinanzeigen.de/api/v1/prod-ads/images/00/00000000-0000-4000-8000-000000000900?rule=$_0.JPG",
    });
  });

  it("reports totalHits as the count — the whole match set, not this page", () => {
    const { matches, count } = parseShopDirectory(fixture("shop-directory"));
    expect(count).toBe(348);
    expect(count).toBeGreaterThan(matches.length);
  });

  it("reads zero matches as an answer, not as a failure", () => {
    expect(parseShopDirectory(fixture("shop-directory-empty"))).toEqual({ matches: [], count: 0 });
  });

  it("strips the /pro/ prefix off the slug and keeps its spelling byte for byte", () => {
    const { matches } = parseShopDirectory(fixture("shop-directory"));
    // Mixed case survives, and so would a numeric collision suffix: two shops
    // sharing a name are told apart by it (SPEC 3.5).
    expect(matches[0]!.shop_slug).toBe("Synthetisches-Musterhaus-GmbH-0");
    expect(matches.every((match) => !match.shop_slug.startsWith("/"))).toBe(true);
  });

  it("is loud about a urlExtension that is not a shop page", () => {
    expect(() => parseShopDirectory(withCardField("shop-directory", "urlExtension", "/s-anzeige/x/1"))).toThrow(
      ParseError,
    );
    expect(() => parseShopDirectory(withCardField("shop-directory", "urlExtension", "/pro/"))).toThrow(ParseError);
    expect(() => parseShopDirectory(withCardField("shop-directory", "urlExtension", "/pro/a/b"))).toThrow(ParseError);
  });

  it("reads the seller id as the number the glossary says it is, and is loud otherwise", () => {
    expect(parseShopDirectory(withCardField("shop-directory", "userId", "163072438")).matches[0]!.seller_id).toBe(
      163072438,
    );
    expect(() => parseShopDirectory(withCardField("shop-directory", "userId", "nicht-numerisch"))).toThrow(ParseError);
    expect(() => parseShopDirectory(withCardField("shop-directory", "userId", 163072438))).toThrow(ParseError);
  });

  it("treats a missing logo and a missing location as absent, not as a failure", () => {
    const noLogo = parseShopDirectory(withoutCardField("shop-directory", "logoUrl"));
    expect(noLogo.matches[0]!.logo_url).toBeNull();
    const noLocation = parseShopDirectory(withoutCardField("shop-directory", "location"));
    expect(noLocation.matches[0]!.location).toBeNull();
  });

  it("is loud about a missing name, a missing slug and a missing inventory count", () => {
    for (const key of ["title", "urlExtension", "userId", "liveAds"]) {
      expect(() => parseShopDirectory(withoutCardField("shop-directory", key)), key).toThrow(ParseError);
    }
  });

  it("is loud about an empty body, which the request path has already refused as a 204", () => {
    expect(() => parseShopDirectory("")).toThrow(ParseError);
    expect(() => parseShopDirectory("   ")).toThrow(ParseError);
  });

  it("is loud about a body that is not JSON, and about one that is not the directory's", () => {
    expect(() => parseShopDirectory("<html>blocked</html>")).toThrow(ParseError);
    expect(() => parseShopDirectory('[{"view":1},"CARD"]')).toThrow(ParseError);
  });

  it("is loud about a payload that states no totalHits", () => {
    const { values } = payload("shop-directory");
    const metadata = values[(values[0] as Record<string, number>)["metadata"]!] as Record<string, number>;
    delete metadata["totalHits"];
    expect(() => parseShopDirectory(JSON.stringify(values))).toThrow(ParseError);
  });

  it("decodes the same encoding the inventory RPC answers in", () => {
    // Not a second decoder: the directory and `getAds` share one, and this is
    // the assertion that keeps them from drifting apart (SPEC 5.1).
    expect(decodeFlattened(JSON.parse(fixture("shop-directory-empty")))).toMatchObject({
      view: "CARD",
      brandingCards: [],
    });
  });
});
