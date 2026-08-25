/**
 * The two readings every search-row parser does before it can believe a string:
 * collapse the site's deep indentation, and read a German-grouped number.
 */

/** Runs of whitespace to one space, ends trimmed. The site indents rows deeply. */
export const collapse = (value: string): string => value.replace(/\s+/gu, " ").trim();

/** `39.183` → `39183`, `1.234,5` → `1234.5`. Grouping is `.`, the decimal is `,`. */
export const germanNumber = (value: string): number =>
  Number(value.replaceAll(".", "").replace(",", "."));
