import { describe, expect, it } from "vitest";
import type { CityDataset } from "./city-dataset.ts";
import { findLocations, qualifiedLocationName } from "./find-locations.ts";

const state = (location_id: number, name: string, slug: string) =>
  ({ location_id, name, slug, level: "state", state: name }) as const;

const locality = (location_id: number, name: string, slug: string, state: string) =>
  ({ location_id, name, slug, level: "locality", state }) as const;

const DATASET: CityDataset = [
  state(928, "Nordrhein-Westfalen", "nordrhein-westfalen"),
  state(3331, "Berlin", "berlin"),
  locality(945, "Köln", "koeln", "Nordrhein-Westfalen"),
  locality(3518, "Mitte", "mitte", "Berlin"),
  locality(9800, "Mitte", "mitte-nrw", "Nordrhein-Westfalen"),
  locality(16970, "Kr. München", "kr-muenchen", "Bayern"),
];

describe("qualifiedLocationName", () => {
  it("qualifies a locality with its federal state", () => {
    expect(qualifiedLocationName(DATASET[2]!)).toBe("Nordrhein-Westfalen > Köln");
  });

  it("leaves a federal state unqualified", () => {
    expect(qualifiedLocationName(DATASET[1]!)).toBe("Berlin");
  });
});

describe("findLocations", () => {
  it("matches a name regardless of case and diacritics", () => {
    expect(findLocations(DATASET, "köln").map((l) => l.location_id)).toEqual([945]);
    expect(findLocations(DATASET, "KOLN").map((l) => l.location_id)).toEqual([945]);
  });

  it("matches the way a German writes an umlaut on an ASCII keyboard", () => {
    expect(findLocations(DATASET, "koeln").map((l) => l.location_id)).toEqual([945]);
    expect(findLocations(DATASET, "kr. muenchen").map((l) => l.location_id)).toEqual([16970]);
  });

  it("returns every location a colliding name could mean, never one of them", () => {
    expect(findLocations(DATASET, "Mitte").map((l) => l.location_id)).toEqual([3518, 9800]);
  });

  it("narrows a collision through the qualified form", () => {
    expect(findLocations(DATASET, "Berlin > Mitte").map((l) => l.location_id)).toEqual([3518]);
  });

  it("matches a federal state, which is a location like any other", () => {
    expect(findLocations(DATASET, "Nordrhein-Westfalen").map((l) => l.location_id)).toEqual([928]);
  });

  it("never matches on a slug", () => {
    expect(findLocations(DATASET, "kr-muenchen")).toEqual([]);
    expect(findLocations(DATASET, "mitte-nrw")).toEqual([]);
  });

  it("does no fuzzy or substring matching", () => {
    expect(findLocations(DATASET, "Köl")).toEqual([]);
    expect(findLocations(DATASET, "München")).toEqual([]);
    expect(findLocations(DATASET, "Nordrhein")).toEqual([]);
  });

  it("answers a postcode with no matches: the postcode layer has no ids", () => {
    expect(findLocations(DATASET, "10115")).toEqual([]);
  });

  it("answers an unknown name with no matches rather than an error", () => {
    expect(findLocations(DATASET, "Atlantis")).toEqual([]);
  });

  it("answers a blank query with no matches", () => {
    expect(findLocations(DATASET, "   ")).toEqual([]);
  });
});
