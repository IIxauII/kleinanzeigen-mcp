/**
 * Dev-time capture of the search-results fixtures under `tests/fixtures/`.
 *
 * Run by a maintainer, **never by the server** (SPEC 8.6):
 *
 *     npm run capture:search-fixtures
 *
 * SPEC 8.6 asks for three properties at once, and each rules out an easier
 * option: fixtures are **hand-captured out of band** (verbatim capture by the
 * server would republish real ads), **minimised** to the DOM the parser reads,
 * and **redacted** — free text, seller names, exact locations and image URLs
 * replaced with synthetic values. Fully synthetic fixtures were rejected too:
 * they drift from the real DOM and the parser tests end up proving only that
 * the parser parses the fixture.
 *
 * Raw pages are written to a gitignored scratch directory and reused on a
 * re-run, so iterating on the minimiser costs no further requests. Pass
 * `--refetch` to go back to the network.
 */
import * as cheerio from "cheerio";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ORIGIN } from "../src/search/search-url.ts";
import { USER_AGENT } from "../src/user-agent.ts";

const RAW_DIR = fileURLToPath(new URL("../.fixture-capture/", import.meta.url));
const OUT_DIR = fileURLToPath(new URL("../tests/fixtures/", import.meta.url));

/** Personal-scale politeness: serialised, no bursting (SPEC 2.8). */
const REQUEST_GAP_MS = 1500;

/**
 * Every shape the parser has to survive, and the one reason each is here.
 * `fahrrad` is broad enough to carry TOP rows and ad banners, and page 51 of it
 * is the silent clamp (SPEC 2.4).
 */
const PAGES = [
  {
    name: "search-page-1",
    // Radius is what makes `distance_km` render at all (SPEC 3.3).
    url: `${ORIGIN}/s-k0?keywords=fahrrad&locationStr=Berlin&radius=20`,
  },
  { name: "search-page-50", url: `${ORIGIN}/s-seite:50/k0?keywords=fahrrad` },
  { name: "search-page-51-clamped", url: `${ORIGIN}/s-seite:51/k0?keywords=fahrrad` },
  { name: "search-wanted", url: `${ORIGIN}/s-k0?keywords=fahrrad&adType=WANTED` },
  // Narrow enough that page 1 spans days, which is the only way to see the
  // other two date spellings — `Gestern, HH:MM` and `DD.MM.YYYY` (SPEC 3.2).
  { name: "search-old-dates", url: `${ORIGIN}/s-k0?keywords=cinelli` },
  // An honest empty set, which is a normal result only because §5.4 removed
  // the block that presents the same way (SPEC 5.6, 6.3).
  { name: "search-empty", url: `${ORIGIN}/s-k0?keywords=qzxwvnoresultsforthisquery` },
] as const;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function raw(name: string, url: string, refetch: boolean): Promise<string> {
  const path = `${RAW_DIR}${name}.html`;
  if (!refetch && existsSync(path)) return readFileSync(path, "utf8");
  process.stderr.write(`GET ${url}\n`);
  const response = await fetch(url, { headers: { "user-agent": USER_AGENT } });
  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`);
  const body = await response.text();
  mkdirSync(RAW_DIR, { recursive: true });
  writeFileSync(path, body);
  await sleep(REQUEST_GAP_MS);
  return body;
}


/**
 * Synthetic stand-ins. The pool keeps the shapes the parser has to survive —
 * a plain name, one with an umlaut, one with an eszett, multi-word names and a
 * lower-case particle — so redaction costs the fixture no coverage.
 */
const PLACES = [
  "Musterstadt",
  "Königsbrück",
  "Neustadt an der Nordsee",
  "Bad Grönenbach",
  "St Sebald",
  "Weißenthal",
  "Altdorf bei Musterberg",
  "Kleinlinden",
] as const;

const LOREM =
  "Synthetischer Beschreibungstext für eine Testvorrichtung. Er steht an der Stelle " +
  "des echten Anzeigentexts und trägt keine personenbezogenen Daten. Er ist lang genug, " +
  "um die Länge zu treffen, die das ld+json der Zeile sonst führt.";

/** Stable per page, so the same real place keeps one stand-in inside one fixture. */
function redactor() {
  const places = new Map<string, string>();
  return {
    place(real: string): string {
      const known = places.get(real);
      if (known !== undefined) return known;
      const standIn = PLACES[places.size % PLACES.length]!;
      places.set(real, standIn);
      return standIn;
    },
    postcode: (index: number): string => String(10000 + ((index * 137) % 89999)),
    adId: (index: number): string => String(3400000000 + index),
    slug: (index: number): string => `synthetisches-inserat-${index}`,
    title: (index: number): string => `Synthetisches Inserat ${index}`,
    image: (index: number): string =>
      `https://img.kleinanzeigen.de/api/v1/prod-ads/images/00/00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    /** The ld+json description is ~200 characters and ends truncated; the visible one is shorter. */
    long: (index: number): string => `${LOREM.slice(0, 197)}... [${index}]`,
    short: (): string => `${LOREM.slice(0, 92)}...`,
  };
}

