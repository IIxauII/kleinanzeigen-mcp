import {
  CATEGORIES_SITEMAP_URL,
  parseCategorySitemap,
} from "../../src/categories/category-sitemap.ts";
import type { Get } from "../lib/site.ts";
import { reportFor, unavailable, type DatasetReport } from "./report.ts";

/**
 * The category leg: **one request**, diffing the live id set against the
 * committed `data/category-tree.json` (SPEC 7).
 *
 * Ids only. The sitemap carries no labels — the German names come from the
 * homepage nav at generation time — so this leg is blind to a category rename
 * by construction, and says nothing about names rather than claiming none
 * changed.
 *
 * Nothing here is conditioned on the sitemap index's `lastmod`, for the reason
 * `parseCategorySitemap` gives. A sitemap that cannot be read is reported,
 * never thrown: a check that failed because the site is down has learnt
 * nothing, which is not the same as having learnt that the bundle is fine.
 */
export async function checkCategoryDrift(
  get: Get,
  bundled: ReadonlyMap<number, string>,
): Promise<DatasetReport> {
  try {
    const live = parseCategorySitemap(await get(CATEGORIES_SITEMAP_URL));
    return reportFor("categories", bundled, {
      ids: new Set(live.map((entry) => entry.category_id)),
    });
  } catch (error) {
    return unavailable("categories", error);
  }
}
