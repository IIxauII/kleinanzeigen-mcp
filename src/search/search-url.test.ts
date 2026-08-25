import { describe, expect, it } from "vitest";
import { REACHABLE } from "./ceiling.ts";
import {
  isDegenerateForm,
  searchUrl,
  SearchQuerySchema,
  SHIPPING_CARRIERS,
  SORTS,
} from "./search-url.ts";

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

  it("serialises both shipping literals, because false is a real filter", () => {
    expect(query(searchUrl({ shipping: true })).get("shipping")).toBe("true");
    expect(query(searchUrl({ shipping: false })).get("shipping")).toBe("false");
    expect(query(searchUrl({})).has("shipping")).toBe(false);
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
    const answerable = [
      { poster_type: "COMMERCIAL", shipping_carrier: "DHL" },
      { poster_type: "COMMERCIAL", buy_now: true },
      { shipping: false, shipping_carrier: "HERMES" },
      { buy_now: false },
      { min_price: 900, max_price: 10 },
      { location_id: 3331, radius: 0 },
      { page: 51 },
    ];
    for (const answerableQuery of answerable) {
      expect(SearchQuerySchema.safeParse(answerableQuery)).toMatchObject({ success: true });
    }
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

describe("the filters the site answers server-side", () => {
  it("sends the carrier alone, because a carrier already implies shipping", () => {
    // `?shippingCarrier=DHL` and `?shipping=true&shippingCarrier=DHL` return the
    // identical total, so nothing is added on the caller's behalf (SPEC 4.1).
    expect(Object.fromEntries(query(searchUrl({ shipping_carrier: "HERMES" })))).toEqual({
      shippingCarrier: "HERMES",
    });
  });

  it("keeps a known-honest empty set's parameters exactly as they were asked for", () => {
    // Both of §5.6's families. Commercial sellers ship — just not through the
    // mechanism the first two filters key on — and "ships by DHL" ∩ "pickup
    // only" is empty by construction. All three return nothing, and none is
    // "fixed" by dropping a parameter, which would answer a different question.
    expect(
      Object.fromEntries(query(searchUrl({ poster_type: "COMMERCIAL", shipping_carrier: "DHL" }))),
    ).toEqual({ posterType: "COMMERCIAL", shippingCarrier: "DHL" });
    expect(Object.fromEntries(query(searchUrl({ poster_type: "COMMERCIAL", buy_now: true })))).toEqual(
      { posterType: "COMMERCIAL", buyNowEnabled: "true" },
    );
    expect(Object.fromEntries(query(searchUrl({ shipping: false, shipping_carrier: "HERMES" })))) //
      .toEqual({ shipping: "false", shippingCarrier: "HERMES" });
  });

  it("maps every argument to the site's own wire parameter name", () => {
    // Every narrowing input but the two path codes is a query parameter on an
    // allowed pretty URL, and this is the one place the mapping from the
    // `snake_case` argument lives (SPEC 2.2, 11.2, 11.5).
    const url = searchUrl({
      keywords: "hollandrad",
      category_id: 217,
      location_id: 3331,
      radius: 50,
      min_price: 10,
      max_price: 900,
      ad_type: "OFFER",
      poster_type: "PRIVATE",
      shipping: true,
      shipping_carrier: "DHL",
      buy_now: true,
      sort: "PRICE_AMOUNT",
      page: 3,
    });
    expect(path(url)).toBe("/s-seite:3/c217l3331");
    expect(Object.fromEntries(query(url))).toEqual({
      keywords: "hollandrad",
      radius: "50",
      minPrice: "10",
      maxPrice: "900",
      adType: "OFFER",
      posterType: "PRIVATE",
      shipping: "true",
      shippingCarrier: "DHL",
      buyNowEnabled: "true",
      sortingField: "PRICE_AMOUNT",
    });
    // Free-text location is the one argument the surface above cannot also
    // carry: it is mutually exclusive with `location_id`.
    expect(query(searchUrl({ location: "Flensburg" })).get("locationStr")).toBe("Flensburg");
  });
});

describe("the filters that do not exist", () => {
  it("offers no sort by distance, in any spelling", () => {
    // `/*sortierung:entfernung*` is disallowed in every position and no
    // query-string form exists, so it is absent rather than approximated (SPEC 2.6).
    expect([...SORTS]).toEqual(["SORTING_DATE", "PRICE_AMOUNT", "PRICE_AMOUNT_DESC"]);
    expect(SearchQuerySchema.safeParse({ sort: "DISTANCE" }).success).toBe(false);
  });

  it("takes one upper-case carrier and refuses every spelling the site 400s", () => {
    // The enum is a property of the query planner, not the category: no
    // per-category schema and no runtime discovery (SPEC 4.1).
    expect([...SHIPPING_CARRIERS]).toEqual(["DHL", "HERMES"]);
    for (const spelling of ["dhl", "DHL,HERMES", "DPD", "KLEINANZEIGEN_VERSAND"]) {
      expect(SearchQuerySchema.safeParse({ shipping_carrier: spelling }).success).toBe(false);
    }
  });

  it("refuses an argument it does not have, rather than ignoring it", () => {
    // An attribute filter has no discoverable domain and no working query-string
    // form. Accepting `attributes` and dropping it would hand back a nationwide
    // result the caller reads as filtered (SPEC 2.6).
    const parsed = SearchQuerySchema.safeParse({
      keywords: "fahrrad",
      attributes: { "global.zustand": "new" },
    });
    expect(parsed.success).toBe(false);
  });
});
