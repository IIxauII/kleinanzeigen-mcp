import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { log } from "./logging.ts";
import { createServer } from "./server.ts";

// stdio only: no port, no bind address, no auth surface, no local listener
// (SPEC 8.3). stdout belongs to the transport; every log line goes to stderr.
const transport = new StdioServerTransport();
await createServer().connect(transport);
log("server_started", { transport: "stdio" });
