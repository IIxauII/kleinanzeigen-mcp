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
 */
import { driftExitCode, formatReport } from "./drift/report.ts";
import { readBundledDatasets, runDriftCheck } from "./drift/run.ts";
import { createGet } from "./lib/site.ts";

function note(message: string): void {
  process.stderr.write(`${message}\n`);
}

async function main(): Promise<number> {
  // A dataset that cannot be read locally exits 2, not 1: nothing was
  // established about the site, and 1 would have a cron open an issue claiming
  // drift it never saw.
  let bundled;
  try {
    bundled = readBundledDatasets();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    note(`the committed datasets could not be read: ${message}`);
    return 2;
  }

  const reports = await runDriftCheck(createGet({ note }), bundled);
  for (const line of formatReport(reports)) note(line);
  return driftExitCode(reports);
}

// `process.exit()` truncates stderr — writes to a pipe are asynchronous in Node,
// so exiting on the same tick can lose the report a maintainer is meant to read.
// Setting `exitCode` and falling off the end flushes first.
process.exitCode = await main();
