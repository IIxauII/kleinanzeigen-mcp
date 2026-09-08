import { loadCategoryTree } from "../../src/categories/category-tree.ts";
import { loadCityDataset } from "../../src/locations/city-dataset.ts";
import type { Get } from "../lib/site.ts";
import { checkCategoryDrift } from "./categories.ts";
import { checkLocationDrift } from "./locations.ts";
import type { DatasetReport } from "./report.ts";

/** The committed datasets, as id → German name, which is what a diff needs of them. */
export type BundledDatasets = {
  categories: ReadonlyMap<number, string>;
  locations: ReadonlyMap<number, string>;
};

/** Where the committed datasets live in a clone. Never `dist/`: the cron and the release gate check `data/`. */
export const DATA_DIR = new URL("../../data/", import.meta.url);

/**
 * Reads the two committed datasets through the same schemas the server reads
 * them with, so a dataset that no longer parses fails the check rather than
 * being diffed as an empty set.
 */
export function readBundledDatasets(dataDir: URL = DATA_DIR): BundledDatasets {
  const categories = loadCategoryTree(new URL("category-tree.json", dataDir));
  const locations = loadCityDataset(new URL("cities.json", dataDir));
  return {
    categories: new Map(categories.map((node) => [node.category_id, node.name])),
    locations: new Map(locations.map((node) => [node.location_id, node.name])),
  };
}

/**
 * One run, **19 requests**, both datasets, serialised at the generators' gap:
 * `sitemap_categories.xml`, `sitemap_cities.xml`, and the `/s-katalog-orte.html`
 * root plus its sixteen state pages — about 28 seconds (SPEC 7).
 *
 * **Both datasets are always attempted**, whatever the other one did. A caller
 * decides whether to open an issue from the report, and a dataset whose drift
 * was never looked for cannot appear in it.
 */
export async function runDriftCheck(get: Get, bundled: BundledDatasets): Promise<DatasetReport[]> {
  return [
    await checkCategoryDrift(get, bundled.categories),
    await checkLocationDrift(get, bundled.locations),
  ];
}
