import { ConfigError } from "./fetch/errors.ts";

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
 */
export function readRateLimitMs(env: Record<string, string | undefined> = process.env): number {
  const raw = env[RATE_LIMIT_ENV_VAR];
  if (raw === undefined) return DEFAULT_RATE_LIMIT_MS;
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
