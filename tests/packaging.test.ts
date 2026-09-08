import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

/**
 * Run-from-clone, publish-ready by construction: if publishing is ever decided
 * it changes one README line and nothing in the code (SPEC 8.3).
 */
describe("the package", () => {
  it("carries a bin entry pointing at the built bundle", () => {
    expect(pkg.bin).toEqual({ "kleinanzeigen-mcp": "./dist/index.js" });
    expect(pkg.files).toEqual(["dist"]);
  });

  it("has no install-time lifecycle script at all", () => {
    // No `postinstall`, so an install runs no code of ours — which is half of
    // why `npm install` here is inspectable (SPEC 8.3).
    for (const hook of ["preinstall", "install", "postinstall", "prepare", "prepublish"]) {
      expect(pkg.scripts, hook).not.toHaveProperty(hook);
    }
  });

  it("depends on exactly the three runtime packages the spec names", () => {
    expect(Object.keys(pkg.dependencies).sort()) //
      .toEqual(["@modelcontextprotocol/server", "cheerio", "zod"]);
  });

  it("pulls in no native runtime dependency: nothing shipped builds at install time", () => {
    // A native dependency would need a compiler on the operator's machine and
    // would make the bundle un-portable. Only what ships counts: the build and
    // test toolchain is a maintainer's problem, and `files` carries `dist`
    // alone (SPEC 8.1, 8.3).
    const tree = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
    const native = Object.entries<Record<string, unknown>>(tree.packages ?? {})
      .filter(([, entry]) => entry.hasInstallScript === true)
      .filter(([, entry]) => entry.dev !== true && entry.devOptional !== true)
      .map(([path]) => path);
    expect(native).toEqual([]);
  });

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
