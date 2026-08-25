import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { USER_AGENT } from "./user-agent.ts";
import { VERSION } from "./version.ts";

it("keeps VERSION in step with package.json", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  expect(VERSION).toBe(pkg.version);
});

it("names the project and links to it in the User-Agent", () => {
  expect(USER_AGENT).toBe(
    `kleinanzeigen-mcp/${VERSION} (+https://github.com/IIxauII/kleinanzeigen-mcp)`,
  );
});
