import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POLL_INTERVAL_MS, awaitNpmVersion, npmVersionUrl } from "../scripts/await-npm-version.ts";
import {
  LOGIN_ARGS,
  PUBLISH_RETRY_MS,
  type PublisherRun,
  type RunPublisher,
  publishToRegistry,
} from "../scripts/publish-registry.ts";
import { PLACEHOLDER_SHA256, type ServerJson, stamped } from "../scripts/stamp-server-json.ts";
import { VERSION_SITES, stampVersion, stampedSource } from "../scripts/stamp-version.ts";

const ROOT = new URL("../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, ROOT), "utf8");
const pkg = JSON.parse(read("package.json"));

/**
 * The four files the release rewrites that no other tool owns.
 *
 * `package.json` and `package-lock.json` are absent on purpose:
 * `@semantic-release/npm` writes both, and a second writer racing it is a
 * version stated twice by two tools rather than once by one. Everything here is
 * a value some *other* test already pins to `package.json` — `manifest.json` in
 * `tests/mcpb.test.ts`, the two plugin files in `tests/plugin.test.ts`,
 * `src/version.ts` in `src/version.test.ts` — so a stamp that misses one turns
 * the whole suite red rather than shipping a stale file (SPEC 8.7).
 */
describe("the version stamp", () => {
  const temporary: string[] = [];
  afterAll(() => temporary.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  /** The four real files, copied into a workspace of their own. */
  function checkout(): string {
    const workspace = mkdtempSync(join(tmpdir(), "kleinanzeigen-version-"));
    temporary.push(workspace);
    for (const site of VERSION_SITES) {
      const destination = join(workspace, site.path);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(fileURLToPath(new URL(site.path, ROOT)), destination);
    }
    return workspace;
  }

  /** …and what the stamp made of them. */
  function stampCopy(version: string): Record<string, string> {
    const workspace = checkout();
    stampVersion(version, workspace);
    return Object.fromEntries(
      VERSION_SITES.map((site) => [site.path, readFileSync(join(workspace, site.path), "utf8")]),
    );
  }

  it("covers every file SPEC 8.7 commits back that npm does not write itself", () => {
    expect(VERSION_SITES.map((site) => site.path)).toEqual([
      "src/version.ts",
      "manifest.json",
      "plugin/.claude-plugin/plugin.json",
      "plugin/.mcp.json",
    ]);
  });

  it("moves all four to the release's version", () => {
    const stampedTree = stampCopy("9.9.9");

    expect(stampedTree["src/version.ts"]).toContain('export const VERSION = "9.9.9";');
    expect(JSON.parse(stampedTree["manifest.json"]!).version).toBe("9.9.9");
    expect(JSON.parse(stampedTree["plugin/.claude-plugin/plugin.json"]!).version).toBe("9.9.9");
    // The pin the plugin ships against: `npx -y kanzeigen-mcp@<version>`,
    // exact and never floating (SPEC 8.8).
    expect(JSON.parse(stampedTree["plugin/.mcp.json"]!).mcpServers.kleinanzeigen.args) //
      .toEqual(["-y", "kanzeigen-mcp@9.9.9"]);
  });

  it("changes the version and nothing else about any of the four files", () => {
    // A JSON round-trip would reflow `manifest.json`'s one-line `keywords` array
    // and turn every release commit into a formatting diff nobody reviews. The
    // stamp is a targeted rewrite for that reason, so what it leaves alone is
    // worth asserting rather than assuming.
    const stampedTree = stampCopy("9.9.9");
    for (const site of VERSION_SITES) {
      expect(stampedTree[site.path]!.replaceAll("9.9.9", pkg.version), site.path).toBe(read(site.path));
    }
  });

  it("refuses a file whose version site it cannot find exactly once", () => {
    // The whole failure mode this script exists to prevent is a silent no-op: a
    // renamed key or a reformatted line leaves the old version in place, the
    // release commits it, and the MCPB install dialog names the previous
    // version. Loud at release time instead.
    const workspace = checkout();
    writeFileSync(join(workspace, "manifest.json"), '{ "manifest_version": "0.4" }\n');

    expect(() => stampVersion("9.9.9", workspace)).toThrow(/manifest\.json/u);
  });

  it("refuses a version the channels would not accept", () => {
    // The same rule `stamp-server-json.ts` applies, for the same reason: this
    // value reaches npm, the MCPB manifest and the plugin's pin, and the
    // registry marks a version it cannot parse `latest` even when it sorts
    // earlier (SPEC 8.7).
    for (const version of ["latest", "^1.2.3", "1.x", ""]) {
      expect(() => stampedSource(VERSION_SITES[0]!, read("src/version.ts"), version), version).toThrow(/version/u);
    }
  });

  it("is idempotent, so a re-run of a half-finished release is not a second edit", () => {
    const once = stampCopy("9.9.9");
    const workspace = checkout();
    for (const site of VERSION_SITES) writeFileSync(join(workspace, site.path), once[site.path]!);
    stampVersion("9.9.9", workspace);

    for (const site of VERSION_SITES) {
      expect(readFileSync(join(workspace, site.path), "utf8"), site.path).toBe(once[site.path]);
    }
  });
});

/**
 * The release configuration (SPEC 8.7, ADR-0005, `docs/maintenance.md`).
 *
 * `.releaserc.json` is data, like every other manifest in this repository, and
 * the reasoning for each value lives here rather than in a file format that has
 * no comments. What this covers is the half of the release no dry run reaches:
 * the plugin **order**, which is the whole of the sequencing contract, and the
 * absence of the two things that would quietly weaken it — a skippable gate and
 * an npm token.
 */
describe("the release configuration", () => {
  const source = read(".releaserc.json");
  const config = JSON.parse(source);

  /** Every plugin as `[name, options]`, whether or not it was written that way. */
  const plugins: [string, Record<string, unknown>][] = config.plugins.map((entry: unknown) =>
    Array.isArray(entry) ? (entry as [string, Record<string, unknown>]) : [entry as string, {}],
  );

  /** Where a plugin sits in the run order — by name, and by the step it configures. */
  const at = (name: string, key?: string): number =>
    plugins.findIndex(([plugin, opts]) => plugin === name && (key === undefined || key in opts));

  const options = (name: string, key?: string): Record<string, unknown> => {
    const found = plugins[at(name, key)];
    if (found === undefined) throw new Error(`${name}${key === undefined ? "" : ` (${key})`} is not in the plugin list`);
    return found[1];
  };

  it("releases from main, and from nothing else", () => {
    expect(config.branches).toEqual(["main"]);
  });

  it("keeps the tag format the registry's asset URL is built from", () => {
    // `stamp-server-json.ts` builds `…/releases/download/v<version>/…` and the
    // registry does a redirect-refusing `HEAD` on it. A config that changed
    // `tagFormat` would point the listing at a tag that does not exist, and the
    // failure would be the registry's rather than a test's (`docs/maintenance.md`).
    expect(config.tagFormat).toBe("v${version}");
    const server: ServerJson = JSON.parse(read("server.json"));
    const mcpb = stamped(server, "9.9.9", PLACEHOLDER_SHA256) //
      .packages.find((entry) => entry.registryType === "mcpb")!;
    expect(mcpb.identifier).toContain("/download/v9.9.9/");
  });

  it("runs the drift gate first, before any other plugin verifies anything", () => {
    // `verifyConditions` runs in plugin order, so the gate being first is what
    // stops a release that cannot establish dataset currency before it has
    // touched npm, the registry or a tag (SPEC 7).
    expect(at("@semantic-release/exec", "verifyConditionsCmd")).toBe(0);
    expect(options("@semantic-release/exec", "verifyConditionsCmd").verifyConditionsCmd).toBe("npm run check:drift");
  });

  it("gives the gate no override, because the version is the provenance", () => {
    // The command is `npm run check:drift` and nothing else: no flag, no input
    // and no environment variable that skips it. `exec` fails the release on
    // any non-zero exit, which is exactly "blocks on 1 and on 2" — and on the
    // `64` a usage error would produce, where the check never ran at all.
    //
    // The clause is load-bearing rather than defensive: it is the only reason
    // the publish date *is* the dataset-current date, which is why neither
    // dataset carries a `generated_at` stamp. Weaken it and that claim goes
    // with it (ADR-0005, `docs/maintenance.md`).
    const gate = options("@semantic-release/exec", "verifyConditionsCmd");
    expect(Object.keys(gate)).toEqual(["verifyConditionsCmd"]);
    expect(String(gate.verifyConditionsCmd)).not.toMatch(/\|\||;|&&|\bif\b|\$\{|SKIP|FORCE/u);
  });

  it("stamps the four version files, builds and packs the MCPB before anything publishes", () => {
    // Order inside `prepare`: `@semantic-release/npm` bumps `package.json`
    // first, then this rewrites the four files nothing else owns, then the
    // build runs — so what `tsup` bundles and what `mcpb pack` ships already
    // carry the version being cut. `pack:mcpb` names the file from the bumped
    // `package.json`, which is why it cannot run any earlier. `@semantic-release/git`
    // comes after all of it, because it commits what these produced.
    expect(String(options("@semantic-release/exec", "prepareCmd").prepareCmd)).toBe(
      "node scripts/stamp-version.ts ${nextRelease.version} && npm run build && npm run pack:mcpb",
    );
    expect(at("@semantic-release/npm")).toBeLessThan(at("@semantic-release/exec", "prepareCmd"));
    expect(at("@semantic-release/exec", "prepareCmd")).toBeLessThan(at("@semantic-release/git"));
    expect(at("@semantic-release/changelog")).toBeLessThan(at("@semantic-release/git"));
  });

  it("commits back exactly the seven files SPEC 8.7 names", () => {
    // Every one of them states a version that nothing derives: the lockfile
    // because `packaging.test.ts` asserts it is committed, precisely so a cold
    // install resolves the same tree; `manifest.json` because the MCPB install
    // dialog would otherwise name the previous version, silently; the two
    // plugin files because `.mcp.json` pins the exact version it ships against.
    //
    // `server.json` is deliberately not among them — the release stamps it,
    // submits it and leaves the working copy alone, so the committed version
    // trails the package's by design (`tests/registry.test.ts`).
    expect(options("@semantic-release/git").assets).toEqual([
      "package.json",
      "package-lock.json",
      "src/version.ts",
      "manifest.json",
      "CHANGELOG.md",
      "plugin/.claude-plugin/plugin.json",
      "plugin/.mcp.json",
    ]);
  });

  it("attaches the packed MCPB to the GitHub release", () => {
    // The name `pack:mcpb` writes, matched where it writes it: `build/` is
    // gitignored, which is why the asset is uploaded rather than committed.
    expect(options("@semantic-release/github").assets).toEqual([
      { path: "build/*.mcpb", label: "MCPB bundle for Claude Desktop" },
    ]);
  });

  it("submits to the registry last: after npm published, after the asset uploaded", () => {
    // Two orderings in one assertion, and both fail only in production. The
    // registry proves ownership by reading `mcpName` out of
    // `registry.npmjs.org/<pkg>/<version>`, so the npm publish has to have
    // landed; and it does a redirect-refusing `HEAD` on the MCPB asset URL, so
    // `@semantic-release/github` has to have uploaded it (`docs/maintenance.md`).
    const registry = at("@semantic-release/exec", "publishCmd");
    expect(registry).toBeGreaterThan(-1);
    expect(at("@semantic-release/npm")).toBeLessThan(registry);
    expect(at("@semantic-release/github")).toBeLessThan(registry);
    // The version is passed rather than defaulted. The stamp would otherwise
    // read `package.json`, which is only the right number while the plugins run
    // in this order — and nothing downstream catches a listing stamped one
    // version behind, because the registry never verifies anything it is given.
    // `validate` sits between the stamp and the publish because it is the
    // registry's own schema check and it is free. It is explicitly *not* the
    // guard against a forgotten stamp — sixty-four zeros is schema-valid, so
    // validation passes on the unstamped file exactly as it does on the stamped
    // one, and running the stamp is the only thing that covers that
    // (`docs/maintenance.md`).
    // The wait is first in the chain, and it is there because plugin order
    // cannot express what it enforces: order puts `@semantic-release/npm`
    // before this step and stops there, while npm's read-after-write runs
    // minutes behind its own publish — 3.4 seconds apart against a document
    // that appeared two to three minutes later, on 1.0.1 (#84). It goes ahead
    // of the stamp because the stamp is disk work there is no point doing
    // before npm is ready, and the submission is wrapped rather than called
    // directly because the registry's propagation 400 is retried and every
    // other failure on this step is not.
    expect(String(options("@semantic-release/exec", "publishCmd").publishCmd)).toBe(
      "node scripts/await-npm-version.ts ${nextRelease.version}" +
        " && node scripts/stamp-server-json.ts ${nextRelease.version}" +
        " && mcp-publisher validate" +
        " && node scripts/publish-registry.ts ${nextRelease.version}",
    );
  });

  it("names no npm token and no provenance flag, here or in the package", () => {
    // Trusted publishing emits provenance by default, and `--provenance` is the
    // thing that breaks under OIDC. No token either — not as a fallback and not
    // to unblock a failing publish: granular write tokens expire in 7 days by
    // default, which is a credential that fails at the moment a release is
    // being cut (ADR-0005).
    for (const [name, file] of [
      [".releaserc.json", source],
      ["package.json", read("package.json")],
    ] as const) {
      expect(file, name).not.toMatch(/NPM_TOKEN|--provenance|"provenance"/u);
    }
    expect(pkg, "publishConfig").not.toHaveProperty("publishConfig");
  });
});

/**
 * The dispatch itself (SPEC 8.7). Four things about this workflow are decided
 * rather than incidental, and each of them fails silently or expensively: the
 * trigger, the two permissions the publish credential is made of, the npm floor
 * below which a publish succeeds *without* provenance, and the filename — which
 * npm's trusted-publishing settings name, so a rename is a publish that stops
 * authenticating.
 */
describe("the release workflow", () => {
  const workflow = read(".github/workflows/release.yml");

  it("fires on a maintainer's dispatch and on nothing else", () => {
    // A no-override, network-dependent gate under a push trigger reddens `main`
    // in any month the site is unreachable, and a red `main` nobody can act on
    // is a gate everybody learns to ignore. It also means there is no trigger
    // for `@semantic-release/git`'s commit-back to loop against (ADR-0005).
    //
    // Read out of the `on:` block rather than off the whole file: `release:` is
    // also the job's name, and a scan for trigger keywords over the document
    // finds it there and fails on a workflow that is correct.
    const triggers = /^on:\n((?: .*|\n)*)/mu.exec(workflow)?.[1] ?? "";
    expect(triggers.trim()).toBe("workflow_dispatch:");
  });

  it("carries the whole publish credential in two job permissions", () => {
    // `id-token: write` is it — the npm publish and `mcp-publisher login
    // github-oidc` authenticate the same way, which is why it is not a
    // registry-specific quirk. `contents: write` is the tag, the release and
    // the commit-back.
    expect(workflow).toMatch(/^ {6}contents: write$/mu);
    expect(workflow).toMatch(/^ {6}id-token: write$/mu);
  });

  it("asserts the npm floor rather than hoping the runner is new enough", () => {
    // Below 11.5.1 trusted publishing is unavailable and the publish still
    // succeeds — without provenance. A failure that looks like success is
    // exactly the kind this repository checks rather than documents (SPEC 8.7).
    expect(workflow).toContain("npm install --global npm@latest");
    expect(workflow).toContain("11.5.1");
  });

  it("runs the suite as a pre-publish gate, before anything reaches a channel", () => {
    // SPEC 8.6: the cold-install verification "runs on every PR and again as a
    // pre-publish gate". The tarball this job publishes is built here, and
    // nothing else in the dispatch would notice a packaging regression before
    // npm has it — at which point the version is spent (SPEC 8.7).
    const steps = workflow.slice(workflow.indexOf("- run: npm ci"));
    expect(steps).toContain("- run: npm test");
    expect(steps.indexOf("- run: npm run build")).toBeLessThan(steps.indexOf("- run: npm test"));
    expect(steps.indexOf("- run: npm test")).toBeLessThan(steps.indexOf("npx semantic-release"));
  });

  it("logs in to the registry over OIDC, with no secret", () => {
    expect(workflow).toContain("mcp-publisher login github-oidc");
    // Pinned, not floating: the registry is in preview, and its CLI moves.
    expect(workflow).toMatch(/MCP_PUBLISHER_VERSION: "\d+\.\d+\.\d+"/u);
  });

  it("clones the whole history, because the bump is read from it", () => {
    // A shallow clone has no tags, and `semantic-release` reads that as *no
    // previous release* and emits 1.0.0 — the same failure `git tag v0.1.0`
    // exists to prevent (SPEC 8.7).
    expect(workflow).toMatch(/^ {10}fetch-depth: 0$/mu);
  });

  it("puts no npm token in any workflow in this repository", () => {
    // Stated over the whole directory rather than this file: the decision is
    // that no token enters this repository's secrets at all, so a second
    // workflow reaching for one is the same violation (ADR-0005).
    for (const file of ["release.yml", "pr-checks.yml", "dataset-drift.yml", "plugin.yml"]) {
      expect(read(`.github/workflows/${file}`), file).not.toContain("NPM_TOKEN");
    }
  });
});

/**
 * The npm propagation wait (`scripts/await-npm-version.ts`).
 *
 * `@semantic-release/npm` and the registry step run seconds apart inside one
 * `publish` lifecycle, and npm's read-after-write is not immediate: the 1.0.1
 * release reached `mcp-publisher publish` **3.4 seconds** after `+ kanzeigen-mcp@1.0.1`,
 * and `registry.npmjs.org/kanzeigen-mcp/1.0.1` first answered 200 two to three
 * minutes later. Plugin order sequences the calls and says nothing about that
 * gap, which is the whole of the bug ([#84](https://github.com/IIxauII/kleinanzeigen-mcp/issues/84)).
 *
 * Nothing about this fails anywhere a test would otherwise reach — it fails on
 * a 400 from the registry, on the last step of a release that has already
 * published everything else and cannot be re-run.
 *
 * Fake timers throughout, for the reason `scripts/lib/site.test.ts` uses them
 * on the request gap: the waiting is the point, and a real clock would put
 * minutes of wall clock in the suite to prove it (SPEC 8.6).
 */
describe("the npm propagation wait", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** The version document as npm serves it once the publish is readable. */
  const document = (version: string, mcpName: string = pkg.mcpName): string =>
    JSON.stringify({ name: pkg.name, version, mcpName });

  const ok = (body: string): Response => new Response(body, { status: 200 });
  const status = (code: number): Response => new Response("", { status: code });

  /**
   * `fetch`, answering the queue in order and then repeating its last answer
   * forever — a wait is a loop, so "and then it keeps saying that" is the
   * ordinary case rather than a special one.
   */
  function answers(...queue: (Response | Error)[]): typeof fetch & { urls: string[] } {
    const urls: string[] = [];
    const impl = (async (input: string | URL | Request) => {
      urls.push(String(input));
      const next = queue.length > 1 ? queue.shift()! : queue[0];
      if (next === undefined) throw new Error("nothing queued");
      if (next instanceof Error) throw next;
      return next.clone();
    }) as typeof fetch & { urls: string[] };
    impl.urls = urls;
    return impl;
  }

  const quiet = (): void => {};

  it("reads the same document the registry proves ownership out of", () => {
    // `docs/maintenance.md`: the registry reads `mcpName` out of
    // `registry.npmjs.org/<pkg>/<version>`. Polling anything else — the
    // packument, a `dist-tag`, `npm view` — would be waiting for a different
    // fact than the one the publish turns on. The packument is the trap of the
    // three: it answers 200 for a package whose newest version is the previous
    // one, so a wait on it would pass instantly and prove nothing.
    expect(npmVersionUrl(pkg.name, "9.9.9")).toBe("https://registry.npmjs.org/kanzeigen-mcp/9.9.9");
  });

  it("returns on the first read that answers, without spending an interval", async () => {
    const fetchImpl = answers(ok(document("9.9.9")));

    await expect(awaitNpmVersion("9.9.9", { fetchImpl, onAttempt: quiet })).resolves.toContain("9.9.9");

    expect(fetchImpl.urls).toEqual(["https://registry.npmjs.org/kanzeigen-mcp/9.9.9"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("polls through the 404 the race produces, and through a flaky read", async () => {
    // The three ways the document is *not yet* readable, all of them transient
    // and none of them a reason to fail the release: the 404 before npm has it,
    // a CDN 5xx, and a connection that never completed.
    const fetchImpl = answers(status(404), status(503), new Error("ECONNRESET"), ok(document("9.9.9")));

    const settled = awaitNpmVersion("9.9.9", { fetchImpl, onAttempt: quiet });
    await vi.advanceTimersByTimeAsync(3 * POLL_INTERVAL_MS);

    await expect(settled).resolves.toContain("9.9.9");
    expect(fetchImpl.urls).toHaveLength(4);
  });

  it("gives up rather than hanging, so a real publish failure still reddens the run", async () => {
    // The bound is the half that makes this safe to put in front of the
    // release's last step: a package that never appears is a publish that
    // failed, and a wait without a deadline would turn it into a job that runs
    // until the runner's own timeout kills it with nothing said.
    const fetchImpl = answers(status(404));

    const settled = awaitNpmVersion("9.9.9", { fetchImpl, timeoutMs: 4 * POLL_INTERVAL_MS, onAttempt: quiet });
    const refused = expect(settled).rejects.toThrow(/9\.9\.9/u);
    await vi.advanceTimersByTimeAsync(4 * POLL_INTERVAL_MS);

    await refused;
    expect(fetchImpl.urls).toHaveLength(5);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fails at once on a document whose mcpName is not the one the registry authenticates", async () => {
    // Not a wait: `mcpName` is immutable npm metadata, so a mismatch is a
    // version already spent and no amount of polling changes it (SPEC 8.7).
    // Spending the whole budget on it would bury the one error message that
    // says what went wrong.
    const fetchImpl = answers(ok(document("9.9.9", "io.github.someone/else")));

    await expect(awaitNpmVersion("9.9.9", { fetchImpl, onAttempt: quiet })).rejects.toThrow(/mcpName/u);

    expect(fetchImpl.urls).toHaveLength(1);
  });

  it("refuses a version the channels would not accept, before it reads anything", async () => {
    // The same rule the two stamps apply, for the same reason and one step
    // earlier: `registry.npmjs.org/<pkg>/latest` is a document that exists and
    // answers 200, so an unchecked range would sail through the wait and then
    // fail the step it was added to protect.
    for (const version of ["latest", "^1.2.3", "1.x", ""]) {
      const fetchImpl = answers(ok(document(version)));
      await expect(awaitNpmVersion(version, { fetchImpl, onAttempt: quiet }), version).rejects.toThrow(/version/u);
      expect(fetchImpl.urls, version).toHaveLength(0);
    }
  });
});

/**
 * The registry publish (`scripts/publish-registry.ts`).
 *
 * The wait above removes the cause; this removes what is left of the effect.
 * Our reader and the registry's are different clients of a CDN-fronted npm, so
 * a 200 here does not prove a 200 there — and the registry's own 400 asks the
 * caller to wait and retry. The retry is deliberately the narrowest thing that
 * covers it: every other way `mcp-publisher publish` fails is permanent — the
 * casing 403, a `HEAD` on an asset that is not there, a hash nothing checks —
 * and a blanket retry would spend the budget twice before reporting any of them.
 */
describe("the registry publish", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** The 400 measured on the 1.0.1 release, verbatim. */
  const propagation400 = (version: string): string =>
    [
      "Error: publish failed: server returned status 400:",
      "  registry validation failed for package 0 (kanzeigen-mcp):",
      `  NPM package 'kanzeigen-mcp' exists, but version '${version}' was not found (status: 404).`,
      "  A newly published release can take a moment to appear on the registry.",
      `  Wait and retry, or publish version '${version}' before registering it`,
    ].join("\n");

  /** The other failure in the same step, the one this project expects to meet. */
  const casing403 = "Error: publish failed: server returned status 403: you do not have permission to publish this server";

  const LOGGED_IN: PublisherRun = { code: 0, output: "logged in" };

  /**
   * `mcp-publisher`, recording every invocation. `publishes` answers in order
   * and then repeats its last answer, because a retry loop asking again is the
   * ordinary case rather than a special one.
   */
  function publisher(
    publishes: PublisherRun[],
    login: PublisherRun = LOGGED_IN,
  ): RunPublisher & { invocations: string[]; published: number } {
    const run = Object.assign(
      async (args: readonly string[]): Promise<PublisherRun> => {
        run.invocations.push(args.join(" "));
        if (args[0] === "login") return login;
        run.published += 1;
        return publishes.length > 1 ? publishes.shift()! : publishes[0]!;
      },
      { invocations: [] as string[], published: 0 },
    );
    return run;
  }

  const quiet = (): void => {};

  it("publishes once when the registry takes it", async () => {
    const run = publisher([{ code: 0, output: "published" }]);

    await expect(publishToRegistry("9.9.9", { run, onAttempt: quiet })).resolves.toBe(0);
    expect(run.published).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("mints a token for every attempt, because the registry's does not live long enough", async () => {
    // `tokenDuration: 5 * time.Minute` in the registry's own JWT manager, which
    // is why its reference workflow logs in in the step immediately before
    // `publish`. This release cannot: the publish is inside `semantic-release`,
    // behind the drift gate, the npm publish, the build, the pack, the
    // commit-back, the GitHub release — and behind a wait that may run for ten
    // minutes. The workflow's own login is a pre-flight, not the credential
    // this step uses, and a 401 from an expired one is not a propagation 400,
    // so nothing would retry it: the same unrecoverable last-step failure #84
    // is about, wearing a different status code.
    const run = publisher([{ code: 1, output: propagation400("9.9.9") }, { code: 0, output: "published" }]);

    const settled = publishToRegistry("9.9.9", { run, onAttempt: quiet });
    await vi.advanceTimersByTimeAsync(PUBLISH_RETRY_MS);
    await expect(settled).resolves.toBe(0);

    const login = LOGIN_ARGS.join(" ");
    expect(run.invocations).toEqual([login, "publish", login, "publish"]);
  });

  it("stops on a login it cannot make, rather than retrying a credential", async () => {
    // A login that fails is a permission or a misconfigured OIDC context, and
    // both say the same thing thirty seconds later. It is also the one failure
    // here that is cheap to fix and expensive to misread as propagation.
    const run = publisher([{ code: 0, output: "published" }], { code: 1, output: "Error: failed to get OIDC token" });

    await expect(publishToRegistry("9.9.9", { run, onAttempt: quiet })).resolves.not.toBe(0);
    expect(run.invocations).toEqual([LOGIN_ARGS.join(" ")]);
    expect(run.published).toBe(0);
  });

  it("retries the propagation 400 the registry asks the caller to retry", async () => {
    const run = publisher([{ code: 1, output: propagation400("9.9.9") }, { code: 0, output: "published" }]);

    const settled = publishToRegistry("9.9.9", { run, onAttempt: quiet });
    await vi.advanceTimersByTimeAsync(PUBLISH_RETRY_MS);

    await expect(settled).resolves.toBe(0);
    expect(run.published).toBe(2);
  });

  it("leaves every other failure red on the first attempt", async () => {
    // Including the one this project expects to meet: `mcpName`'s casing is
    // inferred rather than documented, and the 403 that confirms it is a
    // decision to make, not a delay to wait out (SPEC 8.7).
    const run = publisher([{ code: 1, output: casing403 }]);

    await expect(publishToRegistry("9.9.9", { run, onAttempt: quiet })).resolves.not.toBe(0);
    expect(run.published).toBe(1);
  });

  it("does not read a 400 about some other version as its own", async () => {
    // Three anchors have to line up — the status, the npm-package phrasing and
    // *this* release's version — because the retry is a narrowing and a loose
    // match would widen it back into the blanket retry that was refused. The
    // MCPB asset's `HEAD` is the near miss this guards: it fails on a URL that
    // carries a version and the words *not found* too.
    const run = publisher([{ code: 1, output: propagation400("1.0.1") }]);

    await expect(publishToRegistry("9.9.9", { run, onAttempt: quiet })).resolves.not.toBe(0);
    expect(run.published).toBe(1);
  });

  it("gives up non-zero after a bounded number of attempts", async () => {
    // The same bound, for the same reason as the wait's: a registry that keeps
    // saying 400 is a release that failed, and it has to say so.
    const run = publisher([{ code: 1, output: propagation400("9.9.9") }]);

    const settled = publishToRegistry("9.9.9", { run, attempts: 3, onAttempt: quiet });
    await vi.advanceTimersByTimeAsync(2 * PUBLISH_RETRY_MS);

    await expect(settled).resolves.not.toBe(0);
    expect(run.published).toBe(3);
  });
});
