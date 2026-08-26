/** The one argument the binary takes, and it is not configuration (SPEC 7, 8.3). */
export const DRIFT_CHECK_FLAG = "--check-drift";

export const USAGE = [
  "usage: kleinanzeigen-mcp [--check-drift]",
  "",
  "  (no arguments)   serve the MCP tool surface over stdio",
  `  ${DRIFT_CHECK_FLAG}    fetch the categories sitemap once and diff it against the`,
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
 *
 * The refusal says which of the two things went wrong. Calling a repeated
 * `--check-drift` "unrecognised" would tell an operator something false about
 * the argument in front of them, which is the same failure in a new place.
 */
export function parseArgv(argv: readonly string[]): Invocation {
  if (argv.length === 0) return { mode: "serve" };
  if (argv.length === 1 && argv[0] === DRIFT_CHECK_FLAG) return { mode: "check-drift" };
  const unrecognised = argv.find((argument) => argument !== DRIFT_CHECK_FLAG);
  const reason =
    unrecognised === undefined
      ? `${DRIFT_CHECK_FLAG} given more than once`
      : `unrecognised argument ${JSON.stringify(unrecognised)}`;
  return { mode: "refused", message: `${reason}\n${USAGE}` };
}
