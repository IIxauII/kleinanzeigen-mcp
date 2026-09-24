/**
 * `mcp-publisher publish`, with a token minted for the attempt and a retry on
 * the one failure the registry itself asks the caller to retry:
 *
 *     node scripts/publish-registry.ts <version>
 *
 * `await-npm-version.ts` removes the cause of that failure — it will not let
 * the release reach this step before npm serves the version document. What it
 * cannot remove is the last of the effect: our reader and the registry's are
 * different clients of a CDN-fronted npm, so a 200 from here does not prove a
 * 200 from there. The registry's own 400 says as much — *"A newly published
 * release can take a moment to appear on the registry. Wait and retry"*
 * ([#84](https://github.com/IIxauII/kleinanzeigen-mcp/issues/84)).
 *
 * **The retry is a narrowing, not a safety net**, and that is the decision
 * worth keeping. Every other way this step fails is permanent: the inferred
 * casing's 403, a redirect-refusing `HEAD` on an asset that was never uploaded,
 * a schema the preview registry moved. Retrying those spends the budget twice
 * and then reports the same thing, later. So three anchors from the measured
 * message have to line up before anything is re-run, and a registry that
 * respells any of them stops the retry rather than starting it — failing
 * closed, back to the single attempt this replaced.
 *
 * **The login is here rather than only in the workflow because the registry's
 * token is minutes long.** `tokenDuration: 5 * time.Minute` in the registry's
 * own JWT manager, and its reference workflow accordingly puts `login` in the
 * step immediately before `publish`. This release cannot: the publish happens
 * inside `semantic-release`, behind the drift gate, the npm publish, the build,
 * the pack, the commit-back, the GitHub release — and now behind a wait that
 * may run for ten minutes. A token taken before all of that is expired before
 * it is used, and a 401 is not a propagation 400, so nothing would retry it.
 * It would have been the same unrecoverable last-step failure with a different
 * status code. So every attempt mints its own.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runVersionStep, sleepMs } from "./lib/cli.ts";
import { note } from "./lib/site.ts";
import { assertPublishableVersion } from "./lib/version.ts";

/** The CLI, on `PATH`: a Go binary the release workflow installs at a pinned version. */
export const MCP_PUBLISHER = "mcp-publisher";

/** The CI half of the login. No secret — it exchanges the job's own OIDC token. */
export const LOGIN_ARGS = ["login", "github-oidc"] as const;

/**
 * How many times to publish in all. Five attempts across the gap below is a
 * couple of minutes — the same order as the propagation that has already been
 * waited out, on the reading that what is left here is skew and not a fresh
 * wait from zero.
 */
export const PUBLISH_ATTEMPTS = 5;

/**
 * The gap between attempts. Long enough that a retry is a fresh read rather
 * than the same cached one, short enough that five of them do not outlast the
 * wait that already ran.
 */
export const PUBLISH_RETRY_MS = 30_000;

/** What one `mcp-publisher` invocation did: its exit code, and everything it said. */
export interface PublisherRun {
  code: number;
  output: string;
}

/** The one seam: running the CLI. The clock is vitest's, as it is elsewhere (SPEC 8.6). */
export type RunPublisher = (args: readonly string[]) => Promise<PublisherRun>;

const escape = (literal: string): string => literal.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);

/**
 * Is this the propagation 400, and this release's?
 *
 * Three coincidences, all of them from the message measured on the 1.0.1 run:
 * the status, the npm-package phrasing that distinguishes it from the asset's
 * `HEAD`, and **this** version. Two would be loose enough to catch a failure
 * about the MCPB asset URL, which also carries the version and also says *not
 * found* — and that failure is one nobody should wait through.
 */
export function isPropagation400(output: string, version: string): boolean {
  return (
    /\b400\b/u.test(output) &&
    /npm package/iu.test(output) &&
    new RegExp(String.raw`version '${escape(version)}' was not found`, "u").test(output)
  );
}

export interface PublishOptions {
  run?: RunPublisher;
  attempts?: number;
  onAttempt?: (message: string) => void;
}

/** One `mcp-publisher …`, echoed to stderr as it runs and captured as it goes. */
function runMcpPublisher(args: readonly string[]): Promise<PublisherRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(MCP_PUBLISHER, [...args], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const capture = (chunk: string): void => {
      output += chunk;
      // Echoed rather than swallowed: the release log is where this is read
      // from, and a retry that hid the first failure would hide the last one too.
      process.stderr.write(chunk);
    };
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding("utf8");
      stream.on("data", capture);
    }
    // A CLI that could not be started is not a publish that failed, and it is
    // certainly not one to retry — it is the workflow's install step.
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
  });
}

/** Publish `version` to the registry. Resolves with the exit code to leave the release with. */
export async function publishToRegistry(
  version: string,
  { run = runMcpPublisher, attempts = PUBLISH_ATTEMPTS, onAttempt = note }: PublishOptions = {},
): Promise<number> {
  assertPublishableVersion(version);

  for (let attempt = 1; ; attempt++) {
    // Before each attempt, including the first: the workflow's own login ran
    // before the drift gate and everything after it, and the token does not
    // live that long.
    const auth = await run(LOGIN_ARGS);
    if (auth.code !== 0) {
      // Never retried. A login that fails is a credential or a permission, and
      // both of those say the same thing a minute later.
      onAttempt(`${MCP_PUBLISHER} ${LOGIN_ARGS.join(" ")} failed (exit ${auth.code})`);
      return auth.code;
    }

    const { code, output } = await run(["publish"]);
    if (code === 0) return 0;

    if (!isPropagation400(output, version)) {
      onAttempt(`${MCP_PUBLISHER} publish failed (exit ${code}); not npm propagation, so it is not retried`);
      return code;
    }
    if (attempt >= attempts) {
      onAttempt(`${MCP_PUBLISHER} publish still cannot see ${version} on npm after ${attempts} attempts`);
      return code;
    }
    onAttempt(
      `${MCP_PUBLISHER} publish cannot see ${version} on npm yet — ` +
        `attempt ${attempt} of ${attempts}, retrying in ${Math.round(PUBLISH_RETRY_MS / 1000)}s`,
    );
    await sleepMs(PUBLISH_RETRY_MS);
  }
}

const USAGE = "usage: node scripts/publish-registry.ts <version>";

// The version is passed rather than read from `package.json` for the reason the
// stamp beside it is: it is the value the retry's match is anchored on, and
// anchoring it on the wrong number would silently widen the match.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await runVersionStep(USAGE, (version) => publishToRegistry(version));
}
