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
import * as cheerio from "cheerio";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { CityDatasetFile } from "../src/locations/city-dataset.ts";
import { USER_AGENT } from "../src/user-agent.ts";

const ORIGIN = "https://www.kleinanzeigen.de";
const SITEMAP_URL = `${ORIGIN}/sitemap_cities.xml`;
const KATALOG_URL = `${ORIGIN}/s-katalog-orte.html`;
const OUTPUT = new URL("../data/cities.json", import.meta.url);

/** Personal-scale politeness: serialised, no bursting (SPEC 2.8). */
const REQUEST_GAP_MS = 1500;

/**
 * The three city-states, hard-coded as §7 requires. They are states *and*
 * `/stadt/` landing pages, so the sitemap gives them no id — and they are the
 * three ids a caller most needs. The katalog root is asserted to agree, so a
 * hard-coded id that ever went stale would fail the build rather than ship.
 */
const CITY_STATES: Record<string, number> = { Berlin: 3331, Hamburg: 9409, Bremen: 1 };

type Place = { id: number; name: string };

function fail(message: string): never {
  throw new Error(`city dataset generation failed: ${message}`);
}

function note(message: string): void {
  process.stderr.write(`${message}\n`);
}

let lastRequestAt = 0;

async function get(url: string): Promise<string> {
  const wait = lastRequestAt + REQUEST_GAP_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt = Date.now();

  const response = await fetch(url, { headers: { "user-agent": USER_AGENT } });
  if (!response.ok) fail(`GET ${url} answered ${response.status}`);
  const body = await response.text();
  note(`GET ${url} → ${response.status}, ${body.length} chars`);
  return body;
}

/**
 * The site's own slug spelling, as the `/stadt/` landing pages write it:
 * umlauts expanded the German way, everything else reduced to `a-z0-9-`.
 *
 * Only ever used for the 140 ids the sitemap withholds, and every derived slug
 * is checked back against a real landing page before it ships.
 */
function slugFromName(name: string): string {
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

/** `l<id>` → slug, plus the slugs of the id-less `/stadt/` landing pages. */
function readSitemap(xml: string): { slugs: Map<number, string>; landingPages: Set<string> } {
  const $ = cheerio.load(xml, { xml: true });
  const slugs = new Map<number, string>();
  const landingPages = new Set<string>();

  for (const element of $("url > loc").toArray()) {
    const loc = $(element).text().trim();
    const path = loc.startsWith(ORIGIN) ? loc.slice(ORIGIN.length) : fail(`foreign entry ${loc}`);
    const location = /^\/s-(.+)\/l(\d+)$/.exec(path);
    const landing = /^\/stadt\/(.+)\/$/.exec(path);
    if (location !== null) {
      const id = Number(location[2]);
      if (slugs.has(id)) fail(`the sitemap repeated l${id}`);
      slugs.set(id, location[1]!);
    } else if (landing !== null) {
      landingPages.add(slugFromName(decodeURIComponent(landing[1]!)));
    } else {
      fail(`unrecognised sitemap entry ${loc}`);
    }
  }

  if (slugs.size === 0) fail("the sitemap listed no locations");
  return { slugs, landingPages };
}

/** The children of one catalogue node, in the page's own order. */
function readKatalog(html: string, what: string): Place[] {
  const $ = cheerio.load(html);
  const places = $("#brwslctns-lctns-list a[href*='locationId=']")
    .toArray()
    .map((element) => {
      const id = /[?&]locationId=(\d+)/.exec($(element).attr("href") ?? "")?.[1];
      const name = $(element).text().replace(/\s+/gu, " ").trim();
      if (id === undefined || name === "") fail(`unreadable ${what} entry in the catalogue`);
      return { id: Number(id), name };
    });
  if (places.length === 0) fail(`the catalogue listed no ${what}`);
  return places;
}

async function generate(): Promise<CityDatasetFile> {
  const { slugs, landingPages } = readSitemap(await get(SITEMAP_URL));
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

const file = await generate();
reportDrift(file);
writeFileSync(OUTPUT, serialise(file), "utf8");
note(
  `wrote ${file.states.length} federal states and ${file.locations.length} localities ` +
    `to ${OUTPUT.pathname}`,
);
