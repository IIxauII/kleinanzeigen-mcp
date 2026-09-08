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
const DATA_DIR = new URL("../../data/", import.meta.url);

/**
 * Reads the two committed datasets through the same schemas the server reads
 * them with, so a dataset that no longer parses fails the check rather than
 * being diffed as an empty set.
 */
export function readBundledDatasets(): BundledDatasets {
  const categories = loadCategoryTree(new URL("category-tree.json", DATA_DIR));
  const locations = loadCityDataset(new URL("cities.json", DATA_DIR));
  return {
    categories: new Map(categories.map((node) => [node.category_id, node.name])),
    locations: new Map(locations.map((node) => [node.location_id, node.name])),
  };
}

/**
 * One run over both datasets: the category leg's one request, then the location
 * leg's eighteen. `scripts/check-drift.ts` has the budget and the exit codes.
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
