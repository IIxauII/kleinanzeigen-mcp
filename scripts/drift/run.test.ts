import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CATEGORIES_SITEMAP_URL } from "../../src/categories/category-sitemap.ts";
import type { Place } from "../lib/locations.ts";
import { CITIES_SITEMAP_URL, KATALOG_URL, SiteError, type Get } from "../lib/site.ts";
import { checkCategoryDrift } from "./categories.ts";
import { checkLocationDrift } from "./locations.ts";
import { driftExitCode, formatReport } from "./report.ts";
import { readBundledDatasets, runDriftCheck } from "./run.ts";

/** The sixteen federal states the katalog root lists, with one locality each. */
const STATES: Place[] = Array.from({ length: 16 }, (_, index) => ({
  id: 100 + index,
  name: `Land ${index}`,
}));

const LOCALITIES = new Map<number, Place[]>(
  STATES.map((state) => [state.id, [{ id: state.id * 10, name: `Ort in ${state.name}` }]]),
);

const CATEGORY_IDS = [210, 216, 217];

function categoriesSitemap(ids: readonly number[]): string {
  const entries = ids
    .map((id) => `<url><loc>https://www.kleinanzeigen.de/s-c${id}/c${id}</loc></url>`)
    .join("");
  return `<?xml version="1.0"?><urlset>${entries}</urlset>`;
}

function citiesSitemap(ids: readonly number[]): string {
  const entries = ids
    .map((id) => `<url><loc>https://www.kleinanzeigen.de/s-l${id}/l${id}</loc></url>`)
    .join("");
  return `<?xml version="1.0"?><urlset>${entries}</urlset>`;
}

function katalogPage(places: readonly Place[]): string {
  const items = places
    .map((place) => `<li><a href="/s-katalog-orte.html?locationId=${place.id}">${place.name}</a></li>`)
    .join("");
  return `<html><body><ul id="brwslctns-lctns-list">${items}</ul></body></html>`;
}

type SiteOptions = {
  categoryIds?: readonly number[];
  sitemapLocationIds?: readonly number[];
  states?: readonly Place[];
  localities?: ReadonlyMap<number, Place[]>;
  /** URLs the site refuses, as the real one refuses: a status, never a body. */
  refuse?: readonly string[];
};

type FakeSite = { urls: string[]; get: Get };

function fakeSite(options: SiteOptions = {}): FakeSite {
  const states = options.states ?? STATES;
  const localities = options.localities ?? LOCALITIES;
  const pages = new Map<string, string>([
    [CATEGORIES_SITEMAP_URL, categoriesSitemap(options.categoryIds ?? CATEGORY_IDS)],
    [
      CITIES_SITEMAP_URL,
      citiesSitemap(
        options.sitemapLocationIds ??
          [...states.map((state) => state.id), ...[...localities.values()].flat().map((p) => p.id)],
      ),
    ],
    [KATALOG_URL, katalogPage(states)],
    ...states.map(
      (state): [string, string] => [
        `${KATALOG_URL}?locationId=${state.id}`,
        katalogPage(localities.get(state.id) ?? []),
      ],
    ),
  ]);

  const urls: string[] = [];
  return {
    urls,
    get: (url) => {
      urls.push(url);
      if (options.refuse?.includes(url)) {
        return Promise.reject(new SiteError(`GET ${url} answered 503`));
      }
      const body = pages.get(url);
      return body === undefined
        ? Promise.reject(new SiteError(`GET ${url} answered 404`))
        : Promise.resolve(body);
    },
  };
}

const bundledCategories = (ids: readonly number[] = CATEGORY_IDS): Map<number, string> =>
  new Map(ids.map((id) => [id, `c${id}`]));

const bundledLocations = (): Map<number, string> =>
  new Map(
    [...STATES, ...[...LOCALITIES.values()].flat()].map((place) => [place.id, place.name]),
  );

const bundled = () => ({ categories: bundledCategories(), locations: bundledLocations() });

