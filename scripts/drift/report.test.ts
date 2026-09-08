import { describe, expect, it } from "vitest";
import {
  driftExitCode,
  formatReport,
  REBUILD_COMMANDS,
  reportFor,
  unavailable,
  type DatasetReport,
} from "./report.ts";

const bundled = (entries: [number, string][]): Map<number, string> => new Map(entries);

const CATEGORIES = bundled([
  [210, "Auto, Rad & Boot"],
  [216, "Autos"],
]);

describe("one dataset's verdict", () => {
  it("is clean when the ids and the names both agree", () => {
    expect(reportFor("categories", CATEGORIES, { ids: new Set([216, 210]) })).toEqual({
      dataset: "categories",
      outcome: "clean",
      bundled_count: 2,
      live_count: 2,
    });
  });

  it("names what the site gained and what it dropped, each sorted", () => {
    expect(reportFor("categories", CATEGORIES, { ids: new Set([216, 999, 300]) })).toEqual({
      dataset: "categories",
      outcome: "drifted",
      bundled_count: 2,
      live_count: 3,
      added: [300, 999],
      removed: [210],
      renamed: [],
    });
  });

  it("counts a renamed node as drift even though its id never moved", () => {
    // `find_location` matches on the name, so a rename stops the bundled row
    // resolving (CONTEXT.md, Location drift). It is the whole reason the check
    // walks the katalog rather than the cities sitemap alone.
    const live = { ids: new Set([3331]), names: new Map([[3331, "Berlin (Stadt)"]]) };
    expect(reportFor("locations", bundled([[3331, "Berlin"]]), live)).toMatchObject({
      outcome: "drifted",
      added: [],
      removed: [],
      renamed: [{ id: 3331, from: "Berlin", to: "Berlin (Stadt)" }],
    });
  });

  it("does not read a leg that carries no names as evidence of no renames", () => {
    // The categories sitemap has ids and no labels: silence about names is not
    // a claim about them (SPEC 7).
    expect(reportFor("categories", CATEGORIES, { ids: new Set([210, 216]) })).toMatchObject({
      outcome: "clean",
    });
  });

  it("says nothing about a name it has for an id the bundle never had", () => {
    // That id is an addition, not a rename; reporting both would double-count it.
    const live = { ids: new Set([1, 2]), names: new Map([[2, "Neu"]]) };
    expect(reportFor("locations", bundled([[1, "Alt"]]), live)).toMatchObject({
      added: [2],
      removed: [],
      renamed: [],
    });
  });
});

describe("what the whole run exits with", () => {
  const clean = (dataset: "categories" | "locations"): DatasetReport => ({
    dataset,
    outcome: "clean",
    bundled_count: 1,
    live_count: 1,
  });
  const drifted = (dataset: "categories" | "locations"): DatasetReport => ({
    dataset,
    outcome: "drifted",
    bundled_count: 1,
    live_count: 2,
    added: [999],
    removed: [],
    renamed: [],
  });

  it("is 0 when both datasets match the site", () => {
    expect(driftExitCode([clean("categories"), clean("locations")])).toBe(0);
  });

  it("is 1 when either dataset has really drifted", () => {
    expect(driftExitCode([clean("categories"), drifted("locations")])).toBe(1);
  });

  it("is 2 when a leg never reached the site, which is not the same as clean", () => {
    expect(driftExitCode([unavailable("categories", new Error("boom")), clean("locations")])).toBe(2);
  });

  it("lets 2 outrank 1: a run with a leg missing has not found all the drift there is", () => {
    expect(driftExitCode([unavailable("categories", new Error("boom")), drifted("locations")])).toBe(2);
  });
});

describe("the stderr report", () => {
  it("names each dataset's outcome separately, whatever the exit code is", () => {
    // The exit is 2 here, and the drift must still be readable as drift: issue
    // opening is driven by the report, never by the process exit (SPEC 7).
    const reports = [
      unavailable("categories", new Error("GET https://example/x answered 503")),
      reportFor("locations", new Map([[1, "Alt"]]), {
        ids: new Set([1]),
        names: new Map([[1, "Neu"]]),
      }),
    ];
    expect(driftExitCode(reports)).toBe(2);
    expect(formatReport(reports)).toEqual([
      "categories: UNAVAILABLE — GET https://example/x answered 503",
      "locations: DRIFTED — 1 bundled, 1 live",
      "  renamed: l1 Alt → Neu",
      `  rebuild: ${REBUILD_COMMANDS.locations}`,
    ]);
  });

  it("points a maintainer at the rebuild for the dataset that moved, and only that one", () => {
    const lines = formatReport([
      reportFor("categories", CATEGORIES, { ids: new Set([210, 216, 999]) }),
      reportFor("locations", new Map([[1, "Alt"]]), { ids: new Set([1]) }),
    ]).join("\n");
    expect(lines).toContain("npm run generate:category-tree");
    expect(lines).not.toContain("npm run generate:cities");
    expect(REBUILD_COMMANDS).toEqual({
      categories: "npm run generate:category-tree",
      locations: "npm run generate:cities",
    });
  });

  it("shouts about removals, because a removed id stops resolving for a caller", () => {
    const lines = formatReport([reportFor("locations", bundled([[1, "Alt"]]), { ids: new Set() })]);
    expect(lines).toContain("  REMOVED 1: l1");
  });

  it("caps a taxonomy-wide change at ten ids and counts the rest", () => {
    const live = new Set(Array.from({ length: 13 }, (_, index) => 1000 + index));
    const lines = formatReport([reportFor("categories", new Map(), { ids: live })]);
    expect(lines[1]).toBe("  added 13: c1000, c1001, c1002, c1003, c1004, c1005, c1006, c1007, c1008, c1009, … and 3 more");
  });

  it("says a clean dataset is clean, so a clean run is not silence", () => {
    expect(formatReport([reportFor("categories", CATEGORIES, { ids: new Set([210, 216]) })])) //
      .toEqual(["categories: clean — 2 bundled, 2 live"]);
  });
});
