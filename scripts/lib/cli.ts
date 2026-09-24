/**
 * The half the two release-step scripts share: a delay, and the argv contract
 * they both answer to.
 *
 * They run inside `.releaserc.json`'s `publishCmd` chain, one either side of
 * the stamp, and `exec` fails the release on any non-zero exit. That makes the
 * distinction between *the step failed* and *the step was never run* worth
 * stating once rather than twice — `64` for a usage error, as
 * `scripts/check-drift.ts` defines it, is outside what a run can conclude.
 *
 * SPEC 8.3's argv contract binds the shipped binary and not these; a
 * maintenance script may take an argument. What it may not do is **default**
 * this one: the release passes the version it is cutting, and a step that
 * silently fell back to `package.json`'s would watch, or publish, the previous
 * one (`docs/maintenance.md`).
 */
import { note } from "./site.ts";

export const sleepMs = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run a release step that takes exactly one version argument, and turn what it
 * did into the exit code `exec` reads.
 */
export async function runVersionStep(
  usage: string,
  step: (version: string) => Promise<number>,
): Promise<number> {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    note(`${args.length === 0 ? "no version given" : "too many arguments"}\n${usage}`);
    return 64;
  }
  try {
    return await step(args[0]!);
  } catch (error) {
    note(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
