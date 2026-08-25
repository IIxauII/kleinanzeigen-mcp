import type * as cheerio from "cheerio";

/**
 * The two readings every cheerio parser here starts from, shared by the search
 * and listing surfaces so neither grows its own spelling of them.
 */

/** One cheerio selection — `Cheerio<Element>`, spelled without reaching past cheerio into `domhandler`. */
export type Selection = ReturnType<ReturnType<cheerio.CheerioAPI["root"]>["find"]>;

/** A node's text, with the site's deep indentation collapsed to single spaces. */
export const text = (node: Selection): string => node.text().replace(/\s+/gu, " ").trim();
