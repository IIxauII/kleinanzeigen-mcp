/**
 * The dataset drift check, run by a maintainer in a clone and by CI:
 *
 *     npm run check:drift
 *
 * **19 requests**, serialised at the generators' 1500 ms gap, about 28 seconds:
 * `sitemap_categories.xml`, `sitemap_cities.xml`, and the `/s-katalog-orte.html`
 * root plus its sixteen state pages. It **reads and reports and writes nothing**
 * — dataset drift is fixed by regenerating the dataset and shipping a new
 * version, never by a runtime write (SPEC 7, ADR-0002).
 *
 * It lives here rather than in the shipped binary, which takes no arguments
 * (SPEC 8.3). The stated cost: a published user cannot check their own bundle
 * (SPEC 9.17). The cron has a clone; a user does not need one.
 *
 * | exit | means |
 * | --- | --- |
 * | `0` | both datasets match the site |
 * | `1` | real drift |
 * | `2` | the check never reached the site |
 *
 * `2` outranks `1` outranks `0` — one process, one exit code, two datasets —
 * and the stderr report always names each dataset's outcome separately, because
 * a caller decides whether to open an issue from the report rather than from the
 * exit (`docs/maintenance.md`).
 *
 *     npm run check:drift -- --json
 *
 * writes that same per-dataset report to **stdout** as JSON, and changes nothing
 * else: the human report still goes to stderr and the exit code is unchanged.
 * The monthly cron needs the report as data, and the alternative — a workflow
 * regex over prose — would make the wording of a log line load-bearing.
 */
import { DATASET_NAMES, driftExitCode, formatReport, unavailable } from "./drift/report.ts";
import { readBundledDatasets, runDriftCheck } from "./drift/run.ts";
import { createGet, note } from "./lib/site.ts";

const JSON_FLAG = "--json";

const USAGE = [
  "usage: npm run check:drift [-- --json]",
  "",
  "  (no arguments)   report to stderr and exit 0 | 1 | 2",
  `  ${JSON_FLAG}           additionally write the per-dataset report to stdout as JSON`,
].join("\n");

async function main(): Promise<number> {
  // Refused rather than ignored, for the reason an invalid rate limit refuses
  // to start: a silently-swallowed typo lets a maintainer believe they invoked
  // something they did not (SPEC 8.4). `64` is a usage error and deliberately
  // outside the check's own `0 | 1 | 2` — it says the check did not run, which
  // is not one of the three things a run can conclude (`docs/maintenance.md`).
  // SPEC 8.3's argv contract binds the shipped binary; this is a script.
  const args = process.argv.slice(2);
  const unrecognised = args.find((argument) => argument !== JSON_FLAG);
  if (unrecognised !== undefined) {
    note(`unrecognised argument ${JSON.stringify(unrecognised)}\n${USAGE}`);
    return 64;
  }
  const emitJson = args.includes(JSON_FLAG);

  // A committed dataset that cannot even be read is reported as both datasets
  // unavailable — the run never happened, so neither was checked — and exits 2
  // rather than 1: nothing was established about the site, and 1 would have a
  // cron open an issue claiming drift it never saw. It goes through the same
  // report as every other outcome, because "each dataset's outcome is named"
  // holds on this path too (SPEC 7).
  let reports;
  try {
    reports = await runDriftCheck(createGet(), readBundledDatasets());
  } catch (error) {
    reports = DATASET_NAMES.map((dataset) => unavailable(dataset, error));
  }

  for (const line of formatReport(reports)) note(line);
  if (emitJson) process.stdout.write(`${JSON.stringify(reports, null, 2)}\n`);
  return driftExitCode(reports);
}

// `process.exit()` truncates stderr — writes to a pipe are asynchronous in Node,
// so exiting on the same tick can lose the report a maintainer is meant to read.
// Setting `exitCode` and falling off the end flushes first.
process.exitCode = await main();
