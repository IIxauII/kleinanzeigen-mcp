import * as cheerio from "cheerio";
import { ParseError } from "../fetch/errors.ts";

/**
 * The whole taxonomy in one ~2 KB file, and the only complete source for it:
 * its id set is byte-identical to the disallowed `/s-kategorie-baum.html` tree,
 * while the homepage nav silently omits three of the 159 nodes (SPEC 7).
 */
export const CATEGORIES_SITEMAP_URL = "https://www.kleinanzeigen.de/sitemap_categories.xml";

/** One sitemap entry. No label — the sitemap carries none (SPEC 7). */
export type CategorySitemapEntry = {
  category_id: number;
  slug: string;
  path: string;
};

const CATEGORY_LOC = /^https:\/\/www\.kleinanzeigen\.de\/s-(.+)\/c(\d+)$/;

/**
 * Every category the sitemap lists, in its own depth-first order — which is
 * what lets the build-time generator recover each parent's child set by
 * partitioning at the top-level markers.
 *
 * **`lastmod` is not read**, here or anywhere: it is a whole-index regeneration
 * timestamp rather than a taxonomy-change signal, so nothing may be conditioned
 * on it (SPEC 7).
 *
 * An entry that does not parse is a failure, never a skip: silently dropping
 * one would understate the id set and read as a removal to the drift check
 * (SPEC 5.8).
 */
export function parseCategorySitemap(xml: string): CategorySitemapEntry[] {
  const $ = cheerio.load(xml, { xml: true });
  const entries = $("url > loc")
    .toArray()
    .map((element): CategorySitemapEntry => {
      const loc = $(element).text().trim();
      const match = CATEGORY_LOC.exec(loc);
      if (match === null) throw new ParseError(`unrecognised sitemap entry ${loc}`);
      const slug = match[1]!;
      const id = Number(match[2]!);
      return { category_id: id, slug, path: `/s-${slug}/c${id}` };
    });

  if (entries.length === 0) throw new ParseError("the categories sitemap listed no categories");

  const ids = new Set(entries.map((entry) => entry.category_id));
  if (ids.size !== entries.length) {
    throw new ParseError("the categories sitemap repeated a category id");
  }
  return entries;
}
