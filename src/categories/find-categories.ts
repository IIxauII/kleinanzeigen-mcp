import { foldedMatch } from "../fold.ts";
import type { CategoryNode, CategoryTree } from "./category-tree.ts";

/** The qualified `"Parent > Child"` form; a top-level category is just its name. */
export function qualifiedName(node: CategoryNode): string {
  return node.parent_name === null ? node.name : `${node.parent_name} > ${node.name}`;
}

/**
 * Every category the query could mean, in tree order. Matching runs against the
 * name and against the qualified form, and **never against a slug** — slugs are
 * cosmetic URL segments and collide 25 ways (SPEC 4.4).
 *
 * Zero matches is an answer, not an error.
 */
export function findCategories(tree: CategoryTree, query: string): CategoryNode[] {
  return tree.filter(
    (node) => foldedMatch(query, node.name) || foldedMatch(query, qualifiedName(node)),
  );
}
