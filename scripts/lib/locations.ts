/**
 * The two allowed location sources, parsed. Shared by `generate-cities.ts`,
 * which builds `data/cities.json` from them, and by `check-drift.ts`, which
 * diffs the committed dataset against them (SPEC 7, ADR-0004).
 *
 * - `sitemap_cities.xml` carries **ids and the site's own slugs**, no names,
 *   and withholds 140 major places that exist only as `/stadt/` landing pages.
 * - `/s-katalog-orte.html` carries the **German names and the tree**: the root
 *   lists the sixteen federal states, one request per state lists that state's
 *   whole child layer.
 *
 * Every reader here fails on a page that carries none of its marker rather than
 * returning an empty result: a block presents as HTTP 200 with an empty list, so
 * an empty parse is never evidence of an empty site (ADR-0003).
 */
import * as cheerio from "cheerio";
import { ORIGIN, SiteError } from "./site.ts";

/** One node of the catalogue: a federal state, or one of its children. */
export type Place = { id: number; name: string };

/** What the cities sitemap yields: ids with slugs, and the id-less landing pages. */
export type CitySitemap = {
  slugs: Map<number, string>;
  landingPages: Set<string>;
};

/**
 * The site's own slug spelling, as the `/stadt/` landing pages write it:
 * umlauts expanded the German way, everything else reduced to `a-z0-9-`.
 */
export function slugFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/ä/gu, "ae")
    .replace(/ö/gu, "oe")
    .replace(/ü/gu, "ue")
    .replace(/ß/gu, "ss")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

/**
 * `l<id>` → slug, plus the slugs of the id-less `/stadt/` landing pages.
 *
 * The `<loc>…/l<id>` entries are this page's parse marker: a sitemap that
 * yields none is a failure, never an empty location set.
 */
export function readCitySitemap(xml: string): CitySitemap {
  const $ = cheerio.load(xml, { xml: true });
  const slugs = new Map<number, string>();
  const landingPages = new Set<string>();

  for (const element of $("url > loc").toArray()) {
    const loc = $(element).text().trim();
    if (!loc.startsWith(ORIGIN)) throw new SiteError(`the cities sitemap listed foreign ${loc}`);
    const path = loc.slice(ORIGIN.length);
    const location = /^\/s-(.+)\/l(\d+)$/.exec(path);
    const landing = /^\/stadt\/(.+)\/$/.exec(path);
    if (location !== null) {
      const id = Number(location[2]);
      if (slugs.has(id)) throw new SiteError(`the cities sitemap repeated l${id}`);
      slugs.set(id, location[1]!);
    } else if (landing !== null) {
      landingPages.add(slugFromName(decodeURIComponent(landing[1]!)));
    } else {
      throw new SiteError(`unrecognised cities sitemap entry ${loc}`);
    }
  }

  if (slugs.size === 0) throw new SiteError("the cities sitemap listed no locations");
  return { slugs, landingPages };
}

/**
 * The children of one catalogue node, in the page's own order.
 *
 * `locationId=` is this page's parse marker: a katalog page that yields none is
 * a failure, never a childless node.
 */
export function readKatalog(html: string, what: string): Place[] {
  const $ = cheerio.load(html);
  const places = $("#brwslctns-lctns-list a[href*='locationId=']")
    .toArray()
    .map((element) => {
      const id = /[?&]locationId=(\d+)/.exec($(element).attr("href") ?? "")?.[1];
      const name = $(element).text().replace(/\s+/gu, " ").trim();
      if (id === undefined || name === "") {
        throw new SiteError(`unreadable ${what} entry in the catalogue`);
      }
      return { id: Number(id), name };
    });
  if (places.length === 0) throw new SiteError(`the catalogue listed no ${what}`);
  return places;
}
