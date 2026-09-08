import { readCitySitemap, readKatalog } from "../lib/locations.ts";
import { CITIES_SITEMAP_URL, KATALOG_URL, SiteError, type Get } from "../lib/site.ts";
import { reportFor, unavailable, type DatasetReport } from "./report.ts";

/** Germany has sixteen, the katalog root lists sixteen, and 19 requests assumes sixteen. */
const FEDERAL_STATES = 16;

/**
 * The location leg: **18 requests** — the cities sitemap, the katalog root, and
 * one page per federal state — diffing both the ids and the German names
 * against the committed `data/cities.json` (SPEC 7, ADR-0004).
 *
 * **The katalog walk is not optional.** The cheap id-only variant was offered
 * and refused: `sitemap_cities.xml` carries ids and no names, so without the
 * katalog a renamed locality is invisible — and a rename stops `find_location`
 * resolving just as surely as a removal does (CONTEXT.md, *Location drift*).
 *
 * The live id set is the **union** of the two sources, because neither alone is
 * the whole set: the sitemap withholds 140 ids that exist only as `/stadt/`
 * landing pages, and an id published in the sitemap but not yet in the katalog
 * is a location the bundle is missing all the same. Names come from the katalog
 * only, so a sitemap-only id is reported as an addition and never as a rename.
 *
 * A failed leg abandons the rest of this dataset: 16 more requests into a site
 * that just refused one learn nothing and are not polite. The other dataset is
 * still checked, and this one is reported as `unavailable`.
 */
export async function checkLocationDrift(
  get: Get,
  bundled: ReadonlyMap<number, string>,
): Promise<DatasetReport> {
  try {
    const { slugs } = readCitySitemap(await get(CITIES_SITEMAP_URL));
    const states = readKatalog(await get(KATALOG_URL), "federal states");
    // The same assertion the generator makes, for the same reason: a root that
    // lists some other number is a page whose shape changed under us, and the
    // walk beneath it would be diffing something else. It is reported as a leg
    // that learnt nothing rather than as sixteen states' worth of drift.
    if (states.length !== FEDERAL_STATES) {
      throw new SiteError(
        `the catalogue listed ${states.length} federal states, not ${FEDERAL_STATES}`,
      );
    }

    const names = new Map<number, string>(states.map((state) => [state.id, state.name]));
    for (const state of states) {
      const children = readKatalog(
        await get(`${KATALOG_URL}?locationId=${state.id}`),
        `localities in ${state.name}`,
      );
      for (const child of children) names.set(child.id, child.name);
    }

    return reportFor("locations", bundled, {
      ids: new Set([...names.keys(), ...slugs.keys()]),
      names,
    });
  } catch (error) {
    return unavailable("locations", error);
  }
}
