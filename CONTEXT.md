# kleinanzeigen-mcp

A read-only MCP server over kleinanzeigen.de, the German classifieds site. This glossary is the project's single vocabulary: every ticket, spec, tool name and field name uses these terms.

## Naming rule

**Canonical terms are English.** The German term is recorded alongside each entry as the source term, for traceability when reading the site's HTML — it is never the canonical name.

This is not a translation. Kleinanzeigen's own JavaScript and query parameters are already English (`adPriceType: FIXED | NEGOTIABLE | GIVE_AWAY`, `adType=OFFER | WANTED`, `posterType=PRIVATE | COMMERCIAL`, `global.zustand: new | like_new | defect`); only the rendered page is German. English canonical follows the site's internal model rather than departing from it.

**Enum values take the site's exact spelling** — `OFFER`, `WANTED`, `GIVE_AWAY`, `PRIVATE`, `COMMERCIAL` — so no value needs mapping on the wire and no mapping can drift.

## Language

### The listing

**Listing** _(Anzeige)_:
One classified ad, identified by an ad id.
_Avoid_: Ad, post, item, product, entry

**Ad id** _(Anzeigen-ID)_:
The stable 10-digit integer identifying a listing. The only load-bearing part of a listing URL.
_Avoid_: Listing id, ad number

**Listing type** _(Angebotstyp)_:
Whether a listing offers something or seeks it: `OFFER` or `WANTED`. One axis on one kind of listing — an offer listing and a want listing differ in this value and nothing else.
_Avoid_: Ad type

**Offer listing** _(Angebot)_:
A listing offering something. `listingType: OFFER`. The overwhelming majority of listings.

**Want listing** _(Gesuch)_:
A listing seeking something. `listingType: WANTED`. Roughly 0.5% of inventory.
_Avoid_: Wanted ad, request, search

**Listing detail page** _(Anzeigenseite)_:
The page for a single listing, at `/s-anzeige/…`. Kleinanzeigen's own code calls it the VIP.
_Avoid_: VIP, detail view

**Search results page** _(Ergebnisliste)_:
A page of listings matching a search query. 25 organic listings per page.
_Avoid_: SRP, listing page

### Price

A listing's price is one of four mutually exclusive shapes. An amount is present only where the shape below says so, which is what keeps "negotiable with no number" from ever being read as "free".

**Price** _(Preis)_:
What a listing asks, as one of: Fixed price, Negotiable price, Giveaway, or Unpriced. Every listing has exactly one — the shape is never absent.

**Fixed price** _(Festpreis)_:
A stated amount in EUR, not open to offers. `FIXED`.

**Negotiable price** _(Verhandlungsbasis, VB)_:
Open to offers. The amount is optional: a listing may show `19.990 € VB` or a bare `VB` with no figure at all. It is the only shape whose amount may be missing.

**Giveaway** _(Zu verschenken)_:
Free. `GIVE_AWAY`. Distinct from a negotiable price with no amount, and distinct from a lending listing.
_Avoid_: Free listing, zero price

**Unpriced**:
The listing's category has no price field, so no price exists to read. Kleinanzeigen omits the field entirely in some categories and tells sellers to state the price in the title or description instead. A normal state, never a parse failure.
_Avoid_: No price, null price, missing price

**Price drop** _(Preissenkung)_:
A previous, higher price shown struck through beside the current one.

### Categories and attributes

**Category** _(Kategorie)_:
A node in the taxonomy, identified by a numeric category id. Exactly two levels exist.

**Category id** _(Kategorie-ID)_:
The numeric identifier of a category, written `c217`. The only valid handle for a category — slugs and names collide across nodes, so neither identifies one.

**Top-level category** _(Oberkategorie)_ / **Subcategory** _(Unterkategorie)_:
The two levels of the taxonomy. There is no third.

**Category tree** _(Kategoriebaum)_:
The complete taxonomy, 159 nodes.

**Attribute** _(Attribut, Merkmal)_:
A category-specific typed field on a listing, keyed `<namespace>.<field>_<type>`, e.g. `autos.km_i`.

**Global attribute**:
An attribute shared across categories rather than specific to one, e.g. condition and colour.

**Condition** _(Zustand)_:
A global attribute: `new`, `new_with_tag`, `like_new`, `alright`, `ok`, `defect`.

### Location

**Location** _(Ort, Standort)_:
A node in kleinanzeigen's own location tree, identified by a numeric location id. Not a postcode, and not a place name — a location id implies its entire subtree.

**Location id**:
The numeric identifier of a location, written `l3331`. As with categories, the only valid handle: names and postcodes can each map to several locations.

**Postcode** _(PLZ)_:
A German five-digit postcode. Resolves to one *or more* locations, so it is not an identifier.

**Radius** _(Umkreis)_:
The distance in km searched around a location. Zero means the location itself.

**Federal state** _(Bundesland)_:
The top level of the location tree; sixteen exist.

### Seller

**Seller** _(Anbieter)_:
The party that posted a listing. Has an identity and an inventory, so it is a concept in its own right rather than a pair of fields on a listing.
_Avoid_: Poster, vendor, user, owner

**Seller id** _(Nutzer-ID)_:
The numeric identifier of a seller. Every seller has one, private or commercial. Not to be confused with the third number in a listing URL, which is the location id.
_Avoid_: User id

**Seller type** _(Anbietertyp)_:
Whether a seller is `PRIVATE` or `COMMERCIAL`. An enum, not a boolean: "not private" is a weaker claim than "commercial", and a seller type that cannot be read is unknown rather than private.

**Private seller** _(Privater Nutzer, Privat)_:
A seller posting as an individual. `posterType=PRIVATE`.

