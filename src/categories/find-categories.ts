import type { CategoryNode, CategoryTree } from "./category-tree.ts";

/**
 * Case- and diacritic-insensitive folding. Runs of whitespace collapse so that
 * copied labels match, and nothing else is normalised: there is no fuzzy or
 * edit-distance matching anywhere here (SPEC 4.4). 159 known strings and an LLM
 * caller — approximate matching buys little and turns a loud failure into a
 * quiet one.
 */
export function foldForMatch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}

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
  const needle = foldForMatch(query);
  if (needle === "") return [];
  return tree.filter(
    (node) => foldForMatch(node.name) === needle || foldForMatch(qualifiedName(node)) === needle,
  );
}
