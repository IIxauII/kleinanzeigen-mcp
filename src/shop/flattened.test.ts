import { describe, expect, it } from "vitest";
import { ParseError } from "../fetch/errors.ts";
import { decodeFlattened } from "./flattened.ts";

const decode = (payload: unknown): unknown => decodeFlattened(payload);

describe("the flattened RPC decoder", () => {
  it("reads position 0 as the root and everything else as a reference to it", () => {
    expect(decode([{ ads: 1, total: 3 }, [2], "eins", 1])).toEqual({ ads: ["eins"], total: 1 });
  });

  it("stores a repeated string once and hands every reference the same one", () => {
    // This is why a 25-row page arrives in 18 kB: every row's `location` and
    // most rows' `date` are one entry pointed at many times.
    const decoded = decode([[1, 1, 1], { location: 2 }, "Musterstadt"]) as { location: string }[];
    expect(decoded.map((row) => row.location)).toEqual(["Musterstadt", "Musterstadt", "Musterstadt"]);
    expect(decoded[0]).toBe(decoded[1]);
  });

  it("terminates on a value that references itself", () => {
    // The references are a graph, not a tree. Memoising by index is what ends
    // the walk rather than what speeds it up.
    const decoded = decode([{ self: 0 }]) as { self: unknown };
    expect(decoded.self).toBe(decoded);
  });

  it("reads the five negative indices that address a value rather than a slot", () => {
    expect(decode([{ a: -1, b: -3, c: -4, d: -5, e: -6 }])).toEqual({
      a: undefined,
      b: Number.NaN,
      c: Number.POSITIVE_INFINITY,
      d: Number.NEGATIVE_INFINITY,
      e: -0,
    });
  });

  it("leaves a hole unwritten rather than writing undefined into it", () => {
    const decoded = decode([[1, -2, 1], "da"]) as unknown[];
    expect(decoded).toHaveLength(3);
    expect(1 in decoded).toBe(false);
  });

  it("refuses a tagged type rather than reading it as the array it is spelled as", () => {
    // `["Date", 1]` is an array whose first element is a string. Decoding it
    // as a list would hand the parser `["Date", "2026-08-25"]` (SPEC 5.8).
    expect(() => decode([{ posted: 1 }, ["Date", 2], "2026-08-25"])).toThrow(ParseError);
  });

  it("refuses a payload that is not a flattened array, and a reference it does not have", () => {
    expect(() => decode({ ads: [] })).toThrow(ParseError);
    expect(() => decode([])).toThrow(ParseError);
    expect(() => decode([{ ads: 7 }])).toThrow(ParseError);
    expect(() => decode([{ ads: "1" }, []])).toThrow(ParseError);
  });
});
