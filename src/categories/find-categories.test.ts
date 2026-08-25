import { describe, expect, it } from "vitest";
import type { CategoryTree } from "./category-tree.ts";
import { findCategories, foldForMatch, qualifiedName } from "./find-categories.ts";

const node = (
  category_id: number,
  name: string,
  slug: string,
  parent: { id: number; name: string } | null,
) => ({
  category_id,
  name,
  slug,
  path: `/s-${slug}/c${category_id}`,
  parent_id: parent?.id ?? null,
  parent_name: parent?.name ?? null,
});

const AUTO = { id: 210, name: "Auto, Rad & Boot" };
const SERVICES = { id: 297, name: "Dienstleistungen" };

const TREE: CategoryTree = [
  node(210, "Auto, Rad & Boot", "auto-rad-boot", null),
  node(217, "Fahrräder & Zubehör", "fahrraeder", AUTO),
  node(297, "Dienstleistungen", "dienstleistungen", null),
  node(289, "Auto, Rad & Boot", "auto-rad-boot", SERVICES),
];

describe("foldForMatch", () => {
  it("folds case and diacritics", () => {
    expect(foldForMatch("FahrrÄder")).toBe("fahrrader");
    expect(foldForMatch("Bahn & ÖPNV")).toBe("bahn & opnv");
  });

  it("collapses surrounding and repeated whitespace", () => {
    expect(foldForMatch("  Auto,   Rad & Boot ")).toBe("auto, rad & boot");
  });
});

describe("qualifiedName", () => {
  it("qualifies a subcategory with its parent", () => {
    expect(qualifiedName(TREE[1]!)).toBe("Auto, Rad & Boot > Fahrräder & Zubehör");
  });

  it("leaves a top-level category unqualified", () => {
    expect(qualifiedName(TREE[0]!)).toBe("Auto, Rad & Boot");
  });
});

describe("findCategories", () => {
  it("matches a name regardless of case and diacritics", () => {
    expect(findCategories(TREE, "fahrrader & zubehor").map((n) => n.category_id)).toEqual([217]);
  });

  it("returns every node a colliding name could mean, never one of them", () => {
    expect(findCategories(TREE, "Auto, Rad & Boot").map((n) => n.category_id)).toEqual([210, 289]);
  });

  it("narrows a collision through the qualified form", () => {
    expect(findCategories(TREE, "Dienstleistungen > Auto, Rad & Boot").map((n) => n.category_id)) //
      .toEqual([289]);
  });

  it("never matches on a slug", () => {
    expect(findCategories(TREE, "fahrraeder")).toEqual([]);
    expect(findCategories(TREE, "auto-rad-boot")).toEqual([]);
  });

  it("does no fuzzy or substring matching", () => {
    expect(findCategories(TREE, "Fahrrad")).toEqual([]);
    expect(findCategories(TREE, "Fahrräder")).toEqual([]);
    expect(findCategories(TREE, "Auto")).toEqual([]);
  });

  it("answers an unknown name with no matches rather than an error", () => {
    expect(findCategories(TREE, "Raumfahrt")).toEqual([]);
  });

  it("answers a blank query with no matches", () => {
    expect(findCategories(TREE, "   ")).toEqual([]);
  });
});
