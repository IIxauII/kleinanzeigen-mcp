import { foldedMatch } from "../fold.ts";
import type { CityDataset, LocationNode } from "./city-dataset.ts";

/**
 * The qualified `"Bundesland > Ort"` form; a federal state is just its name.
 *
 * It is the only way to separate the four Neustadts and the two Mittes without
 * already knowing an id, which is the thing the caller came here to find out.
 */
export function qualifiedLocationName(location: LocationNode): string {
  return location.level === "state" ? location.name : `${location.state} > ${location.name}`;
}

/**
 * Every location the query could mean, in dataset order. Matching runs against
 * the name and against the qualified form, and **never against a slug** — slugs
 * are cosmetic URL material a search URL never even emits (SPEC 4.4, SPEC 2.2).
 *
 * Zero matches is an answer, not an error — including for the case a caller is
 * most likely to type. **A five-digit postcode matches nothing here**: the
 * postcode layer's ids exist on the site but are absent from every allowed
 * source, so the dataset cannot name them (SPEC 7). A postcode still works as
 * `search_listings`' free-text `location`, where the site resolves it itself —
 * silently picking among the locations it collides with, which is exactly the
 * ambiguity this tool exists to expose.
 */
export function findLocations(dataset: CityDataset, query: string): LocationNode[] {
  return dataset.filter(
    (location) =>
      foldedMatch(query, location.name) || foldedMatch(query, qualifiedLocationName(location)),
  );
}
