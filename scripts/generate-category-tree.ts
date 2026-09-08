/**
 * Build-time generator for `data/category-tree.json`.
 *
 * Run by a maintainer, never by the server (SPEC 7):
 *
 *     npm run generate:category-tree
 *
 * Ids come from `sitemap_categories.xml`, which is depth-first and whose id set
 * is byte-identical to the disallowed `/s-kategorie-baum.html` tree — so
 * partitioning it at the top-level markers recovers every parent's child set
 * exactly. German labels come from the homepage nav, which confirms the same
 * partitions independently but silently omits a few nodes; those labels are
 * recovered from their parents' browse pages. Only the sitemap is complete; the
 * homepage is a label convenience, not a source of truth.
 */
import * as cheerio from "cheerio";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  CATEGORIES_SITEMAP_URL,
  parseCategorySitemap,
  type CategorySitemapEntry,
} from "../src/categories/category-sitemap.ts";
import type { CategoryNode } from "../src/categories/category-tree.ts";
import { createGet, ORIGIN } from "./lib/site.ts";

const OUTPUT = new URL("../data/category-tree.json", import.meta.url);

function fail(message: string): never {
  throw new Error(`category tree generation failed: ${message}`);
}

function note(message: string): void {
  process.stderr.write(`${message}\n`);
}

/** Serialised at the shared 1500 ms gap, the same one the drift check holds (SPEC 2.8). */
const get = createGet({ note });

/** Top-level ids in nav order, and every label the nav does render. */
function readHomepageNav(html: string): { topLevelIds: number[]; labels: Map<number, string> } {
  const $ = cheerio.load(html);

  const topLevelIds = $("a[id^='category-']")
    .toArray()
    .map((element) => Number($(element).attr("id")?.slice("category-".length)))
    .filter((id) => Number.isInteger(id));
  if (topLevelIds.length === 0) fail("the homepage nav rendered no top-level categories");

  const labels = new Map<number, string>();
  for (const element of $("a[href]").toArray()) {
    const id = /^\/s-.+\/c(\d+)$/.exec($(element).attr("href") ?? "")?.[1];
    if (id === undefined) continue;
    const label = $(element).text().trim();
    if (label !== "") labels.set(Number(id), label);
  }
  return { topLevelIds, labels };
}

/** Recovers one label the nav omits, from its parent's browse page. */
async function recoverLabel(node: CategorySitemapEntry, parentPath: string): Promise<string> {
  const $ = cheerio.load(await get(`${ORIGIN}${parentPath}`));
  const label = $(`a[href='${node.path}']`).first().text().trim();
  if (label === "") fail(`no label for c${node.category_id} on its parent's browse page`);
  return label;
}

async function generate(): Promise<CategoryNode[]> {
  const entries = parseCategorySitemap(await get(CATEGORIES_SITEMAP_URL));
  const { topLevelIds, labels } = readHomepageNav(await get(`${ORIGIN}/`));

  const topLevel = new Set(topLevelIds);
  for (const id of topLevel) {
    if (!entries.some((entry) => entry.category_id === id)) {
      fail(`the homepage nav offered top-level c${id}, which the sitemap does not list`);
    }
  }
  if (!topLevel.has(entries[0]?.category_id ?? -1)) {
    fail("the sitemap does not open on a top-level category, so it is not depth-first");
  }

  const nodes: CategoryNode[] = [];
  let parent: CategoryNode | null = null;

  for (const entry of entries) {
    const isTopLevel = topLevel.has(entry.category_id);
    const node: CategoryNode = {
      category_id: entry.category_id,
      name: labels.get(entry.category_id) ?? "",
      slug: entry.slug,
      path: entry.path,
      parent_id: isTopLevel ? null : (parent?.category_id ?? null),
      parent_name: isTopLevel ? null : (parent?.name ?? null),
    };
    if (!isTopLevel && node.parent_id === null) {
      fail(`c${entry.category_id} has no top-level category above it`);
    }
    nodes.push(node);
    if (isTopLevel) parent = node;
  }

  const omitted = nodes.filter((node) => node.name === "");
  if (omitted.length > 0) {
    note(`the homepage nav omitted ${omitted.length} node(s); recovering from browse pages`);
  }
  for (const node of omitted) {
    const parentNode = nodes.find((candidate) => candidate.category_id === node.parent_id);
    if (parentNode === undefined || parentNode.name === "") {
      fail(`cannot recover c${node.category_id}: its parent has no browse page label either`);
    }
    node.name = await recoverLabel(node, parentNode.path);
    node.parent_name = parentNode.name;
    note(`recovered c${node.category_id} → ${node.name}`);
  }

  for (const node of nodes) {
    if (node.name === "") fail(`c${node.category_id} came out without a German label`);
  }
  return nodes;
}

/**
 * Names what changed against the dataset already committed. Drift is fixed by
 * shipping a new version, so this reports rather than decides — but a silent
 * regeneration that loses nodes is exactly what it exists to make loud (SPEC 7).
 */
function reportDrift(nodes: CategoryNode[]): void {
  if (!existsSync(OUTPUT)) {
    note("no dataset was committed yet, so there is nothing to diff against");
    return;
  }
  const previous: CategoryNode[] = JSON.parse(readFileSync(OUTPUT, "utf8"));
  const before = new Set(previous.map((node) => node.category_id));
  const after = new Set(nodes.map((node) => node.category_id));
  const added = [...after].filter((id) => !before.has(id));
  const removed = [...before].filter((id) => !after.has(id));
  const renamed = nodes.filter((node) => {
    const was = previous.find((candidate) => candidate.category_id === node.category_id);
    return was !== undefined && was.name !== node.name;
  });

  if (added.length === 0 && removed.length === 0 && renamed.length === 0) {
    note(`no drift: the same ${nodes.length} categories, same labels`);
    return;
  }
  if (added.length > 0) note(`added: ${added.map((id) => `c${id}`).join(", ")}`);
  if (removed.length > 0) note(`REMOVED: ${removed.map((id) => `c${id}`).join(", ")}`);
  for (const node of renamed) note(`renamed: c${node.category_id} → ${node.name}`);
}

const nodes = await generate();
const topLevelCount = nodes.filter((node) => node.parent_id === null).length;

reportDrift(nodes);
writeFileSync(OUTPUT, `${JSON.stringify(nodes, null, 2)}\n`, "utf8");
note(
  `wrote ${nodes.length} categories (${topLevelCount} top-level, ` +
    `${nodes.length - topLevelCount} sub) to ${OUTPUT.pathname}`,
);
