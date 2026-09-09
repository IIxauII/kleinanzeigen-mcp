# kleinanzeigen-mcp — build-ready spec

A local, personal, read-only MCP server over kleinanzeigen.de that reaches the site **only through URLs `robots.txt` permits**.

This document is the whole build. It carries no open decisions: every question the design raised was resolved on [the map](https://github.com/IIxauII/kleinanzeigen-mcp/issues/1) before this was written, and where two resolutions disagreed, §11 records which one won and why. Vocabulary is [`CONTEXT.md`](./CONTEXT.md)'s and nothing else. The three decisions a future reader will wonder about live in [`docs/adr/`](./docs/adr/).

Every factual claim below was measured live against the site, not inferred. Ticket links point at the measurement.

---

## 1. What this is, and what it deliberately isn't

### Is

- A **read-only** MCP server: search listings, read one listing, read a commercial seller's shop page, resolve category / location / shop names to handles.
- **Local and personal.** One process, one machine, one person, spawned over stdio by an MCP client.
- **Robots-clean, read literally.** Every URL fetched is matched by no `Disallow` under `User-agent: *`. See [ADR-0001](./docs/adr/0001-robots-clean-html-read-literally.md).
- **Non-persistent.** Nothing is written to disk, ever; nothing survives the process. See [ADR-0002](./docs/adr/0002-nothing-on-disk-nothing-survives-the-process.md).
- **Non-circumventing.** It identifies itself truthfully, rate-limits itself, and stops when told to stop. See [ADR-0003](./docs/adr/0003-non-circumvention.md).

### Isn't

Each of these was ruled out deliberately, and the reason matters as much as the ruling.

| Out of scope | Why |
| --- | --- |
| **Write operations** — posting, editing, renewing, deleting | Read-only destination. |
| **Messaging / negotiation** | Read-only destination. |
| **Anything authenticated** — Auth0 PKCE login, SMS MFA, the Akamai sensor flow | Public search and detail need no account. |
| **The mobile JSON API** (`api.kleinanzeigen.de`) and all `/*.json` helpers | Technically the better source — typed fields, GPS, ISO timestamps, exact counts, **no page cap** — and answers a plain `curl` with a credential baked into the APK. Refused: `Disallow: /api` and `Disallow: /*.json` ([#2](https://github.com/IIxauII/kleinanzeigen-mcp/issues/2)). This is the single largest thing given up, and [ADR-0001](./docs/adr/0001-robots-clean-html-read-literally.md) exists to explain it. |
| **Private seller inventory** (`/s-bestandsliste.html?userId=`) | `Disallow`'d (line 53), with **no** query-string escape — `?userId=`, `?sellerId=`, `?storeId=`, `?shopId=` and `?brandName=` are all inert on allowed search URLs. Refused **even though it works**: naked `curl`, HTTP 200, no auth, renders in the search-results markup we already parse, pages cleanly on `&pageNum=` at 25/page unbounded, and serves commercial sellers on the same handle. One refused path would have delivered the whole seller-inventory capability for both seller types at zero parser cost. Commercial sellers are **5.9%** of inventory, so the larger half is knowingly given up ([#12](https://github.com/IIxauII/kleinanzeigen-mcp/issues/12)). |
| **The shop directory as a browse surface** | `/s-unternehmensseiten-verzeichnis.html` is in scope **only** as a name → shop slug resolver. Walking its 53 808 shops is 1 077 requests ≈ 27 minutes — precisely the crawl § 5 Nr. 1 of the AGB describes ([#14](https://github.com/IIxauII/kleinanzeigen-mcp/issues/14)). |
| **The official Category Browser** (`developer.kleinanzeigen.de`) | `Disallow: /` for every agent — the entire `robots.txt` is 25 bytes. And it is the wrong taxonomy regardless: its string keys cannot reach numeric ids, since 12 slugs collide across 25 nodes, 4 of them across L1/L2 ([#5](https://github.com/IIxauII/kleinanzeigen-mcp/issues/5)). |
| **Headless browser / stealth automation** | Buys block-resistance that personal volume does not need, and evasion is the axis legal risk actually moves on. See [ADR-0003](./docs/adr/0003-non-circumvention.md). |
| **Third-party scraping APIs** (Apify, BrightData) | Outsourcing the same act. |
| **Hosted or multi-tenant deployment** | Personal/local destination. |
| **Saved searches, watching, polling for new listings** | Standing background load on a site that asked for none. |
| **Client-side filtering of any kind** | See §2.5 — a filter over 25 date-ordered rows out of a possible 1 250 is not a filter. |
| **The view counter** (`/s-vac-inc-get.json?adId=`) | Refused twice over: matched by `Disallow: /*.json`, **and** it increments the seller's own statistics. `s-vac-inc-get` is *view-ad-counter increment and get*. Reading is one thing; inflating a stranger's numbers to satisfy a read is another. |
| **Publishing to npm / PyPI** | Deliberately deferred. The package is *shaped* for it (§8) so the decision stays cheap. |

---

## 2. The access approach

### 2.1 The rule

> **A URL matched by no `Disallow` under `User-agent: *` is allowed.**

Read literally. Intent, resemblance and "they clearly meant to fence this" carry no weight — a spelling that escapes the file is a spelling the file did not fence. The alternative rule (refuse where a rule exists and only a spelling escaped it) was adopted first and abandoned in [#12](https://github.com/IIxauII/kleinanzeigen-mcp/issues/12), because it could not distinguish the cases it was invented to separate. Full reasoning in [ADR-0001](./docs/adr/0001-robots-clean-html-read-literally.md).

The corollary matters as much: **where the file *did* write a rule, it is obeyed even when a working path exists** — see the private Bestandsliste above.

**Development requirement.** An RFC 9309 matcher over the live `robots.txt` is run against every candidate URL *before* it is issued, during development and research. This is a dev-time discipline, not a runtime dependency: the server ships a fixed set of URL templates that were checked this way, and fetching `robots.txt` at runtime would add a request per session for a file that has not moved.

### 2.2 Allowed URL forms

Everything the server ever fetches. Nothing else may be added without re-running the matcher.

**Search** (HTML, `GET`)

| Inputs | Path |
| --- | --- |
| none | `/s-[seite:N/]k0` |
| category | `/s-[seite:N/]c<id>` |
| location | `/s-[seite:N/]l<id>` |
| category + location | `/s-[seite:N/]c<id>l<id>` |

`k0` is a **literal token** (`k1`/`k9` → 404). Leading slugs are cosmetic and are never emitted. **The keyword is never a path segment** — see §11.2.

Query parameters, all verified live on allowed pretty URLs:

```
?keywords=       free text, resolved server-side
?locationStr=    free text or postcode, resolved server-side
?radius=         km
?minPrice=       EUR
?maxPrice=       EUR
?adType=         OFFER | WANTED
?posterType=     PRIVATE | COMMERCIAL
?shipping=       true | false
?shippingCarrier=DHL | HERMES
?buyNowEnabled=  true
?sortingField=   SORTING_DATE | PRICE_AMOUNT | PRICE_AMOUNT_DESC
```

**Listing detail** (HTML, `GET`) — `/s-anzeige/x/<ad_id>`. Only the ad id is load-bearing; the slug and the trailing `-<category_id>-<location_id>` are cosmetic.

**Shop page** (HTML with a devalue-encoded Astro island, `GET`) — `/pro/<shop_slug>`.

**Shop inventory paging** (`POST /_actions/proPublicWeb.brandProfile.getAds/`) — JSON in, devalue-flattened out. No CSRF token, no cookies, no session.

**Shop directory search** (`POST /_actions/proPublicWeb.brandingIndex.searchBrandings/`) — same shape, same absence of ceremony.

**Build-time only, never at runtime** — `/sitemap_index.xml`, `/sitemap_categories.xml`, `/sitemap_cities.xml`.

The three `_actions` and slugless `seite:` forms are the four places the literal rule is actually load-bearing; `unternehmensseiten`, `verzeichnis`, `_actions`, `brandingIndex`, `searchBrandings`, `brandProfile` and `/pro/` appear **nowhere** in the file's 252 `*` rules ([#14](https://github.com/IIxauII/kleinanzeigen-mcp/issues/14)).

### 2.3 Refused URL forms

`/api` · `/*.json` (including `/s-ort-empfehlungen.json` and `/s-vac-inc-get.json`) · `/s-suchanfrage.html` · `/s-kategorie-baum.html` · `/s-bestandsliste.html` · `/s-feed.rss` · `/belen-gateway/*` · `developer.kleinanzeigen.de` (any path) · every **path-segment** filter spelling: `/preis:`, `/sortierung:`, `/anbieter:`, `/anzeige:`, `versand:`, `paketdienst:`, `direktkaufen:`, and all 33 `r{km}` radius forms.

The filters themselves are **not** refused — only these spellings of them. `robots.txt` fences the path-segment form; the query-string form matches no line, and the file's authors used query-string exclusions three times elsewhere (`utm_source`, `simcid`, `view=karte`), so the mechanism was available and was not applied here ([#4](https://github.com/IIxauII/kleinanzeigen-mcp/issues/4)).

Two escapes are **noticed and deliberately not taken**, because the tool would have to construct them on purpose and both sit under a wall of hand-written rules: `/s-l<id>r<km>` (the slugless radius form — moot anyway, `?radius=` covers radius entirely), and any radius path form. Slugless pagination *is* taken; [ADR-0001](./docs/adr/0001-robots-clean-html-read-literally.md) explains why that is not the same act.

### 2.4 The result ceiling and the page-50 clamp

- **25 organic listings per page × 50 pages = 1 250 organic listings per query.** Measured, not assumed.
- **TOP listings are extra**, up to 2 per page, consuming no result slot — so a page reporting `51 - 75` can carry 27 rows. They are not constant: 2/page on broad queries, **0/page** on narrow ones.
- **Page 50 is the last honest page, and the clamp is silent.** Page 51+ re-serve page 50 at HTTP 200 with a full 27 plausible rows and no error; deeper still (page 1000) the range resets to page 1's.

| page | reported range | expected start |
| --- | --- | --- |
| 49 | `1.201 - 1.225` | 1201 ✅ |
| 50 | `1.226 - 1.250` | 1226 ✅ |
| 51 | `1.226 - 1.250` | 1251 ❌ |
| 100 | `1.226 - 1.250` | 2476 ❌ |
| 1000 | `1 - 25` | 24976 ❌ |

**Detection rule.** Page N's honest range starts at `(N − 1) × 25 + 1`. Read the `N - M von T` range off `span.breadcrump-summary`; if the reported start ≠ the expected start, the page was clamped. This is **stateless** — no previous page, no query-scoped state — which is what lets it coexist with ADR-0002.

**Never infer depth from row counts.** A clamped page is full.

### 2.5 Paging is lazy, caller-driven, and never fanned out

Pages are independently addressable: `/s-seite:N/…` needs no cursor, session or cookie, and page 1000 was fetched cold from nothing. Page N costs exactly one request, never a replay of 1…N−1.

So: **one `search_listings` call fetches exactly one page.** No fixed cap, no internal walk, no opaque cursor. A cursor would be a fiction maintained over a source that has none, and `nextCursor: null` can tell the caller it stopped but never that it was *clamped*. An internal `limit: 1000` walk is 40 requests and ~60 s of wall clock hidden behind one call — and ADR-0003's "the operator owns their IP and their risk" only works if the request count is predictable from the call.

**No tool call ever fans out over listings.** Enriching 25 search rows with detail fetches would be 25 extra requests and 37.5 s at the default gap — a silent 25× rate-limit multiplier behind one call. `get_listing` exists so the caller chooses to pay that, one listing at a time. (`get_shop` costing one request per page is *paging*, not fan-out.)

### 2.6 Nothing is filtered client-side

**A filter is a server-side query parameter or it does not exist.**

The map originally permitted client-side filtering where it was "visible to the caller that a page-capped sample was filtered". That is closed off. Visibility does not rescue it: filtering 25 date-ordered rows out of a possible 1 250 is not a filter, and flagging it as sampled asks the agent to read a caveat instead of a value. The caller receives every field and can filter what it got — at which point it *knows* it filtered a sample, because it did the filtering.

**Genuinely unavailable, therefore absent from the tool surface** (not accepted-and-ignored, not offered as a client-side approximation):

- **Sort by distance** — `/*sortierung:entfernung*` is disallowed in every position and no query-string form exists.
- **Category attribute filters** — the path form *works* for keys `robots.txt` does not name (`/s-fahrraeder/c217+global.zustand:new` → 134 211 results), but ~40 popular keys **are** named, `?attributeMap[…]` returns an error page with 0 listings, and the valid key set is unenumerable. An `attributes` argument would have no discoverable domain. Attributes still arrive as *read* fields on `get_listing` (§4.2). Adding the argument later breaks nothing.
- **Multi-carrier search** — `?shippingCarrier=DHL,HERMES`, a repeated key in either order, and lower-case values all **400**. A caller wanting both issues two searches and unions.

### 2.7 Drift

Sequential paging drifts on high-volume queries: **5 of 125 organic rows were duplicates over a 13-second sweep** of nationwide `fahrrad`, as new listings landed and slid the date window. Every duplicate is also a listing missed. A narrow query (`damenrad` in Berlin, 4 251 results) returned 125 distinct with zero duplicates.

**Lazy paging makes this worse** — a caller-driven walk can span minutes. Consequences:

- **Dedupe on `data-adid`** and report the distinct count, never `pages × 25`.
- Dedupe is **the caller's**, not the server's: ADR-0002 forbids the query-scoped state a server-side dedupe would need, and the drift is a property of the source, not something to hide.
- The 5-minute cache softens it, since each page URL caches separately.

### 2.8 Rate limiting

- **One global serialised limiter**, shared by every tool, because every request hits one host. Per-tool budgets would let two tools stack up load the site experiences as a single client.
- **Minimum gap between requests, default 1500 ms. No bursting.** A token bucket would give better first-result latency and was rejected: a burst is the exact shape volume-driven blocking notices. An adaptive limiter that tightens on success was rejected more firmly still — tightening *is* throttle-probing.
- **Exponential backoff on 429/5xx, at most 2 retries. Never a retry on a block.**
- **`Retry-After` honoured exactly, up to a 60 s cap**, then fail loud. An MCP call that blocks for twenty minutes is indistinguishable from a hang.
- **Cache hits issue no request and skip the limiter entirely.**

The 1500 ms figure is field folk wisdom (the Go MCP server's self-limit), not a measurement. No rate-limit probing was done, deliberately: probing a throttle means triggering it on the operator's home IP.

---

## 3. Domain types

TypeScript, in `CONTEXT.md`'s vocabulary. Enum values take the site's exact spelling, so nothing maps on the wire and no mapping can drift.

### 3.1 Price — a tagged union, never an absent field

```ts
type Price =
  | { kind: "Fixed";      amount: number }
  | { kind: "Negotiable"; amount?: number }
  | { kind: "Giveaway" }
  | { kind: "Unpriced" };
```

Two properties do the work, and they are the reason this is a union rather than `{ amount?: number; type?: string }`:

- **The amount is optional only on `Negotiable`.** A bare `VB` with no figure is structurally unconfusable with `Giveaway` — different variants, not the same variant with a missing number.
- **`Unpriced` is an explicit variant, never absence.** Categories such as *Reise & Event-Services*, *Künstler & Musiker* and *Verleihen* (`c274`) have no price field by design. Modelling that as absence makes "the site has no price here" indistinguishable from "we failed to parse one".

Every listing has exactly one shape; the shape is never missing. Source: `adPriceType` in the detail page's JS init (`FIXED` | `NEGOTIABLE` | `GIVE_AWAY` | `''`), and the rendered price string on a search row.

> **Correction, recorded while building `get_listing` ([#21](https://github.com/IIxauII/kleinanzeigen-mcp/issues/21)).** **`GIVE_AWAY` is a price type a seller chose, not the giveaway category.** A listing in *Zu verschenken* (`c192`) carries `adPriceType: ''` and renders no `#viewad-price` element, so it reads `Unpriced` — while a listing in an ordinary category whose seller picked "Zu verschenken" carries `GIVE_AWAY` and renders that string. Both are free; only the second says so in a field, and neither is inferred from the other.
>
> On the detail page the two sources are read **together**: the shape and the amount come from the init, and the rendered string is held against the shape as a second opinion. A page where they disagree is a page the parser no longer understands, and it fails loudly (§5.8) rather than picking a winner.

A **price drop** is a previous higher price shown struck through. It is carried as `old_price?: Price` and appears only where the site renders one.

### 3.2 Posting date — two precisions, one timezone

```ts
type PostingDate =
  | { value: string; precision: "minute" }  // "2026-08-24T20:08:00+02:00"
  | { value: string; precision: "day" };    // "2026-08-18"
```

The **same listing has different precision depending on which tool read it**: a search row gives `Heute, 20:08` / `Gestern, 11:02` / `18.08.2026`; the detail page gives `DD.MM.YYYY` with no time at all. The discriminant is therefore mandatory — a bare ISO string would claim `18.08.2026` happened at midnight.

**Normalisation is in `Europe/Berlin`, never the machine's local date.** At 00:30 Berlin the machine's UTC date is still yesterday, and resolving `Heute` locally shifts every recent listing by a day. Node 22 ships full ICU, so this costs no dependency.

### 3.3 Listing

```ts
type ListingType = "OFFER" | "WANTED";
type SellerType  = "PRIVATE" | "COMMERCIAL";

type SearchRow = {
  ad_id: string;
  url: string;
  title: string;
  description: string;          // ~200 chars, from the row's ld+json
  price: Price;
  old_price?: Price;
  postcode: string | null;
  location_name: string | null;
  posted: PostingDate;
  thumbnail: string | null;
  image_count: number;
  shipping: boolean;            // true = shipping offered, false = pickup only
  listing_type: ListingType;
  promoted: boolean;            // a TOP listing
  distance_km: number | null;   // rendered only under an active radius
};
```

> **Correction, recorded while building `search_listings` ([#19](https://github.com/IIxauII/kleinanzeigen-mcp/issues/19)).** Two of `SearchRow`'s fields above are not always present on the live page, and both are now **nullable**.
>
> - **`posted` is `null` on a TOP row.** A promoted row renders an empty `.aditem-main--top--right` — no date, no calendar icon — on every page sampled, while every organic row on those same pages carries one. Since TOP listings are returned flagged and in place (§4.1), the date has to be allowed to be missing on exactly the rows that are marked as the reason it is.
> - **`description` falls back to the visible snippet** on a picture-less row. The ~200-character text lives in the row's `ld+json`, and that block describes the row's *image*: a row rendering `imagebox is-nopic` has no `ld+json` at all (17 of 108 sampled rows). The visible `p.aditem-main--middle--description` is shorter, and reading it is honest; treating the absence as a parse failure would make a normal row look like a DOM change.
>
> `thumbnail: null` and `image_count: 0` on those same rows were already in the type. A row that renders an image but no `.galleryimage--counter` has exactly one image.

```ts
type Listing = {
  ad_id: string;
  url: string;
  title: string;
  description: string;          // full text
  price: Price;
  old_price?: Price;
  category_id: number | null;
  location_id: number | null;
  postcode: string | null;
  location_name: string | null;
  posted: PostingDate;          // always precision: "day" from this surface
  images: string[];             // large gallery URLs, exactly as the page gave them
  image_count: number;
  listing_type: ListingType;
  attributes: { label: string; value: string }[];   // verbatim German, rendered order
  seller: Seller;
  flags: ListingFlags;
};
```

**Attributes are verbatim German label/value pairs in rendered order** — `{ label: "Zustand", value: "Sehr Gut" }` — with no key mapping. The machine keys (`autos.km_i`, `global.zustand`) exist in `robots.txt` and in filter URLs but **not in the detail page's DOM**, so the typed key and the readable value live on different surfaces. A mapping table for ~40 unenumerable keys across 159 categories has no verification path, and a half-populated typed field is worse than an honest untyped one.

**Images are exactly what the page gave.** Search returns the `$_2` thumbnail plus `image_count`; `get_listing` returns the large gallery URLs plus the count. Stripping `rule=` and documenting the size grammar would mean owning a URL vocabulary we neither control nor version.

> **Correction, recorded while building `get_listing` ([#21](https://github.com/IIxauII/kleinanzeigen-mcp/issues/21)).** Three readings of `Listing` did not survive contact with the live detail page.
>
> - **`old_price` is not on this surface, and is not on the shape `get_listing` returns.** The detail page renders no struck-through price at all — the price drop is markup on a *search row*, and the only struck-through prices on a detail page belong to the seller's other listings and the related-ads block at its foot, both of which are results-page markup for listings nobody asked for. Carrying it as an optional field that can never be populated would promise a reading the page does not have, so `get_listing`'s schema omits it; `SearchRow`'s keeps it.
> - **`image_count` is derived from the gallery here, and has to be.** A search row states its count in `.galleryimage--counter`; the only elements of that class on a detail page belong to the *other* listings at the foot of it. There is no second source to hold the gallery against.
> - **The posting date is picked out of `#viewad-extra-info`, not read as the whole of it.** The view counter shares that element and is filled in by script after load, so the date is the `DD.MM.YYYY` token inside it (SPEC 5.5's rule: read numbers off the markup).
> - **Boolean feature tags are not attributes and are not returned.** `.checktaglist .checktag` carries label-only booleans — `Anhängerkupplung`, `Balkon` — with no value beside them. `attributes` is a label/value list, and returning `{ label: "Balkon", value: "" }` would invent a shape the page does not have. Their absence is a known gap, not an oversight.

### 3.4 Listing states — no enum, three flags

```ts
type ListingFlags = {
  expired: boolean;       // adExpired
  paused: boolean;        // showPausedVeil
  deleted_veil: boolean;  // showDeletedVeil
};
```

`CONTEXT.md` names four site-side states. What a logged-out reader can observe is narrower, and the type says so:

- **Active** is observable *only* as the absence of everything else, so it cannot be positively confirmed. An enum with an `ACTIVE` member would be a claim the page cannot support, and `UNKNOWN` as the overwhelming majority value is an enum that has stopped earning its keep.
- **Reserved** has **no field at all** in a live page's JS init. Kleinanzeigen surfaces the marker through watchlists and conversations, both requiring an account. It is not represented.
- **Expired / Paused** are readable — `adExpired` / `showPausedVeil` are present on a public page. Prior research only ever sampled live ads, so "always false" was unverified, not unavailable.
- **Deleted** is detectable only as "this URL no longer yields a listing", never as a reason. See §5.3.
- **Sold is not a state.** Kleinanzeigen publishes none. `data-soldlabel` is a *label template* — the wording an ad would use if its seller marked it sold — a category hint, not a status. Sellers signal sold or reserved by editing the title, and that convention is the only signal a reader gets.

> **Correction, recorded while building `get_listing` ([#21](https://github.com/IIxauII/kleinanzeigen-mcp/issues/21)).** **The veils are set on pages still being served.** `showDeletedVeil: true` was read off a live, publicly readable listing during fixture capture — prior research had only ever sampled ads where all three were `false`, and "always false" was an artefact of that sample. A `deleted_veil` listing is *not* the `gone` case: `gone` is a URL that no longer yields a listing at all (§5.3), while this is a page that still answers, still parses, and says of itself that it is veiled.
>
> The same page also settles `data-soldlabel`'s one legitimate use: it is read for `Gefunden` — the want-listing marker §5.1 prescribes — and for nothing else. No state, no availability, no `sold` field.

### 3.5 Seller and shop

```ts
type Seller = {
  seller_id: number | null;
  seller_type: SellerType | null;   // null = unreadable, never defaulted to a pole
  name: string | null;
  shop_slug: string | null;         // COMMERCIAL only; PRIVATE sellers have none
  member_since: string | null;      // "YYYY-MM"
  badges: string[];
};

type Shop = {
  shop_slug: string;
  name: string;
  seller_id: number;
  store_id: number | null;
  ads_online: number;
  about: string | null;
  logo_url: string | null;
  categories: { category_id: number; count: number }[];
};
```

`seller_type` is an **enum, not a boolean**: "not private" is a weaker claim than "commercial", and a seller type that cannot be read is unknown rather than private.

**`shop_slug` is case-sensitive and may carry a numeric collision suffix — never normalise it.** Two different sellers both named byte-identically `Autohaus Meyer GmbH` live at `/pro/Autohaus-Meyer-GmbH` and `/pro/autohaus-meyer-gmbh-1`.

> **Correction, recorded while building `get_listing` ([#21](https://github.com/IIxauII/kleinanzeigen-mcp/issues/21)).** **`seller_id` lives in two different elements, and neither is on both kinds of page.**
>
> - A **private** seller's id is in the link to their own listings: `href="/s-bestandsliste.html?userId=<id>"`, which is the page's only appearance of it. `userId` in the JS init is present and **empty** on every page sampled, private and commercial alike, so it is never a source.
> - A **commercial** seller has no such link at all. Their id is `data-user-id` on `#viewad-commercial-policy-documents`, the element behind the imprint dialog — verified equal to the `sellerId` their `/pro/` page's island props carry.
>
> Reading only the first would have returned `seller_id: null` for every commercial listing, which is the shortfall this correction exists to prevent rather than to record.

### 3.6 The envelope

Every tool result carries it.

```ts
type Envelope = {
  fetched_at: string;              // ISO 8601 UTC
  stale: boolean;
  stale_reason?: "block" | "network" | "timeout" | "http_error" | "parse_failure";
  source_url: string | null;       // null for the zero-request resolvers
};
```

`fetched_at` is present on **every** result, cached or not — uniform, no special case, so a caller can reason about recency without knowing the cache exists.

---

## 4. The tool surface

**Six tools. One call never fans out over listings. Every filter is server-side or it does not exist. And where the site is ambiguous, the ambiguity ships as a value in the result — never as a caveat in a description.**

That last line is the through-line of the whole surface. Agents read values, not prose.

| Tool | Requests | Notes |
| --- | --- | --- |
| `search_listings` | exactly 1 | one page per call |
| `get_listing` | exactly 1 | by ad id |
| `get_shop` | 1 per page | commercial sellers only |
| `find_category` | **0** | local, over the bundled tree |
| `find_location` | **0** | local, over the bundled city dataset |
| `find_shop` | exactly 1 | the odd resolver out |

**Discovery is tools, not MCP resources.** 159 categories and 11 091 locations are exactly the static documents resources exist for, and resources were rejected anyway: the resolvers do not *serve* data, they **refuse to guess**. 12 slugs collide across 25 nodes, names collide too, and a shop-name match may not be a name match at all — so matching must report candidates, which is behaviour a document cannot do. Agents also pull resources unreliably, which would make the collision guard optional in practice.

**`describe_category` is out.** It would describe filters you cannot apply (§2.6) — a footgun wearing a helpful hat.

### 4.1 `search_listings`

**Arguments**

```ts
{
  keywords?:        string,
  category_id?:     number,          // → c<id> path code
  location_id?:     number,          // → l<id> path code
  location?:        string,          // free text or postcode → ?locationStr=
  radius?:          number,          // km → ?radius=
  min_price?:       number,          // EUR
  max_price?:       number,          // EUR
  ad_type?:         "OFFER" | "WANTED",
  poster_type?:     "PRIVATE" | "COMMERCIAL",
  shipping?:        boolean,         // tri-state: true | false | omitted
  shipping_carrier?:"DHL" | "HERMES",
  buy_now?:         boolean,         // true only; false is dropped at serialisation
  sort?:            "SORTING_DATE" | "PRICE_AMOUNT" | "PRICE_AMOUNT_DESC",
  page?:            number           // 1-based integer ≥ 1, default 1
}
```

**Two `zod` refinements**, and they are the only two on the surface:

1. `location` and `location_id` are **mutually exclusive**.
2. `radius` **requires** one of them.

Both are cases where the site cannot be *asked* a coherent question, not cases where it would answer honestly with an empty set — see §11.4 for why that line is drawn here and nowhere else.

> **Recorded while building the filter surface ([#20](https://github.com/IIxauII/kleinanzeigen-mcp/issues/20)).** The argument object is **strict**: an unrecognised key is refused, never stripped. That is not a third rejection rule. §11.4 governs combinations of arguments this surface *has*; strictness governs an argument it does **not** have, and §2.6 already says the missing filters are "not accepted-and-ignored". Stripping `attributes` silently is exactly accepted-and-ignored — the caller asks for a filtered set, gets the nationwide one, and is told nothing. The rule is the surface's, not this tool's: §4.4's resolvers refuse an unrecognised argument too, so a caller that invents `limit` reads no full list as a truncated one.

**Serialisation rules that are not obvious**

- **`shipping` is a genuine tri-state.** `true` → ships (`versand:ja`), `false` → **pickup only** (`versand:nein`, a real filter: `16.292 → 3.507`, 0/27 rows tagged, and `12.785 + 3.507 = 16.292` partitions the base exactly), omitted → both. **Both literals are serialised.**
- **`buy_now: false` is a no-op and must never be sent.** It returns the baseline total and a baseline row mix. The two `false`s behave differently and **must not share a serialisation rule**.
- **`shipping_carrier` implies shipping** — send it alone. `?shippingCarrier=DHL` and `?shipping=true&shippingCarrier=DHL` return the identical total. Sending both is now harmless but redundant.
- **`shipping_carrier` is upper-case, single-valued and global.** Lower-case, the comma form, a repeated key and every other candidate value (`DPD`, `GLS`, `UPS`, `DHL_PAKET`, `DEUTSCHE_POST`, `KLEINANZEIGEN_VERSAND`) all **400**. The enum is a property of the query planner, not the category: `c216`, which renders *no* carrier facets, still accepts `shippingCarrier=DHL` and filters `793.124 → 412`. So: a flat `z.enum(["DHL","HERMES"])`, no per-category schema, no runtime discovery.
- **`sort` is sent only when the caller asks for one.** `?sortingField=` on a pretty URL is the only reliable spelling.

**Result**

```ts
Envelope & {
  listings: SearchRow[];
  total: number | null;         // the site's stated count
  reachable: 1250;              // 25 × 50 — the real ceiling
  range: { from: number; to: number } | null;
  clamped: boolean;
  organic_count: number;
  promoted_count: number;
  page: number;
  sort: Sort | null;            // what we SENT; null = the site chose
  location_resolution?: LocationResolution;
}
```

**`total` and `reachable` are separate numbers and stay separate.** Collapsing them into `min(stated, 1250)` is exactly the "25 results vs 25 of 40 000" failure this surface exists to avoid. `reachable: 1250` against `total: 40231` is the number that tells an agent to narrow rather than walk 50 pages.

**TOP listings are returned flagged and in place.** They are extra, so `listings.length` is 27 while `range` reads `51 - 75`. Dropping them would hide a genuinely matching listing because its seller paid; a separate array would lose position within the page. The envelope **states** `organic_count` and `promoted_count`, so the length is never something the caller has to infer.

**`sort: null` honestly means "whatever the site chose here."** The applied sort **cannot be read back** — the dropdown's `data-text` reads `Neueste` regardless — and category `c216` (Autos) is powered by mobile.de and silently ranks by `MOBILEDE_RECOMMENDED`. So the envelope reports what was *sent*, never what was applied.

**`location_resolution` — the ambiguity ships as a value.** `?locationStr=` resolves server-side and **silently picks** among colliding nodes: `10115` is both Mitte (`l9668`, 358 hits) and Wedding (`l3504`, 39 hits), disjoint, and the server chooses one without saying which it rejected. The bundled dataset detects that collision at **zero request cost**:

```ts
type LocationResolution = {
  input: string;
  resolved_to: { id: number; label: string } | null;
  ambiguous: boolean;
  alternatives: { id: number; label: string }[];
};
```

Present only when `location` (free text) was used. The failure mode is silent picking; the fix is a value, not a warning.

> **Correction, recorded while building `search_listings` ([#19](https://github.com/IIxauII/kleinanzeigen-mcp/issues/19)).** The worked example above is a **postcode**, and a postcode is the one input this field cannot speak to: §7's correction established that the postcode layer's ids are absent from every allowed source, so `10115` matches **nothing** in the bundled dataset and arrives as `resolved_to: null, ambiguous: false, alternatives: []`.
>
> The mechanism is intact for the case it can actually see — a colliding **name**, of which the dataset holds many (four Neustadts, two Mittes) — and those do return `ambiguous: true` with every candidate named. What is lost is only the postcode example, not the field.
>
> **`resolved_to` is `null` whenever the dataset holds more than one candidate.** Naming one of them would be the same silent pick this field exists to expose, so the alternatives carry the whole answer and nothing is promoted to a resolution.

**Description**

```
One page of listings matching a search query. Promoted listings repeat on
every page; high-volume queries drift between pages, so a listing can be
missed or seen twice across a walk.
```

### 4.2 `get_listing`

**Arguments** — `{ ad_id: string }`. The ad id only; `/s-anzeige/x/<ad_id>` resolves on its own.

**Result** — `Envelope & ({ status: "ok" } & Listing | { status: "gone" })`.

`status: "gone"` is a **normal result, not an error** — see §5.3 for the guard that produces it and §6 for why it is an answer.

**Description**

```
One listing in full, by ad id.
```

### 4.3 `get_shop`

**Arguments**

```ts
{
  shop_slug:     string,     // case-sensitive; never normalise
  page?:         number,     // 1-based, default 1
  keywords?:     string,
  category_id?:  number,
  location_id?:  number,
  min_price?:    number,
  max_price?:    number
}
```

Page 1 is the `/pro/<slug>` island — profile **and** the first 25 listings in one blob, one request. Deeper pages are the Astro RPC, one request each. `pageSize` is **fixed in code at 25 and not exposed** (§8's one-knob principle; the ceiling above 100 is unprobed).

The RPC's filters are genuinely server-side, so §2.6's rule admits them. This does hand commercial sellers an in-shop search that private sellers have no equivalent for. That asymmetry is real, is a direct consequence of the Bestandsliste refusal, and is stated rather than papered over by declining the capability.

**Result** — `Envelope & { shop: Shop; listings: SearchRow[]; page: number; count: number }`.

> **Correction, recorded while building `get_shop` ([#22](https://github.com/IIxauII/kleinanzeigen-mcp/issues/22)).** **The result shape above outruns what the two shop encodings carry, in three places.** Each was found by decoding live payloads, and each is a field the surface does not have rather than one the parser failed to read.
>
> - **`listings` are not `SearchRow`s.** The island and the RPC carry twelve fields per listing between them — `id`, `url`, `title`, `description`, `price`, `date`, `location`, `image`, `retinaImage`, `imageCount`, `hasVirtualTour`, `tags` — and four a `SearchRow` needs are in neither: there is **no shipping tag, no `Gesuch` marker, no postcode and no promoted slot** anywhere on the shop surface. Defaulting them would put `shipping: false` on a listing that ships and `listing_type: "OFFER"` on a want listing, so the tool returns a **`ShopRow`**: the ten of those twelve worth returning, among them the one a search row has no equivalent for — `tags`, the size a clothing or footwear listing is filed under. Absent, not guessed, is the same reading that makes an unreadable seller type unknown rather than private (§3.5). The two left behind are **`retinaImage`**, the same picture at `rule=$_35` rather than `rule=$_2` and derivable from the one returned, and **`hasVirtualTour`**, which was `false` on all 65 listings sampled and has no field on any type here.
> - **`shop` is `Shop | null`, and is non-null only where the shop page answered.** The profile lives in the page's islands and **the RPC carries none of it** — no name, no seller id, no logo, no prose. The shop page in turn renders one thing only: the shop's first 25 listings, *unfiltered*. So the island answers page 1 with no filters and the RPC answers everything else, and a profile on a deeper or a filtered page would cost a second request behind one call — the hidden multiplier §2.5 refuses. A caller wanting both asks twice, knowingly, at one request each.
> - **The RPC's price bounds are strings on the wire.** `minPrice`/`maxPrice` are validated as `string` and a numeric bound is refused with HTTP 400 and a field-level complaint; `categoryId`/`locationId` are validated as `number` and a string id is refused the same way. `keywords`, `categoryId`, `locationId`, `minPrice` and `maxPrice` are all confirmed genuinely server-side.
>
> One further reading, which is why `Shop.categories` can keep its promise: **`categoriesSearchData` is a breakdown of the answered query, not a fixed property of the shop.** Unfiltered it names top-level categories and sums exactly to `adsOnline`; under a `categoryId` filter it drops a level and names that category's *subcategories*, summing to the filtered set. Only the unfiltered reading reaches a caller, so the sum §5.1 states holds for every `Shop` this tool returns.

**Description**

```
Profile and listings for one COMMERCIAL seller. Private sellers have no
shop page and cannot be reached by this server.
```

### 4.4 `find_category` and `find_location`

**Zero requests.** Both resolve in-process against bundled datasets.

```ts
find_category({ query: string })
  → { matches: { category_id, name, slug, path, parent_id, parent_name }[], count }

find_location({ query: string })
  → { matches: { location_id, name, slug, level, state }[], count }
```

**Both always return a list, never a bare object, even on an exact single hit.** A shape that sometimes resolves for you is a shape that teaches the caller to stop reading. The never-guess rule only holds if the caller cannot skip the check, and a `best:` hint would be the same guess wearing a different name.

Matching is **case- and diacritic-insensitive** against the name and against a qualified `"Parent > Child"` form. **No fuzzy / edit-distance matching** — 159 known strings and an LLM caller; approximate matching buys little and turns a loud failure into a quiet one. **Never match on a slug**: slugs are cosmetic URL segments and collide 25 ways.

Zero matches is `{ matches: [], count: 0 }` — an answer.

> **Correction ([#18](https://github.com/IIxauII/kleinanzeigen-mcp/issues/18)).** `find_location`'s description above promises more than the dataset can keep: **a postcode matches nothing**, because the postcode layer's ids are absent from every allowed source (§7's correction). It is left verbatim because a shipped description is a contract, and the shortfall is recorded here, in the tool's input schema, and in [ADR-0004](./docs/adr/0004-the-city-dataset-has-two-sources.md) rather than silently reworded. A postcode remains usable as §4.1's free-text `location`.
>
> Matching also folds **`ä ö ü ß` to `ae oe ue ss`** alongside the plain diacritic strip, so `Köln`, `Koln` and `koeln` all reach `Köln`. This is transliteration, and §4.5's "never transliterate" does not reach it: that rule governs the caller's string on its way to a **live `fulltext` query**, where the site's own umlaut handling is uncharacterised. Here both sides of a local comparison are folded identically, the fold is exact rather than approximate, and the site spells its own location slugs this way. The expansion runs **one way only** — nothing contracts `ue` back to `ü`.

**Descriptions**

```
find_category
  Category ids matching a name. Always returns candidates — names and slugs
  collide, so only the numeric id identifies a category.

find_location
  Location ids matching a name or postcode. Always returns candidates — a
  postcode can map to several locations.
```

### 4.5 `find_shop`

The odd resolver out: **one live request**, subject to the limiter, the cache and every error rule in §6.

**Arguments** — `{ name: string, category_id?: number, location_id?: number, page?: number }`.

`name` → `fulltext`. `category_id` / `location_id` are validated against the bundled trees at zero cost, because **the directory's filter ids are the same numeric ids** as the bundled datasets. `page` is 1-based → `from = (page − 1) × 50`.

**Fixed in code, not exposed** — `pageSize: 50`, `view: "CARD"`, `searchScope: "BOTH"`.

`pageSize` is deliberately not a knob: **the ordering is a function of `pageSize`**, so the same query, seed and offset return a different order at 21 than at 50, and a caller-set page size would silently reshuffle results between calls.

**Result**

```ts
Envelope & {
  matches: { name, shop_slug, seller_id, location, ads_online, logo_url }[];
  count: number;        // totalHits — the whole match set, not the page
  page: number;
  page_size: 50;
}
```

Never auto-selected, even at `count: 1` — **and here that rule is a correctness guard, not a homonym guard.** `fulltext` matches **profile prose, not just names**: `"decathlon"` returns `TGW Systems Integration GmbH`, whose `about` text merely names Decathlon as a customer, and `searchScope: "BRANDING"` does not exclude it. **A single exact hit can still be the wrong shop.**

> **Correction, recorded while building `find_shop` ([#23](https://github.com/IIxauII/kleinanzeigen-mcp/issues/23)).** "Validated against the bundled trees" holds for **`category_id` and not for `location_id`**, and the difference is the datasets rather than the ids. The filter ids *are* the same numeric ids — the same id **space** — but the two bundled sets are not the same shape of complete. The category tree is complete: 159 of 159 nodes, byte-identical to the disallowed tree (§7). The city dataset knowingly is not: it holds the location tree's first two tiers, and **sub-Ortsteile (Wedding `l3503`) and the entire postcode layer are absent from every allowed source** (§7's correction).
>
> So refusing `l3503` would reject an id the directory filters by and answers **honestly** — the opposite of the failure the check exists to prevent — and a caller can hold such an id legitimately, since the third number in a listing URL is a location id (§2.2). The category id is checked; the location id is passed through to the site, which is the authority for it.

**Pass the caller's string through; never transliterate.** Umlaut folding is uncharacterised — `köln` → 492 hits, `koln` → 3, and those 3 include a shop whose name *has* the umlaut.

**`pageSize` > 50 returns HTTP 204 with a zero-byte body.** The server never sends one, but 204 must be treated as an **error**, never as zero results.

Paging here is clean and drift-free, unlike search: 148/148 distinct across four offsets, zero overlap, clean termination, no clamp.

**Description**

```
Shop slugs for COMMERCIAL sellers matching a name. Makes a live request,
unlike the other resolvers. A match may be a mention in a shop's profile
text rather than its name, so check before using one.
```

### 4.6 What each tool declares

**Two annotation fields are stated on every tool, two are deliberately absent, and no icon ships anywhere.** Annotations are wire-visible and agent-facing in exactly the way descriptions are, so they are pinned here and tested rather than left to a reviewer's checklist.

| tool | `title` | `readOnlyHint` | `openWorldHint` |
| --- | --- | --- | --- |
| `search_listings` | Search listings | `true` | `true` |
| `get_listing` | Get listing | `true` | `true` |
| `get_shop` | Get shop page and inventory | `true` | `true` |
| `find_category` | Find categories | `true` | **`false`** |
| `find_location` | Find locations | `true` | **`false`** |
| `find_shop` | Find shops | `true` | `true` |

**`readOnlyHint: true` is stated on all six, never left to the default.** The default is `false`, so silence here asserts the *opposite* of the whole project — read-only is the first line of the README, it is ADR-0001 and ADR-0003, and it is what the §12 position rests on. Asserting it in prose and nowhere on the wire is the defect this table fixes. `get_shop`'s `POST …brandProfile.getAds` does not complicate the claim: it is a transport verb, not a mutation, and the field asks whether the tool modifies its environment.

**`openWorldHint` is the field that splits the surface.** It is not "does it touch the network" — it asks whether the set of things the tool can reach is bounded and knowable in advance. The two dataset resolvers walk a snapshot frozen into the tarball at build time, at **zero requests** (§4.4), which is a closed world in the field's own sense; the other four read a live site whose contents move underneath the caller. `find_shop` fetches, so it is open despite the `find_` prefix. The default is `true`, so leaving it unset would advertise both resolvers as reaching an open world while they read a file on disk.

**`destructiveHint` and `idempotentHint` are omitted, not defaulted, and that is not an oversight.** The protocol makes both meaningful *only when `readOnlyHint == false`*, so with `readOnlyHint: true` everywhere neither field has anything to carry. `destructiveHint: false` would be noise that also implies the author thought `readOnlyHint` might be false. `idempotentHint: true` on a fetching tool would be worse than noise: a reader would take it as a claim about **result stability**, which is exactly what *Drift* (§2.7, §9.3) denies and what the envelope reports honestly instead. The test asserts both fields are **absent**, so re-adding them fails rather than passes quietly.

**`title` goes in the top-level slot only, never `annotations.title`.** Both exist and clients are told to prefer the annotation, so populating both invites two strings that drift with the wrong one winning. One slot, one string. The titles are plain verb phrases; `get_shop` carries "and inventory" because the tool returns the profile *and* the seller's listings (§4.3), and a title naming only the page undersells it. The resolvers' "candidates, never a selection" identity stays in the descriptions, where it already lives.

**No icons, on any tool or on the server.** Three reasons, any one sufficient: a data URI inflates *every* `tools/list` six times over; a remote URL is a fetch this stdio-only, rate-limited server has no business making; and the only obvious icon is kleinanzeigen's own logo, which would imply the endorsement ADR-0003 exists to avoid claiming.

**Server identity is declared in the same pass.** The SDK's `Implementation` takes `title`, `description`, `websiteUrl` and `icons`, and passing `{ name, version }` alone leaves a client listing installed servers showing the bare slug:

```ts
{
  name: "kleinanzeigen-mcp",
  version: VERSION,
  title: "kanzeigen",
  description: "A read-only, robots-clean MCP server over kleinanzeigen.de",
  websiteUrl: "https://github.com/IIxauII/kleinanzeigen-mcp",
}
```

**`title` is `kanzeigen`, verbatim and lowercase** — the clipped stem, chosen over `Kleinanzeigen (unofficial, read-only)` and over matching the `claude mcp add kleinanzeigen` install handle, to put distance between this project's display name and the site's trademark. It states neither *read-only* nor *unofficial*; the description and the README carry those. **The clip governs every slug the project owns downstream**, including the plugin's (§8.8).

**`description` is one string, reused in five places** — `package.json`, this `Implementation`, `server.json`, the MCPB manifest and `plugin.json` (§8.7, §8.8). One sentence to keep true rather than five to keep in step. At 57 characters it clears the MCP Registry's 100-character cap with room to spare.

**Pinned by `descriptions.test.ts`.** That test already asserts every tool description matches this spec verbatim, on the reasoning that a description is the whole of what an agent reads before choosing a tool. It is extended to pin each tool's `title`, `readOnlyHint` and `openWorldHint` against the table above, and to assert `destructiveHint` and `idempotentHint` are absent.

**None of this waits on the v2 migration.** `title`, `annotations` and `icons` are in the v1 SDK already and the codemod does not touch them; the sequencing in §8.7 is a release-ordering decision, not a dependency.

---

## 5. Fetch and parse

### 5.1 DOM anchors

These have appeared identically across five languages of scraper spanning 2021–2026. **It is the anti-bot layer that churns, not the DOM.**

**Search results page**

| Anchor | Reads |
| --- | --- |
| `#srchrslt-adtable` | the results container |
| `li.ad-listitem` | a row slot — **5–8 per page carry no `data-adid` and are ad banners; drop them silently** |
| `article.aditem[data-adid]` | a listing row; `data-adid` is the ad id |
| `li.is-topad` | a TOP listing → `promoted: true` |
| `li.is-highlight` | a highlighted listing — no effect on ranking, not surfaced |
| `span.breadcrump-summary` | `N - M von T` — **numbers only**, see §5.5 |
| `span.simpletag` | `Gesuch` → `listing_type: "WANTED"`; `Versand möglich` → `shipping: true`; `Direkt kaufen` |
| the row's `ld+json` | the ~200-char description, longer than the visible snippet |
| `a.pagination-page` | present, but never used for navigation — pages are addressed directly |

**Listing detail page**

| Anchor | Reads |
| --- | --- |
| `#viewad-title` | title |
| `#viewad-price` | the rendered price string |
| `#viewad-*` | description, attribute list, gallery, seller box, dates |
| `Belen.Search.ViewAdView.init({…})` | `adPriceType`, `isCommercialUser`, `adExpired`, `showPausedVeil`, `showDeletedVeil` |
| Open Graph tags | including lat/long |
| `href="/pro/<slug>"` | the shop slug, on commercial listings only |

**Never use `isWantedAdType`** — the JS flag is broken and reads `false` on confirmed want listings. Use the `Gesuch` tag on a row, and `data-soldlabel` (`Gefunden`) on a detail page.

**Shop page** — `/pro/<slug>` is not search-results markup. It is an Astro island whose props carry a **devalue-encoded** payload: `brandName`, `sellerId`, `storeId`, `sellerType`, `adsOnline`, `about`, `initialAds`, `categoriesSearchData` (a per-category breakdown of the whole shop that sums exactly to `adsOnline`).

**The two `_actions` RPCs** return a **devalue-*flattened*** payload — an index/reference table, a *different* encoding from the island props.

So there are **three decoders**: cheerio over HTML, devalue island props, devalue-flattened RPC.

> **Correction, recorded while building `get_shop` ([#22](https://github.com/IIxauII/kleinanzeigen-mcp/issues/22)).** **Three decoders is right; the shop page's own is not one island and is not the flattened encoding.**
>
> - **The island props are a `[type, value]` pair per value, applied recursively** — `{"adsOnline":[0,30]}`, `{"ads":[1,[[0,{…}],…]]}` — and a one-element pair, `[0]`, is a value the page does not have. Type `0` and type `1` are the only codes the shop page uses; Astro spells `Date`, `Map`, `Set`, `RegExp`, `BigInt` and `URL` under codes of their own, and an unrecognised code is a loud failure rather than a value read as the string it resembles (§5.8). This is a *different* shape from the flattened RPC's index table, which is the point §5.1 was already making.
> - **The profile is spread over three islands, not one.** `BrandProfilePage` carries `brandName`, `sellerId`, `storeId`, `sellerType`, `adsOnline`, `about` and `initialAds`; the shop's **name and logo are not in it** — they are `title` and `logoUrl` on `ProfileActions`, with the name repeated as `companyName` on `UserBadges` for a page that renders no profile actions. Islands are found by the **stable name in `opts`**, never by `component-url`, which carries a build hash and moves with every deploy.
> - **`about` is nested and `storeId` is mislabelled elsewhere.** The prose is `about.description`, not `about`. And the `BrandingProfileContact` island calls the *store* id `sellerId` — for the shop sampled it reads `219685`, the `storeId`, while the seller id is `163073336`. Only `BrandProfilePage`'s spelling is read.
> - **`brandName` echoes the slug that was asked for**, not a canonical spelling of it: `/pro/Autohaus-CCC-GmbH` and `/pro/autohaus-ccc-gmbh` both answer with seller `82731513` and each says its own slug back. The site resolves a slug case-insensitively; **that is not licence to normalise one**, because the *numeric collision suffix* is still load-bearing (§3.5).
> - **`initialShowcasedAds` and `contactPerson` are also in the props**, and nothing reads either: the first is listings already in `initialAds`, the second is a named employee, their photograph and their bio.

### 5.2 The `/pro/` page does not paginate

`?pageNum=2` and `?page=2` return byte-identical page 1; `/pro/<slug>/seite:2` → **404**. Page 1 alone would cap a Decathlon-sized shop at 25 of 170. Paging is the RPC or nothing.

`POST /_actions/proPublicWeb.brandProfile.getAds/` takes `{ brandName, keywords, categoryId, locationId, minPrice, maxPrice, pageSize, pageNum }`, honours `pageSize` past the UI's 25 (100 verified), and terminates cleanly past the end — page 8 of a 170-listing shop returns 0 listings in 505 bytes.

> **Correction, recorded while building `get_shop` ([#22](https://github.com/IIxauII/kleinanzeigen-mcp/issues/22)).** **A slug that names no shop has §5.3's failure mode, and the shop surface needed §5.3's guard.**
>
> `/pro/dieser-shop-gibt-es-nicht-xyz123` answers **HTTP 200** with a complete 111 kB page: header, footer, and a `BrandProfilePage` island whose props are profile-*shaped* — `adsOnline: 0`, `initialAds: null`, no `sellerId`, no `storeId`, and **`sellerType` flipped from `"commercial"` to `"private"`**. That last field is the trap: read on its own it says a private seller was found, when what happened is that no seller was found at all. There is no 404 and no tombstone, exactly as for a deleted listing.
>
> So the identity is the reading: **a shop page that names no `sellerId` is not a shop**, and nothing else on it is parsed. The result is `status: "gone"` — a normal result, not an error (§6.3). The final URL after redirects is asserted the same way §5.3 asserts a listing's, on the **origin and the path** together, and a response that cannot say where it ended up is a failure rather than a `gone`.
>
> Two readings ride with that, both of them about not letting a guard go quiet. `initialAds: null` is **also** what a real shop with nothing online carries, so it is read as an empty inventory — but only past the identity guard and only where the shop's own `adsOnline` is `0`; a null block on a shop stating listings is the encoding having moved, and an empty list would hide it (§5.4). And a page that *does* name a seller while saying `sellerType: "private"` is a **loud failure**, never a second `gone`: were the site to respell that string, a `gone` there would report every shop on the site as missing, silently.
>
> **The RPC's answer to the same slug is HTTP 204 with a zero-byte body**, which §4.5 already rules is an error and never zero results — reported as an empty page it would say a shop is empty that nobody looked at. The rule now lives in the request path, once, so every surface inherits it. It also means an unknown slug is `gone` on page 1 and an `http_error` on a deeper page: the RPC's 204 cannot distinguish "no such brand" from a request it declined to serve, and guessing between them is not this server's to do.

### 5.3 The deleted-ad guard

**The nastiest failure mode on the board, because it looks like data.**

A missing or deleted listing does not 404 and leaves no tombstone. It **301s to a synthesised browse page** and answers **HTTP 200 with a full page of *other* listings**. Verified: `/s-anzeige/foo/1000000000-217-4070` → 301 → `/s-fahrraeder/weisswasser/c217l4069`, 200, a full results page.

> **`get_listing` MUST assert that the final URL after redirects still starts with `/s-anzeige/`.** If it does not, return `{ status: "gone" }` and parse nothing.

> **Recorded while building `get_listing` ([#21](https://github.com/IIxauII/kleinanzeigen-mcp/issues/21)).** The assertion is on the **origin and the path**, not the path alone — a bare prefix check accepts `https://kleinanzeigen.de.example.com/s-anzeige/…`. Two further readings come with it: a response that cannot say where it ended up is a **failure**, never a `gone` (only "we looked, and it is not a listing" is an answer); and a page that *is* a listing detail page has to agree it is the listing that was asked for, which is the same failure one redirect further along.
>
> Both redirect targets are confirmed live: `/s-anzeige/x/1000000000` → `301` → the homepage, HTTP 200; `/s-anzeige/foo/1000000000-217-4070` → `301` → `/s-fahrraeder/weisswasser/c217l4069`, HTTP 200, a full results page.

A detail-fetch tool without this guard will confidently return the wrong listing.

### 5.4 Block detection

- **Detect the string `IP-Bereich vorübergehend gesperrt` explicitly.** This is an *IP-range* ban that survives UA rotation and kills everyone on the same address range.
- **A block is never an empty result list.** The observed failure mode is HTTP 200 with zero listings; surfacing that as "no matches" would be the server quietly hammering a site that has already said stop.
- A block **trips a circuit breaker**: further requests are refused for a fixed cooldown and the refusal says so. **Never retry a block.**
- Anti-bot posture, for context: Akamai Bot Manager is present on both hosts (`_abck`, `bm_sz`), but there is no interstitial, no JS challenge and no CAPTCHA on a cold request. Blocking is **IP-reputation and volume driven, not request-shape driven** — which is exactly why the answer is to send less, not to look different (ADR-0003).

### 5.5 Three live label bugs — read numbers, never labels

The site renders correct numbers under wrong labels in at least three places. **Nothing in the markup distinguishes a correct label from a wrong one**, so the rule is uniform:

> **Read numbers off the markup. Never read an applied scope, an applied filter or an applied sort off it.**

1. **`rel="canonical"` lies about location scope.** `/s-mitte/10115/…` scopes correctly to `10115 Mitte` but canonicalises to all of Berlin. Read counts off `span.breadcrump-summary`, never off canonical.
2. **`span.breadcrump-summary`'s own trailing noun phrase lies about category.** `/s-sammeln/c234` renders `1 - 25 von 2.293.257 Comics in Deutschland` while the breadcrumb leaf and canonical both say `Sammeln` — and `Comics` is `c284`, a different category. The **numbers** in that span are authoritative; the trailing phrase is not, and is never parsed.
3. **Facet pre-counts lie.** The *unfiltered* `Direkt kaufen → Aktiv` pre-count is byte-identical to the `Angebote` count — a threefold overstatement — while the carrier facets beside it are right to the digit. **Never read a total off a facet count.** Every `total` comes from `span.breadcrump-summary` of the *filtered* request.

**Applied-filter chips are not a parse-time assertion either.** On `c173` the `shipping=false` page renders no chip though the filter is plainly applied: two shipping-facet spellings coexist (the global `versand:ja|nein` path segment and the category attribute `<slug>.versand_s:ja|nein`), and where the sidebar uses the attribute spelling, an applied *global* filter matches no facet item and emits no chip. Nothing in this spec reads chips; this is a reason to keep it that way.

### 5.6 Zero results are suspicious, and one large family of them is explained

Bad parameter combinations return HTTP 200 with `Es wurden keine Ergebnisse gefunden`, and an IP block can present the same way. §5.4 removes the second case, which is what makes an empty list safe to return as a real answer.

**Known-honest empty sets — never "fixed" by dropping a parameter:**

- `poster_type: "COMMERCIAL"` with `shipping_carrier` or `buy_now`. Measured and structural: `PRIVATE&shippingCarrier=DHL` returns the *unrestricted* DHL total, so the filtered sets are proper subsets of the private set, and 81 sampled commercial rows carried zero `Direkt kaufen` tags. Commercial sellers ship — just not through the mechanism these filters key on. (`poster_type: "COMMERCIAL"` composes fine with plain `shipping: true`: 498 hits, 27/27 shipping.)
- `shipping: false` with a `shipping_carrier`. "Ships by DHL" ∩ "pickup only" is empty by construction.

### 5.7 The degenerate-form guard

One search URL shape is known to return garbage: `/s-seite:N/k0c<id>` — slugless *and* keywordless with a combined category code — returns `1 - 1 von 1`. §2.2's grammar never emits it (keywordless queries drop `k0`, and keywords always ride the query string), so it is structurally unreachable.

Two grammar shapes were not fetched during the map: paged `/s-seite:N/l<id>`, and `/s-[seite:N/]c<id>l<id>`. Both follow the verified grammar, and this guard covers them:

> A **keywordless** query whose only narrowing inputs are `category_id` and/or `location_id` — no keywords, no price bounds, no other filter — that reports `1 - 1 von 1` is the degenerate signature, not data. Treat it as a parse-level assertion failure (`isError`), never as a result.

Tight by construction: a bare category or location holds thousands of listings, so exactly one is not a number that query can honestly produce.

### 5.8 Parse failures must be loud

Because a parse failure falls back to a stale cache entry (§6.2), **a DOM change can be masked by stale data instead of surfacing**.

> **The stderr log MUST shout on a parse failure even when the stale serve succeeds.** That log line is the only signal that the parser broke.

This is a requirement, not an implementation nicety.

---

## 6. Caching, staleness and errors

### 6.1 The cache

- **In memory only.** Never on disk. Dies with the process.
- **Value: parsed domain objects**, in `CONTEXT.md` vocabulary. **Raw HTML is discarded the moment parsing finishes** — the server never holds a page copy longer than it takes to read it.
- **Key: the exact fetched URL after query-string normalisation**, so parameter order cannot fragment the cache.
- **Fresh window: 5 minutes, uniform** for search and detail alike. A split TTL matches real churn better and was rejected anyway: one lifetime is worth more in an ADR and a README than the tuning gain.
- **Bound: ~200 entries, LRU — and LRU is the only eviction rule.** There is **no time ceiling**. An entry past 5 minutes is not evicted; it stops being *fresh* and becomes servable only under §6.2. TTL is a freshness marker, not an eviction trigger.
- **No cache-bypass flag and no clear-cache tool.** The timestamp is the answer. A bypass parameter is precisely what an agent in a retry loop sets on every call, which turns the cache off and puts load back on the site exactly when things are already failing — and since a stale entry is only ever returned *after* a fresh fetch has already failed, bypassing it would simply fail again.

Rationale in [ADR-0002](./docs/adr/0002-nothing-on-disk-nothing-survives-the-process.md).

### 6.2 Stale serve — one rule

> **When a fetch cannot produce fresh data for any reason, fall back to a stale cache entry if one exists; otherwise fail loud.**

One rule, no per-failure-type policy: block, network failure, timeout, 5xx after retries **and parse failure** all take the same path. A stale entry is always returned **flagged**, carrying its own `fetched_at` and a `stale_reason`.

### 6.3 The error taxonomy

Operational failures use MCP `isError`. Domain outcomes are normal results with a discriminant.

| `isError: true` | normal result |
| --- | --- |
| IP block (breaker tripped) | `{ listings: [], total: 0 }` on a valid query |
| retries exhausted | `{ status: "gone" }` from `get_listing` |
| `Retry-After` past the 60 s cap | `{ matches: [], count: 0 }` from any resolver |
| parse failure with **no** stale entry | `{ stale: true, stale_reason: … }` wherever §6.2 applies |
| **HTTP 204, from any surface** | `{ status: "gone" }` from `get_shop` |
| the §5.7 degenerate signature | `{ listings: [] }` from `get_shop` past the end of a shop |
| an invalid `KLEINANZEIGEN_MCP_RATE_LIMIT_MS` (process refuses to start) | |

**"This listing no longer exists" and "nothing matched" are answers.** Dressing either as an error invites the agent to retry it. §5.4's rule — a block is never an empty list — is what makes the empty list safe to use as a real answer here.

> **Correction, recorded while building `get_shop` ([#22](https://github.com/IIxauII/kleinanzeigen-mcp/issues/22)).** The 204 row read `HTTP 204 from find_shop`; it is now **any surface**, because the rule is enforced once in the request path rather than per tool. The shop inventory RPC returns a 204 of its own — for a `brandName` that does not exist — and a rule spelled per tool would have had to be written a second time to catch it. The two new normal results beside it are `get_shop`'s, and both are cases where the server *did* answer: a slug that names no shop (§5.2), and a page past the end of a shop's inventory.

### 6.4 Logging

- **stderr only. Never a file.** `stdout` is reserved for the MCP stdio transport and must stay clean.
- **Metadata only**: URL fetched, HTTP status, timing, result counts, parse outcome, block detection, limiter waits.
- **No listing content, ever** — no titles, prices, descriptions, seller names or locations. A log file is a persisted copy of listing data by another name, and keeping content out of it is what makes "writes nothing to disk" true rather than nominal.

---

## 7. Bundled datasets

Two static datasets ship **inside the package as build-time artefacts**, as sidecar JSON in `dist/`, **read and parsed lazily on first use — never at startup**. A keyword-only search never touches them.

Reading is not writing; ADR-0002's invariant is untouched.

| Dataset | Source | Size | Contents |
| --- | --- | --- | --- |
| `category-tree.json` | `GET /sitemap_categories.xml` (2 094 B) + `GET /` for labels | tiny | all **159** nodes, 2 levels, id + German name + slug + path |
| `cities.json` | `GET /sitemap_cities.xml` (798 561 B) | ~84 KB gzipped | **11 091** locations, slug + id |

**Both are build-time GETs run by a maintainer, not by the server.**

**Category tree provenance.** The sitemap's id set is **byte-identical** to the disallowed `/s-kategorie-baum.html` tree — 159 ids, zero added, zero missing — and it is depth-first, so partitioning at the 15 L1 markers recovers every parent's child set exactly. The homepage nav confirms the same 15 partitions independently but **silently omits 3 of 159 nodes** (`c286 Bahn & ÖPNV`, `c269 Beauty & Gesundheit`, `c273 Tauschen`) — absent from the HTML, not collapsed behind a toggle. **Only the sitemap is complete; the homepage is a label convenience, not a source of truth.** The 3 missing labels are recovered from their parents' browse pages.

**City dataset gaps, hard-coded.** `sitemap_cities.xml` omits the three city-states — Berlin `l3331`, Hamburg `l9409`, Bremen `l1` — which appear only as `/stadt/` landing pages. **Hard-code those three ids.** Also absent: sub-Ortsteile (e.g. Wedding `l3503`) and the entire postcode layer, whose ids are unobtainable from any allowed source. Postcodes still work as input, via `?locationStr=`.

> **Correction, recorded while building `find_location` ([#18](https://github.com/IIxauII/kleinanzeigen-mcp/issues/18)).** Two claims above do not survive contact with the data. The sitemap withholds **140** ids, not 3: the three city-states plus **137 major cities** — Köln `l945`, München `l6411`, Dortmund, Düsseldorf, Stuttgart — which likewise appear only as `/stadt/` landing pages. And the sitemap carries **no names, levels or states**, so it cannot alone produce three of the five fields §4.4 returns. The shipped dataset is generated from the sitemap **and** the allowed `/s-katalog-orte.html` catalogue (17 build-time requests), holds the tree's first two tiers — 16 federal states + 11 215 localities = **11 231** locations — and measures **139 KB gzipped**, not ~84 KB, because that budget was measured on slugs and ids alone. Reasoning and the exact reconciliation: [ADR-0004](./docs/adr/0004-the-city-dataset-has-two-sources.md).

**A location id implies its whole subtree** — verified across Berlin, Schleswig-Holstein and Kr. München. No searching each district separately.

**Drift check.** One check covers **both** datasets at full depth — **19 requests**: `sitemap_categories.xml`, `sitemap_cities.xml`, and the 16 `/s-katalog-orte.html` state pages — serialised at the generators' 1500 ms gap, ~28 s per run. It **reads and reports; it writes nothing**: drift is fixed by regenerating the dataset and shipping a new version, never by a runtime write. Do **not** condition it on the sitemap index's `lastmod`, which is a whole-index regeneration timestamp rather than a taxonomy-change signal.

Four things about it are decisions, not implementation detail:

- **It lives in `scripts/`, not in the shipped binary.** `npm run check:drift` is `node scripts/check-drift.ts`, beside the two generators whose fetch code it shares. §8.3's argv contract follows from this: the binary takes no arguments. The cost is stated rather than hidden — **a published user cannot check their own bundle** (§9.17). The cron has a clone; a user does not need one.
- **It does not route through `src/fetch/core.ts`'s limiter.** The 1500 ms gap is the project's stance, not a performance setting, and an operator's `KLEINANZEIGEN_MCP_RATE_LIMIT_MS` (§8.4) must never retune a maintenance job.
- **The cheap id-only variant was offered and refused.** `sitemap_cities.xml` carries ids but **no names**, so a sitemap-only diff is blind to renames; the katalog walk catches them ([ADR-0004](./docs/adr/0004-the-city-dataset-has-two-sources.md)). This retires the *"one request, 2 KB"* posture twice over — the check is 19 requests, and the categories sitemap measures **11 940 B**, not ~2 KB.
- **The status is not the test.** A block presents as HTTP 200 with an empty list (ADR-0003), so every leg counts a parse marker (`<loc>…/c<id>`, `locationId=`) and fails on a 200 that carries none.

**Exit codes: `2` outranks `1` outranks `0`.** `0` clean, `1` real drift, `2` the check never reached the site. The stderr report **always names each dataset's outcome separately**, and issue-opening is driven by the *report*, not the process exit — so a dataset at `1` opens an issue even when the other dataset's outage pushed the exit to `2`. Real drift is never swallowed by the other half's failure. `--json` writes that same per-dataset report to stdout, which is what the cron decides from — matching on the prose report would make a log line's wording load-bearing. An argument the script does not have is refused with `64`, which is outside the ordering rather than on top of it: the three codes are what a run concludes, and `64` says no run happened.

**Who runs it, and when it blocks.** A monthly GitHub Actions cron diffs the repo's `data/` against the live sources; `1` opens or updates a single tracking issue, `2` logs only — a check that never reached the site has learnt nothing, and an issue would claim otherwise. **The same check gates every release, blocking on `1` and on `2`, with no override** (§8.7). That clause is load-bearing: it is the only reason *the version is the provenance* is true. If no release ships without establishing dataset currency, the publish date **is** the dataset-current date, and neither dataset needs a `generated_at` stamp. Weaken the gate and the provenance claim goes with it. The cron targets the repo's `data/`, not a published tarball — one code path, one meaning of "checked"; users are stale iff a release is overdue.

A GitHub Actions runner **is** served by the site: three runs from `ubuntu-latest` on three distinct Azure IPs returned HTTP 200 with no redirect, no `Retry-After` and no interstitial, on both gateway routes the check touches (`sitemaps` for the sitemap leg, `k-desktop` for the 17 katalog requests). ADR-0003 was never put to the test, because there was no block to route around. What is **not** established is durability — three runs inside three minutes, and Azure ranges are exactly what a future tightening would target. The cron's own exit status is the monitor for this answer expiring: a check that starts failing on the network leg rather than on real drift is the signal.

The live category set was **159 as of 2026-09-08**, byte-for-byte the count in `data/category-tree.json`. The check is cheap in requests but not in bytes — one katalog state page is 583 KB and the root 137 KB, so a full run is multi-megabyte. Irrelevant to a monthly cron; worth knowing before anyone proposes running it per-PR.

**The shop directory is deliberately not bundled**, on four independent grounds: `liveAds` is a live inventory count a snapshot would freeze; the ordering reseeds nightly (`randomizationSeed` is the date); `totalHits` drifted 53 811 → 53 808 inside 30 minutes; and the sweep is 1 077 requests ≈ 27 minutes.

---

## 8. Stack, packaging, install

**TypeScript on Node ≥ 22, three build-time dependencies inlined into one file, stdio, four install channels, one env knob.**

### 8.1 Language and dependencies

- **TypeScript**, chosen for the **domain model, not the runtime**: the price tagged union (§3.1) and the listing flags (§3.4) get compile-time exhaustiveness on every `switch`. Since the whole point of the price union is that "negotiable with no number" can never be read as "free", having the compiler enforce it beats having a test enforce it.
- **Node ≥ 22.** Node 20 went EOL in April 2026; 22 is in maintenance, 24 is active LTS. 22 keeps the door open for anyone not yet on 24. Node 22 also ships full ICU, which is what makes §3.2's `Europe/Berlin` normalisation free.
- **Three build-time dependencies, inlined: `@modelcontextprotocol/server`, `zod`, `cheerio`.** `zod` is not new — the SDK already requires it for tool schemas. `cheerio` earns its place because §5.8 makes parse failure a loud, breaker-adjacent event, and hand-rolled regex extraction would be the most brittle thing to hang that rule on; every anchor in §5.1 is a plain CSS selector.
- **The published package declares no `dependencies` at all**, and this is the correction of a real defect rather than a tidy-up. §8.2's `noExternal: [/.*/]` already inlines all three into the bundle, yet the manifest declared them — so every `npx -y kleinanzeigen-mcp` cold start downloaded **110 packages, 4 750 files, 33 MB** for code already sitting in the 3.4 MB tarball. Ten times the artifact, for nothing, on the primary install channel. All three are `devDependencies`. **This is safe only because §8.6's cold-install verification proves the installed bundle resolves nothing at runtime**; the two decisions are load-bearing on each other, and neither may be removed alone.
- **`@modelcontextprotocol/client` is test-only.** It is imported by the in-process handshake tests and by nothing under `src/`. It belongs in `devDependencies` for that reason, independently of the inlining above.
- **No HTTP client dependency.** Node's built-in `fetch` suffices: blocking is IP-reputation and volume driven, not request-shape driven, so finer header or HTTP/2 control buys nothing.

For contrast, five of the seven existing kleinanzeigen MCP servers depend on a ~1.5 GB Playwright container. What a user installs here is **one file, two sidecar datasets, and nothing to resolve**.

### 8.2 Build

**tsup → a single-file ESM `dist/index.js`, dependencies inlined, built by `prepack`. `tsc --noEmit` is the real typecheck.**

Node ≥ 22.18 strips TypeScript types natively, which would allow pointing the MCP config straight at `src/index.ts`. Rejected: run-from-clone already requires `npm install`, so no-build saves exactly one `npm run build`, and **type-stripping does not typecheck — it deletes annotations**. A bundle also makes cold start a single file read instead of a `node_modules` resolution walk.

The two datasets stay **sidecar JSON in `dist/`**, not inlined: inlining would mean JS-parsing 11 231 locations on every process start, and sidecar files stay diffable for the drift check (§7). They survive MCPB packing untouched, and `import.meta.url` still resolves beside them after an extension is extracted to disk (§8.7).

**`prepack` is the build gate, and the hook was chosen by measurement.** `dist/` is gitignored, so `files: ["dist"]` packs only because a built `dist` happens to exist locally — from a fresh clone the tarball is `README.md` + `package.json` and `bin` points at nothing. Measured against npm 11.12.1:

| | `prepack` | `prepublishOnly` | `prepare` |
| --- | --- | --- | --- |
| `npm pack` | ✅ | — | ✅ |
| `npm publish` | ✅ | ✅ | ✅ |
| `npm install` (in a clone) | — | — | ✅ |
| `npm ci` | — | — | ✅ |
| consumer install | — | — | — |

`prepublishOnly` would leave **`npm pack` still emitting the broken tarball** — and `npm pack` is what §8.6's cold-install verification and §8.7's MCPB staging both run. `prepare` would make the build install-time. So: **`"prepack": "npm run build"`**, which fixes both surfaces and keeps *`npm install` runs no code of ours* true. `tests/packaging.test.ts` carries a **positive assertion pinning `prepack`** alongside its existing negative lifecycle list — the install-time/publish-time distinction is a claim this project makes to users, so it is tested rather than merely true.

**`minify` stays off.** `dist/index.js` therefore ships as 77 863 lines of readable JavaScript at ~44 bytes a line. That is a property of the artifact, not a claim the README makes — and it is not made redundant by §8.7's provenance, which attests that the bundle came from this source and says nothing about what the source does. Reading the bundle is the route from the artifact to the guards, and minifying would close it.

### 8.3 Transport and install

**stdio only.** No port, no bind address, no auth surface, no CORS, no unauthenticated local listener — and no second configuration knob.

**The binary takes no arguments.** `--check-drift` left the shipped binary when the check moved to `scripts/` (§7), and the `USAGE` string, the `Invocation` union and the exit-`64` argv refusal path went with it. argv is not a configuration surface; §8.4's one env knob is the whole of it. A binary invoked with an argument it does not have is a caller's mistake, and there is no argument it does have.

**Four install channels, one artifact.** Every channel serves the same `dist/index.js` from the same release (§8.7); they differ only in who does the fetching.

| Channel | Who it is for | How |
| --- | --- | --- |
| **npm / npx** — primary | anyone with an MCP client | `npx -y kleinanzeigen-mcp`, no install step |
| **MCPB** | Claude Desktop | a downloaded `.mcpb`, opened |
| **Claude Code plugin** | Claude Code | `/plugin marketplace add`, server + skill together (§8.8) |
| **run-from-clone** | development | `git clone && npm install && npm run build` |

In Claude Code the one-line form is:

```bash
claude mcp add kleinanzeigen -- npx -y kleinanzeigen-mcp
```

local scope by default; `--scope user` / `--scope project` for the others, and any env assignment goes **before** the `--`. In a client that takes a JSON config block, `command: "npx"`, `args: ["-y", "kleinanzeigen-mcp"]`.

**Run-from-clone is no longer the packaging posture** — it is the development path, and it is the only one that yields a tree the drift check and the fixture-capture scripts can run in:

```bash
git clone git@github.com:IIxauII/kleinanzeigen-mcp.git
cd kleinanzeigen-mcp
npm install
npm run build
```

then an absolute path to `dist/index.js` in the client's config block.

**MCPB is the Claude Desktop channel and nothing else.** `claude mcp` has no `.mcpb` path at all, so this is not a fourth way into Claude Code — it is the only way a Desktop user installs this server without hand-editing JSON. The four channels overlap less than they look.

### 8.4 Configuration — exactly one knob

**`KLEINANZEIGEN_MCP_RATE_LIMIT_MS`.** Unset means 1500 ms. **No floor** — it is the operator's machine, the operator's IP and the operator's risk, and a project that ships the knob should be honest about who bears the consequence rather than performing restraint it cannot enforce.

**An invalid value refuses to start.** Anything that is not a non-negative finite integer kills the process before the transport opens: non-zero exit, reason on stderr. **No silent fallback to 1500 ms** — an operator who set `5000` and got a typo-driven fallback would believe they were being polite while they were not.

**An empty value is unset.** `""` reads as 1500 ms, exactly as an absent variable does. This is the one exception to the paragraph above and it does not weaken it: the "no silent fallback" argument is about an operator who *typed a value* and had it discarded, and an empty box is a user declining to type one. It is also the one invalid value a **host** can produce without the operator entering anything — MCPB's install dialog hands the server `""` when a user selects the number field and clears it (§8.7), and refusing that is a clean install that dies with only stderr to explain itself. Every other non-integer still kills the process.

**A default location was rejected as env config.** It is a tool-argument default, not an environment setting: putting it in env makes an identical tool call return different results on different machines, invisibly to the calling agent and unreproducibly in a bug report.

**What is not configurable and cannot be disabled:** the `Retry-After` honouring, the block circuit breaker, the User-Agent, and the deleted-ad guard. **The delay is a politeness dial the operator owns; those are the project's compliance stance, fixed in code.** There is no flag that turns them off, which is what makes the README's claim verifiable rather than aspirational.

### 8.5 User-Agent

```
kleinanzeigen-mcp/<version> (+https://github.com/IIxauII/kleinanzeigen-mcp)
```

Fixed in code, deliberately **not** an environment variable. Reasoning in [ADR-0003](./docs/adr/0003-non-circumvention.md).

**Unchanged by publishing, and now true in both halves.** The token does two jobs and they separate cleanly: `kleinanzeigen-mcp/<version>` is what a site operator writes a block rule against — the **identify** half, which is the half ADR-0003's non-circumvention argument actually rests on — and the `+https://…` URL is the **explain** half, which a private repository used to cost and which now resolves (§8.7, [ADR-0005](./docs/adr/0005-four-channels-one-artifact.md)). An operator who reads the token can read the project before deciding what to do about it, which was the whole point of putting a URL in a User-Agent.

The split stays written down anyway, because it is what settles the question the next time the URL breaks — a rename, a move, a repository taken private again. The answer is that the token does not change: a block rule keys on the identify half, so a dead URL costs explanation and never enforcement, and chasing one would mean editing `src/user-agent.ts`, `src/fetch/core.test.ts`, this section and ADR-0003, and then editing them all back.

`<version>` is `src/version.ts`, which is also `serverInfo.version` on every `initialize`. It is committed back by the release (§8.7) rather than left at a placeholder, and *the version is the provenance* (§7) lives on this wire.

### 8.6 Tests

**vitest.** It handles TypeScript against the tsup setup with no extra configuration, and its fake-timer control is the practical way to test a serialised 1500 ms limiter, exponential backoff, the 60 s `Retry-After` cap and the circuit breaker without a network and without a slow suite. One dev dependency.

**Fixtures are committed**, and are:

- **hand-captured out of band** by a dev-time script — **never by the server**;
- **minimised** to the DOM structure the parser actually reads;
- **redacted**, and the rule is *every* piece of personal or identifying data in the captured markup — scrubbed or replaced with synthetic values — rather than a list of fields. **Attributes the parser never reads are in scope.** The enumeration this bullet used to carry (seller names, exact locations, image URLs, free text) was a list of what the parser touches, and a redaction pass aimed at that list is how partner-ad ids in `data-gaevent` and shop names in `title="Zum shop …"` came to sit in committed fixtures — invisible for exactly as long as nobody read the markup the parser skips. The fixtures were re-redacted and the git history rewritten to remove the earlier copies, and **`tests/redaction.test.ts` pins the rule against the committed bytes** — every file under `tests/fixtures/`, not the ones a parser happens to load, matched on what a value looks like rather than on where anyone expected it. A capture that reintroduces one of these fails the suite instead of a review.

Verbatim capture was rejected (it republishes real ads and real personal data under DSGVO); gitignored-only was rejected (CI and new contributors could not run parser tests); fully synthetic was rejected (the fixture drifts from the real DOM and the tests end up proving only that the parser parses the fixture).

**A `vitest.config.ts` exists, and its job is an `exclude`.** Without one, vitest globs any git worktree left under `.claude/`, which has already reported a 40-file / 446-test suite as 160 files / 1 784 tests — the whole suite run four times, quietly passing. The config excludes `.claude/**`. This is listed here because it is the difference between a suite that reports its own size honestly and one that does not.

**No test may pass by skipping.** `tests/stdio-server.test.ts` was `describe.skipIf(!existsSync(BUNDLE))`, so the only end-to-end test in the repo went silently green whenever `dist/` was absent — precisely the state a fresh checkout is in. A missing bundle now **fails**, with *run `npm run build` first*. A guard that turns the only test of a thing into a no-op under the exact conditions the thing is untested is worse than no guard.

**Cold-install verification is a test, not a checklist.** It packs, installs the tarball into a temp prefix, and drives the installed binary through a real handshake:

```
npm pack                                     # prepack builds
npm i ./kleinanzeigen-mcp-*.tgz --prefix $TMP
$TMP/node_modules/.bin/kleinanzeigen-mcp
  ├─ stderr: exactly one server_started line
  ├─ stdout: transport only, nothing else, ever
  ├─ a real MCP initialize handshake
  ├─ serverInfo.version == the tarball's package.json version
  └─ tools/list → the six names
```

It runs **on every PR and again as a pre-publish gate**: on a PR it catches packaging regressions at review time rather than at release time, and it is the only thing that makes §8.1's `devDependencies` move safe, because it proves the installed bundle resolves nothing at runtime.

`tests/packaging.test.ts` keeps its `bin` / `files` / `engines` / lockfile checks and its negative lifecycle list, gains the positive `prepack` assertion and an assertion that `dependencies` is **absent**, and moves its native-dependency check **onto the packed tarball's contents** — that check goes vacuous the moment nothing is a non-dev dependency.

**CI runs `npm ci → build → typecheck → test` on Node 22 and 24** — the declared `engines` floor and the active LTS. `npm test` stays the single gate, so nothing is CI-only and local and CI cannot drift.

**How much of the suite is fixture-driven versus live is not settled here** — see §10.

### 8.7 Release and distribution

**One maintainer-triggered dispatch publishes one version to every channel.** Reasoning and the trade-offs accepted: [ADR-0005](./docs/adr/0005-four-channels-one-artifact.md). The operational procedure: [`docs/maintenance.md`](./docs/maintenance.md).

```
workflow_dispatch
  ├─ drift gate — npm run check:drift, blocks on 1 and on 2, no override (§7)
  ├─ semantic-release → npm + git tag + GitHub release + CHANGELOG.md
  ├─ mcpb pack (from a staging directory) → attached to the release
  └─ mcp-publisher publish (server.json, version stamped from the release)
```

One dispatch, one version everywhere — the only way *the version is the provenance* holds across channels rather than on npm alone. Nothing auto-propagates: the MCP Registry never polls npm, so a release that skips its step leaves the listing advertising the previous version indefinitely.

**`semantic-release` owns the version, the tag, `CHANGELOG.md` and the GitHub release**, on Conventional Commits, which the history already follows without exception. It is triggered by **`workflow_dispatch`, never by a push to `main`**: the drift gate is network-dependent and has no override, so automatic-on-merge releasing would redden `main` every month the site was unreachable. That also defuses the standard objection to committing release artefacts back, since there is no push trigger for the release commit to loop against.

**Committed back by the release:** `package.json`, `package-lock.json`, `src/version.ts`, `manifest.json`, `CHANGELOG.md`, `plugin/.claude-plugin/plugin.json` and `plugin/.mcp.json`. `manifest.json` is in the list because the MCPB manifest states the version itself and nothing derives it from `package.json` — a release that skips it ships a bundle whose install dialog names the previous version, silently; `tests/mcpb.test.ts` pins the two together so the omission fails the suite instead. `src/version.ts` is not deleted in favour of a build-time define — the value is load-bearing on two wires (§8.5) and the canonical `0.0.0-development` placeholder fails the User-Agent test outright. The lockfile is in the list because `packaging.test.ts` asserts it is committed, precisely so a cold install resolves the same tree. The two plugin files are in it because the plugin pins the version it ships against (§8.8).

**Dataset refreshes are versioned by what changed**, which is §7's drift check arriving in the release process:

| change | commit | bump |
| --- | --- | --- |
| dataset additions / churn | `fix(data): …` | patch |
| a category or location **renamed or removed** | `feat(data): …` | minor |
| code | normal rules | |

The split earns its keep: after a removal, an argument that resolved against the previous version stops resolving, which is what a minor is for.

**Tags start at `v0.1.0` on current `main`.** With zero tags, `semantic-release` reads *no previous release* and emits `1.0.0` — a stability promise this project cannot back. `v0.1.0` is simply true (`package.json` and `src/version.ts` both say so) and was never published, so it exists only as a git tag. The v2 SDK migration is a `feat:`, which makes **the first version ever published to npm `0.2.0`**.

**Two `package.json` fields are immutable once published and must be right before the first `npm publish`:**

- `"license": "Unlicense"` — the licence decision, recorded in the README rather than in an ADR.
- `"mcpName": "io.github.IIxauII/kleinanzeigen"` — how the MCP Registry proves the npm package belongs to the authenticated namespace. It reads `mcpName` out of the published version's metadata, so the package must exist on npm at that exact version before it can be listed. **Casing is inferred, not documented**: the registry formats `io.github.%s/*` from the GitHub login verbatim with no case folding anywhere in the path, and our login is `IIxauII`. Confirm it against the real 403 on the first publish attempt, because this is exactly the value that costs a version bump to correct.

npm metadata is immutable; retrofitting either field is not a follow-up commit. The rest of the manifest — `description` (§4.6's one string), `homepage`, `repository`, `author: Felix (IIxauII)`, `bugs`, and `keywords: mcp, model-context-protocol, kleinanzeigen, classifieds, germany, read-only` — is mutable and merely absent today.

**And one sequencing constraint of the same class points the other way: trusted publishing cannot be configured until the package exists.** It is a per-package setting on npmjs.com, and the settings page does not exist for a package that does not, so **the first artifact on npm cannot be the one CI publishes.** The resolution is a hand-published, immediately deprecated stub:

1. `npm publish` a stub **`0.0.1`** from a maintainer's machine, with `license` and `mcpName` already correct — it is a real publish and they freeze on it too. npm publishes the version `package.json` carries, so `package.json` and `src/version.ts` go to `0.0.1` for that publish and are reverted uncommitted; `v0.1.0` stays a tag that was never published.
2. Configure trusted publishing at `npmjs.com/package/kleinanzeigen-mcp/access`, pointing at this repository and the release workflow.
3. `npm deprecate kleinanzeigen-mcp@0.0.1`, with a message saying it is a bootstrap placeholder.
4. Dispatch. CI publishes **`0.2.0` with provenance**, and `latest` moves to it.

This is recorded beside the immutable fields rather than filed in the procedure because it is the same kind of thing — a step whose wrong ordering costs a version number — and it is the only one that has to be taken **after** the first publish rather than before. Nobody installs the placeholder: `npx -y kleinanzeigen-mcp` resolves `latest`.

**`server.json` for the MCP Registry** carries `$schema`, `name`, `title`, `description` (≤ 100 characters, schema-enforced), `version`, `repository`, `websiteUrl` and `packages[]`. npm and MCPB coexist in one `packages[]` entry. The MCPB entry needs a GitHub release-asset URL containing `mcp`, over https, with `fileSha256` **required** — and the registry does a redirect-refusing `HEAD` on it, so the asset must be uploaded before the registry step runs. The registry never verifies the hash; clients do, so a wrong hash publishes cleanly and fails every install. Listing is free, automated and unreviewed; there is no licence field, no category, and no disclosure form.

**The MCPB artefact** is a plain zip extracted to disk at install time, so both sidecar datasets survive and `import.meta.url` resolves beside them. Claude Desktop supplies the Node runtime — nothing node-shaped goes in the zip — and the artefact measures ~1.07 MB. Four things about it are decided rather than incidental:

- **Pack from a staging directory, never `mcpb pack .`**, which honours neither `.gitignore` nor `package.json:files` and would ship `src/`, `data/`, `scripts/` and the fixtures. The staging directory holds exactly `manifest.json`, `package.json`, `README.md`, `dist/index.js`, `dist/cities.json`, `dist/category-tree.json`. A staging directory is an allowlist; `.mcpbignore` is a denylist that fails open, and this project's packaging history is already one story about a denylist failing open.
- **`package.json` ships** for `"type": "module"` alone — without it Node reparses the ESM entry by syntax detection and warns on every cold start.
- **`user_config.rate_limit_ms` must declare `default: 1500`.** Without a default the host substitutes the literal `${user_config.rate_limit_ms}` into the environment, which §8.4 refuses; with one, a cleared field arrives as `""`, which §8.4 now reads as unset. `required: true` is not the fix and would be wrong anyway — the host then skips generating the MCP config entirely.
- **Ship unsigned.** `mcpb sign --self-signed` reports success and then fails its own `verify`, because verification checks the chain against the OS trust store, which a self-signed certificate can never be in; it also writes its key into the installed npm package directory, so the identity dies at the next `npm install`. The cost is a *"Not signed"* warning. Buying a real certificate is a separate decision nobody has made.

**No `privacy_policies` key.** The MCPB manifest calls the field required *"when the extension connects to external services … that process user data"*, and on the reading this project can defend, the trigger does not fire: there is no account, no identity, no telemetry, and nothing retained past the process ([ADR-0002](./docs/adr/0002-nothing-on-disk-nothing-survives-the-process.md)). The only thing that leaves the machine is the caller's search string, sent to the site the tool exists to read. Declaring a policy would imply a data relationship that does not exist. Recorded here so the omission reads as a decision rather than a missed field.

**MCPB has no update mechanism** — no update URL, no version check, nothing. A `.mcpb` on a GitHub release is inert: a new version means the user downloads and opens the file again. This is the channel on which "running a build they did not make and will never be prompted to replace" is most true, and §7's release gate is the whole of the mitigation.

**Provenance is on, and no npm token exists.** Publishing goes through npm **trusted publishing** over OIDC: the publish job declares `id-token: write`, runs npm CLI **≥ 11.5.1**, and **emits provenance by default** — there is no `--provenance` flag to remember and none to lose in a later workflow edit. A **granular npm token in Actions secrets** was the earlier decision, taken when a private source repository made provenance impossible and OIDC's setup cost therefore bought nothing. It is retired on two facts: granular write tokens now **expire, 7 days by default and 90 at the outside**, which leaves a credential used a handful of times a year expired more often than valid and failing at the moment a release is being cut; and provenance — the thing the token path cannot produce without remembering a flag — is exactly what makes the OIDC setup worth paying for. **No npm token belongs in this repository's secrets at all**, not as a fallback and not to unblock a failing publish. Expect roughness on the way in: `@semantic-release/npm`'s OIDC path has open issues ([`#1069`](https://github.com/semantic-release/npm/issues/1069), `ENONPMTOKEN` on an OIDC-only setup; [`#1023`](https://github.com/semantic-release/npm/issues/1023), a first publish from a maintenance branch). The placeholder bootstrap above removes the first-publish half of that exposure and not the rest.

**The repository is public, so the four things that rode on visibility all work.** npm provenance, above. The `.mcpb` attached to every release is downloadable by anyone — it was built and attached regardless of that, because the step costs one job and keeps the artefact provably in step with the npm tarball from the first release. `repository`, `homepage`, `bugs` and §8.5's User-Agent URL resolve. And the plugin marketplace reaches past its owner (§8.8). npm and the Registry never depended on visibility either way: the package is public regardless, and the `io.github.IIxauII` namespace authenticates against the account, not the repository.

**`main` takes a ruleset** — pull request required, force-push and deletion blocked — which GitHub Free does not offer on a private repository and does on a public one. Two things about it are decided rather than incidental. **Required status checks stay out of it until the PR checks exist**, because a ruleset that requires a check no workflow produces blocks every merge, including the one that would add the workflow. And **the release job needs a bypass**: `semantic-release` commits its version bump straight to `main`, which is exactly what a pull-request-required rule refuses, so the identity that job pushes as is named as a bypass actor and nothing else is. If that cannot be scoped tightly, the pull-request rule is the one to drop — on a single-maintainer repository, force-push and deletion blocking are the halves doing the protecting.

### 8.8 The Claude Code plugin and its skill

**One plugin, hosted in this repository, bundling the server and one skill.** Layout:

```
.claude-plugin/marketplace.json        ← source: "./plugin"
plugin/
  .claude-plugin/plugin.json
  .mcp.json
  skills/searching-kanzeigen/SKILL.md
```

**`source: "./"` is refused.** It makes the whole repository the plugin, so `/plugin marketplace add` drags `src/`, `tests/`, `data/` and 77 863 lines of `dist/` onto every user's disk. The subdirectory payload is three files.

**Every slug the plugin owns takes §4.6's trademark clip** — plugin `kanzeigen`, marketplace `kanzeigen`, skill directory `searching-kanzeigen` — and the discoverability cost of not matching the npm name `kleinanzeigen-mcp` is accepted. The clip stops at prose: the skill's **description must contain "kleinanzeigen.de"**, because that string is what makes it trigger, and naming the site you read is descriptive use. `plugin.json` takes §4.6's one description string, which is now shared across five slots.

**`.mcp.json` pins the version exactly** — `npx -y kleinanzeigen-mcp@<version>`, never floating. The skill below describes a result *shape*; a floating server under a fixed skill means the first output-shape change silently invalidates the skill's text. That pin is why `plugin.json` and `.mcp.json` are committed back by the release (§8.7).

**`.mcp.json` carries no `env` block at all.** A plugin manifest has no MCPB-style `user_config`, so anything written there is static for every user — and the block *overrides* the environment. Writing `"KLEINANZEIGEN_MCP_RATE_LIMIT_MS": "1500"` for visibility would **break the one knob a plugin user has**; omitting it is the only way an exported value still reaches the server, which then falls back to its own default (§8.4).

**The skill is intent-triggered, not tool-triggered.** This is the whole design problem: the knowledge has to load *before* the first bad `search_listings` call, and a description written about the server and its six tools fires once the agent is already reaching for them — one call too late. The description names the site, the German-classifieds domain and secondhand listing search, so it loads when a user asks for a used bike in Cologne.

**It teaches only what the six tool descriptions cannot carry.** The per-tool warnings are already on the wire and pinned to this spec by `descriptions.test.ts`; restating them is the duplication that drifts. The skill's normative content is exactly the following, and a test asserts `SKILL.md` contains these lines verbatim — the same mechanism that pins the tool descriptions:

```
Resolve before you search. find_category and find_location take a name and
return candidate ids; search_listings takes ids. A raw string is not a handle.

get_shop takes a shop slug, and find_shop is the only way to one. Same
resolver-first shape, one live request instead of zero.

A colliding location resolves to nothing. location_resolution.ambiguous is
true, resolved_to is null, and every candidate is in alternatives. Nothing is
promoted to a resolution — pick one and say which.

total and reachable are different numbers. reachable is 1250 and never moves.
A large total against it means narrow the query, not walk fifty pages.

Dedupe on ad id, and never report pages times 25. The result set slides
underneath a walk, so the same listing arrives twice and another never
arrives at all.

Only commercial sellers have shops. An empty shop result is not evidence
that a seller has no listings — private inventory is refused by design.
```

Form is these rules plus **one worked sequence** (place name → `find_location` → candidates → `search_listings` with `location_id`), because "resolve first" as a bare rule is exactly the instruction agents skip. **Self-contained, with no links out**: a link to this spec resolves for nobody without the repository, and the on-disk path under a plugin install is not stable.

**§2.6's strict-argument rule is deliberately left out.** An unrecognised key is *refused*, loudly — the skill would save a round trip rather than prevent a wrong answer, and the skill's budget goes to quiet failures.

**CI runs `claude plugin validate`** as a manifest check.

**The plugin channel reaches everyone.** A marketplace resolves a plugin from a public git URL or from a path inside the marketplace repository, and this repository is public — so `/plugin marketplace add IIxauII/kleinanzeigen-mcp` works for anyone. It did not while the repository was private, and that was accepted rather than fixed: "installable in one command" is already satisfied by `npx`, and the plugin is an extra channel rather than the destination-critical one. The channel used to ship on the repository's visibility clock instead of the first release's; it no longer does, because visibility landed first.

**Submission to `claude-plugins-community` stays out of scope**, on one of the two reasons it used to have. The other — that a marketplace needs a source the user can clone — is gone. What survives is the one that was doing the work: vendoring the plugin directory into their repository puts every change to the skill or to the pinned server version behind their review queue, with no self-hosted channel underneath to ship past it, and this repository's own `marketplace.json` already installs in one command.

---

## 9. Known limits, stated plainly

These are the things a user will hit. None is a bug.

1. **1 250 organic listings per query, maximum.** Against category totals near a million. On a broad query you are seeing a *window*, and the right response is to narrow — which is why `total` and `reachable` are reported separately. The ceiling costs **nothing on the long tail**, which is where assistant-driven search actually lives: `stefan zweig erstausgabe` in Books returns `1 - 2 von 2` — complete recall.
2. **Page 51+ silently re-serve page 50.** Detected and reported as `clamped: true`, never as data.
3. **High-volume queries drift between pages.** ~4% duplicates over a 13-second sweep, worse over a lazy walk. Every duplicate is also a listing missed. Dedupe on `ad_id`.
4. **No sort by distance.** Disallowed in every spelling, with no query-string equivalent.
5. **No category attribute filters** (condition, mileage, m², rooms, sizes). Attributes are readable on `get_listing`, never filterable.
6. **The applied sort cannot be read back**, and `c216` (Autos) silently ranks by mobile.de's own default. `sort: null` means "the site chose".
7. **No private seller inventory.** Commercial sellers only — 5.9% of inventory. This is the largest deliberate gap and it is a robots decision, not a technical one.
8. **`find_shop` can return the wrong shop on an exact single hit**, because it matches profile prose. Never auto-select.
9. **A postcode is not an identifier.** `10115` is two disjoint locations; `?locationStr=` picks one silently, and `location_resolution` is the only reason the caller can tell.
10. **The DOM is the contract, and it is not ours.** Anti-bot posture churns; the anchors in §5.1 have been stable across five scrapers and five years, but a redesign breaks the parser. §5.8's loud parse-failure log is the tripwire.
11. **Three site-side label bugs are live today** (§5.5) and more may exist. The mitigation is structural: read numbers, never labels.
12. **The `shippingCarrier` enum could widen without warning.** It is a server-side closed set, so a new carrier arrives as a 400 on a value we never send — invisible rather than breaking. The cheap standing check is the `Paketdienst` facet group on `/s-k0`, one allowed request.
13. **Umlaut folding in `find_shop` is uncharacterised.** `köln` → 492, `koln` → 3. Pass the caller's string through.
14. **Shop inventory totals do not reconcile.** One shop reports `18 Anzeigen online` on `/pro/`, 17 rows via the (refused) Bestandsliste, and `71 Anzeigen gesamt` separately. Three counts, no known authority — so `ads_online` is reported as the site states it and is not promised to equal `listings.length` summed over pages. A **fourth** figure was seen while building `get_shop` ([#22](https://github.com/IIxauII/kleinanzeigen-mcp/issues/22)): the shop directory's `liveAds` read `11` for a shop whose own `adsOnline` read `10` minutes later. One listing expiring in between would explain it, so it is recorded rather than claimed.
15. **How deep the shop RPC goes before clamping is unprobed.** `pageSize` is honoured to at least 100 and it terminates cleanly past the end, but the largest shop sampled had 170 listings, so no analogue of the page-50 wall has been ruled out.
16. **No radius-free rural fallback beyond what the site gives.** `?radius=` covers this properly; but note kleinanzeigen's own catchment is administrative containment, and only 5 `Kr.` nodes exist in Bayern's 2 079 children.
17. **An installed user cannot check their own bundle for dataset drift.** The check needs a clone; the shipped binary takes no arguments (§8.3). Staleness is inferred instead of measured: you are stale iff a release is overdue, and §7's release gate is what makes that inference sound. Accepted, in exchange for a binary that serves and does nothing else.
18. **An installed MCPB extension is never prompted to update.** The format has no update mechanism at all, so a `.mcpb` is as current as the day it was downloaded. This is the channel on which limit 17 bites hardest, and the mitigation is entirely on the release side (§8.7).

---

## 10. Deliberately left open

Not decisions this spec dodged — questions nothing in it depends on. Each is cheap to answer when someone needs it.

- **Test layering.** The runner (vitest), the fixture stance (committed, hand-captured, minimised, redacted) and the units that need fake timers are all settled. How much of the suite is fixture-driven parser testing, and whether any test hits the live site at all, is not.
- **How deep the shop RPC clamps.** Needs a shop with >1 000 listings.
- **Whether `/pro/` and the Bestandsliste count the same things.** Limit 14 above.
- **`searchScope`.** `BRANDING` behaved identically to `BOTH` and did not suppress the prose match; `ADS` was never sent. Hardcoding `BOTH` costs nothing given that.
- **`shipping: false` × `buy_now: true`.** Should be another honest empty set, but that is an inference. It costs one request to learn and returns a correct answer either way.
- **Whether a real signing certificate is worth buying for MCPB.** Self-signing cannot verify, so today's artefact is unsigned and carries the warning (§8.7).

---

## 11. Conflicts resolved while assembling this spec

Four decisions from different tickets disagreed, and one convention was never fixed. Each is settled here, because a spec with a hedge in it is not build-ready.

### 11.1 `scope` is dropped from the search envelope

**[#10](https://github.com/IIxauII/kleinanzeigen-mcp/issues/10) specified `scope: "in 10115 Mitte und Umgebung"`, echoed from `span.breadcrump-summary`**, as the cheapest guard against a silently-wrong location — a request that came from [#6](https://github.com/IIxauII/kleinanzeigen-mcp/issues/6).

**[#15](https://github.com/IIxauII/kleinanzeigen-mcp/issues/15) then found that span's trailing noun phrase is a live label bug** (§5.5 case 2). The map's standing constraint was updated to *"read only the numbers out of that span… the applied scope is never parsed from markup"*, which post-dates and overrides #10.

**Settled: `scope` is not returned.** Returning a demonstrably-wrong label as the applied scope is worse than returning nothing — an agent reading `Comics in Deutschland` would believe the category. The guard #6 asked for is not lost: **`location_resolution` replaces it and is strictly better**, because it names the alternative the server silently rejected instead of echoing the server's own account of what it did.

### 11.2 Keywords always ride the query string

Never settled explicitly. [#4](https://github.com/IIxauII/kleinanzeigen-mcp/issues/4) verified both spellings — `/s-fahrrad/k0` (path slug) and `/s-c217?keywords=hollandrad` (query string).

**Settled: `?keywords=` always; the keyword is never a path segment.** Three things fall out, all good:

- **No slugification anywhere in the spec** — no umlaut transliteration, no space encoding, no decision about what a keyword slug even is. This is the same discipline §4.5 applies to `find_shop`: pass the caller's string through.
- **The degenerate `/s-seite:N/k0c<id>` form becomes structurally unreachable**, because a keywordless query drops `k0` and emits the verified bare-code form.
- The path grammar collapses to four shapes driven only by `category_id` and `location_id`.

### 11.3 The rate-limit env variable is `KLEINANZEIGEN_MCP_RATE_LIMIT_MS`

[#8](https://github.com/IIxauII/kleinanzeigen-mcp/issues/8) wrote `KLEINANZEIGEN_MCP_REQUEST_GAP_MS` and explicitly deferred the name to this ticket; [#9](https://github.com/IIxauII/kleinanzeigen-mcp/issues/9) then stated `KLEINANZEIGEN_MCP_RATE_LIMIT_MS` as the decision. **#9's name stands.**

### 11.4 Two `zod` refinements, and why the rule permits them

[#15](https://github.com/IIxauII/kleinanzeigen-mcp/issues/15) fixed the rule: **`zod` rejects only what the site would `400`.** An honest empty set is a value, not an error, and neither `poster_type: "COMMERCIAL"` + a carrier nor `shipping: false` + a carrier is refused.

§4.1's two refinements — `location` xor `location_id`, and `radius` requires one of them — do not breach that rule, because that rule governs **combinations the site can answer**. These are combinations the site cannot be *asked*:

- Two location inputs resolve at different stages (path code vs `?locationStr=`), so the result would silently be one or the other — the exact silent-picking failure the whole surface is built to eliminate.
- `?radius=` with no location has nothing to be a radius *of*. Sending it produces a nationwide result the caller believes was scoped.

Neither yields an honest empty set; both yield a plausible wrong answer. That is the seam.

> **Correction, recorded while building `find_shop` ([#23](https://github.com/IIxauII/kleinanzeigen-mcp/issues/23)).** Two more refinements ship, and both sit on the same seam rather than beside it.
>
> **§4.5's `category_id` is checked against the bundled tree**, and an id it does not have is refused before a request is spent on it. The site would not `400` such an id — it takes it, filters by it, and answers. That is precisely the problem: the answer is an empty set the caller reads as *no shops in that category*, when what happened is that there is no such category. Plausible wrong answer, not honest empty set. The check costs nothing — no request, and the tree is not read at all unless a category id was given (§7) — and `search_listings` deliberately does not make it, because there the ids ride a URL path code the site resolves for itself while here the id goes to a filter field. **`location_id` gets no such check**; §4.5's correction says why.
>
> **An empty `name` is refused.** The action treats `fulltext` as *optional* and answers an omitted one with the whole 53 808-shop directory rather than with a `400` — which is the browse surface §1 puts out of scope, and is not what a caller asking for a shop by name meant. Honest empty set, no; plausible wrong answer at 53 808 rows, yes.

### 11.5 Field naming is `snake_case`, values keep the site's spelling

[#10](https://github.com/IIxauII/kleinanzeigen-mcp/issues/10) mixed `adId` / `categoryId` / `minPrice` with `organic_count` / `location_resolution` / `fetched_at`; [#14](https://github.com/IIxauII/kleinanzeigen-mcp/issues/14) was `snake_case` throughout.

**Settled: `snake_case` for every tool argument and result field.** Mixing `adId` with `organic_count` in one object is exactly the vocabulary drift `CONTEXT.md`'s naming rule exists to prevent, and #14 is both the most recent contract and the internally consistent one.

**Enum values are untouched** — `OFFER`, `WANTED`, `PRIVATE`, `COMMERCIAL`, `DHL`, `HERMES`, `GIVE_AWAY`, `SORTING_DATE`, `PRICE_AMOUNT`, `PRICE_AMOUNT_DESC` keep the site's exact spelling, per `CONTEXT.md`. **Wire parameter names are untouched too** — `minPrice`, `sortingField`, `posterType`, `shippingCarrier`, `buyNowEnabled` are the site's, and the mapping lives in one place: the URL builder.

---

## 12. The ToS position

This section is written for the README as well as for the spec, and it is deliberately not a comfort blanket.

**There is a genuine contradiction, and this project sits inside it rather than resolving it.**

**§ 5 Nr. 1 of the Nutzungsbedingungen** forbids *"Crawler, Spider, Scraper oder andere automatisierte Mechanismen"* without written consent. It is flat. There is **no personal-use carve-out**, it has been unchanged since before 2024, and it never mentions "API" — so an argument that it targets only bulk commercial extraction is an argument the text does not make.

**`robots.txt` says something different.** It carries **no TDM reservation**, and it explicitly `Allow: /`s GPTBot, OAI-SearchBot, ChatGPT-User and PerplexityBot on the same pages this server reads. `ClaudeBot` is not named and falls under `*`. § 44b(3) UrhG requires a text-and-data-mining reservation to be **machine-readable**, and whether prose ToS qualifies is unsettled — LG Hamburg's *LAION* decision said yes, in obiter, as the minority position, with a Sprungrevision permitted to the BGH.

**Choosing robots-clean does not resolve that contradiction. It picks the machine-readable side of it, knowingly.**

What the project does about it:

- **It reads the machine-readable channel literally and obeys it**, including where obeying costs real capability — the private Bestandsliste works, and is refused.
- **It never circumvents.** No stealth browser, no fingerprint spoofing, no proxy rotation, no header impersonation, no evading a block. The User-Agent names the project and links to it, so the site operator has something to block. German case law on automated access points here rather than at the ToS: BGH I ZR 224/12 holds that breaching an automated-access ban is **not by itself** a UWG violation, and locates the *Unlauterkeitsmoment* in technical **circumvention**. See [ADR-0003](./docs/adr/0003-non-circumvention.md).
- **It keeps volume at personal scale**, serialised at ~1.5 s per request, with no bursting, no background polling and no saved searches.
- **It persists nothing.** Reading is not extraction; persisting is. Under § 87b UrhG and CJEU C-304/07 / C-545/07, both permanent *and* temporary transfer count as extraction, and § 87c's private-use exception is **expressly unavailable for electronic databases** — so the in-memory, process-lifetime, parsed-object-only cache is a deliberate legal posture, not a performance choice. See [ADR-0002](./docs/adr/0002-nothing-on-disk-nothing-survives-the-process.md).
- **It is single-user and local.** The most on-point authority is favourable to exactly this shape: **BGH 22.06.2011 – I ZR 159/10 (*Automobil-Onlinebörse*)** concerned AUTOBINGOOO, desktop software that queried car marketplaces on a user's behalf and rendered results locally — structurally almost exactly a local MCP server. Held: each query takes only an insubstantial part; uses by separate users **do not aggregate** absent concerted action; and § 87b requires conduct *aimed at reconstituting* the database. *Paperboy* points the same way.

**What this is not.** It is not legal advice, it is not written consent, and it does not make § 5 Nr. 1 go away. A reader who concludes that the AGB forbid this tool is reading the AGB correctly. The position taken here is that the site publishes a machine-readable permission file, that this server obeys it to the letter, that it circumvents nothing, and that it operates at a volume and a persistence level the case law treats as insubstantial — and that if kleinanzeigen wants this stopped, the User-Agent gives them a name to block and one line in `robots.txt` would settle it.

**Use it on your own account, at your own risk, and don't point it at anything but your own machine.**
