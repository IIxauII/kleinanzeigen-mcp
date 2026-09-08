import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readCitySitemap, readKatalog, slugFromName } from "./locations.ts";

const fixture = (name: string): string =>
  readFileSync(new URL(`../../tests/fixtures/${name}`, import.meta.url), "utf8");

describe("reading the cities sitemap", () => {
  it("takes the site's own slug for every id it publishes", () => {
    const { slugs } = readCitySitemap(fixture("sitemap-cities.xml"));
    expect([...slugs]).toEqual([
      [5510, "bayern"],
      [4127, "augsburg"],
      [6410, "kr-muenchen"],
    ]);
  });

  it("keeps the id-less /stadt/ landing pages, which is all it has of those 140", () => {
    // Köln is one of the 137 major cities beyond the three city-states that the
    // sitemap names only as a landing page, percent-encoded (SPEC 7, ADR-0004).
    expect(readCitySitemap(fixture("sitemap-cities.xml")).landingPages).toEqual(new Set(["koeln"]));
  });

  it("fails a sitemap that carries no location at all, rather than reading it as empty", () => {
    // A block answers 200 with an empty list, so the status is never the test
    // (ADR-0003). The `<loc>…/l<id>` entries are this page's parse marker.
    const empty = '<?xml version="1.0"?><urlset></urlset>';
    expect(() => readCitySitemap(empty)).toThrow("listed no locations");
  });

  it("fails an entry shaped like nothing it knows, rather than skipping it", () => {
    // A skipped entry understates the id set, which reads as a removal to the
    // drift check and loses a location in the generator (SPEC 5.8).
    const strange = `<urlset><url><loc>https://www.kleinanzeigen.de/s-anzeige/x1</loc></url></urlset>`;
    expect(() => readCitySitemap(strange)).toThrow("unrecognised cities sitemap entry");
  });

  it("fails a repeated id: two slugs for one location is not a thing to pick between", () => {
    const twice = `<urlset>
      <url><loc>https://www.kleinanzeigen.de/s-bayern/l5510</loc></url>
      <url><loc>https://www.kleinanzeigen.de/s-bavaria/l5510</loc></url>
    </urlset>`;
    expect(() => readCitySitemap(twice)).toThrow("repeated l5510");
  });
});

describe("reading a catalogue page", () => {
  it("takes the children in the page's own order, ids and German names", () => {
    expect(readKatalog(fixture("katalog-orte-root.html"), "federal states")).toEqual([
      { id: 3331, name: "Berlin" },
      { id: 5510, name: "Bayern" },
      { id: 9409, name: "Hamburg" },
    ]);
  });

  it("reads only the catalogue list, so a breadcrumb id is not a location", () => {
    const ids = readKatalog(fixture("katalog-orte-root.html"), "federal states").map((p) => p.id);
    expect(ids).not.toContain(99999);
  });

  it("collapses the whitespace a wrapped anchor puts inside a name", () => {
    const hamburg = readKatalog(fixture("katalog-orte-root.html"), "federal states").at(-1);
    expect(hamburg).toEqual({ id: 9409, name: "Hamburg" });
  });

  it("reads the second tier's mixed ranks the same way, Kreis and city alike", () => {
    expect(readKatalog(fixture("katalog-orte-bayern.html"), "localities in Bayern")).toEqual([
      { id: 6410, name: "Kr. München" },
      { id: 6411, name: "München" },
      { id: 4127, name: "Augsburg" },
    ]);
  });

  it("fails a page that lists nobody, naming what it was looking for", () => {
    expect(() => readKatalog("<html><body></body></html>", "localities in Bayern")) //
      .toThrow("listed no localities in Bayern");
  });

  it("fails an entry with an id and no name rather than shipping a nameless place", () => {
    const nameless = `<ul id="brwslctns-lctns-list">
      <li><a href="/s-katalog-orte.html?locationId=1"></a></li>
    </ul>`;
    expect(() => readKatalog(nameless, "federal states")).toThrow("unreadable federal states entry");
  });
});

describe("spelling a slug the way the site does", () => {
  it("expands umlauts the German way rather than stripping them", () => {
    expect(slugFromName("München")).toBe("muenchen");
    expect(slugFromName("Köln")).toBe("koeln");
    expect(slugFromName("Groß-Gerau")).toBe("gross-gerau");
  });

  it("reduces everything else to a-z0-9-, with no leading or trailing dash", () => {
    expect(slugFromName("Kr. München")).toBe("kr-muenchen");
    expect(slugFromName("Frankfurt (Oder)")).toBe("frankfurt-oder");
  });
});