/**
 * Everything outside the two anchors §5.1 names is dropped, and every value a
 * real person or a real ad could be recognised by is replaced.
 *
 * What stays verbatim is what the parser reads *as data* and no one is
 * identifiable by: prices, dates, distances, image counts, tags, and the
 * summary's numbers — including its trailing noun phrase, which is kept
 * precisely so a test can prove the parser never reads it (SPEC 5.5).
 */
function minimise($: cheerio.CheerioAPI, name: string): string {
  const redact = redactor();
  const summary = $("span.breadcrump-summary").first();
  if (summary.length === 0) throw new Error(`${name}: no span.breadcrump-summary`);

  const rows: string[] = [];
  $("#srchrslt-adtable > li.ad-listitem").each((index, li) => {
    const $li = $(li);
    const article = $li.find("article.aditem[data-adid]").first();
    if (article.length === 0) {
      // An ad banner: 5–8 per page, dropped silently by the parser (SPEC 5.1).
      // The slot is kept so the fixture still contains what has to be dropped.
      rows.push($.html($li));
      return;
    }

    const adId = redact.adId(index);
    const href = `/s-anzeige/${redact.slug(index)}/${adId}-217-0000`;
    article.attr("data-adid", adId).attr("data-href", href);
    article.find("a[href]").attr("href", href);
    article.find("a[aria-label]").attr("aria-label", redact.title(index));

    article.find("script[type='application/ld+json']").each((_, script) => {
      const payload = JSON.parse($(script).text()) as Record<string, unknown>;
      payload["title"] = redact.title(index);
      payload["description"] = redact.long(index);
      payload["contentUrl"] = `${redact.image(index)}?rule=$_59.AUTO`;
      $(script).text(JSON.stringify(payload));
    });
    article
      .find("img")
      .attr("src", `${redact.image(index)}?rule=$_2.AUTO`)
      .attr("srcset", `${redact.image(index)}?rule=$_35.AUTO`)
      .attr("alt", `${redact.title(index)} Vorschau`);

    article.find("h2 a").text(redact.title(index));
    article.find("p.aditem-main--middle--description").text(redact.short());

    // `<i class="icon-pin-gray"/> 13353 Wedding` and, under a radius, a
    // `(3 km)` or `(ca. 20 km)` in a text node of its own.
    article
      .find(".aditem-main--top--left")
      .contents()
      .each((_, node) => {
        if (node.type !== "text") return;
        node.data = node.data.replace(
          /(\d{5})[ \t]+([^\n(]+)/,
          (_match, _plz: string, place: string) =>
            `${redact.postcode(index)} ${redact.place(place.trim())}`,
        );
      });

    rows.push($.html($li));
  });

  const table = $("#srchrslt-adtable");
  const list =
    table.length === 0
      ? ""
      : `\n    <ul id="${table.attr("id")}" class="${table.attr("class")}">\n${rows.join("\n")}\n    </ul>`;
  const document = `<!doctype html>
<html lang="de">
  <head><meta charset="utf-8" /><title>${name}</title></head>
  <body>
    <h1>${$.html(summary)}</h1>${list}
  </body>
</html>
`;
  // Blank runs go, and the site's deep indentation is capped at four columns.
  // Both are whitespace the parser trims anyway, and a fixture a reviewer can
  // read is worth more than byte-for-byte indentation.
  return document.replace(/\n\s*\n/g, "\n").replace(/^[ \t]{5,}/gm, "    ");
}

const refetch = process.argv.includes("--refetch");
mkdirSync(OUT_DIR, { recursive: true });
for (const { name, url } of PAGES) {
  const body = await raw(name, url, refetch);
  const $ = cheerio.load(body);
  writeFileSync(`${OUT_DIR}${name}.html`, minimise($, name), "utf8");
  process.stderr.write(`wrote ${name}.html\n`);
}
