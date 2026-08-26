import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ParseError } from "../fetch/errors.ts";
import { CATEGORIES_SITEMAP_URL, parseCategorySitemap } from "./category-sitemap.ts";

const FIXTURE = new URL("../../tests/fixtures/sitemap-categories.xml", import.meta.url);
const xml = (): string => readFileSync(FIXTURE, "utf8");

describe("the categories sitemap", () => {
  it("is the one 2 KB file the taxonomy comes from", () => {
    expect(CATEGORIES_SITEMAP_URL).toBe("https://www.kleinanzeigen.de/sitemap_categories.xml");
  });

  it("reads every entry in the sitemap's own depth-first order", () => {
    expect(parseCategorySitemap(xml())).toEqual([
      { category_id: 210, slug: "auto-rad-boot", path: "/s-auto-rad-boot/c210" },
      { category_id: 216, slug: "autos", path: "/s-autos/c216" },
      { category_id: 217, slug: "fahrraeder", path: "/s-fahrraeder/c217" },
      {
        category_id: 231,
        slug: "eintrittskarten-tickets",
        path: "/s-eintrittskarten-tickets/c231",
      },
      { category_id: 286, slug: "bahn-oepnv", path: "/s-bahn-oepnv/c286" },
      {
        category_id: 192,
        slug: "zu-verschenken-tauschen",
        path: "/s-zu-verschenken-tauschen/c192",
      },
      { category_id: 273, slug: "tauschen", path: "/s-tauschen/c273" },
    ]);
  });

  it("reads the id set the drift check diffs", () => {
    expect(new Set(parseCategorySitemap(xml()).map((entry) => entry.category_id))) //
      .toEqual(new Set([210, 216, 217, 231, 286, 192, 273]));
  });

  it("ignores `lastmod` entirely", () => {
    // A whole-index regeneration marker, not a taxonomy-change signal: nothing
    // may be conditioned on it (SPEC 7).
    const stamped = xml();
    const unstamped = stamped.replace(/\s*<lastmod>[^<]*<\/lastmod>/g, "");
    expect(stamped).toContain("<lastmod>");
    expect(unstamped).not.toContain("<lastmod>");
    expect(parseCategorySitemap(unstamped)).toEqual(parseCategorySitemap(stamped));
  });

  it("refuses a sitemap that lists no categories, loudly", () => {
    expect(() => parseCategorySitemap('<?xml version="1.0"?><urlset></urlset>')) //
      .toThrow(ParseError);
  });

  it("refuses an entry it does not recognise rather than skipping it", () => {
    const moved = xml().replace(
      "https://www.kleinanzeigen.de/s-autos/c216",
      "https://www.kleinanzeigen.de/kategorien/autos",
    );
    expect(() => parseCategorySitemap(moved)).toThrow(ParseError);
  });

  it("refuses a repeated category id, which would understate the id set", () => {
    const repeated = xml().replace("/s-fahrraeder/c217", "/s-autos/c216");
    expect(() => parseCategorySitemap(repeated)).toThrow(/repeated/);
  });
});
