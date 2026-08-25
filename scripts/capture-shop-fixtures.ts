/**
 * Dev-time capture of the shop fixtures under `tests/fixtures/`.
 *
 * Run by a maintainer, **never by the server** (SPEC 8.6):
 *
 *     npm run capture:shop-fixtures
 *
 * Same three properties as the search and listing captures — hand-captured out
 * of band, minimised, redacted — and one difference that shapes the whole
 * script: **the shop surface is not HTML the way the others are.** The page's
 * payload is an encoded blob in an island attribute and the paging RPC answers
 * in a second, different encoding, so there is no markup to strip down to.
 *
 * So the redaction is done **inside each encoding, in place**. The pair tree of
 * the island props and the index table of the RPC are rewritten leaf by leaf
 * and never re-encoded by us: a fixture round-tripped through our own encoder
 * would prove only that our decoder can read our encoder, which is the
 * fully-synthetic failure §8.6 rejects.
 *
 * What is dropped rather than redacted: the contact island (a phone number, a
 * street address and opening hours), the `contactPerson` prop (a named
 * employee, their photograph and their bio) and `initialShowcasedAds` (the
 * same listings a second time). Nothing reads any of them, and the safest
 * redaction of personal data nobody needs is not to keep it.
 *
 * **Shops age out.** Each shop below is named for the one shape it is here
 * for; when one closes the capture fails loudly on it, and the fix is to find
 * another shop of that shape rather than to drop the fixture.
 */
import * as cheerio from "cheerio";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { islandName } from "../src/shop/island-props.ts";
import { shopAdsRequest, shopPageUrl, SHOP_PAGE_SIZE } from "../src/shop/shop-request.ts";
import { raw, rawPost } from "./capture-raw.ts";
import { redactor } from "./redact.ts";

const OUT_DIR = fileURLToPath(new URL("../tests/fixtures/", import.meta.url));

/** The islands the parser reads. Everything else on the page is dropped. */
const ISLANDS = ["BrandProfilePage", "ProfileActions", "UserBadges"] as const;

const SHOPS = [
  // A full page 1: 25 listings, a profile with prose and a logo, and a
  // per-category breakdown that sums exactly to `adsOnline`.
  { name: "shop-page", slug: "decathlon-muenster" },
  // **A mixed-case slug**, and the shape the first shop has none of: listings
  // the site renders no price for at all — a job and a flat filed beside the
  // stock — plus negotiable prices, and no `contactPerson`.
  { name: "shop-page-unpriced", slug: "Autohaus-CCC-GmbH" },
  // **A slug that names no shop, answering HTTP 200 with a shop-shaped page**:
  // `adsOnline: 0`, `initialAds: null`, no `sellerId`, and `sellerType`
  // flipped to `private`. The guard fixture.
  { name: "shop-page-unknown", slug: "kein-shop-mit-diesem-slug-xyz123" },
] as const;

const RPC_PAGES = [
  // Page 2 of a 30-listing shop: the deeper page the shop page cannot serve.
  { name: "shop-ads-page-2", slug: "decathlon-muenster", page: 2 },
  // Page 3 of the same shop: past the end, and **a clean termination rather
  // than an error** — `ads: []` in 444 bytes (SPEC 5.2).
  { name: "shop-ads-empty", slug: "decathlon-muenster", page: 3 },
] as const;

type Redact = ReturnType<typeof redactor>;

/** Reads and writes one listing's fields, whichever encoding is holding them. */
type Field = {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
};

/**
 * One listing, in either encoding.
 *
 * The two decoders are different and the twelve fields underneath them are the
 * same, which is exactly why this is written once: a capture with two copies
 * of it could redact an island fixture and an RPC fixture into disagreeing
 * about what a shop listing is.
 */
function redactAd(field: Field, redact: Redact, index: number): void {
  const ad_id = redact.adId(index);
  const url = String(field.get("url"));
  // The trailing category and location codes stay: they are taxonomy, not a
  // seller, and keeping them keeps the URL the shape the parser sees.
  const codes = /-(\d+)-(\d+)$/u.exec(url);
  field.set("id", Number(ad_id));
  field.set("url", `/s-anzeige/${redact.slug(index)}/${ad_id}${codes?.[0] ?? ""}`);
  field.set("title", redact.title(index));
  field.set("description", redact.long(index));
  field.set("location", redact.place(String(field.get("location"))));
  // **The size grammar is kept.** `rule=` tells a card image from a retina one
  // and is never rewritten — here or in the parser.
  for (const [position, key] of ["image", "retinaImage"].entries()) {
    const original = String(field.get(key));
    field.set(key, `${redact.image(index * 10 + position)}${/\?rule=[^"']*/u.exec(original)?.[0] ?? ""}`);
  }
}

// ---------------------------------------------------------------------------
// The island props: a `[type, value]` pair per value, applied recursively.
// ---------------------------------------------------------------------------

type Pair = [number, unknown];

const value = (pair: unknown): unknown => (pair as Pair)[1];

const asRecord = (pair: unknown): Record<string, unknown> => value(pair) as Record<string, unknown>;

/** A pair holding a value, which is how everything but an array is spelled. */
const pair = (value_: unknown): Pair => [0, value_];

/** `[0]` — a pair with nothing in it — is how the page spells a value it does not have. */
const present = (pair: unknown): boolean => pair !== undefined && value(pair) !== undefined;

function islandField(ad: Record<string, unknown>): Field {
  return {
    get: (key) => (ad[key] === undefined ? undefined : value(ad[key])),
    set: (key, replacement) => {
      ad[key] = pair(replacement);
    },
  };
}

