import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { specSection } from "../src/spec-section.ts";
import { USER_AGENT } from "../src/user-agent.ts";
import { freshCheckout, removeCheckouts } from "./fresh-checkout.ts";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

afterAll(removeCheckouts);

/**
 * Publish-ready by construction: every field npm freezes on the first publish
 * is asserted here, because none of them can be corrected by a commit
 * afterwards (SPEC 8.1, 8.7).
 */
describe("the package", () => {
  it("carries a bin entry pointing at the built bundle", () => {
    expect(pkg.bin).toEqual({ "kanzeigen-mcp": "./dist/index.js" });
    expect(pkg.files).toEqual(["dist"]);
  });

  it("is distributed under the free npm name, which is not the project's own", () => {
    // `kleinanzeigen-mcp` on npm belongs to somebody else's real, functioning
    // server over the same site, published first — so `npx -y
    // kleinanzeigen-mcp` fetches a stranger and the first publish from here
    // would 403. The distribution name takes 4.6's trademark clip, like every
    // other slug this project owns (SPEC 8.1, 8.8).
    expect(pkg.name).toBe("kanzeigen-mcp");
    // The bin key is the command `npx` puts on PATH, and npm links it only
    // from a package it installed under this name.
    expect(Object.keys(pkg.bin)).toEqual([pkg.name]);
  });

  it("keeps the project identity out of the rename, on both wires", () => {
    // The distribution name moved and these two deliberately did not. The
    // User-Agent token is what a site operator writes a block rule against —
    // the identify half ADR-0003's non-circumvention argument rests on — and
    // `serverInfo.name` rides the same wire (SPEC 8.5, 8.8, ADR-0003). A
    // blanket rename across the repo would take both; this fails if one does.
    expect(USER_AGENT.split("/")[0]).toBe("kleinanzeigen-mcp");
    expect(specSection("4.6")).toContain('name: "kleinanzeigen-mcp",');
    expect(pkg.name).not.toBe("kleinanzeigen-mcp");
  });

  it("has no install-time lifecycle script at all", () => {
    // No `postinstall`, so an install runs no code of ours — which is half of
    // why `npm install` here is inspectable (SPEC 8.3). `prepublish` stays on
    // the list; it is not `prepublishOnly`, which npm still honours.
    for (const hook of ["preinstall", "install", "postinstall", "prepare", "prepublish"]) {
      expect(pkg.scripts, hook).not.toHaveProperty(hook);
    }
  });

  it("builds on `prepack`, so a pack from a clean checkout is not empty", () => {
    // `dist/` is gitignored: without this hook `files: ["dist"]` packs only
    // because a built `dist` happens to exist locally. `prepack` covers both
    // `npm pack` and `npm publish` and leaves install time untouched — the
    // install-time/publish-time split is a claim this project makes to users,
    // so it is tested rather than merely true (SPEC 8.2).
    expect(pkg.scripts.prepack).toBe("npm run build");
  });

  it("declares no runtime dependencies: the bundle inlines all three", () => {
    // `noExternal: [/.*/]` puts @modelcontextprotocol/server, cheerio and zod
    // inside dist/index.js, so declaring them cost every `npx` cold start 110
    // packages and 33 MB for code already in the tarball. They move to
    // devDependencies rather than out of the tree: the build still needs all
    // three. Their absence from `dependencies` is safe only once §8.6's
    // cold-install verification proves the installed bundle resolves nothing
    // at runtime, and the two decisions move together (SPEC 8.1, 8.6).
    expect(pkg).not.toHaveProperty("dependencies");
    expect(Object.keys(pkg.devDependencies)).toEqual(
      expect.arrayContaining(["@modelcontextprotocol/server", "cheerio", "zod"]),
    );
  });

  it("carries the two fields npm freezes on the first publish", () => {
    // Immutable once published: neither can be added nor re-cased afterwards,
    // and `mcpName`'s casing is inferred from the registry's source — it
    // formats `io.github.%s/*` from the GitHub login verbatim, with no case
    // folding anywhere in the match (SPEC 8.7).
    expect(pkg.license).toBe("Unlicense");
    expect(pkg.mcpName).toBe("io.github.IIxauII/kleinanzeigen");
  });

  it("ships the licence text the `license` field names", () => {
    expect(existsSync(new URL("../LICENSE", import.meta.url))).toBe(true);
  });

  it("carries the registry metadata, description byte-identical to the shared string", () => {
    // `description` is the one string every other manifest repeats — the SDK
    // `Implementation`, server.json, the MCPB manifest and plugin.json, as
    // each of those lands. Never paraphrased (SPEC 8.7).
    expect(pkg.description).toBe("A read-only, robots-clean MCP server over kleinanzeigen.de");
    expect(pkg.homepage).toBe("https://github.com/IIxauII/kleinanzeigen-mcp");
    expect(pkg.repository).toBe("https://github.com/IIxauII/kleinanzeigen-mcp");
    expect(pkg.bugs).toBe("https://github.com/IIxauII/kleinanzeigen-mcp/issues");
    expect(pkg.author).toBe("Felix (IIxauII)");
  });

  it("packs the bundle, its two datasets and the licence, and nothing else", () => {
    // On the tarball rather than on the lockfile: with no runtime dependency
    // left to declare, a lockfile scan for install scripts is vacuous. What
    // ships is what counts, and the whole file list is asserted rather than a
    // filter over it — a `node_modules/` or `.node` filter under `files:
    // ["dist"]` is a check that cannot fail (SPEC 8.1, 8.2).
    //
    // Packed from a copy with no `dist/`, which is both the honest test — this
    // is the fresh-clone case `prepack` exists for — and what keeps
    // `prepack`'s `clean: true` from deleting `dist/index.js` underneath the
    // stdio tests spawning it in a parallel worker.
    const out = execFileSync("npm", ["pack", "--dry-run", "--json"], { cwd: freshCheckout(), encoding: "utf8" });
    // `prepack` runs the build, and tsup's own log shares this stdout — the
    // report is the JSON array that starts on a line of its own after it.
    const start = out.search(/^\[$/m);
    expect(start, `no JSON report in \`npm pack\` output:\n${out}`).toBeGreaterThanOrEqual(0);
    const packed = JSON.parse(out.slice(start));
    const paths: string[] = packed[0].files.map((file: { path: string }) => file.path);

    expect(paths.sort()).toEqual([
      "LICENSE",
      "README.md",
      "dist/category-tree.json",
      "dist/cities.json",
      "dist/index.js",
      "package.json",
    ]);
  }, 120_000);

  it("names Node 22 as the floor, which is what makes the timezone work free", () => {
    expect(pkg.engines.node).toBe(">=22");
  });

  it("runs the drift check from the clone, not through the shipped binary", () => {
    // The check lives beside the two generators whose fetch code it shares, and
    // the binary it left takes no arguments. The cost is stated rather than
    // hidden: a published user cannot check their own bundle (SPEC 7, 8.3, 9.17).
    expect(pkg.scripts["check:drift"]).toBe("node scripts/check-drift.ts");
    expect(existsSync(new URL("../scripts/check-drift.ts", import.meta.url))).toBe(true);
    expect(pkg.files).not.toContain("scripts");
  });

  it("commits its lockfile, so a cold install resolves the same tree", () => {
    expect(existsSync(new URL("../package-lock.json", import.meta.url))).toBe(true);
  });
});

/**
 * `npm run check:drift` and the two generators are `node scripts/*.ts` — plain
 * Node, no build step, no loader — and they import `src/` for the parsers they
 * share with the server. Node runs them under **strip-only** type stripping,
 * which erases types and refuses anything that would need emitting: a
 * constructor parameter property, an `enum`, a `namespace`.
 *
 * `tsc` and `tsup` both accept all three, so nothing else in this repo notices
 * until a maintenance script dies at import time on syntax the server never
 * minded (SPEC 7, 8.6).
 */
describe("what the maintenance scripts can import", () => {
  const STRIPPED = [new URL("../src/", import.meta.url), new URL("../scripts/", import.meta.url)];

  function sources(directory: URL): URL[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
      if (entry.isDirectory()) return sources(child);
      return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [child] : [];
    });
  }

  it("holds no syntax Node's strip-only mode refuses", () => {
    const parameterProperty = /constructor\s*\([^)]*?\b(?:readonly|private|public|protected)\b/su;
    const emitting = /^\s*(?:export\s+)?(?:const\s+)?(?:enum|namespace)\s/mu;

    const files = STRIPPED.flatMap(sources);
    // Counted first, so a moved directory cannot make this pass by scanning
    // nothing — the same reason the tool-wiring guard asserts its own path.
    expect(files.length).toBeGreaterThan(30);

    const offenders = files
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        return parameterProperty.test(source) || emitting.test(source);
      })
      .map((file) => file.pathname);

    expect(offenders).toEqual([]);
  });
});
