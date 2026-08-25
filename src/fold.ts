/**
 * The one matching rule the two zero-request resolvers share (SPEC 4.4).
 *
 * Case- and diacritic-insensitive, and **nothing more**: no fuzzy matching, no
 * edit distance, no substring matching. A known vocabulary and an LLM caller
 * mean approximate matching buys little and turns a loud failure into a quiet
 * one.
 */

/**
 * The plain fold: case dropped, combining marks stripped, runs of whitespace
 * collapsed so a copied label still matches.
 *
 * `Köln` folds to `koln`, which is what a caller typing unaccented ASCII writes.
 */
function foldForMatch(value: string): string {
  return stripMarks(value.toLowerCase()).replace(/\s+/gu, " ").trim();
}

/**
 * The German fold: `ä ö ü ß` expand to `ae oe ue ss` **before** marks are
 * stripped, so `Köln` folds to `koeln`.
 *
 * This is the other half of how Germans write German on an ASCII keyboard, and
 * the site itself writes its slugs that way (`/s-koeln-vogelsang/l20582`). It
 * is a transliteration, not an approximation: the output is exact, and folding
 * both sides of a comparison keeps matching symmetric.
 */
function foldExpandingUmlauts(value: string): string {
  const expanded = value
    .toLowerCase()
    .replace(/ä/gu, "ae")
    .replace(/ö/gu, "oe")
    .replace(/ü/gu, "ue")
    .replace(/ß/gu, "ss");
  return stripMarks(expanded).replace(/\s+/gu, " ").trim();
}

/** NFD, minus every combining mark, recomposed. */
function stripMarks(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "");
}

/**
 * Every folded form a string may be matched by — one when the two folds agree,
 * two when the value carries an umlaut or an eszett.
 */
export function foldVariants(value: string): string[] {
  const plain = foldForMatch(value);
  const german = foldExpandingUmlauts(value);
  return plain === german ? [plain] : [plain, german];
}

/**
 * Whether two strings are the same name under that rule. `München` matches
 * `Munchen` and `Muenchen`; it matches nothing else.
 *
 * A blank string matches nothing, so a blank query is an empty result rather
 * than a match on every unnamed thing.
 */
export function foldedMatch(query: string, candidate: string): boolean {
  const needles = foldVariants(query);
  if (needles[0] === "") return false;
  return foldVariants(candidate).some((variant) => needles.includes(variant));
}
