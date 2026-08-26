import type { FailureReason } from "../envelope.ts";
import { getFetchCore, type FetchCore } from "../fetch/core.ts";
import { FetchError } from "../fetch/errors.ts";
import { log } from "../logging.ts";
import { CATEGORIES_SITEMAP_URL, parseCategorySitemap } from "./category-sitemap.ts";
import { loadCategoryTree, type CategoryTree } from "./category-tree.ts";

/** What a maintainer runs when the check reports drift. Drift is fixed by shipping a new version. */
export const REBUILD_COMMAND = "npm run generate:category-tree";

/** What the site gained and what it dropped, each sorted ascending. */
export type CategoryIdDiff = {
  added: number[];
  removed: number[];
};

/**
 * The check's answer.
 *
 * A tagged union rather than a boolean with optional fields: "could not be
 * read" is a third outcome, and reading it as "clean" would report a healthy
 * bundle for a check that never happened.
 */
type Counts = {
  bundled_count: number;
  live_count: number;
  /** Whether the live side came from the cache after a failure, not from the site. */
  stale: boolean;
};

export type CategoryDriftReport =
  | ({ outcome: "clean" } & Counts)
  | ({ outcome: "drifted" } & Counts & CategoryIdDiff)
  | { outcome: "unavailable"; reason: FailureReason; message: string };

const ascending = (left: number, right: number): number => left - right;

/** Set difference both ways. Order in either input is immaterial. */
export function diffCategoryIds(bundled: Iterable<number>, live: Iterable<number>): CategoryIdDiff {
  const before = new Set(bundled);
  const after = new Set(live);
  return {
    added: [...after].filter((id) => !before.has(id)).sort(ascending),
    removed: [...before].filter((id) => !after.has(id)).sort(ascending),
  };
}

export type CategoryDriftOptions = {
  core?: FetchCore;
  readCategoryTree?: () => CategoryTree;
};

/**
 * The one maintenance affordance: **one request, ~2 KB**, diffing the live id
 * set against the bundled one (SPEC 7).
 *
 * It **reads and reports and writes nothing** — drift is fixed by shipping a
 * new version, not by a runtime write (ADR-0002). It is explicitly invoked and
 * opportunistic: nothing on the request path calls it, so it never runs on a
 * tool call. Nothing here is conditioned on the sitemap index's `lastmod`,
 * for the reason `parseCategorySitemap` gives.
 *
 * A sitemap that cannot be read is reported, never thrown: a maintenance check
 * that fails because the site is down has learnt nothing, which is not the same
 * as having learnt that the bundle is fine.
 */
export async function checkCategoryDrift({
  core = getFetchCore(),
  readCategoryTree = loadCategoryTree,
}: CategoryDriftOptions = {}): Promise<CategoryDriftReport> {
  const bundled = readCategoryTree().map((node) => node.category_id);

  let live: number[];
  let stale = false;
  try {
    const { data, envelope } = await core.fetch(CATEGORIES_SITEMAP_URL, (body) =>
      parseCategorySitemap(body).map((entry) => entry.category_id),
    );
    live = data;
    // A stale serve diffed cached bytes rather than the site as it is now, and
    // "clean" would be a claim about the wrong moment. Unreachable from the
    // one-shot CLI, whose cache is empty — but the function is exported.
    stale = envelope.stale;
  } catch (error) {
    const failure =
      error instanceof FetchError
        ? error
        : new FetchError("network", error instanceof Error ? error.message : String(error));
    log("category_drift_unavailable", {
      level: "error",
      url: CATEGORIES_SITEMAP_URL,
      reason: failure.reason,
      message: failure.message,
    });
    return { outcome: "unavailable", reason: failure.reason, message: failure.message };
  }

  const counts = { bundled_count: bundled.length, live_count: live.length, stale };
  const { added, removed } = diffCategoryIds(bundled, live);

  if (added.length === 0 && removed.length === 0) {
    log("category_drift_clean", counts);
    return { outcome: "clean", ...counts };
  }

  log("category_drift", { level: "warn", ...counts, added, removed, rebuild: REBUILD_COMMAND });
  return { outcome: "drifted", ...counts, added, removed };
}

/**
 * What the process exits with after a check: 0 clean, 1 drifted, 2 could not be
 * checked. The third is deliberately not 0 — a check that never reached the
 * sitemap has not established that the bundle is current (SPEC 7).
 *
 * **A stale clean is a 2, not a 0.** The exit code is the machine-readable
 * answer, and a diff computed against cached bytes after a failure is a claim
 * about an earlier moment — which is the same thing 2 already means. A stale
 * *drift* stays 1: those cached bytes were a real answer once, so a difference
 * against the bundle is real drift whenever it was read.
 */
export function driftExitCode(report: CategoryDriftReport): number {
  switch (report.outcome) {
    case "clean":
      return report.stale ? 2 : 0;
    case "drifted":
      return 1;
    case "unavailable":
      return 2;
  }
}
