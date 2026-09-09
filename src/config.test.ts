import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ConfigError, DEFAULT_RATE_LIMIT_MS, RATE_LIMIT_ENV_VAR, readRateLimitMs } from "./config.ts";

describe("the one configuration knob", () => {
  it("is KLEINANZEIGEN_MCP_RATE_LIMIT_MS and nothing else", () => {
    expect(RATE_LIMIT_ENV_VAR).toBe("KLEINANZEIGEN_MCP_RATE_LIMIT_MS");
  });

  it("defaults to 1500 ms when unset", () => {
    expect(readRateLimitMs({})).toBe(DEFAULT_RATE_LIMIT_MS);
    expect(DEFAULT_RATE_LIMIT_MS).toBe(1500);
  });

  it("reads an empty value as unset, because a host can produce one on its own", () => {
    // MCPB's install dialog hands the server `""` when a user selects the
    // number field and clears it, and nothing else in that flow is a typed
    // value being discarded. Whitespace is (SPEC 8.4, SPEC 8.7).
    expect(readRateLimitMs({ KLEINANZEIGEN_MCP_RATE_LIMIT_MS: "" })).toBe(DEFAULT_RATE_LIMIT_MS);
  });

  it("takes the operator's value with no floor", () => {
    expect(readRateLimitMs({ KLEINANZEIGEN_MCP_RATE_LIMIT_MS: "5000" })).toBe(5000);
    expect(readRateLimitMs({ KLEINANZEIGEN_MCP_RATE_LIMIT_MS: "0" })).toBe(0);
  });

  it.each([" ", "1500ms", "abc", "-1", "1.5", "1e3", "Infinity", "NaN", "0x10"])(
    "refuses %o rather than falling back to the default",
    (value) => {
      expect(() => readRateLimitMs({ KLEINANZEIGEN_MCP_RATE_LIMIT_MS: value })).toThrow(ConfigError);
    },
  );

  it("names the variable and the offending value in the refusal", () => {
    expect(() => readRateLimitMs({ KLEINANZEIGEN_MCP_RATE_LIMIT_MS: "soon" })).toThrow(
      /KLEINANZEIGEN_MCP_RATE_LIMIT_MS.*soon/s,
    );
  });
});

/** Everything else in this layer is fixed in code and cannot be turned off (SPEC 8.4, ADR-0003). */
describe("there is no second knob", () => {
  const SRC = fileURLToPath(new URL(".", import.meta.url));

  const sources = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = `${dir}${entry.name}`;
      if (entry.isDirectory()) return sources(`${path}/`);
      return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
    });

  it("reads the environment in exactly one file", () => {
    const readers = sources(SRC).filter((path) => readFileSync(path, "utf8").includes("process.env"));
    expect(readers.map((path) => path.slice(SRC.length))).toEqual(["config.ts"]);
  });

  it("names no other KLEINANZEIGEN_ variable anywhere in the source", () => {
    const named = sources(SRC).flatMap((path) => [
      ...readFileSync(path, "utf8").matchAll(/KLEINANZEIGEN_[A-Z_]+/g),
    ].map((match) => match[0]));
    expect([...new Set(named)]).toEqual([RATE_LIMIT_ENV_VAR]);
  });
});
