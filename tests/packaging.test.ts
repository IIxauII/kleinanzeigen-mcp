import { existsSync, readFileSync } from "node:fs";
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

  it("gives a maintainer the drift check as a script of its own", () => {
    expect(pkg.scripts["check:drift"]).toBe("node dist/index.js --check-drift");
  });

  it("commits its lockfile, so a cold install resolves the same tree", () => {
    expect(existsSync(new URL("../package-lock.json", import.meta.url))).toBe(true);
  });
});
