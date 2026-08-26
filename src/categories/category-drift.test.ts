import { existsSync, readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Cache } from "../fetch/cache.ts";
import { createFetchCore, type FetchImpl } from "../fetch/core.ts";
import { CATEGORIES_SITEMAP_URL } from "./category-sitemap.ts";
import {
  checkCategoryDrift,
  diffCategoryIds,
  driftExitCode,
  REBUILD_COMMAND,
  type CategoryDriftReport,
} from "./category-drift.ts";
import type { CategoryNode, CategoryTree } from "./category-tree.ts";

const FIXTURE = new URL("../../tests/fixtures/sitemap-categories.xml", import.meta.url);
const BUNDLED_DATASET = new URL("../../data/category-tree.json", import.meta.url);

const sitemap = (): string => readFileSync(FIXTURE, "utf8");

/** The seven ids the fixture lists, as a bundle that agrees with it exactly. */
function treeOf(ids: number[]): CategoryTree {
  return ids.map(
    (id): CategoryNode => ({
      category_id: id,
      name: `c${id}`,
      slug: `c${id}`,
      path: `/s-c${id}/c${id}`,
      parent_id: null,
      parent_name: null,
    }),
  );
}

const FIXTURE_IDS = [210, 216, 217, 231, 286, 192, 273];

type Harness = {
  urls: string[];
  report: () => Promise<CategoryDriftReport>;
};

function harness(options: { xml?: string; status?: number; ids?: number[] } = {}): Harness {
  const urls: string[] = [];
  const fetchImpl: FetchImpl = (url) => {
    urls.push(url);
    return Promise.resolve(
      new Response(options.xml ?? sitemap(), {
        status: options.status ?? 200,
        headers: { "content-type": "application/xml" },
      }),
    );
  };
  const core = createFetchCore({ rateLimitMs: 0, fetchImpl });
  const tree = treeOf(options.ids ?? FIXTURE_IDS);
  return { urls, report: () => checkCategoryDrift({ core, readCategoryTree: () => tree }) };
}

describe("diffing the taxonomy's id set", () => {
  it("is empty when the two sets agree, whatever order they arrive in", () => {
    expect(diffCategoryIds([210, 216, 217], [217, 210, 216])).toEqual({ added: [], removed: [] });
  });

  it("names what the site gained and what it dropped, each sorted", () => {
    expect(diffCategoryIds([210, 216, 217], [217, 210, 999, 300])).toEqual({
      added: [300, 999],
      removed: [216],
    });
  });
});