describe("the category leg", () => {
  it("fetches the categories sitemap and nothing else", async () => {
    const site = fakeSite();
    await checkCategoryDrift(site.get, bundledCategories());
    expect(site.urls).toEqual([CATEGORIES_SITEMAP_URL]);
  });

  it("is clean when the bundled ids and the live ids agree", async () => {
    const site = fakeSite();
    expect(await checkCategoryDrift(site.get, bundledCategories())).toMatchObject({
      outcome: "clean",
      bundled_count: 3,
      live_count: 3,
    });
  });

  it("names the ids the taxonomy gained and lost", async () => {
    const site = fakeSite({ categoryIds: [210, 216, 999] });
    expect(await checkCategoryDrift(site.get, bundledCategories())).toMatchObject({
      outcome: "drifted",
      added: [999],
      removed: [217],
    });
  });

  it("reports rather than throws when the sitemap cannot be read", async () => {
    const site = fakeSite({ refuse: [CATEGORIES_SITEMAP_URL] });
    expect(await checkCategoryDrift(site.get, bundledCategories())).toEqual({
      dataset: "categories",
      outcome: "unavailable",
      message: `GET ${CATEGORIES_SITEMAP_URL} answered 503`,
    });
  });

  it("fails a 200 that carries no category at all, because the status is not the test", async () => {
    // A block presents as HTTP 200 with an empty list (ADR-0003), and an empty
    // live set would otherwise read as every category having been removed.
    const site = fakeSite({ categoryIds: [] });
    expect(await checkCategoryDrift(site.get, bundledCategories())).toMatchObject({
      outcome: "unavailable",
      message: expect.stringContaining("listed no categories"),
    });
  });

  it("writes nothing: the committed dataset is untouched by a drifting check", async () => {
    const dataset = new URL("../../data/category-tree.json", import.meta.url);
    const before = readFileSync(dataset, "utf8");
    const site = fakeSite({ categoryIds: [1, 2, 3] });
    expect((await checkCategoryDrift(site.get, bundledCategories())).outcome).toBe("drifted");
    expect(readFileSync(dataset, "utf8")).toBe(before);
  });
});

describe("the location leg", () => {
  it("walks the sitemap, the katalog root and every state — 18 requests", async () => {
    const site = fakeSite();
    await checkLocationDrift(site.get, bundledLocations());
    expect(site.urls).toHaveLength(18);
    expect(site.urls.slice(0, 3)).toEqual([
      CITIES_SITEMAP_URL,
      KATALOG_URL,
      `${KATALOG_URL}?locationId=100`,
    ]);
  });

  it("is clean when both the ids and the German names agree", async () => {
    const site = fakeSite();
    expect(await checkLocationDrift(site.get, bundledLocations())).toMatchObject({
      outcome: "clean",
      bundled_count: 32,
      live_count: 32,
    });
  });

  it("catches a rename, which the cities sitemap alone never could", async () => {
    // The reason the katalog walk is not optional: the sitemap carries ids and
    // no names, so l1000 renamed is invisible to it (SPEC 7, ADR-0004).
    const localities = new Map(LOCALITIES);
    localities.set(100, [{ id: 1000, name: "Ort in Land 0, umbenannt" }]);
    const site = fakeSite({ localities });
    expect(await checkLocationDrift(site.get, bundledLocations())).toMatchObject({
      outcome: "drifted",
      added: [],
      removed: [],
      renamed: [{ id: 1000, from: "Ort in Land 0", to: "Ort in Land 0, umbenannt" }],
    });
  });

  it("catches a locality the katalog dropped, which breaks find_location for it", async () => {
    const localities = new Map(LOCALITIES);
    localities.set(100, [{ id: 1001, name: "Neuer Ort" }]);
    const site = fakeSite({ localities, sitemapLocationIds: [1001] });
    expect(await checkLocationDrift(site.get, bundledLocations())).toMatchObject({
      outcome: "drifted",
      added: [1001],
      removed: [1000],
    });
  });

  it("counts an id the sitemap publishes and the katalog does not as an addition", async () => {
    // The live set is the union of both sources: an id in either is a location
    // the bundle is missing. It carries no name, so it is never a rename.
    const site = fakeSite({ sitemapLocationIds: [4242] });
    expect(await checkLocationDrift(site.get, bundledLocations())).toMatchObject({
      outcome: "drifted",
      added: [4242],
      removed: [],
      renamed: [],
    });
  });

  it("does not read the 140 ids the sitemap withholds as removals", async () => {
    // Berlin, Hamburg, Köln and 137 more appear only as `/stadt/` landing
    // pages, so a sitemap-only diff would report them missing every run.
    const site = fakeSite({ sitemapLocationIds: [1000] });
    expect(await checkLocationDrift(site.get, bundledLocations())).toMatchObject({
      outcome: "clean",
    });
  });

  it("fails a katalog page that answers 200 with no location on it", async () => {
    const localities = new Map(LOCALITIES);
    localities.set(105, []);
    const site = fakeSite({ localities });
    expect(await checkLocationDrift(site.get, bundledLocations())).toMatchObject({
      outcome: "unavailable",
      message: "the catalogue listed no localities in Land 5",
    });
  });

  it("refuses a katalog root that no longer lists sixteen federal states", async () => {
    // The number is what 19 requests assumes and what the generator asserts. A
    // root listing some other number is a page whose shape moved under us, so
    // it is a leg that learnt nothing rather than sixteen states' worth of drift.
    const site = fakeSite({ states: STATES.slice(0, 15) });
    expect(await checkLocationDrift(site.get, bundledLocations())).toMatchObject({
      outcome: "unavailable",
      message: "the catalogue listed 15 federal states, not 16",
    });
    expect(site.urls).toEqual([CITIES_SITEMAP_URL, KATALOG_URL]);
  });

  it("abandons the rest of the walk once a leg has failed", async () => {
    // Sixteen more requests into a site that just refused one learn nothing,
    // and they are not polite.
    const site = fakeSite({ refuse: [KATALOG_URL] });
    expect((await checkLocationDrift(site.get, bundledLocations())).outcome).toBe("unavailable");
    expect(site.urls).toEqual([CITIES_SITEMAP_URL, KATALOG_URL]);
  });
});

