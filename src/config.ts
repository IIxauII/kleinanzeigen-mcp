/** An invalid environment: the process refuses to start rather than falling back (SPEC 8.4). */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/** Exactly one knob, and this is its name (SPEC 8.4, SPEC 11.3). */
export const RATE_LIMIT_ENV_VAR = "KLEINANZEIGEN_MCP_RATE_LIMIT_MS";

/** Field folk wisdom — the Go MCP server's self-limit — not a measurement (SPEC 2.8). */
export const DEFAULT_RATE_LIMIT_MS = 1500;

/**
 * The minimum gap between requests, in ms.
 *
 * **No floor**: it is the operator's machine, IP and risk, and a project that
 * ships the knob should be honest about who bears the consequence.
 *
 * **No silent fallback**: anything that is not a non-negative finite integer
 * throws, and the caller kills the process before the transport opens. An
 * operator who set `5000` and got a typo-driven fallback to 1500 would believe
 * they were being polite while they were not (SPEC 8.4).
 *
 * **An empty value is unset**, and that is the one exception rather than a hole
 * in the rule above: the argument against silent fallback is about an operator
 * who *typed a value* and had it discarded, and an empty box is a user
 * declining to type one. It is also the one invalid value a host can produce
 * without the operator entering anything — MCPB's install dialog hands the
 * server `""` when a user selects the number field and clears it (SPEC 8.7) —
 * and refusing that is a clean install that dies with only stderr to explain
 * itself. A whitespace-only value is still a typo, and still fatal.
 */
export function readRateLimitMs(env: Record<string, string | undefined> = process.env): number {
  const raw = env[RATE_LIMIT_ENV_VAR];
  if (raw === undefined || raw === "") return DEFAULT_RATE_LIMIT_MS;
  // Deliberately stricter than Number(): a decimal, an exponent, a hex literal
  // or a stray unit suffix is a typo, not a value to interpret.
  const digits = raw.trim();
  if (!/^\d+$/.test(digits) || !Number.isSafeInteger(Number(digits))) {
    throw new ConfigError(
      `${RATE_LIMIT_ENV_VAR} must be a non-negative integer number of milliseconds, got ${JSON.stringify(raw)}`,
    );
  }
  return Number(digits);
}
