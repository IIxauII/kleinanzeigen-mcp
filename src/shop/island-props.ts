import type * as cheerio from "cheerio";
import { ParseError } from "../fetch/errors.ts";

/**
 * **The second of the three decoders** (SPEC 5.1).
 *
 * The shop page is not search-results markup and it is not a listing detail
 * page: it is an Astro page whose islands carry their props as an encoded blob
 * in an attribute. Cheerio finds the island; it cannot read what is inside it,
 * which is why this is a decoder in its own right rather than another set of
 * selectors.
 *
 * The encoding is a pair per value — `[type, value]` — applied recursively, so
 * `{"adsOnline":[0,30]}` is `{ adsOnline: 30 }` and a one-element pair is a
 * value the page does not have. Only two of Astro's type codes appear on this
 * page, and an unrecognised third is a **loud failure** rather than a guess:
 * decoding `[3, "…"]` as a plain string would hand the parser a date-shaped
 * string it would then read as text (SPEC 5.8).
 */

/** A primitive, an object, or nothing at all — `[0]` with no second element. */
const VALUE = 0;

/** An array, whose elements are themselves pairs. */
const ARRAY = 1;

/**
 * The island's stable name, from `opts`. `component-url` carries a build hash
 * and moves with every deploy.
 *
 * Exported so the fixture capture picks its islands by the same reading the
 * parser does — a fixture written by a second opinion of "which island is
 * this" is the drift SPEC 8.6 exists to prevent.
 */
export function islandName(opts: string | undefined): string | null {
  if (opts === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(opts);
    const name = (parsed as { name?: unknown }).name;
    return typeof name === "string" ? name : null;
  } catch {
    return null;
  }
}

function decodePair(pair: unknown, path: string): unknown {
  if (!Array.isArray(pair)) {
    throw new ParseError(`island props at ${path} are not a [type, value] pair`);
  }
  const [type, value] = pair as [unknown, unknown];
  if (type === ARRAY) {
    if (!Array.isArray(value)) throw new ParseError(`island props at ${path} say array and are not one`);
    return value.map((element, index) => decodePair(element, `${path}[${index}]`));
  }
  if (type !== VALUE) {
    // Astro encodes Date, Map, Set, RegExp, BigInt, URL and the typed arrays
    // under their own codes. None appears on this page, and one that started
    // to must surface here rather than downstream (SPEC 5.8).
    throw new ParseError(`island props at ${path} carry unsupported type code ${JSON.stringify(type)}`);
  }
  if (Array.isArray(value)) throw new ParseError(`island props at ${path} carry a bare array`);
  if (value === null || typeof value !== "object") return value;
  const decoded: Record<string, unknown> = {};
  for (const [key, member] of Object.entries(value)) decoded[key] = decodePair(member, `${path}.${key}`);
  return decoded;
}

/** The decoded props of one island, keyed by the prop names the page uses. */
export function decodeIslandProps(raw: string, island: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ParseError(`the ${island} island's props are not JSON`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ParseError(`the ${island} island's props are not an object`);
  }
  const props: Record<string, unknown> = {};
  for (const [key, pair] of Object.entries(parsed)) props[key] = decodePair(pair, `${island}.${key}`);
  return props;
}

/**
 * One named island's props, or `null` where the page carries no such island.
 *
 * `null` rather than a throw, because the shop page **drops islands it has
 * nothing to render** — a shop with no profile actions carries no
 * `ProfileActions` — and a missing island is the page saying so.
 */
export function islandProps(
  $: cheerio.CheerioAPI,
  island: string,
): Record<string, unknown> | null {
  for (const element of $.root().find("astro-island").toArray()) {
    const node = $(element);
    if (islandName(node.attr("opts")) !== island) continue;
    const raw = node.attr("props");
    if (raw === undefined) throw new ParseError(`the ${island} island carries no props`);
    return decodeIslandProps(raw, island);
  }
  return null;
}