describe("the category drift check", () => {
  let stderr: string[];

  beforeEach(() => {
    stderr = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      stderr.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches the categories sitemap and nothing else — one request, ~2 KB", async () => {
    const { urls, report } = harness();
    await report();
    expect(urls).toEqual([CATEGORIES_SITEMAP_URL]);
  });

  it("reports a clean bundle when the id sets agree", async () => {
    const { report } = harness();
    expect(await report()).toEqual({ outcome: "clean", bundled_count: 7, live_count: 7, stale: false });
  });

  it("names the added and removed ids when the taxonomy has moved", async () => {
    const { report } = harness({ ids: [210, 216, 217, 231, 286, 192, 4242] });
    expect(await report()).toEqual({
      outcome: "drifted",
      bundled_count: 7,
      live_count: 7,
      stale: false,
      added: [273],
      removed: [4242],
    });
  });

  it("warns on stderr and points a maintainer at the rebuild", async () => {
    const { report } = harness({ ids: [210, 216, 217, 231, 286, 192] });
    await report();
    const warning = stderr.map((line) => JSON.parse(line)).find((line) => line.level === "warn");
    expect(warning).toMatchObject({
      event: "category_drift",
      added: [273],
      removed: [],
      rebuild: REBUILD_COMMAND,
    });
    expect(REBUILD_COMMAND).toBe("npm run generate:category-tree");
  });

  it("says so on stderr when there is no drift, so a clean run is not silence", async () => {
    const { report } = harness();
    await report();
    expect(stderr.map((line) => JSON.parse(line)).map((line) => line.event)) //
      .toContain("category_drift_clean");
  });

  it("writes nothing: the bundled dataset is untouched by a drifting check", async () => {
    const before = readFileSync(BUNDLED_DATASET, "utf8");
    const { report } = harness({ ids: [1, 2, 3] });
    expect((await report()).outcome).toBe("drifted");
    expect(readFileSync(BUNDLED_DATASET, "utf8")).toBe(before);
  });

  it("reports rather than throws when the sitemap cannot be read", async () => {
    const { report } = harness({ status: 503 });
    const result = await report();
    expect(result).toMatchObject({ outcome: "unavailable", reason: "http_error" });
    expect(stderr.map((line) => JSON.parse(line)).map((line) => line.event)) //
      .toContain("category_drift_unavailable");
  });

  it("says the answer was stale when a failure fell back to a cached sitemap", async () => {
    // Nothing was fresh, so the second call reaches the site, fails, and falls
    // back — the same path SPEC 6.2 puts every tool on. "clean" against cached
    // bytes is a claim about the wrong moment, so the report says which.
    const entries = new Map<string, { value: unknown; fetched_at: string }>();
    const cache: Cache<unknown> = {
      get: (key) => {
        const entry = entries.get(key);
        return entry === undefined ? null : { ...entry, fresh: false };
      },
      set: (key, value) => {
        const entry = { value, fetched_at: "2026-08-26T00:00:00.000Z" };
        entries.set(key, entry);
        return { ...entry, fresh: true };
      },
      size: () => entries.size,
    };

    let failing = false;
    const fetchImpl: FetchImpl = () =>
      Promise.resolve(new Response(failing ? "" : sitemap(), { status: failing ? 503 : 200 }));
    const core = createFetchCore({ rateLimitMs: 0, fetchImpl, cache });
    const tree = treeOf(FIXTURE_IDS);
    const run = (): Promise<CategoryDriftReport> =>
      checkCategoryDrift({ core, readCategoryTree: () => tree });

    expect(await run()).toMatchObject({ outcome: "clean", stale: false });
    failing = true;
    expect(await run()).toMatchObject({ outcome: "clean", stale: true });
  });

  it("reports rather than throws when the sitemap no longer parses", async () => {
    const { report } = harness({ xml: '<?xml version="1.0"?><urlset></urlset>' });
    expect(await report()).toMatchObject({ outcome: "unavailable", reason: "parse_failure" });
  });
});

describe("what the drift check exits with", () => {
  it("is 0 for a clean bundle", () => {
    expect(driftExitCode({ outcome: "clean", bundled_count: 159, live_count: 159, stale: false })).toBe(0);
  });

  it("is 1 for drift, so a maintainer's script can act on it", () => {
    expect(
      driftExitCode({
        outcome: "drifted",
        bundled_count: 159,
        live_count: 160,
        stale: false,
        added: [999],
        removed: [],
      }),
    ).toBe(1);
  });

  it("is 2 when the check could not run, which is not the same as clean", () => {
    expect(driftExitCode({ outcome: "unavailable", reason: "block", message: "blocked" })).toBe(2);
  });

  it("is 2 for a clean answer that came from the cache, not from the site", () => {
    // The exit code is the machine-readable answer, and 0 would claim the
    // bundle is current *now* on the strength of an earlier moment's bytes.
    expect(driftExitCode({ outcome: "clean", bundled_count: 159, live_count: 159, stale: true })) //
      .toBe(2);
  });

  it("is still 1 for drift found in cached bytes, because that drift was real", () => {
    expect(
      driftExitCode({
        outcome: "drifted",
        bundled_count: 159,
        live_count: 160,
        stale: true,
        added: [999],
        removed: [],
      }),
    ).toBe(1);
  });
});

describe("what the drift check is not wired into", () => {
  const MODULE = "category-drift";
  const TOOLS = new URL("../tools/", import.meta.url);

  /**
   * It is explicitly invoked and opportunistic: nothing on the request path may
   * reach for it, or it would run on every call (SPEC 7).
   *
   * Every tool is enumerated rather than listed, so a seventh one is covered
   * the day it lands — and the module's own path is asserted first, so renaming
   * it cannot make the whole check pass by matching nothing.
   */
  it("is imported by no tool and by no server wiring", () => {
    expect(existsSync(new URL(`./${MODULE}.ts`, import.meta.url))).toBe(true);

    const tools = readdirSync(TOOLS)
      .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
      .map((file) => new URL(file, TOOLS));
    // The six of SPEC 4, plus `tool-result.ts` and `descriptions` helpers.
    expect(tools.length).toBeGreaterThanOrEqual(6);

    for (const file of [new URL("../server.ts", import.meta.url), ...tools]) {
      expect(readFileSync(file, "utf8"), file.pathname).not.toContain(MODULE);
    }
  });
});
