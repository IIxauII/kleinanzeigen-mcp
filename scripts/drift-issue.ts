/**
 * The monthly cron's second half: turn a drift run's per-dataset report into
 * the tracking issue, or into the decision that there is nothing to open.
 *
 *     node scripts/check-drift.ts --json > report.json
 *     node scripts/drift-issue.ts report.json > issue.md
 *
 * It reads the **report**, never the drift check's exit code — the reasoning
 * for that, and for what each outcome opens, is in `scripts/drift/issue.ts`,
 * where the decision lives under test. This file is the plumbing around it: the
 * issue body goes to stdout, and `drift`, `title` and `marker` go to
 * `$GITHUB_OUTPUT` when there is one, or to stderr when a maintainer is running
 * it by hand.
 *
 * A missing or unreadable report is an error, not "no drift". The cron would
 * otherwise report itself green in exactly the case where it learnt nothing —
 * the same failure `describe.skipIf` was in `tests/stdio-server.test.ts`.
 */
import { appendFileSync, readFileSync } from "node:fs";
import { TRACKING_ISSUE_MARKER, trackingIssue } from "./drift/issue.ts";
import { parseReports } from "./drift/report.ts";
import { note } from "./lib/site.ts";

const USAGE = "usage: node scripts/drift-issue.ts <report.json>";

/**
 * `key=value` for `$GITHUB_OUTPUT`, or a stderr line when run outside Actions.
 *
 * One line per value, so a value carrying a newline would silently become two
 * outputs. Everything written here is a constant or a fixed word; a value that
 * is not is refused rather than mangled.
 */
function writeStepOutputs(outputs: Record<string, string>): void {
  const lines = Object.entries(outputs).map(([key, value]) => {
    if (value.includes("\n")) throw new Error(`step output ${key} spans lines: ${JSON.stringify(value)}`);
    return `${key}=${value}`;
  });
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

  let reports;
  try {
    reports = parseReports(readFileSync(path, "utf8"));
  } catch (error) {
    note(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  const issue = trackingIssue(reports, runUrl());
  if (issue === null) {
    note("no dataset drifted: nothing to open, nothing to update.");
    writeStepOutputs({ drift: "false" });
    return 0;
  }

  process.stdout.write(issue.body);
  writeStepOutputs({ drift: "true", title: issue.title, marker: TRACKING_ISSUE_MARKER });
  return 0;
}

/** The run that found the drift, when Actions is the caller. */
function runUrl(): string | undefined {
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;
  if (!GITHUB_SERVER_URL || !GITHUB_REPOSITORY || !GITHUB_RUN_ID) return undefined;
  return `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`;
}

process.exitCode = main();
