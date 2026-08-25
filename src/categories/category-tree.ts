import { readFileSync } from "node:fs";
import { z } from "zod";

/**
 * One node of the category tree. `parent_id` and `parent_name` are `null` on a
 * top-level category; the taxonomy has exactly two levels and no third.
 *
 * `slug` and `path` are cosmetic URL material — 12 slugs collide across 25
 * nodes, so only `category_id` identifies a category (CONTEXT.md).
 */
export const CategoryNodeSchema = z.object({
  category_id: z.number().int().positive(),
  name: z.string().min(1),
  slug: z.string().min(1),
  path: z.string().min(1),
  parent_id: z.number().int().positive().nullable(),
  parent_name: z.string().min(1).nullable(),
});

export type CategoryNode = z.infer<typeof CategoryNodeSchema>;
export type CategoryTree = readonly CategoryNode[];

const CategoryTreeSchema = z.array(CategoryNodeSchema).min(1);

/**
 * The sidecar dataset sits beside the bundle, so this resolves to
 * `dist/category-tree.json` once built (SPEC 7, SPEC 8.2).
 */
export const CATEGORY_TREE_PATH = new URL("./category-tree.json", import.meta.url);

let loaded: CategoryTree | null = null;

/**
 * Reads and parses the bundled tree **lazily on first use, never at startup** —
 * a keyword-only search must never touch it (SPEC 7). Reading a static
 * build-time artefact is not persistence; ADR-0002's invariant is untouched.
 */
export function loadCategoryTree(source: URL | string = CATEGORY_TREE_PATH): CategoryTree {
  loaded ??= CategoryTreeSchema.parse(JSON.parse(readFileSync(source, "utf8")));
  return loaded;
}

/** Whether the lazy read has happened yet. Exists so laziness is testable. */
export function isCategoryTreeLoaded(): boolean {
  return loaded !== null;
}

/** Test seam: drops the memoised tree so the next load reads again. */
export function resetCategoryTree(): void {
  loaded = null;
}