function redactIsland(name: string, props: Record<string, unknown>, redact: Redact): Record<string, unknown> {
  if (name === "BrandProfilePage") {
    // Each is rewritten only where the page has one: the shop that does not
    // exist has neither id, and a fixture that invented them for it would hide
    // the very absence it is captured to prove.
    if (present(props["brandName"])) props["brandName"] = pair(redact.shopSlug(0));
    if (present(props["sellerId"])) props["sellerId"] = pair(Number(redact.userId(0)));
    if (present(props["storeId"])) props["storeId"] = pair(redact.storeId(0));
    const about = props["about"] === undefined ? undefined : asRecord(props["about"]);
    if (about !== undefined) {
      if (about["description"] !== undefined) about["description"] = pair(redact.body(0));
      if (about["summary"] !== undefined) about["summary"] = pair(redact.short());
    }
    // A named employee, their photograph and their bio. Nothing reads it.
    delete props["contactPerson"];
    // The same listings a second time, in a shorter shape.
    delete props["initialShowcasedAds"];
    const initialAds = props["initialAds"];
    // `null` is the shape a slug that names no shop produces, and the fixture
    // that carries it is the point of that capture.
    if (initialAds !== undefined && value(initialAds) !== null) {
      const ads = value(asRecord(initialAds)["ads"]) as unknown[];
      for (const [index, ad] of ads.entries()) redactAd(islandField(asRecord(ad)), redact, index);
    }
    return props;
  }
  if (name === "ProfileActions") {
    props["userId"] = pair(redact.userId(0));
    props["internalUrl"] = pair(`https://www.kleinanzeigen.de/pro/${redact.shopSlug(0)}`);
    props["title"] = pair(redact.shopName(0));
    props["description"] = pair(redact.body(0));
    props["logoUrl"] = pair(`${redact.image(999)}?rule=$_12.JPG`);
    return props;
  }
  // UserBadges: the name a third time, and reputation markers that name nobody.
  props["companyName"] = pair(redact.shopName(0));
  return props;
}

const escapeAttribute = (text: string): string =>
  text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/**
 * The page, reduced to the islands the parser reads.
 *
 * The `opts` attribute comes along verbatim: it carries the island's **stable
 * name**, which is what the parser anchors on, because `component-url` carries
 * a build hash and moves with every deploy.
 */
function minimiseShopPage(body: string, name: string): string {
  const $ = cheerio.load(body);
  const redact = redactor();
  const kept: string[] = [];

  for (const element of $.root().find("astro-island").toArray()) {
    const node = $(element);
    const opts = node.attr("opts");
    if (opts === undefined) continue;
    // The parser's own reading of which island this is, imported rather than
    // repeated (SPEC 8.6).
    const island = islandName(opts);
    if (island === null || !ISLANDS.includes(island as (typeof ISLANDS)[number])) continue;
    const props = node.attr("props");
    if (props === undefined) throw new Error(`${name}: the ${island} island carries no props`);
    const redacted = redactIsland(island, JSON.parse(props) as Record<string, unknown>, redact);
    kept.push(
      `    <astro-island opts="${escapeAttribute(opts)}" component-export="default" ` +
        `props="${escapeAttribute(JSON.stringify(redacted))}"></astro-island>`,
    );
  }
  if (kept.length === 0) throw new Error(`${name}: no island on the page`);

  return `<!doctype html>
<html lang="de">
  <head>
    <meta charset="utf-8" />
    <title>${name}</title>
  </head>
  <body>
${kept.join("\n")}
  </body>
</html>
`;
}

// ---------------------------------------------------------------------------
// The RPC: a flat index table, where every value is addressed by its position.
// ---------------------------------------------------------------------------

/**
 * The RPC payload, redacted **at its indices**.
 *
 * Strings repeat across rows — every listing's `location`, most listings'
 * `date` — and the encoding stores each once and points at it, so an index
 * already rewritten is left alone. Rewriting it twice would map a stand-in
 * through the redactor a second time and hand two rows different places where
 * the site gave them the same one.
 */
function minimiseShopAds(body: string, name: string): string {
  const values = JSON.parse(body) as unknown[];
  const redact = redactor();
  const rewritten = new Set<number>();
  const root = values[0] as Record<string, number>;
  const ads = values[root["ads"]!] as number[];

  for (const [index, reference] of ads.entries()) {
    const ad = values[reference] as Record<string, number>;
    redactAd(
      {
        get: (key) => (ad[key] === undefined ? undefined : values[ad[key]]),
        set: (key, held_) => {
          const slot = ad[key];
          if (slot === undefined || rewritten.has(slot)) return;
          values[slot] = held_;
          rewritten.add(slot);
        },
      },
      redact,
      index,
    );
  }
  if (ads.length === 0 && !name.endsWith("empty")) throw new Error(`${name}: no listings to redact`);
  return `${JSON.stringify(values)}\n`;
}

const refetch = process.argv.includes("--refetch");
mkdirSync(OUT_DIR, { recursive: true });

for (const { name, slug } of SHOPS) {
  const body = await raw(name, shopPageUrl(slug), refetch);
  writeFileSync(`${OUT_DIR}${name}.html`, minimiseShopPage(body, name), "utf8");
  process.stderr.write(`wrote ${name}.html\n`);
}

for (const { name, slug, page } of RPC_PAGES) {
  const request = shopAdsRequest({ shop_slug: slug, page });
  if (request.body["pageSize"] !== SHOP_PAGE_SIZE) throw new Error("the capture must page as the server does");
  const body = await rawPost(name, request.url, request.body, refetch);
  writeFileSync(`${OUT_DIR}${name}.json`, minimiseShopAds(body, name), "utf8");
  process.stderr.write(`wrote ${name}.json\n`);
}
