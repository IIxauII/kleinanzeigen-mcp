import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertPublishableVersion } from "./lib/version.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

/**
 * One file that states the version, and the exact shape it states it in.
 *
 * `pattern` brackets the version: group 1 is everything up to it, group 2
 * everything after, and the rewrite is the two groups with the release's
 * version between them. That is a targeted edit rather than a JSON round-trip
 * on purpose — `JSON.stringify` would reflow `manifest.json`'s one-line
 * `keywords` array, and a release commit whose diff is mostly formatting is a
 * release commit nobody reads.
 */
export interface VersionSite {
  /** Repository-relative, and the same path SPEC 8.7's commit-back list names. */
  path: string;
  /** Must match exactly once. Anything else is a file that moved under us. */
  pattern: RegExp;
}

/**
 * Every file the release rewrites that no other tool owns.
 *
 * **`package.json` and `package-lock.json` are deliberately not here.**
 * `@semantic-release/npm` writes both, and a second writer racing it would be
 * one version stated by two tools. Everything in this list is instead a value
 * some other test already pins *to* `package.json` — `manifest.json` in
 * `tests/mcpb.test.ts`, the two plugin files in `tests/plugin.test.ts`,
 * `src/version.ts` in `src/version.test.ts` — so a file this list forgets fails
 * the suite on the next run rather than shipping stale (SPEC 8.7).
 *
 * `server.json` is not here either, and for the opposite reason: it is not
 * committed back at all. The release stamps it, submits it and leaves the
 * working copy alone — `scripts/stamp-server-json.ts` owns that one.
 */
export const VERSION_SITES: readonly VersionSite[] = [
  // The value on two wires: `serverInfo.version` on every `initialize` and the
  // outbound User-Agent (SPEC 8.5). Not replaced by a build-time define — the
  // canonical `0.0.0-development` placeholder fails the User-Agent test.
  { path: "src/version.ts", pattern: /(export const VERSION = ")[^"]*(")/u },
  // The MCPB manifest states its own version and nothing derives it from
  // `package.json`; a stale one ships a bundle whose install dialog names the
  // previous release, silently.
  { path: "manifest.json", pattern: /(\n {2}"version": ")[^"]*(")/u },
  { path: "plugin/.claude-plugin/plugin.json", pattern: /(\n {2}"version": ")[^"]*(")/u },
  // The plugin pins the exact server version it ships against, never floating:
  // the skill describes a result *shape* (SPEC 8.8).
  { path: "plugin/.mcp.json", pattern: /("kanzeigen-mcp@)[^"]*(")/u },
];

/**
 * One file's contents with the version moved, or a throw naming the file.
 *
 * The exactly-once rule is the whole point. The failure this script exists to
 * prevent is silent: a renamed key or a reflowed line leaves the old version in
 * place, the release commits it, and the mismatch surfaces to a user rather
 * than to the run that caused it.
 */
export function stampedSource(site: VersionSite, source: string, version: string): string {
  assertPublishableVersion(version);
  const occurrences = source.match(new RegExp(site.pattern, `${site.pattern.flags.replace("g", "")}g`));
  if (occurrences?.length !== 1) {
    throw new Error(`${site.path} states its version ${occurrences?.length ?? 0} times, not once: ${site.pattern}`);
  }
  return source.replace(site.pattern, `$1${version}$2`);
}

/**
 * Stamp all four for a release. Run by `@semantic-release/exec` between the npm
 * plugin's `package.json` bump and the build, so what `tsup` bundles and what
 * `mcpb pack` ships already carry the version being cut (SPEC 8.7).
 *
 * Idempotent: stamping a version that is already there rewrites the same bytes,
 * so a re-run of a half-finished release is not a second edit.
 */
export function stampVersion(version: string, root: string = ROOT): string[] {
  assertPublishableVersion(version);
  return VERSION_SITES.map((site) => {
    const path = join(root, site.path);
    writeFileSync(path, stampedSource(site, readFileSync(path, "utf8"), version));
    return path;
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [version] = process.argv.slice(2);
  if (version === undefined) {
    process.stderr.write("usage: node scripts/stamp-version.ts <version>\n");
    process.exitCode = 64;
  } else {
    for (const path of stampVersion(version)) console.log(`${path} → ${version}`);
  }
}