**Commercial seller** _(Gewerblicher Nutzer, Gewerblich, PRO)_:
A seller posting as a business. `posterType=COMMERCIAL`. Has a public shop page.

**Seller inventory** _(Bestandsliste)_:
Every listing one seller currently has online. Distinct from the count of listings a seller has ever posted, which their shop page also shows. A commercial seller's inventory is reachable through their shop page; a private seller's has a page of its own that this project does not read.

**Shop page** _(Unternehmensseite)_:
A commercial seller's public page, at `/pro/<slug>`, carrying their profile and their inventory. Private sellers have none.

**Shop slug** _(Unternehmensseiten-Slug)_:
The text handle addressing a shop page. Unlike a category or a location, where only a numeric id identifies a node, the slug is the shop page's own address — but it is a second handle, not a replacement for the seller id.

**Shop directory** _(Unternehmensseitenverzeichnis)_:
Kleinanzeigen's public index of shop pages. The way to resolve a commercial seller's name to a shop slug.

**Member since** _(Aktiv seit)_:
The date a seller's account was created.

**Seller badge** _(Nutzerbadge)_:
A reputation marker kleinanzeigen awards a seller, e.g. "TOP Zufriedenheit".

### Listing states

These are the seller's reality. What a logged-out reader can actually observe is narrower, so each entry says so — the distinction matters because a state that cannot be read must not be promised as a field.

**Active**:
A listing visible in search and reachable at its detail page. Observable only as the absence of every other state, so it cannot be positively confirmed — a reserved listing reached by URL is indistinguishable from an active one.

**Reserved** _(Reserviert)_:
A seller has set the listing aside for a buyer. It leaves search results while its detail page stays reachable. Kleinanzeigen surfaces the marker through watchlists and existing conversations, both of which require an account, so whether a logged-out reader sees it is unknown. A previously-found listing can therefore vanish from search while its URL still resolves.

**Expired** _(Abgelaufen)_:
The listing's lifetime has elapsed. Cannot be restored. While still served, the page carries a flag and renders behind a veil.

**Paused** _(Pausiert)_:
A seller has temporarily hidden the listing. As with Expired, flagged on the page while still served.

**Deleted** _(Gelöscht)_:
The listing is gone. There is no tombstone and no 404: the URL redirects to a browse page which answers 200 with a full page of *other* listings. A reader can tell that a URL no longer yields a listing, but never why — deleted and expired-then-purged are indistinguishable.

**Sold** _(Verkauft)_:
**Not a state.** Kleinanzeigen publishes no sold state. The page carries a sold *label template* — the wording an ad would use if its seller marked it sold — which is a category hint, not a status. Sellers signal sold or reserved by editing the title, and that convention is the only signal a reader sees.
_Avoid_: Sold, available, unavailable, in stock

**Listing lifetime** _(Laufzeit)_:
How long a listing runs before expiring: 60 days by default, extendable.

### Promotion

**Promotion** _(Hervorhebung)_:
Any of the paid products a seller can buy to raise a listing's visibility.

**Top listing** _(TOP-Anzeige)_:
A listing paid into the reserved slots at the head of every search results page. Appears *in addition to* the page's 25 organic listings, so it inflates a naive per-page count and recurs across pages.

**Highlighted listing** _(Highlight)_:
A listing paid a coloured background in results. No effect on ranking or position.

**Bump** _(Hochschieben)_:
A paid one-off return to the top of the date sort, which rewrites the listing's effective sort date.

**Gallery placement** _(Galerie)_:
Paid placement in the gallery on a city or federal-state homepage.

### Search

**Search query** _(Suchanfrage)_:
A complete request for listings: keyword, category, location, radius, filters, sort order and page. Always the full noun phrase — never a bare "search", which collides with *Gesuch*.

**Keyword** _(Suchbegriff)_:
The free-text part of a search query. Tokens are AND-combined; there are no operators.

**Sort order** _(Sortierung)_:
How results are ordered. Newest first is the default.

**Page** _(Seite)_:
One page of a search results page's pagination: 25 organic listings.

**Shipping offered** _(Versand möglich)_:
The seller will ship the item.

**Pickup only** _(Nur Abholung)_:
The seller will not ship.

### Categories that behave like price types

Kleinanzeigen models giving away, swapping and lending partly as taxonomy rather than as price. These two carry no price at all, which is why they belong in the vocabulary despite being ordinary categories.

**Lending listing** _(Verleihen, Verleihservice)_:
A listing offering something to borrow rather than to keep. A category, not a price type; such listings are always Unpriced.

**Swap listing** _(Tauschen)_:
A listing offering an exchange rather than a sale. Likewise a category.

## Terms to avoid, and why

- **"Ad"** for a listing. The page's own markup uses ad-listitem for advertising slots that are not listings at all, so the word is already taken. Say **listing**.
- **"VIP", "SRP", "liberty", "Belen"** — kleinanzeigen's internal names. Useful when reading their HTML, never in ours.
- **"User id"** for the third number in a listing URL. It is the **location id**.
- **"Sold"**, **"available"**, **"in stock"** — imply a published inventory state that does not exist.
- **"Search"** as a noun. In German, *Suche* (the act) and *Gesuch* (a want listing) are different words; in English they collapse. Say **search query** for the request and **want listing** for the Gesuch.
- **"Item"**, **"product"** for a listing. The model has listings, not goods: no stock, no SKU, no quantity.
- **A category or location *name* used as a handle.** Names and slugs collide across nodes; only the numeric **category id** or **location id** identifies one. Matching by name must report the candidates rather than pick among them.