describe("one run over both datasets", () => {
  it("is 19 requests: 1 + 1 + 17", async () => {
    const site = fakeSite();
    await runDriftCheck(site.get, bundled());
    expect(site.urls).toHaveLength(19);
  });

  it("exits 0 and says so for both datasets when neither has moved", async () => {
    const site = fakeSite();
    const reports = await runDriftCheck(site.get, bundled());
    expect(driftExitCode(reports)).toBe(0);
    expect(formatReport(reports)).toEqual([
      "categories: clean — 3 bundled, 3 live",
      "locations: clean — 32 bundled, 32 live",
    ]);
  });

  it("checks the locations even when the categories leg never reached the site", async () => {
    // Real drift is never swallowed by the other half's failure: the exit is 2,
    // and the location drift is still in the report as drift (SPEC 7).
    const localities = new Map(LOCALITIES);
    localities.set(100, [{ id: 1000, name: "Umbenannt" }]);
    const site = fakeSite({ localities, refuse: [CATEGORIES_SITEMAP_URL] });
    const reports = await runDriftCheck(site.get, bundled());

    expect(driftExitCode(reports)).toBe(2);
    expect(reports.map((report) => report.outcome)).toEqual(["unavailable", "drifted"]);
    expect(formatReport(reports).join("\n")).toContain("locations: DRIFTED");
  });

  it("exits 1 on real drift in either dataset", async () => {
    const site = fakeSite({ categoryIds: [210, 216, 217, 999] });
    expect(driftExitCode(await runDriftCheck(site.get, bundled()))).toBe(1);
  });
});

describe("the datasets the run diffs against", () => {
  it("reads the committed data/, through the same schemas the server uses", () => {
    const datasets = readBundledDatasets();
    // 159 categories and 16 + 11 215 locations, as SPEC 7 records them.
    expect(datasets.categories.size).toBe(159);
    expect(datasets.categories.get(210)).toBe("Auto, Rad & Boot");
    expect(datasets.locations.size).toBeGreaterThan(11000);
    expect(datasets.locations.get(3331)).toBe("Berlin");
  });
});
