/**
 * Build-time generator for `data/cities.json`.
 *
 * Run by a maintainer, never by the server (SPEC 7):
 *
 *     npm run generate:cities
 *
 * Two allowed sources, each supplying what the other cannot:
 *
 * - `sitemap_cities.xml` carries the **ids and the site's own slugs**, but no
 *   names, no levels and no states — and it names 140 major cities only as
 *   `/stadt/<name>/` landing pages with no id at all. Those 140 are the three
 *   city-states §7 calls out **plus 137 more**, Köln and München among them.
 * - `/s-katalog-orte.html` carries the **German names and the tree**: the root
 *   page lists the sixteen federal states, and one request per state lists that
 *   state's whole child layer. It is not disallowed — the disallowed catalogue
 *   page is `/s-kategorie-baum.html`, and no rule in the file matches this one.
 *
 * 17 requests, serialised. The two sources reconcile exactly: the katalog's
 * first two tiers are 16 states + 11 215 localities, and the sitemap's 11 091
 * ids are 13 of those states plus 11 078 of those localities. The generator
 * asserts that reconciliation and fails rather than shipping a hole.
 *
 * The tree is cut at the second tier, which is where the ids stop being
 * obtainable: sub-Ortsteile (Wedding `l3503` under Mitte, and every Ortsteil of
 * the 137 cities) and the entire postcode layer are absent from both sources
 * (SPEC 7).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { CityDatasetFile } from "../src/locations/city-dataset.ts";
import { readCitySitemap, readKatalog, slugFromName, type Place } from "./lib/locations.ts";
import { CITIES_SITEMAP_URL, createGet, KATALOG_URL, note } from "./lib/site.ts";

const OUTPUT = new URL("../data/cities.json", import.meta.url);

/**
 * The three city-states, hard-coded as §7 requires. They are states *and*
 * `/stadt/` landing pages, so the sitemap gives them no id — and they are the
 * three ids a caller most needs. The katalog root is asserted to agree, so a
 * hard-coded id that ever went stale would fail the build rather than ship.
 */
const CITY_STATES: Record<string, number> = { Berlin: 3331, Hamburg: 9409, Bremen: 1 };

function fail(message: string): never {
  throw new Error(`city dataset generation failed: ${message}`);
}

/** Serialised at the shared 1500 ms gap, the same one the drift check holds (SPEC 2.8). */
const get = createGet();

async function generate(): Promise<CityDatasetFile> {
  const { slugs, landingPages } = readCitySitemap(await get(CITIES_SITEMAP_URL));
  note(`sitemap: ${slugs.size} ids with slugs, ${landingPages.size} id-less landing pages`);

  const states = readKatalog(await get(KATALOG_URL), "federal states");
  if (states.length !== 16) fail(`the catalogue listed ${states.length} federal states, not 16`);
  for (const [name, id] of Object.entries(CITY_STATES)) {
    const state = states.find((candidate) => candidate.name === name);
    if (state === undefined) fail(`the catalogue no longer lists the city-state ${name}`);
    if (state.id !== id) fail(`${name} is l${state.id} now, not the hard-coded l${id}`);
    if (slugs.has(id)) fail(`the sitemap now carries ${name} l${id}; drop the hard-coded id`);
  }

  const derived: string[] = [];
  const slugFor = (place: Place): string => {
    const fromSitemap = slugs.get(place.id);
    if (fromSitemap !== undefined) return fromSitemap;
    const slug = slugFromName(place.name);
    if (!landingPages.has(slug)) {
      fail(`l${place.id} ${place.name} has neither a sitemap slug nor a /stadt/${slug}/ page`);
    }
    derived.push(`l${place.id} ${place.name}`);
    return slug;
  };

  const file: CityDatasetFile = {
    states: states.map((state) => [state.id, state.name, slugFor(state)]),
    locations: [],
  };

  for (const [index, state] of states.entries()) {
    const children = readKatalog(
      await get(`${KATALOG_URL}?locationId=${state.id}`),
      `localities in ${state.name}`,
    );
    for (const child of children) file.locations.push([child.id, child.name, slugFor(child), index]);
  }

  const ids = new Set([
    ...file.states.map(([id]) => id),
    ...file.locations.map(([id]) => id),
  ]);
  if (ids.size !== file.states.length + file.locations.length) fail("the catalogue repeated an id");

  // The reconciliation: every id the sitemap publishes must be a node here.
  // One that isn't means the catalogue's first two tiers no longer cover the
  // sitemap, which is the assumption the whole cut-at-tier-two rule rests on.
  const orphans = [...slugs.keys()].filter((id) => !ids.has(id));
  if (orphans.length > 0) {
    fail(
      `${orphans.length} sitemap id(s) are in neither catalogue tier, ` +
        `e.g. ${orphans.slice(0, 5).map((id) => `l${id} (${slugs.get(id)})`).join(", ")}`,
    );
  }
  note(`recovered ${derived.length} id(s) the sitemap withholds, all verified against /stadt/ pages`);
  return file;
}

/**
 * Names what changed against the dataset already committed. Drift is fixed by
 * shipping a new version, so this reports rather than decides — but a silent
 * regeneration that loses locations is exactly what it exists to make loud
 * (SPEC 7).
 */
function reportDrift(file: CityDatasetFile): void {
  if (!existsSync(OUTPUT)) {
    note("no dataset was committed yet, so there is nothing to diff against");
    return;
  }
  const previous: CityDatasetFile = JSON.parse(readFileSync(OUTPUT, "utf8"));
  const named = (dataset: CityDatasetFile) =>
    new Map<number, string>(
      [...dataset.states, ...dataset.locations].map(([id, name]) => [id, name]),
    );
  const before = named(previous);
  const after = named(file);
  const added = [...after.keys()].filter((id) => !before.has(id));
  const removed = [...before.keys()].filter((id) => !after.has(id));
  const renamed = [...after].filter(([id, name]) => before.has(id) && before.get(id) !== name);

  if (added.length === 0 && removed.length === 0 && renamed.length === 0) {
    note(`no drift: the same ${after.size} locations, same names`);
    return;
  }
  const sample = (ids: number[], names: Map<number, string>) =>
    ids.slice(0, 10).map((id) => `l${id} ${names.get(id)}`).join(", ");

  if (added.length > 0) note(`added ${added.length}: ${sample(added, after)}`);
  if (removed.length > 0) note(`REMOVED ${removed.length}: ${sample(removed, before)}`);
  for (const [id, name] of renamed.slice(0, 10)) note(`renamed: l${id} ${before.get(id)} → ${name}`);
}

/** One row per line: a third of the bytes of objects, and still diffable. */
function serialise(file: CityDatasetFile): string {
  const rows = (values: unknown[][]) => values.map((row) => JSON.stringify(row)).join(",\n");
  return `{\n"states": [\n${rows(file.states)}\n],\n"locations": [\n${rows(file.locations)}\n]\n}\n`;
}

// The shared readers throw a bare `SiteError`; `fail` is what names this script
// in every other message, so a failure reads the same wherever it came from.
const file = await generate().catch((error: unknown) =>
  fail(error instanceof Error ? error.message : String(error)),
);
reportDrift(file);
writeFileSync(OUTPUT, serialise(file), "utf8");
note(
  `wrote ${file.states.length} federal states and ${file.locations.length} localities ` +
    `to ${OUTPUT.pathname}`,
);
