/**
 * Dev-time capture of the listing-detail fixtures under `tests/fixtures/`.
 *
 * Run by a maintainer, **never by the server** (SPEC 8.6):
 *
 *     npm run capture:listing-fixtures
 *
 * Same three properties as the search capture, and the same reasons: pages are
 * **hand-captured out of band**, **minimised** to the DOM §5.1 names, and
 * **redacted** — free text, seller names, exact locations, shop slugs and
 * image URLs replaced with synthetic values. Pass `--refetch` to go back to
 * the network.
 *
 * A detail page needs more minimising than a results page, not less: it
 * carries a share bar quoting the ad's title, a lightbox repeating every
 * image, a commercial seller's **imprint** — their address, phone number and
 * e-mail — and, at the foot, the seller's other listings and a related-ads
 * block, both in results-page markup. None of it is read, and none of it is
 * kept.
 *
 * **Ad ids age out.** Each listing below is named for the one shape it is here
 * for; when one is deleted the capture fails loudly on it, and the fix is to
 * find another listing of that shape rather than to drop the fixture.
 */
import * as cheerio from "cheerio";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { listingUrl } from "../src/listing/listing-url.ts";
import { INIT_KEYS } from "../src/listing/view-ad-init.ts";
import { raw } from "./capture-raw.ts";
import { redactor } from "./redact.ts";

const OUT_DIR = fileURLToPath(new URL("../tests/fixtures/", import.meta.url));

/**
 * Every shape the parser has to survive, and the one reason each is here.
 *
 * A negotiable price **with** an amount is deliberately not among them: it is
 * the intersection of two shapes already captured — `NEGOTIABLE` from the want
 * listing, an amount from either fixed-price listing — and one more real ad
 * captured is one more real ad captured (ADR-0003).
 */
const LISTINGS = [
  // A private offer: a fixed price, a full gallery, attributes and badges.
  { name: "listing-private-offer", ad_id: "3490780801" },
  // A commercial offer: a `/pro/` shop slug, `isCommercialUser`, and a seller
  // id that is **not** where a private seller's is.
  { name: "listing-commercial", ad_id: "3494529766" },
  // A want listing: `data-soldlabel="Gefunden"`, and a bare `VB` with no
  // amount — which `isWantedAdType: false` on this very page contradicts.
  { name: "listing-wanted", ad_id: "3494526034" },
  // Unpriced: `adPriceType: ''`, no `#viewad-price` element, no attributes and
  // no gallery — a listing in the lending category `c274`.
  { name: "listing-unpriced", ad_id: "3494516215" },
  // `GIVE_AWAY`, and `showDeletedVeil: true` on a page still being served:
  // the veil flags are not the "always false" prior research assumed.
  { name: "listing-giveaway-veiled", ad_id: "3493071354" },
] as const;

/**
 * Kept in the fixture though nothing reads them, so a test can prove nothing
 * does. `isWantedAdType` is `false` on the confirmed want listing captured
 * here, which is the whole reason §5.1 forbids it; the category ids are a
 * second source for a value the canonical URL already carries.
 */
const UNREAD_KEYS = ["isWantedAdType", "adL1CategoryId", "adL2CategoryId"] as const;

/**
 * The JS init, reduced to the keys above — **kept line by line as the site
 * wrote them**, mixed quoting and inconsistent spacing included, so the reader
 * is tested against the real thing rather than a tidied copy.
 */
function initBlock(body: string, adId: string): string {
  const block = /Belen\.Search\.ViewAdView\.init\(\{([\s\S]*?)\n\s*\}\);/u.exec(body);
  if (block === null) throw new Error("no Belen.Search.ViewAdView.init({…}) block");
  const lines = block[1]!
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => [...INIT_KEYS, ...UNREAD_KEYS].some((key) => new RegExp(`^${key}\\s*:`, "u").test(line)))
    // The ad id only: the category ids on their own lines are taxonomy, and
    // are kept so a test can hold the canonical URL against them.
    .map((line) => (line.startsWith("adId") ? line.replace(/'\d+'/u, `'${adId}'`) : line));
  return `    Belen.Search.ViewAdView.init({\n${lines.map((line) => `    ${line}`).join("\n")}\n    });`;
}

/** `02943 Sachsen - Weißwasser`, and the real-estate spelling that prefixes a street. */
function locality(rendered: string, redact: ReturnType<typeof redactor>, index: number): string {
  const parts = /(\d{5})\s+(.+)$/u.exec(rendered.replace(/\s+/gu, " ").trim());
  if (parts === null) throw new Error(`unreadable locality ${JSON.stringify(rendered)}`);
  // The postcode and the names go; a parenthesised district qualifier stays,
  // because it is a shape the parser has to survive and identifies nobody.
  const names = parts[2]!.split(" - ").map((name) => {
    const qualifier = /\s(\([^)]*\))$/u.exec(name);
    return qualifier === null
      ? redact.place(name)
      : `${redact.place(name.slice(0, qualifier.index))} ${qualifier[1]}`;
  });
  return `${redact.postcode(index)} ${names.join(" - ")}`;
}

/**
 * The gallery, rebuilt rather than kept: `#viewad-product` is the whole
 * article — description, details, share bar, lightbox and all — so the two
 * elements the parser reads images out of are lifted into an `article` of the
 * same id, and everything else in it is dropped.
 *
 * The thumbnail strip comes along on purpose. Its images are the *small* ones,
 * and a fixture without them could not show that only the large gallery URLs
 * are returned (SPEC 3.3).
 */
