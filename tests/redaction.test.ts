import * as cheerio from "cheerio";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The fixtures, held against the redaction rule `scripts/redact.ts` states
 * (SPEC 8.6): nothing off the live page survives unless it identifies nobody.
 *
 * The capture scripts are where that rule is applied and this is where it is
 * **proved**, because the two fail differently. A capture only ever redacts
 * what its author thought to redact, and the fields nobody thought of are
 * precisely the ones a reviewer will not miss either — a `data-gaevent` and a
 * `title="Zum shop …"` once carried sixteen real ad ids and twelve real shop
 * names, one of them a working phone number, past every reviewer of every
 * capture. This test reads the committed bytes instead, so a value that
 * survives is caught by what it looks like rather than by where anyone
 * expected it.
 *
 * It reads **every** file under `tests/fixtures/`, not the ones a parser
 * loads: a fixture nothing parses yet is published just the same.
 */
const DIR = fileURLToPath(new URL("./fixtures/", import.meta.url));

const FILES = readdirSync(DIR).sort();

const read = (name: string): string => readFileSync(`${DIR}${name}`, "utf8");

/**
 * Every leak the check finds, as `file: value` lines.
 *
 * Deduplicated and sorted so the failure is the same list every run, and
 * asserted against `[]` rather than counted: a count tells CI that something
 * leaked, and this tells it which file and which value, which is the whole of
 * what a maintainer needs before opening anything.
 */
function leaks(check: (body: string, name: string, report: (value: string) => void) => void): string[] {
  const found = new Set<string>();
  for (const name of FILES) check(read(name), name, (value) => found.add(`${name}: ${value}`));
  return [...found].sort();
}

/**
 * Both spellings the site writes an ad id into a tracking attribute under, and
 * the shape the init block writes the page's own id in. Quoted or bare, `=` or
 * `:`, any case — the point is to catch the value, not one syntax.
 */
const AD_ID = /(partneradid|adid)["']?\s*[:=]\s*["']?(\d+)/giu;

/** `redact.adId` mints these; anything else is a real ad. */
const SYNTHETIC_AD_ID = /^34000000\d\d$/u;

/** `redact.partnerAdId` mints these, offset so it cannot collide with the above. */
const SYNTHETIC_PARTNER_AD_ID = /^34000001\d\d$/u;

/** `title="Zum shop <name>"`, the shop name a results row renders where nothing reads it. */
const SHOP_TITLE = /title="Zum shop ([^"]*)"/gu;

/** `redact.shopName` mints these. */
const SYNTHETIC_SHOP = /^Synthetisches Musterhaus GmbH \d+$/u;

/**
 * A German number: `+49 …`, or an area code and a subscriber block separated
 * the way a person writes one — `01234-5678`.
 *
 * `.` and `:` are deliberately not separators, because a date and a clock time
 * are both kept verbatim in these fixtures and neither is a phone number. The
 * lookarounds keep the match out of the middle of a longer run of digits and
 * dashes, which is what an image UUID and a `…-217-0000` ad URL are.
 */
const PHONE = /(?<![\d-])(?:\+49[\s\-/()]*\d[\d\s\-/()]{5,}\d|0\d{2,5}[\s\-/]\d{3,})(?![\d-])/gu;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gu;

describe("every committed fixture", () => {
  it("is a file this test actually read", () => {
    // A rename or a moved directory would otherwise turn every check below
    // into a vacuous pass over nothing.
    expect(FILES.length).toBeGreaterThan(0);
  });

  it("carries only synthetic ad ids, in tracking attributes as much as in markup", () => {
    expect(
      leaks((body, _name, report) => {
        for (const [, key, value] of body.matchAll(AD_ID)) {
          const synthetic = key!.toLowerCase() === "partneradid" ? SYNTHETIC_PARTNER_AD_ID : SYNTHETIC_AD_ID;
          if (!synthetic.test(value!)) report(`${key}=${value}`);
        }
      }),
    ).toEqual([]);
  });

  it("names no real shop in a `Zum shop` link title", () => {
    expect(
      leaks((body, _name, report) => {
        for (const [, name] of body.matchAll(SHOP_TITLE)) {
          if (!SYNTHETIC_SHOP.test(name!)) report(`title="Zum shop ${name}"`);
        }
      }),
    ).toEqual([]);
  });

  it("names no real shop in the text of one either", () => {
    // The row renders the name twice, and a check on the title alone would
    // pass a fixture whose link text still spelled it out.
    expect(
      leaks((body, name, report) => {
        if (!name.endsWith(".html")) return;
        const $ = cheerio.load(body);
        $('a[title^="Zum shop"] span').each((_, span) => {
          const text = $(span).text().trim();
          if (!SYNTHETIC_SHOP.test(text)) report(`<span>${text}</span>`);
        });
      }),
    ).toEqual([]);
  });

  it("carries no phone number", () => {
    expect(leaks((body, _name, report) => {
      for (const [match] of body.matchAll(PHONE)) report(match);
    })).toEqual([]);
  });

  it("carries no e-mail address", () => {
    expect(leaks((body, _name, report) => {
      for (const [match] of body.matchAll(EMAIL)) report(match);
    })).toEqual([]);
  });
});
