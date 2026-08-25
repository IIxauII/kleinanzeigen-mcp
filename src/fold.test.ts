import { describe, expect, it } from "vitest";
import { foldedMatch, foldVariants } from "./fold.ts";

describe("foldVariants", () => {
  it("folds case and diacritics", () => {
    expect(foldVariants("FahrrÄder")).toEqual(["fahrrader", "fahrraeder"]);
    expect(foldVariants("OPNV")).toEqual(["opnv"]);
  });

  it("collapses surrounding and repeated whitespace", () => {
    expect(foldVariants("  Auto,   Rad & Boot ")).toEqual(["auto, rad & boot"]);
  });

  it("offers the umlaut-expanded form alongside the stripped one", () => {
    expect(foldVariants("Köln")).toEqual(["koln", "koeln"]);
    expect(foldVariants("Gießen")).toEqual(["gießen", "giessen"]);
  });

  it("offers a single form when the two folds agree", () => {
    expect(foldVariants("Bonn")).toEqual(["bonn"]);
  });
});

describe("foldedMatch", () => {
  it("matches both ways a German writes an umlaut", () => {
    expect(foldedMatch("Köln", "Köln")).toBe(true);
    expect(foldedMatch("koln", "Köln")).toBe(true);
    expect(foldedMatch("KOELN", "Köln")).toBe(true);
    expect(foldedMatch("Muenchen", "München")).toBe(true);
    expect(foldedMatch("Giessen", "Gießen")).toBe(true);
  });

  it("stays exact — no substring and no edit distance", () => {
    expect(foldedMatch("Köl", "Köln")).toBe(false);
    expect(foldedMatch("Kölnn", "Köln")).toBe(false);
    expect(foldedMatch("Bon", "Bonn")).toBe(false);
  });

  it("never lets a blank query match", () => {
    expect(foldedMatch("   ", "Köln")).toBe(false);
    expect(foldedMatch("", "")).toBe(false);
  });
});