function gallery($: cheerio.CheerioAPI, redact: ReturnType<typeof redactor>, index: number): string {
  const kept = $("#viewad-product .vip-image-gallery, #viewad-product #viewad-lightbox-thumbnail-list");
  kept.find("script").remove();
  // Alongside `src`, an image carries the real URL again in `data-imgsrc` and
  // again in a cover element's inline background, and it carries the real
  // title and the real place in `alt` and `title`.
  kept.find("[style]").removeAttr("style");
  kept.find("[alt], [title], [data-title]").removeAttr("alt").removeAttr("title").removeAttr("data-title");
  kept.find("img").each((position, image) => {
    // **The size grammar is kept.** `rule=` is what tells a large gallery URL
    // from a thumbnail, and it is never rewritten — here or in the parser.
    const standIn = (url: string | undefined): string =>
      `${redact.image(index * 100 + position)}${/\?rule=[^"']*/u.exec(url ?? "")?.[0] ?? ""}`;
    $(image).attr("src", standIn($(image).attr("src")));
    const preview = $(image).attr("data-imgsrc");
    if (preview !== undefined) $(image).attr("data-imgsrc", standIn(preview));
  });
  return kept.length === 0
    ? ""
    : `<article id="viewad-product">\n${kept.map((_, node) => $.html(node)).get().join("\n")}\n</article>`;
}

/** The profile box, and the one element outside it that carries a commercial seller's id. */
function seller($: cheerio.CheerioAPI, redact: ReturnType<typeof redactor>, index: number, name: string): string[] {
  const box = $("#viewad-profile-box").first();
  if (box.length === 0) throw new Error(`${name}: no #viewad-profile-box`);
  const sellerName = redact.sellerName(index);

  box.find("[aria-label], [title], [alt]").removeAttr("aria-label").removeAttr("title").removeAttr("alt");
  box.find("img").attr("src", `${redact.image(index * 100 + 99)}?rule=$_12.JPG`);
  box.find("a[href]").each((_, link) => {
    const href = $(link).attr("href") ?? "";
    // A shop slug keeps its case and its collision suffix: the stand-in
    // carries both, because normalising one is the mistake §3.5 warns about.
    if (href.startsWith("/pro/")) $(link).attr("href", `/pro/${redact.shopSlug(index)}`);
    else if (href.includes("userId=")) $(link).attr("href", `/s-bestandsliste.html?userId=${redact.userId(index)}`);
    else $(link).attr("href", "#");
  });
  // The site masks a phone number to its first digits; those are still a real
  // seller's, and nothing reads them.
  box.find("#viewad-contact-phone a").text("00000...");
  box.find(".userprofile-vip").first().text(sellerName);
  box.find(".user-profile-vip-badge").text(sellerName.slice(0, 1));
  // The commercial teaser renders the shop's name a second time.
  box.find("#viewad-bizteaser--title a").text(sellerName);

  // A commercial seller has no `userId` link — their id is here instead,
  // inside the imprint dialog, whose text is a business address and is not
  // kept. Verified equal to the shop page's own `sellerId`.
  const documents = $("#viewad-commercial-policy-documents").first();
  if (documents.length > 0) documents.attr("data-user-id", redact.userId(index));

  return [$.html(box), ...(documents.length > 0 ? [$.html(documents)] : [])];
}

/**
 * Everything outside the anchors §5.1 names is dropped, and every value a real
 * person or a real ad could be recognised by is replaced.
 *
 * What stays verbatim is what the parser reads *as data* and no one is
 * identifiable by: the price, the posting date, the attribute labels and
 * values, the seller's badges, their type and their tenure, and the init's own
 * flags.
 */
function minimise($: cheerio.CheerioAPI, name: string, index: number, body: string): string {
  const redact = redactor();
  const adId = redact.adId(index);

  const title = $("#viewad-title").first();
  if (title.length === 0) throw new Error(`${name}: no #viewad-title`);
  title.text(redact.title(index));

  const canonical = $('meta[property="og:url"]').first().attr("content");
  if (canonical === undefined) throw new Error(`${name}: no og:url`);
  // The category and location codes stay: they are taxonomy rather than
  // identity, and **the third one is the location id** (SPEC 3.3).
  const codes = /\/(\d+)(-\d+-\d+)?$/u.exec(new URL(canonical).pathname);
  if (codes === null) throw new Error(`${name}: og:url carries no ad id`);
  const url = `https://www.kleinanzeigen.de/s-anzeige/${redact.slug(index)}/${adId}${codes[2] ?? ""}`;

  const where = $("#viewad-locality").first();
  where.text(locality(where.text(), redact, index));
  $("#viewad-description-text").first().text(redact.body(index));

  const kept = [
    $.html(title),
    ...["#viewad-price", "#viewad-locality", "#viewad-extra-info", "#viewad-description-text", "#viewad-details"]
      .map((selector) => $.html($(selector).first()))
      .filter((html) => html !== ""),
    gallery($, redact, index),
    ...seller($, redact, index, name),
  ].filter((html) => html !== "");

  const document = `<!doctype html>
<html lang="de">
  <head>
    <meta charset="utf-8" />
    <title>${name}</title>
    <meta property="og:url" content="${url}" />
  </head>
  <body>
    <script>
${initBlock(body, adId)}
    </script>
${kept.join("\n")}
  </body>
</html>
`;
  // Blank runs go, and the site's deep indentation is capped at four columns.
  return document.replace(/\n\s*\n/g, "\n").replace(/^[ \t]{5,}/gmu, "    ");
}

const refetch = process.argv.includes("--refetch");
mkdirSync(OUT_DIR, { recursive: true });
for (const [index, { name, ad_id }] of LISTINGS.entries()) {
  const body = await raw(name, listingUrl(ad_id), refetch);
  writeFileSync(`${OUT_DIR}${name}.html`, minimise(cheerio.load(body), name, index, body), "utf8");
  process.stderr.write(`wrote ${name}.html\n`);
}
