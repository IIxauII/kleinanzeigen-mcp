import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readRateLimitMs, RATE_LIMIT_ENV_VAR } from "./config.ts";
import { configureFetchCore } from "./fetch/core.ts";
import { log } from "./logging.ts";
import { createServer } from "./server.ts";

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
  process.exit(1);
}

// One core, one limiter, shared by every tool — per-tool budgets would let two
// tools stack up load the site experiences as a single client (SPEC 2.8).
configureFetchCore({ rateLimitMs });

// stdio only: no port, no bind address, no auth surface, no local listener
// (SPEC 8.3). stdout belongs to the transport; every log line goes to stderr.
const transport = new StdioServerTransport();
await createServer().connect(transport);
log("server_started", { transport: "stdio", rate_limit_ms: rateLimitMs });
