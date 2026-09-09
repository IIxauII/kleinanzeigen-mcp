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
 *
 * The stem is the **distribution** name, read from `package.json` rather than
 * written out again: it took §4.6's trademark clip when `kleinanzeigen-mcp`
 * turned out to be somebody else's package (§8.7), and one statement of it is
 * what keeps the asset, the tarball and the registry entry agreeing. The
 * literals in `tests/registry.test.ts` and `tests/cold-install.test.ts` are
 * deliberately *not* derived this way — a test that computes its expectation
 * from the code under test cannot fail when that code builds a plausible
 * wrong name.
 */
export function mcpbAssetName(version: string): string {
  return `${packageName()}-${version}.mcpb`;
}

/** Where `pack:mcpb` writes it, and where the registry stamp reads it back. */
export function defaultMcpbPath(version: string = packageVersion()): string {
  return fileURLToPath(new URL(`build/${mcpbAssetName(version)}`, ROOT));
}

/** The version the release is cutting, which `semantic-release` has bumped. */
function packageVersion(): string {
  return packageManifest().version;
}

/** The name npm publishes under, which the packed asset is named for. */
function packageName(): string {
  return packageManifest().name;
}

function packageManifest(): { name: string; version: string } {
  return JSON.parse(readFileSync(new URL("package.json", ROOT), "utf8"));
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
