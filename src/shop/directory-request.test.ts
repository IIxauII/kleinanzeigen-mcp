import { describe, expect, it } from "vitest";
import type { CategoryTree } from "../categories/category-tree.ts";
import {
  DIRECTORY_PAGE_SIZE,
  directoryRequest,
  findShopArgsSchema,
  type FindShopArgs,
} from "./directory-request.ts";

const TREE: CategoryTree = [
  { category_id: 210, name: "Auto, Rad & Boot", slug: "auto-rad-boot", path: "auto-rad-boot", parent_id: null, parent_name: null },
];

/** A reader that fails the test if it is read at all — laziness is the assertion. */
const never = <T>(what: string) => (): T => {
  throw new Error(`the ${what} was read`);
};

const parse = (args: unknown): FindShopArgs => findShopArgsSchema(() => TREE).parse(args);

describe("find_shop's arguments", () => {
  it("refuses an argument the surface does not have, rather than ignoring it", () => {
    expect(() => parse({ name: "decathlon", page_size: 20 })).toThrow();
    expect(() => parse({ name: "decathlon", view: "TILE" })).toThrow();
    expect(() => parse({ name: "decathlon", search_scope: "BRANDING" })).toThrow();
  });

  it("takes a name, and refuses an empty one", () => {
    expect(parse({ name: "decathlon" })).toEqual({ name: "decathlon" });
    expect(() => parse({ name: "" })).toThrow();
  });

  it("accepts a category id the bundled tree knows", () => {
    expect(parse({ name: "x", category_id: 210, location_id: 3331 })).toEqual({
      name: "x",
      category_id: 210,
      location_id: 3331,
    });
  });

  it("refuses a category id the bundled tree does not have, before a request is spent on it", () => {
    expect(() => parse({ name: "x", category_id: 999 })).toThrow(/find_category/u);
  });

  it("passes a location id the bundled dataset does not have straight through", () => {
    // The city dataset holds the tree's first two tiers only: sub-Ortsteile
    // like Wedding `l3503` are absent from every allowed source, and the
    // directory filters by them and answers honestly (SPEC 7's correction).
    // Refusing one would be the opposite of the failure the category check
    // exists to prevent.
    expect(parse({ name: "x", location_id: 3503 })).toEqual({ name: "x", location_id: 3503 });
  });

  it("reads the bundled tree only when a category id was given", () => {
    const lazy = findShopArgsSchema(never<CategoryTree>("category tree"));
    expect(lazy.parse({ name: "decathlon", page: 3 })).toEqual({ name: "decathlon", page: 3 });
    expect(lazy.parse({ name: "x", location_id: 3331 })).toEqual({ name: "x", location_id: 3331 });
  });

  it("takes a 1-based page and refuses page 0", () => {
    expect(parse({ name: "x", page: 7 })).toEqual({ name: "x", page: 7 });
    expect(() => parse({ name: "x", page: 0 })).toThrow();
  });
});

describe("the directory request", () => {
  it("posts to the directory action", () => {
    expect(directoryRequest({ name: "decathlon" }).url).toBe(
      "https://www.kleinanzeigen.de/_actions/proPublicWeb.brandingIndex.searchBrandings/",
    );
  });

  it("sends the name to fulltext, byte for byte and never transliterated", () => {
    // `köln` → 492 hits and `koln` → 3, and those 3 include a shop whose name
    // *has* the umlaut. Folding here would answer a different question.
    expect(directoryRequest({ name: "Köln" }).body["fulltext"]).toBe("Köln");
    expect(directoryRequest({ name: "Weißenthal Gebr. Söhne" }).body["fulltext"]).toBe("Weißenthal Gebr. Söhne");
  });

  it("fixes the page size, the view and the search scope in code", () => {
    const { body } = directoryRequest({ name: "x" });
    expect(body["pageSize"]).toBe(DIRECTORY_PAGE_SIZE);
    expect(DIRECTORY_PAGE_SIZE).toBe(50);
    expect(body["view"]).toBe("CARD");
    expect(body["searchScope"]).toBe("BOTH");
  });

  it("maps a 1-based page to the directory's 0-based offset", () => {
    expect(directoryRequest({ name: "x" }).body["from"]).toBe(0);
    expect(directoryRequest({ name: "x", page: 1 }).body["from"]).toBe(0);
    expect(directoryRequest({ name: "x", page: 2 }).body["from"]).toBe(50);
    expect(directoryRequest({ name: "x", page: 8 }).body["from"]).toBe(350);
  });

  it("sends the two filter ids under the site's own names, and only where given", () => {
    expect(directoryRequest({ name: "x", category_id: 210, location_id: 3331 }).body).toMatchObject({
      categoryId: 210,
      locationId: 3331,
    });
    const bare = directoryRequest({ name: "x" }).body;
    expect(bare).not.toHaveProperty("categoryId");
    expect(bare).not.toHaveProperty("locationId");
  });
});
