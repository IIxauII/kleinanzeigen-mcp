/**
 * The synthetic stand-ins both fixture captures use (SPEC 8.6).
 *
 * Fixtures are real pages, minimised to the DOM the parser reads and
 * **redacted**: free text, seller names, exact locations and image URLs are
 * replaced with synthetic values. The pool lives here rather than in either
 * capture script so the two cannot drift into different notions of what a
 * redacted place, title or image URL looks like.
 */

/**
 * Synthetic places. The pool keeps the shapes the parsers have to survive — a
 * plain name, one with an umlaut, one with an eszett, multi-word names and a
 * lower-case particle — so redaction costs a fixture no coverage.
 *
 * **Appending to this pool rewrites existing fixtures**: a page with more
 * distinct places than the pool holds wraps around it, so a ninth entry
 * changes what the ninth place in a captured page is called.
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
export function redactor() {
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
    /** A detail page's description is the full text, with the line breaks the page preserves. */
    body: (index: number): string => `${LOREM}\n\nZweiter Absatz der Testvorrichtung [${index}].`,
    sellerName: (index: number): string => `Musterverkäufer ${index}`,
    /**
     * **Case-sensitive, and carrying the numeric collision suffix** two shops
     * sharing a name get: `Autohaus-Meyer-GmbH` and `autohaus-meyer-gmbh-1`
     * are different sellers, which is why a shop slug is never normalised
     * (SPEC 3.5).
     */
    shopSlug: (index: number): string => `Synthetisches-Musterhaus-GmbH-${index}`,
    userId: (index: number): string => String(21000000 + index),
  };
}
