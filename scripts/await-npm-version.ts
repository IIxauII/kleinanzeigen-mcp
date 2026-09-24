/**
 * Block until the version just published to npm can be **read back**:
 *
 *     node scripts/await-npm-version.ts <version>
 *
 * The MCP Registry proves ownership by reading `mcpName` out of
 * `registry.npmjs.org/<pkg>/<version>`, so the npm publish has to have landed
 * before the registry step runs. `.releaserc.json`'s plugin order sequences the
 * two calls and **says nothing about npm's read-after-write**, which is the gap
 * this closes: the 1.0.1 release reached `mcp-publisher publish` 3.4 seconds
 * after `@semantic-release/npm` reported success, and the version document
 * first answered 200 two to three minutes later
 * ([#84](https://github.com/IIxauII/kleinanzeigen-mcp/issues/84)).
 *
 * The 400 that produces lands on the **last** step of a release, so nothing
 * before it is rolled back: npm has the version, the tag and the GitHub release
 * exist, and a re-dispatch finds no new commits and never reaches the registry
 * again. Recovery is the manual sequence in `docs/maintenance.md`. Waiting is
 * cheap; that is not.
 *
 * | exit | means |
 * | --- | --- |
 * | `0` | the version document is readable and says what the registry needs |
 * | `1` | the budget expired, or the document is wrong in a way waiting cannot fix |
 * | `64` | usage error — nothing was polled |
 *
 * It is **bounded on purpose**. A package that never appears is a publish that
 * failed, and an unbounded wait would turn that into a job running until the
 * runner kills it with nothing said (SPEC 8.7).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runVersionStep, sleepMs } from "./lib/cli.ts";
import { note } from "./lib/site.ts";
import { assertPublishableVersion } from "./lib/version.ts";

const ROOT = new URL("../", import.meta.url);
const pkg = JSON.parse(readFileSync(new URL("package.json", ROOT), "utf8"));

export const NPM_REGISTRY_ORIGIN = "https://registry.npmjs.org";

/** How often to re-read. Small: the whole point is to not overshoot the window. */
export const POLL_INTERVAL_MS = 5_000;

/**
 * How long to wait before calling it a failed publish. The measured
 * propagation was two to three minutes; ten is that with room for a bad day,
 * and it is still a fraction of the dispatch's own runtime.
 */
export const POLL_TIMEOUT_MS = 10 * 60_000;

/**
 * The single-version document, not the packument.
 *
 * It is the one the registry reads, and the only one whose 200 means what this
 * wait is waiting for: `registry.npmjs.org/<pkg>` answers 200 for a package
 * whose newest version is the previous one, so polling it would prove nothing.
 */
export function npmVersionUrl(name: string, version: string): string {
  return `${NPM_REGISTRY_ORIGIN}/${name}/${version}`;
}

export interface AwaitNpmVersionOptions {
  timeoutMs?: number;
  intervalMs?: number;
  /** The one seam. The clock is vitest's, as it is for the site GET (SPEC 8.6). */
  fetchImpl?: typeof fetch;
  /** Where the per-read line goes. `note` by default, so a wait is never silent. */
  onAttempt?: (message: string) => void;
}

/** Why a read did not settle it — every one of these is transient by construction. */
type NotYet = { waiting: string };

const waiting = (why: string): NotYet => ({ waiting: why });

/**
 * One read. Returns `undefined` once the document is the one the registry
 * needs, a `NotYet` while it is not there yet — and **throws** where waiting
 * cannot help, which is the distinction the whole script turns on.
 */
async function read(
  url: string,
  version: string,
  mcpName: string,
  fetchImpl: typeof fetch,
): Promise<NotYet | undefined> {
  let response: Response;
  try {
    response = await fetchImpl(url);
  } catch (error) {
    return waiting(`GET ${url} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) return waiting(`GET ${url} → ${response.status}`);

  let document: { version?: unknown; mcpName?: unknown };
  try {
    document = JSON.parse(await response.text());
  } catch {
    // A 200 that is not the document — a CDN error page, a truncated read. The
    // status is never the test here for the same reason it is not in the drift
    // check: a green status is not a green check.
    return waiting(`GET ${url} → 200, but the body is not a version document`);
  }

  // Both of these are npm metadata, and npm metadata is immutable: a document
  // that says the wrong thing will still say it in ten minutes. Failing here
  // costs a version bump to fix and says so; failing at the deadline would bury
  // the one message that explains why (SPEC 8.7).
  if (document.version !== version) {
    throw new Error(`${url} answers 200 for version ${JSON.stringify(document.version)}, not ${version}`);
  }
  if (document.mcpName !== mcpName) {
    throw new Error(
      `${url} carries mcpName ${JSON.stringify(document.mcpName)}, not ${JSON.stringify(mcpName)} — ` +
        "the registry proves ownership from that field and npm metadata is immutable, so waiting cannot fix it",
    );
  }
  return undefined;
}

/**
 * Wait for `version` to be readable on npm. Resolves with the URL that answered;
 * rejects on the deadline, and on a document no wait would repair.
 */
export async function awaitNpmVersion(
  version: string,
  {
    timeoutMs = POLL_TIMEOUT_MS,
    intervalMs = POLL_INTERVAL_MS,
    fetchImpl = fetch,
    onAttempt = note,
  }: AwaitNpmVersionOptions = {},
): Promise<string> {
  // Before the network: `registry.npmjs.org/<pkg>/latest` is a document that
  // exists and answers 200, so an unchecked range would sail through the wait
  // and fail the step it was added to protect.
  assertPublishableVersion(version);

  const url = npmVersionUrl(pkg.name, version);
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const outcome = await read(url, version, pkg.mcpName, fetchImpl);
    if (outcome === undefined) return url;

    const left = deadline - Date.now();
    if (left <= 0) {
      throw new Error(
        `${url} was still not readable after ${Math.round(timeoutMs / 1000)}s (${outcome.waiting}) — ` +
          `npm has not made ${version} visible, or the publish did not land`,
      );
    }
    onAttempt(`${outcome.waiting} — waiting, ${Math.round(left / 1000)}s left`);
    await sleepMs(Math.min(intervalMs, left));
  }
}

const USAGE = "usage: node scripts/await-npm-version.ts <version>";

// `process.exit()` truncates stderr, so the exit code is set and the process
// falls off the end — the same reason `check-drift.ts` does.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await runVersionStep(USAGE, async (version) => {
    note(`${await awaitNpmVersion(version)} is readable`);
    return 0;
  });
}
