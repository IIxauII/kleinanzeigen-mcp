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
 * and **redacted** to the rule `redact.ts` states — nothing off the live page
 * survives unless it identifies nobody, whether or not a parser reads it, which
 * is why unread attributes and link titles are scrubbed here alongside the
 * fields §5.1 names. Fully synthetic fixtures were rejected too:
 * they drift from the real DOM and the parser tests end up proving only that
 * the parser parses the fixture.
 *
 * Raw pages are written to a gitignored scratch directory and reused on a
 * re-run, so iterating on the minimiser costs no further requests. Pass
 * `--refetch` to go back to the network.
 */
import * as cheerio from "cheerio";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ORIGIN } from "../src/search/search-url.ts";
import { raw } from "./capture-raw.ts";
import { redactor } from "./redact.ts";

const OUT_DIR = fileURLToPath(new URL("../tests/fixtures/", import.meta.url));

/**
 * The marker `search-unlinked-title` exists for. Which rows the site renders
 * unlinked is its own business and may change, so the capture **asserts** the
 * variant is there rather than quietly writing a fixture that no longer covers
 * what it was captured to cover.
 */
const UNLINKED = "ref-not-linked";

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
  // The unlinked `<h2><span class="ellipsis ref-not-linked">` heading, which
  // the site renders for a sizeable minority of rows and which `fahrrad`
  // carries only one or two of. `ps5` runs about half its page that way, so it
  // is the query that makes the variant reproducible rather than lucky.
  { name: "search-unlinked-title", url: `${ORIGIN}/s-k0?keywords=ps5`, needs: UNLINKED },
] as const;

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
    // Both of these run on the whole slot and **before** the banner branch
    // below, so a slot kept verbatim is scrubbed too: what the parser drops is
    // still captured, and a tracker in a banner is as real as one in a row.
    //
    // The store-click tracker quotes the row's real ad id where no selector
    // looks — `data-gaevent="…partner=pro;partneradid=3400000107"`.
    $li.find("[data-gaevent]").each((_, node) => {
      $(node).attr("data-gaevent", redact.gaevent($(node).attr("data-gaevent")!));
    });
    // A PRO row names its shop twice: `title="Zum shop …"` on both the badge
    // link and the name link, and the name again as the second link's text.
    $li.find("a[title]").each((_, link) => {
      const shop = /^(Zum shop\s+)(.+)$/u.exec($(link).attr("title")!);
      if (shop === null) return;
      const standIn = redact.shop(shop[2]!);
      $(link).attr("title", `${shop[1]}${standIn}`);
      $(link).find("span").text(standIn);
    });

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

    // Both headings the site renders — the linked `<h2><a>` and the unlinked
    // `<h2><span class="ellipsis ref-not-linked" data-url="…">`, whose
    // `data-url` carries the real slug and is redacted with the rest.
    article.find("h2 a, h2 span.ellipsis").text(redact.title(index));
    article.find(`h2 span.${UNLINKED}`).attr("data-url", href);
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
// Names, if any, narrow the run to those fixtures. A page the site rerenders
// between captures rewrites whatever it is asked to write, so adding one
// fixture should not churn the six that were already reviewed:
//
//     npm run capture:search-fixtures -- search-unlinked-title
const only = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
const wanted = PAGES.filter((page) => only.length === 0 || only.includes(page.name));
const unknown = only.filter((name) => !PAGES.some((page) => page.name === name));
if (unknown.length > 0) throw new Error(`no such fixture: ${unknown.join(", ")}`);

mkdirSync(OUT_DIR, { recursive: true });
for (const page of wanted) {
  const { name, url } = page;
  const body = await raw(name, url, refetch);
  const needs = "needs" in page ? page.needs : null;
  if (needs !== null && !body.includes(needs))
    throw new Error(`${name}: the live page carries no \`${needs}\`, so the fixture would not cover it`);
  const $ = cheerio.load(body);
  writeFileSync(`${OUT_DIR}${name}.html`, minimise($, name), "utf8");
  process.stderr.write(`wrote ${name}.html\n`);
}
