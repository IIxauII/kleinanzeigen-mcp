import { describe, expect, it } from "vitest";
import { ParseError } from "../fetch/errors.ts";
import { parsePrice } from "./price.ts";

describe("the rendered price on a search row", () => {
  it("reads a fixed amount, thousands separator and all", () => {
    expect(parsePrice("1.999 €")).toEqual({ kind: "Fixed", amount: 1999 });
    expect(parsePrice("20 €")).toEqual({ kind: "Fixed", amount: 20 });
    expect(parsePrice("\n    6.850 €\n")).toEqual({ kind: "Fixed", amount: 6850 });
  });

  it("reads a negotiable amount off the VB suffix", () => {
    expect(parsePrice("380 € VB")).toEqual({ kind: "Negotiable", amount: 380 });
    expect(parsePrice("2.400 € VB")).toEqual({ kind: "Negotiable", amount: 2400 });
  });

  it("keeps a bare VB structurally unconfusable with a giveaway", () => {
    // The amount is optional on this variant and on no other, which is the
    // whole reason the type is a union (SPEC 3.1).
    expect(parsePrice(" VB ")).toEqual({ kind: "Negotiable" });
    expect(parsePrice("Zu verschenken")).toEqual({ kind: "Giveaway" });
  });

  it("reads an empty cell as the explicit Unpriced variant, never as absence", () => {
    expect(parsePrice("")).toEqual({ kind: "Unpriced" });
    expect(parsePrice("   \n  ")).toEqual({ kind: "Unpriced" });
  });

  it("throws on anything else, because an unreadable price must not arrive as a readable one", () => {
    expect(() => parsePrice("ab Werk")).toThrow(ParseError);
    expect(() => parsePrice("zwei Euro €")).toThrow(ParseError);
  });
});
