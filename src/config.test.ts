import { describe, expect, it } from "vitest";
import { DEFAULT_RATE_LIMIT_MS, RATE_LIMIT_ENV_VAR, readRateLimitMs } from "./config.ts";
import { ConfigError } from "./fetch/errors.ts";

describe("the one configuration knob", () => {
  it("is KLEINANZEIGEN_MCP_RATE_LIMIT_MS and nothing else", () => {
    expect(RATE_LIMIT_ENV_VAR).toBe("KLEINANZEIGEN_MCP_RATE_LIMIT_MS");
  });

  it("defaults to 1500 ms when unset", () => {
    expect(readRateLimitMs({})).toBe(DEFAULT_RATE_LIMIT_MS);
    expect(DEFAULT_RATE_LIMIT_MS).toBe(1500);
  });

  it("takes the operator's value with no floor", () => {
    expect(readRateLimitMs({ KLEINANZEIGEN_MCP_RATE_LIMIT_MS: "5000" })).toBe(5000);
    expect(readRateLimitMs({ KLEINANZEIGEN_MCP_RATE_LIMIT_MS: "0" })).toBe(0);
  });

  it.each(["", " ", "1500ms", "abc", "-1", "1.5", "1e3", "Infinity", "NaN", "0x10"])(
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
