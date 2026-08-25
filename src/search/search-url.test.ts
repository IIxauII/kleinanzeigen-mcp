import { describe, expect, it } from "vitest";
import { REACHABLE } from "./ceiling.ts";
import { isDegenerateForm, searchUrl, SearchQuerySchema } from "./search-url.ts";

const query = (url: string) => new URL(url).searchParams;
const path = (url: string) => new URL(url).pathname;

describe("the search URL grammar", () => {
  it("never makes the keyword a path segment", () => {
    // No slugification anywhere: no umlaut transliteration, no space-encoding
    // decision about a path (SPEC 11.2).
    const url = searchUrl({ keywords: "Damenrad für Kinder" });
    expect(path(url)).toBe("/s-k0");
    expect(query(url).get("keywords")).toBe("Damenrad für Kinder");
    expect(url).not.toContain("damenrad-fuer");
  });

  it("emits the keywordless token as a literal and never a leading slug", () => {
    expect(path(searchUrl({}))).toBe("/s-k0");
    expect(path(searchUrl({ category_id: 217 }))).toBe("/s-c217");
    expect(path(searchUrl({ location_id: 3331 }))).toBe("/s-l3331");
    expect(path(searchUrl({ category_id: 217, location_id: 3331 }))).toBe("/s-c217l3331");
  });

  it("addresses a page directly, sluglessly", () => {
    // Page N costs exactly one request and never replays 1…N−1 (SPEC 2.5).
    expect(path(searchUrl({ page: 1, keywords: "fahrrad" }))).toBe("/s-k0");
    expect(path(searchUrl({ page: 7, keywords: "fahrrad" }))).toBe("/s-seite:7/k0");
    expect(path(searchUrl({ page: 50, category_id: 217 }))).toBe("/s-seite:50/c217");
  });

  it("never emits the degenerate slugless keywordless combined form", () => {
    // `/s-seite:N/k0c<id>` returns `1 - 1 von 1`. The grammar cannot reach it,
    // because a category drops `k0` entirely (SPEC 5.7).
    expect(path(searchUrl({ page: 3, category_id: 217 }))).not.toContain("k0");
  });

  it("maps every argument to the site's own wire parameter name", () => {
    const parameters = query(
      searchUrl({
        keywords: "hollandrad",
        location: "10115",
        radius: 20,
        min_price: 50,
        max_price: 500,
        ad_type: "WANTED",
        poster_type: "COMMERCIAL",
        sort: "PRICE_AMOUNT_DESC",
      }),
    );
    expect(Object.fromEntries(parameters)).toEqual({
      keywords: "hollandrad",
      locationStr: "10115",
      radius: "20",
      minPrice: "50",
      maxPrice: "500",
      adType: "WANTED",
      posterType: "COMMERCIAL",
      sortingField: "PRICE_AMOUNT_DESC",
    });
  });

  it("serialises both shipping literals, because false is a real filter", () => {
    expect(query(searchUrl({ shipping: true })).get("shipping")).toBe("true");
    expect(query(searchUrl({ shipping: false })).get("shipping")).toBe("false");
    expect(query(searchUrl({})).has("shipping")).toBe(false);
  });

  it("keeps shipping: false beside a carrier, which is an honest empty set", () => {
    // "Ships by DHL" ∩ "pickup only" is empty by construction, and the caller
    // is entitled to ask for it. Dropping the literal would answer a different
    // question (SPEC 5.6).
    const parameters = query(searchUrl({ shipping: false, shipping_carrier: "DHL" }));
    expect(parameters.get("shipping")).toBe("false");
    expect(parameters.get("shippingCarrier")).toBe("DHL");
  });

  it("never sends buy_now: false, which is a no-op the site answers with the baseline", () => {
    // The two `false`s do not share a serialisation rule (SPEC 4.1).
    expect(query(searchUrl({ buy_now: true })).get("buyNowEnabled")).toBe("true");
    expect(query(searchUrl({ buy_now: false })).has("buyNowEnabled")).toBe(false);
  });

  it("sends a sort only when the caller asked for one", () => {
    expect(query(searchUrl({})).has("sortingField")).toBe(false);
    expect(query(searchUrl({ sort: "SORTING_DATE" })).get("sortingField")).toBe("SORTING_DATE");
  });

  it("puts the reachable ceiling at 25 × 50", () => {
    expect(REACHABLE).toBe(1250);
  });
});

describe("the two refinements", () => {
  it("refuses two location inputs, which resolve at different stages", () => {
    const parsed = SearchQuerySchema.safeParse({ location: "Berlin", location_id: 3331 });
    expect(parsed.success).toBe(false);
  });

  it("refuses a radius with nothing to be a radius of", () => {
    expect(SearchQuerySchema.safeParse({ radius: 20 }).success).toBe(false);
    expect(SearchQuerySchema.safeParse({ radius: 20, location: "Berlin" }).success).toBe(true);
    expect(SearchQuerySchema.safeParse({ radius: 20, location_id: 3331 }).success).toBe(true);
  });

  it("refuses nothing the site would answer honestly", () => {
    // `zod` rejects only what the site would 400 or could not be asked; an
    // honest empty set is a value (SPEC 11.4).
    expect(
      SearchQuerySchema.safeParse({ poster_type: "COMMERCIAL", shipping_carrier: "DHL" }).success,
    ).toBe(true);
    expect(SearchQuerySchema.safeParse({ shipping: false, shipping_carrier: "DHL" }).success).toBe(
      true,
    );
  });
});

describe("the degenerate-form guard's precondition", () => {
  it("applies to a keywordless query narrowed only by category or location", () => {
    expect(isDegenerateForm({ category_id: 217 })).toBe(true);
    expect(isDegenerateForm({ location_id: 3331, page: 4, sort: "SORTING_DATE" })).toBe(true);
    expect(isDegenerateForm({ category_id: 217, location_id: 3331 })).toBe(true);
  });

  it("does not apply once any other input could honestly narrow to one", () => {
    expect(isDegenerateForm({ category_id: 217, keywords: "fahrrad" })).toBe(false);
    expect(isDegenerateForm({ category_id: 217, max_price: 5 })).toBe(false);
    expect(isDegenerateForm({ location_id: 3331, radius: 0 })).toBe(false);
    expect(isDegenerateForm({})).toBe(false);
  });
});
