import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MCPB_STAGING_DIR } from "./stage-mcpb.ts";

const ROOT = new URL("../", import.meta.url);
const MCPB_PACKAGE = "@anthropic-ai/mcpb";

/**
 * Where the `mcpb` CLI is, asked of the package rather than assumed of it.
 *
 * `bin` is the stable handle: the package's `exports` map has a `./cli` entry
 * that is a *different file* from the executable, and `dist/cli/cli.js` is
 * internal layout that a minor release may reshuffle. Resolving the entry point
 * and walking up to the owning `package.json` also survives a non-flat install
 * layout, where `node_modules/@anthropic-ai/mcpb` is not beside this file.
 */
function mcpbCli(): string {
  let directory = dirname(createRequire(import.meta.url).resolve(MCPB_PACKAGE));
  for (let parent = dirname(directory); ; parent = dirname((directory = parent))) {
    const manifest = join(directory, "package.json");
    if (existsSync(manifest)) {
      const { name, bin } = JSON.parse(readFileSync(manifest, "utf8"));
      if (name === MCPB_PACKAGE) return join(directory, typeof bin === "string" ? bin : bin.mcpb);
    }
    if (parent === directory) throw new Error(`cannot find the ${MCPB_PACKAGE} package around ${directory}`);
  }
}

/** Run the `mcpb` CLI. The one place this project shells out to it. */
export function mcpb(...args: string[]): string {
  return execFileSync(process.execPath, [mcpbCli(), ...args], { encoding: "utf8" });
}

/**
 * `mcpb pack <dir>` with no output argument writes `<dirname>.mcpb` into the
 * current directory — `mcpb.mcpb`, here — while reporting the name it did not
 * use. The release attaches this file to a GitHub release and `server.json`
 * points the MCP Registry at that URL by hash (SPEC 8.7, SPEC 9.18), so the
 * name is part of the contract and is always passed explicitly.
 */
function defaultMcpbPath(): string {
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
export function packMcpb(output: string = defaultMcpbPath()): string {
  if (!existsSync(MCPB_STAGING_DIR)) {
    throw new Error(`no staged bundle at ${MCPB_STAGING_DIR} — run \`npm run build\` first`);
  }
  mkdirSync(dirname(output), { recursive: true });
  mcpb("pack", MCPB_STAGING_DIR, output);
  return output;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(packMcpb());
