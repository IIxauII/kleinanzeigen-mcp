import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MCPB_STAGING_DIR } from "./stage-mcpb.ts";

const ROOT = new URL("../", import.meta.url);

/**
 * `mcpb pack <dir>` with no output argument writes `<dirname>.mcpb` into the
 * current directory — `mcpb.mcpb`, here — while reporting the name it did not
 * use. The release attaches this file to a GitHub release and `server.json`
 * points the MCP Registry at that URL by hash (SPEC 8.7, SPEC 9.18), so the
 * name is part of the contract and is always passed explicitly.
 */
export function defaultMcpbPath(): string {
  const version = JSON.parse(readFileSync(new URL("package.json", ROOT), "utf8")).version;
  return fileURLToPath(new URL(`build/kleinanzeigen-mcp-${version}.mcpb`, ROOT));
}

/**
 * Pack the staged bundle. **Unsigned, deliberately**: `mcpb sign --self-signed`
 * reports success and then fails its own `mcpb verify`, because verification
 * checks the chain against the OS trust store, which a self-signed certificate
 * can never be in — and it writes its key into the installed npm package
 * directory, so the identity dies at the next `npm install`. The cost is a
 * "Not signed" warning; a real certificate is a purchase and a separate
 * decision ([ADR-0005](../docs/adr/0005-four-channels-one-artifact.md)).
 */
export function packMcpb(output: string = defaultMcpbPath(), { quiet = false } = {}): string {
  mkdirSync(dirname(output), { recursive: true });
  const cli = fileURLToPath(new URL("node_modules/@anthropic-ai/mcpb/dist/cli/cli.js", ROOT));
  execFileSync(process.execPath, [cli, "pack", MCPB_STAGING_DIR, output], { stdio: quiet ? "pipe" : "inherit" });
  return output;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) packMcpb();
