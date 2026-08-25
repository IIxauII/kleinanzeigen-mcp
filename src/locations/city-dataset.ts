import { readFileSync } from "node:fs";
import { z } from "zod";

/**
 * The two tiers kleinanzeigen's location tree exposes below Deutschland: the
 * sixteen federal states, and everything directly beneath them.
 *
 * That second tier is not one kind of place — it holds Gemeinden, Städte, the
 * five `Kr.` Kreis nodes and, under the three city-states, their Ortsteile. It
 * is named for its position in the tree rather than for a civic rank none of
 * them share.
 */
export const LOCATION_LEVELS = ["state", "locality"] as const;

export type LocationLevel = (typeof LOCATION_LEVELS)[number];

/**
 * One location. `slug` is cosmetic URL material — a search URL never emits it
 * (SPEC 2.2) and slugs collide across locations, so only `location_id`
 * identifies one. `state` is the federal state containing it; a state's own
 * `state` is itself.
 */
export const LocationNodeSchema = z.object({
  location_id: z.number().int().positive(),
  name: z.string().min(1),
  slug: z.string().min(1),
  level: z.enum(LOCATION_LEVELS),
  state: z.string().min(1),
});

export type LocationNode = z.infer<typeof LocationNodeSchema>;
export type CityDataset = readonly LocationNode[];

/**
 * The on-disk shape: rows as tuples, with each locality naming its state by
 * index into `states`.
 *
 * Objects would repeat five keys and a state name 11 231 times, which the
 * gzipped package pays for; tuples are the same data at a third of the bytes.
 * The generator writes one row per line, so the file stays diffable for the
 * drift check (SPEC 8.2).
 */
const StateRowSchema = z.tuple([z.number().int().positive(), z.string().min(1), z.string().min(1)]);

const LocalityRowSchema = z.tuple([
  z.number().int().positive(),
  z.string().min(1),
  z.string().min(1),
  z.number().int().nonnegative(),
]);

export const CityDatasetFileSchema = z.object({
  states: z.array(StateRowSchema).length(16),
  locations: z.array(LocalityRowSchema).min(1),
});

export type CityDatasetFile = z.infer<typeof CityDatasetFileSchema>;

/**
 * The sidecar dataset sits beside the bundle, so this resolves to
 * `dist/cities.json` once built (SPEC 7, SPEC 8.2).
 */
export const CITY_DATASET_PATH = new URL("./cities.json", import.meta.url);

/** Tuples in, the shape `find_location` returns out — states first, in file order. */
export function decodeCityDataset(file: CityDatasetFile): LocationNode[] {
  const states = file.states.map(([location_id, name, slug]) => ({
    location_id,
    name,
    slug,
    level: "state" as const,
    state: name,
  }));
  const localities = file.locations.map(([location_id, name, slug, stateIndex]) => {
    const state = states[stateIndex];
    if (state === undefined) throw new Error(`l${location_id} names state index ${stateIndex}`);
    return { location_id, name, slug, level: "locality" as const, state: state.name };
  });
  return [...states, ...localities];
}

let loaded: CityDataset | null = null;

/**
 * Reads and parses the bundled dataset **lazily on first use, never at startup**
 * — a keyword-only search must never touch it (SPEC 7). Reading a static
 * build-time artefact is not persistence; ADR-0002's invariant is untouched.
 */
export function loadCityDataset(source: URL | string = CITY_DATASET_PATH): CityDataset {
  loaded ??= decodeCityDataset(CityDatasetFileSchema.parse(JSON.parse(readFileSync(source, "utf8"))));
  return loaded;
}

/** Whether the lazy read has happened yet. Exists so laziness is testable. */
export function isCityDatasetLoaded(): boolean {
  return loaded !== null;
}

/** Test seam: drops the memoised dataset so the next load reads again. */
export function resetCityDataset(): void {
  loaded = null;
}
