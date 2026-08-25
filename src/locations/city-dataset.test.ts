import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { beforeEach, describe, expect, it } from "vitest";
import {
  CityDatasetFileSchema,
  decodeCityDataset,
  isCityDatasetLoaded,
  loadCityDataset,
  resetCityDataset,
} from "./city-dataset.ts";

const BUNDLED = new URL("../../data/cities.json", import.meta.url);

describe("the bundled city dataset", () => {
  beforeEach(resetCityDataset);

  it("is not read until it is first used", () => {
    expect(isCityDatasetLoaded()).toBe(false);
    loadCityDataset(BUNDLED);
    expect(isCityDatasetLoaded()).toBe(true);
  });

  it("is read once and memoised", () => {
    const first = loadCityDataset(BUNDLED);
    expect(loadCityDataset(BUNDLED)).toBe(first);
  });

  it("carries the catalogue's first two tiers: 16 federal states and their children", () => {
    const dataset = loadCityDataset(BUNDLED);
    expect(dataset.filter((location) => location.level === "state")).toHaveLength(16);
    expect(dataset).toHaveLength(11231);
  });

  it("stays a sidecar small enough to ship, one row per line", () => {
    const raw = readFileSync(BUNDLED);
    // SPEC 7 budgeted ~84 KB gzipped for a dataset of slugs and ids alone. The
    // five fields `find_location` returns cost roughly twice that; the tuple
    // encoding is what keeps it to twice rather than four times, and the line
    // per row is what keeps the drift check diffable.
    expect(gzipSync(raw, { level: 9 }).length).toBeLessThan(150_000);
    expect(raw.toString("utf8").trimEnd().split("\n")).toHaveLength(11231 + 6);
  });

  it("hard-codes the three city-states the sitemap omits", () => {
    const dataset = loadCityDataset(BUNDLED);
    const state = (id: number) => dataset.find((location) => location.location_id === id);
    expect(state(3331)).toMatchObject({ name: "Berlin", level: "state", state: "Berlin" });
    expect(state(9409)).toMatchObject({ name: "Hamburg", level: "state", state: "Hamburg" });
    expect(state(1)).toMatchObject({ name: "Bremen", level: "state", state: "Bremen" });
  });

  it("carries the major cities the sitemap gives no id at all", () => {
    const dataset = loadCityDataset(BUNDLED);
    const city = (id: number) => dataset.find((location) => location.location_id === id);
    expect(city(945)).toMatchObject({ name: "Köln", state: "Nordrhein-Westfalen" });
    expect(city(6411)).toMatchObject({ name: "München", state: "Bayern" });
  });

  it("gives every locality one of the sixteen states", () => {
    const dataset = loadCityDataset(BUNDLED);
    const states = new Set(
      dataset.filter((location) => location.level === "state").map((location) => location.name),
    );
    for (const location of dataset) {
      expect(states, `l${location.location_id} sits in ${location.state}`).toContain(location.state);
    }
  });

  it("identifies each location by a unique id, though names and slugs collide", () => {
    const dataset = loadCityDataset(BUNDLED);
    expect(new Set(dataset.map((location) => location.location_id)).size).toBe(dataset.length);
    expect(new Set(dataset.map((location) => location.name)).size).toBeLessThan(dataset.length);
    expect(new Set(dataset.map((location) => location.slug)).size).toBeLessThan(dataset.length);
  });

  it("puts the states first, in the catalogue's order", () => {
    const dataset = loadCityDataset(BUNDLED);
    expect(dataset[0]).toMatchObject({ location_id: 7970, name: "Baden-Württemberg" });
    expect(dataset[15]).toMatchObject({ location_id: 3548, name: "Thüringen" });
    expect(dataset[16]!.level).toBe("locality");
  });

  it("refuses a malformed dataset loudly", () => {
    expect(() => loadCityDataset(new URL("./find-locations.ts", import.meta.url))).toThrow();
  });

  it("refuses a locality whose state index names no state", () => {
    const file = CityDatasetFileSchema.parse(JSON.parse(readFileSync(BUNDLED, "utf8")));
    expect(() => decodeCityDataset({ ...file, locations: [[42, "Nirgendwo", "nirgendwo", 99]] })) //
      .toThrow("state index 99");
  });
});
