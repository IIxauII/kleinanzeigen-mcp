/**
 * The synthetic stand-ins every fixture capture uses (SPEC 8.6).
 *
 * Fixtures are real pages, minimised to the DOM the parser reads and
 * **redacted**. The rule is not a list of fields, and writing it as one is what
 * made the first hole invisible: **nothing that came off the live page survives
 * into a fixture unless it identifies neither a person, a business, an ad nor a
 * place** — a price, a date, a distance, a badge, a taxonomy code. Whether a
 * parser reads a value has no bearing on it. Attributes, link titles and text
 * the parser never touches are in scope, and it was exactly there — a tracking
 * attribute and a `Zum shop` title, both unread — that sixteen real ad ids and
 * twelve real shop names once rode through a capture that looked complete.
 *
 * A value kept verbatim is therefore a decision, argued for where it is made.
 *
 * The pool lives here rather than in a capture script so the three cannot drift
 * into different notions of what a redacted place, title, shop or ad id looks
 * like.
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

/**
 * Every id a tracking attribute spells, whichever key it spells it under. The
 * site writes the same ad id as `partneradid=` and as `adid=`, and a capture
 * that knew only one of the two spellings would leave the other standing.
 */
const TRACKED_ID = /((?:partner)?adid=)(\d+)/giu;

/** Stable per page, so the same real place keeps one stand-in inside one fixture. */
export function redactor() {
  const places = new Map<string, string>();
  const shops = new Map<string, string>();
  const trackedIds = new Map<string, string>();

  /** A shop's rendered company name, which is a business's and not a person's. */
  const shopName = (index: number): string => `Synthetisches Musterhaus GmbH ${index}`;
  /**
   * The ad id a **tracking** attribute carries. Offset by 100 from `adId()` so
   * the two pools can never mint the same number: a fixture where the row's own
   * id and the id its tracker quotes coincided by accident would hide a capture
   * that had redacted only one of them.
   */
  const partnerAdId = (index: number): string => String(3400000100 + index);

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
    partnerAdId,
    /**
     * One `data-gaevent` value, with every ad id in it replaced.
     *
     * Nothing reads this attribute, which is the only reason it survived a
     * capture at all: on a PRO row the site spells the row's real ad id into it
     * a second time — `ResultsSearch,ResultsAdStoreClick,partner=pro;partneradid=…`
     * — where no selector in `src/` ever looks. The rest of the value is a
     * fixed event name and stays, because it names no one.
     *
     * Mapped rather than indexed by the caller: the same row renders the same
     * attribute on two anchors, and a page's ids have to stay consistent across
     * both without the caller having to know that.
     */
    gaevent(value: string): string {
      return value.replace(TRACKED_ID, (_match, key: string, real: string) => {
        const known = trackedIds.get(real);
        if (known !== undefined) return `${key}${known}`;
        const standIn = partnerAdId(trackedIds.size);
        trackedIds.set(real, standIn);
        return `${key}${standIn}`;
      });
    },
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
    shopName,
    /**
     * A shop named on a results row, by the name the site rendered.
     *
     * A results page names a shop twice per row — `title="Zum shop …"` and the
     * link's own text — and names the same shop on every row it sponsors, so
     * the mapping is by name rather than by row: one shop keeps one stand-in
     * inside one fixture, exactly as a place does. It draws from `shopName`
     * rather than a pool of its own so a shop cannot be called one thing on a
     * results row and another on its own page.
     *
     * These names are not all companies. Two of the ones this replaced read as
     * sole traders, and one carried a working phone number — a business name
     * that is also a person is personal data, and the safe default is that any
     * of them might be.
     */
    shop(real: string): string {
      const key = real.trim();
      const known = shops.get(key);
      if (known !== undefined) return known;
      const standIn = shopName(shops.size);
      shops.set(key, standIn);
      return standIn;
    },
    /** A shop's own id, distinct from the seller id the same page carries. */
    storeId: (index: number): string => String(60000 + index),
    /** A location id is the only valid handle for a location, so it is as exact as a place name. */
    locationId: (index: number): string => String(4000 + index),
  };
}
