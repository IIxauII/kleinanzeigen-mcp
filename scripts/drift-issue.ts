/**
 * The monthly cron's second half: turn a drift run's per-dataset report into
 * the tracking issue, or into the decision that there is nothing to open.
 *
 *     node scripts/check-drift.ts --json > report.json
 *     node scripts/drift-issue.ts report.json > issue.md
 *
 * It reads the **report**, never the drift check's exit code. A dataset at
 * `drifted` opens an issue even when the other dataset's outage pushed that
 * exit to `2`; a run that only failed to reach the site opens nothing at all
 * (SPEC 7, `docs/maintenance.md`). The decision itself lives in
 * `scripts/drift/issue.ts`, under test — this file is the plumbing around it.
 *
 * The issue body goes to stdout; `drift` and `title` go to `$GITHUB_OUTPUT`
 * when there is one, and to stderr when a maintainer is running it by hand.
 *
 * A missing or unreadable report is an error, not "no drift". The cron would
 * otherwise report itself green in exactly the case where it learnt nothing —
 * the same failure `describe.skipIf` was in `tests/stdio-server.test.ts`.
 */
import { appendFileSync, readFileSync } from "node:fs";
import { trackingIssue } from "./drift/issue.ts";
import type { DatasetReport } from "./drift/report.ts";
import { note } from "./lib/site.ts";

const USAGE = "usage: node scripts/drift-issue.ts <report.json>";

/**
 * The report as `scripts/check-drift.ts --json` writes it. Checked rather than
 * cast: a shape that changed underneath this script must fail here, where the
 * message says so, instead of composing an issue body out of `undefined`.
 */
function readReports(path: string): DatasetReport[] {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(`${path} is not a drift report: expected a non-empty array`);
  }
  for (const entry of parsed) {
    const report = entry as Partial<DatasetReport>;
    if (typeof report?.dataset !== "string" || typeof report?.outcome !== "string") {
      throw new Error(`${path} is not a drift report: an entry has no dataset and outcome`);
    }
  }
  return parsed as DatasetReport[];
}

/** `key=value` for `$GITHUB_OUTPUT`, or a stderr line when run outside Actions. */
function emit(outputs: Record<string, string>): void {
  const lines = Object.entries(outputs).map(([key, value]) => `${key}=${value}`);
  const target = process.env.GITHUB_OUTPUT;
  if (target === undefined || target === "") {
    for (const line of lines) note(line);
    return;
  }
  appendFileSync(target, `${lines.join("\n")}\n`);
}

function main(): number {
  const [path, ...rest] = process.argv.slice(2);
  if (path === undefined || rest.length > 0) {
    note(USAGE);
    return 64;
  }

  const issue = trackingIssue(readReports(path), runUrl());
  if (issue === null) {
    note("no dataset drifted: nothing to open, nothing to update.");
    emit({ drift: "false" });
    return 0;
  }

  process.stdout.write(issue.body);
  emit({ drift: "true", title: issue.title });
  return 0;
}

/** The run that found the drift, when Actions is the caller. */
function runUrl(): string | undefined {
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;
  if (!GITHUB_SERVER_URL || !GITHUB_REPOSITORY || !GITHUB_RUN_ID) return undefined;
  return `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`;
}

process.exitCode = main();
