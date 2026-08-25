import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import {
  isCategoryTreeLoaded,
  loadCategoryTree,
  resetCategoryTree,
  type CategoryNode,
} from "./category-tree.ts";

const BUNDLED = new URL("../../data/category-tree.json", import.meta.url);

describe("the bundled category tree", () => {
  beforeEach(resetCategoryTree);

  it("is not read until it is first used", () => {
    expect(isCategoryTreeLoaded()).toBe(false);
    loadCategoryTree(BUNDLED);
    expect(isCategoryTreeLoaded()).toBe(true);
  });

  it("is read once and memoised", () => {
    const first = loadCategoryTree(BUNDLED);
    expect(loadCategoryTree(BUNDLED)).toBe(first);
  });

  it("carries all 159 nodes across exactly two levels", () => {
    const tree = loadCategoryTree(BUNDLED);
    expect(tree).toHaveLength(159);
    expect(tree.filter((node) => node.parent_id === null)).toHaveLength(15);
  });

  it("gives every subcategory a parent that is itself top-level", () => {
    const tree = loadCategoryTree(BUNDLED);
    const byId = new Map(tree.map((node) => [node.category_id, node]));
    for (const node of tree.filter((candidate) => candidate.parent_id !== null)) {
      const parent = byId.get(node.parent_id!);
      expect(parent, `c${node.category_id} has no parent`).toBeDefined();
      expect(parent!.parent_id, `c${parent!.category_id} is not top-level`).toBeNull();
      expect(node.parent_name).toBe(parent!.name);
    }
  });

  it("identifies each node by a unique id, though names and slugs collide", () => {
    const tree = loadCategoryTree(BUNDLED);
    expect(new Set(tree.map((node) => node.category_id)).size).toBe(tree.length);
    expect(new Set(tree.map((node) => node.slug)).size).toBeLessThan(tree.length);
    expect(new Set(tree.map((node) => node.name)).size).toBeLessThan(tree.length);
  });

  it("carries the three nodes the homepage nav silently omits", () => {
    const tree = loadCategoryTree(BUNDLED);
    const named = (id: number) => tree.find((node) => node.category_id === id)?.name;
    expect(named(286)).toBe("Bahn & ÖPNV");
    expect(named(269)).toBe("Beauty & Gesundheit");
    expect(named(273)).toBe("Tauschen");
  });

  it("refuses a malformed dataset loudly", () => {
    expect(() => loadCategoryTree(new URL("./find-categories.ts", import.meta.url))).toThrow();
  });

  it("stays in the sitemap's depth-first order", () => {
    const raw: CategoryNode[] = JSON.parse(readFileSync(BUNDLED, "utf8"));
    expect(raw[0]?.category_id).toBe(210);
    expect(raw[1]?.parent_id).toBe(210);
  });
});
