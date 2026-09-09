import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defaultMcpbPath, mcpbAssetName } from "./pack-mcpb.ts";

const ROOT = new URL("../", import.meta.url);
const pkg = JSON.parse(readFileSync(new URL("package.json", ROOT), "utf8"));

/**
 * What `server.json` carries in `fileSha256` while it sits in the repository.
 *
 * The registry accepts any hash without checking it and **clients check it**, so
 * a plausible-looking committed hash is the most expensive thing this file could
 * hold: it would publish cleanly and then fail every install. This is
 * schema-valid (`^[a-f0-9]{64}$`), unmistakably not a hash of anything, and
 * replaced by the stamp with the hash of the asset the release really uploaded
 * ([SPEC](../SPEC.md) §8.7).
 */
export const PLACEHOLDER_SHA256 = "0".repeat(64);

/** A specific version, never a range and never `latest` — both are rejected. */
const PUBLISHABLE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export interface ServerPackage {
  registryType: string;
  identifier: string;
  version: string;
  fileSha256?: string;
  transport: { type: string };
}

export interface ServerJson {
  $schema: string;
  name: string;
  title: string;
  description: string;
  version: string;
  repository: { url: string; source: string };
  websiteUrl: string;
  packages: ServerPackage[];
}

export const SERVER_JSON_PATH = fileURLToPath(new URL("server.json", ROOT));

/**
 * The release-asset URL the registry is pointed at — and does a
 * **redirect-refusing `HEAD`** on, which is why the asset must be uploaded
 * before the registry step runs. Built from the same `mcpbAssetName` the pack
 * step writes and the same `repository` the package declares, so the URL cannot
 * drift from the file it names or the repository it lives in.
 */
export function mcpbAssetUrl(version: string): string {
  return `${pkg.repository}/releases/download/v${version}/${mcpbAssetName(version)}`;
}

/**
 * `server.json` as the release would submit it: the version in three places,
 * the asset URL that carries the tag, and the hash of the asset itself.
 *
 * The registry's reference workflow stamps the version with one line of `jq`.
 * That covers one of the three, and the two it leaves are the two that fail
 * after a clean publish — a listing whose `HEAD` 404s, or one whose hash every
 * client rejects ([SPEC](../SPEC.md) §8.7).
 */
export function stamped(base: ServerJson, version: string, fileSha256: string): ServerJson {
  if (!PUBLISHABLE_VERSION.test(version)) {
    // A version that does not parse as semver is marked `latest` by the
    // registry *even when it sorts earlier*, so a malformed release input would
    // silently repoint the listing rather than fail it.
    throw new Error(`\`${version}\` is not a version the registry would accept: ranges and \`latest\` are rejected`);
  }
  return {
    ...base,
    version,
    packages: base.packages.map((entry) =>
      entry.registryType === "mcpb"
        ? { ...entry, version, identifier: mcpbAssetUrl(version), fileSha256 }
        : { ...entry, version },
    ),
  };
}

/**
 * Stamp `server.json` in place for a release. Called by the release workflow
 * after `pack:mcpb` and before `mcp-publisher publish`: nothing propagates, so
 * every release is a fresh submission of this file.
 */
export function stampServerJson({
  version = pkg.version,
  asset,
  serverJson = SERVER_JSON_PATH,
}: { version?: string; asset?: string; serverJson?: string } = {}): ServerJson {
  const base: ServerJson = JSON.parse(readFileSync(serverJson, "utf8"));
  const bundle = asset ?? defaultMcpbPath(version);
  if (!existsSync(bundle)) {
    // Hashing nothing is not an option and neither is leaving the placeholder:
    // the registry would accept both and every client would reject the result.
    throw new Error(`no packed bundle at ${bundle} — run \`npm run build && npm run pack:mcpb\` first`);
  }
  const result = stamped(base, version, createHash("sha256").update(readFileSync(bundle)).digest("hex"));
  writeFileSync(serverJson, `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(SERVER_JSON_PATH, stampServerJson().version);
