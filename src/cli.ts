import type { CategoryDriftReport } from "./categories/category-drift.ts";

/** The one argument the binary takes, and it is not configuration (SPEC 7, 8.3). */
export const DRIFT_CHECK_FLAG = "--check-drift";

export const USAGE = [
  "usage: kleinanzeigen-mcp [--check-drift]",
  "",
  "  (no arguments)   serve the MCP tool surface over stdio",
  `  ${DRIFT_CHECK_FLAG}   fetch the categories sitemap once and diff it against the`,
  "                   bundled taxonomy, then exit. Reports; writes nothing.",
].join("\n");

export type Invocation =
  | { mode: "serve" }
  | { mode: "check-drift" }
  | { mode: "refused"; message: string };

/**
 * stdio is the transport and there is exactly one environment knob, so argv
 * carries no configuration at all — only which of the two things the binary
 * does. Anything else is refused rather than ignored, for the reason an invalid
 * rate limit refuses to start: a silently-swallowed typo lets an operator
 * believe they invoked something they did not (SPEC 8.3, 8.4).
 */
export function parseArgv(argv: readonly string[]): Invocation {
  if (argv.length === 0) return { mode: "serve" };
  if (argv.length === 1 && argv[0] === DRIFT_CHECK_FLAG) return { mode: "check-drift" };
  const offending = argv.find((argument) => argument !== DRIFT_CHECK_FLAG) ?? argv[0]!;
  return { mode: "refused", message: `unrecognised argument ${JSON.stringify(offending)}\n${USAGE}` };
}

/**
 * 0 clean, 1 drifted, 2 could not be checked. The third is deliberately not 0:
 * a check that never reached the sitemap has not established that the bundle
 * is current (SPEC 7).
 */
export function driftExitCode(report: CategoryDriftReport): number {
  switch (report.outcome) {
    case "clean":
      return 0;
    case "drifted":
      return 1;
    case "unavailable":
      return 2;
  }
}
