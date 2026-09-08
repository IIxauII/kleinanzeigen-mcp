import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { readRateLimitMs, RATE_LIMIT_ENV_VAR } from "./config.ts";
import { configureFetchCore } from "./fetch/core.ts";
import { log } from "./logging.ts";
import { createServer } from "./server.ts";

/**
 * **The binary takes no arguments**: it serves the MCP tool surface over stdio
 * and does nothing else. argv is not a configuration surface, and the drift
 * check that used to be the one exception now lives in `scripts/check-drift.ts`
 * (SPEC 7, 8.3).
 *
 * Returns the exit code rather than taking it, because **`process.exit()`
 * truncates stderr**: writes to a pipe are asynchronous in Node, so exiting on
 * the same tick as a diagnostic can lose it. Setting `process.exitCode` and
 * falling off the end flushes first. Where the server does start, the code is
 * set on a process that then stays up on the transport, which is exactly right:
 * it applies whenever the server ends.
 */
async function main(): Promise<number> {
  // The one knob is read before anything else: an invalid value kills the
  // process here, before the transport opens, and never falls back to the
  // default (SPEC 8.4).
  let rateLimitMs: number;
  try {
    rateLimitMs = readRateLimitMs();
  } catch (error) {
    log("config_invalid", {
      level: "error",
      variable: RATE_LIMIT_ENV_VAR,
      message: error instanceof Error ? error.message : String(error),
    });
    return 1;
  }

  // One core, one limiter, shared by every tool — per-tool budgets would let
  // two tools stack up load the site experiences as a single client (SPEC 2.8).
  configureFetchCore({ rateLimitMs });

  // stdio only: no port, no bind address, no auth surface, no local listener
  // (SPEC 8.3). stdout belongs to the transport; every log line goes to stderr.
  const transport = new StdioServerTransport();
  await createServer().connect(transport);
  log("server_started", { transport: "stdio", rate_limit_ms: rateLimitMs });
  return 0;
}

process.exitCode = await main();
