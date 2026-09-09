/**
 * The tracking issue the monthly cron opens — or updates — when a dataset has
 * drifted.
 *
 * Two decisions live here, and both are the reason this is a module with tests
 * rather than a few lines of YAML:
 *
 * - **Issue-opening reads the report, not the process exit.** A dataset at
 *   `drifted` opens an issue even when the other dataset's outage pushed the
 *   exit to `2`. Real drift is never swallowed by the other half's failure.
 * - **`2` alone opens nothing.** A check that never reached the site has learnt
 *   nothing, and an issue would claim otherwise (SPEC 7, `docs/maintenance.md`).
 *
 * There is exactly one such issue: drift that persists across months is one
 * condition, not one per month. The title and the marker below are how the
 * workflow finds it again.
 */
import { formatReport, REBUILD_COMMANDS, type DatasetReport } from "./report.ts";

/** Fixed, so the cron finds last month's issue instead of opening this month's. */
export const TRACKING_ISSUE_TITLE = "Dataset drift: the bundled datasets are out of step with the site";

/**
 * Also fixed, and in the body rather than in a label: a label can be removed by
 * hand, and the identity of the one tracking issue should not depend on that.
 */
export const TRACKING_ISSUE_MARKER = "<!-- kleinanzeigen-mcp:dataset-drift -->";

export type TrackingIssue = { title: string; body: string };

/**
 * The issue for this run's report, or `null` when there is nothing to open.
 *
 * `runUrl` is the Actions run that produced the report; it is optional because
 * a maintainer running this by hand has no run to link.
 */
export function trackingIssue(
  reports: readonly DatasetReport[],
  runUrl?: string,
): TrackingIssue | null {
  const driftedDatasets = reports.filter((report) => report.outcome === "drifted");
  if (driftedDatasets.length === 0) return null;

  const partial = reports.some((report) => report.outcome === "unavailable");

  const body = [
    "The monthly drift check found a bundled dataset out of step with the site.",
    "",
    // The same rendering the run's log carries, so the issue and the log cannot
    // disagree about what was found.
    "```",
    ...formatReport(reports),
    "```",
    "",
    ...(partial
      ? [
          "One dataset never reached the site, so this is **not all the drift there is** —",
          "the run that clears this issue is the one where every dataset is checked and clean.",
          "",
        ]
      : []),
    // Paths, not links: relative links do not resolve in an issue body, and an
    // absolute one would pin a branch this issue outlives.
    "Dataset drift is fixed by regenerating the dataset and shipping a new version,",
    "never by a runtime write (ADR-0002):",
    "",
    "```bash",
    ...driftedDatasets.map((report) => REBUILD_COMMANDS[report.dataset]),
    "npm run check:drift                # confirm 0",
    "npm test",
    "```",
    "",
    "Commit by what changed, because `semantic-release` reads it: additions and churn are",
    "`fix(data): …`, a category or locality **renamed or removed** is `feat(data): …`. After a",
    "removal an argument that resolved against the previous version stops resolving, which is",
    "why that one is a minor. Full procedure: `docs/maintenance.md`.",
    "",
    ...(runUrl ? [`Found by ${runUrl}.`, ""] : []),
    "This issue is updated in place while the condition lasts — drift that survives across",
    "months is one condition, not one per month.",
    "",
    TRACKING_ISSUE_MARKER,
  ].join("\n");

  return { title: TRACKING_ISSUE_TITLE, body };
}
