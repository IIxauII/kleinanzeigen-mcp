# The city dataset has two sources, and stops at the second tier

**Status:** accepted

`cities.json` is generated from **`sitemap_cities.xml` and `/s-katalog-orte.html` together**, not from the sitemap alone, and it holds the location tree's **first two tiers** — the 16 federal states and their 11 215 children, 11 231 locations in all.

## Why this needs an ADR

Because [SPEC](../../SPEC.md) §7 names one source and one number, and both turn out to be wrong in ways that matter to a caller.

**The sitemap withholds 140 ids, not 3.** `sitemap_cities.xml` publishes 11 231 entries: 11 091 of the form `/s-<slug>/l<id>`, and **140 `/stadt/<name>/` landing pages that carry no id at all**. §7 records three of those 140 — the city-states Berlin `l3331`, Hamburg `l9409` and Bremen `l1` — and instructs that they be hard-coded. The other **137 are major cities**: Köln, München, Dortmund, Düsseldorf, Stuttgart, Frankfurt am Main, Hannover, Leipzig, Nürnberg, Dresden. A dataset built from the sitemap alone cannot resolve *the ten places a German caller is most likely to name*, and would answer `find_location("Köln")` with `count: 0` — which reads as "no such place" rather than "this dataset cannot see it".

**The sitemap carries no names.** It carries slugs. `find_location` returns `{ location_id, name, slug, level, state }` (§4.4), and three of those five fields are simply absent from the sitemap. Deriving `name` from the slug fails on exactly the inputs that matter: `koeln` is not `Köln`, `kr-muenchen` is not `Kr. München`, `muelheim-ruhr` is not `Mülheim (Ruhr)`. And a name derived from a slug is a slug, which §4.4 forbids matching against for good reason — slugs collide, and matching on one would be matching on cosmetics.

## The second source

`/s-katalog-orte.html` is the site's own location catalogue. Its root page lists the 16 federal states with their German names and ids; `?locationId=<id>` lists that node's children. **17 requests cover the country**: the root, plus one per state.

It is allowed. The catalogue page `robots.txt` disallows is `/s-kategorie-baum.html`, the *category* tree; no rule in the file's 252 `*` entries matches `/s-katalog-orte.html`. This is the same shape of decision as the category tree, in mirror image: there, the sitemap was complete and the homepage nav was a label convenience that silently omitted three nodes. Here the catalogue is the complete, named tree and the **sitemap is the slug convenience** — so the generator takes ids and names from the catalogue, slugs from the sitemap, and derives a slug only for the 140 the sitemap withholds, checking each derived slug back against a real `/stadt/` landing page before it ships.

The two sources reconcile **exactly**, and the generator fails the build rather than shipping a hole if they ever stop:

```
catalogue tiers 1–2 : 16 states + 11 215 localities = 11 231
sitemap l<id>       : 13 states + 11 078 localities = 11 091
withheld            :  3 states +    137 cities     =    140   ← the /stadt/ entries
```

The three hard-coded city-state ids stay hard-coded, as §7 requires, and the generator asserts the catalogue still agrees with all three — a hard-coded id that went stale fails the build instead of shipping.

## Why the tree is cut at the second tier

Because that is where ids stop being obtainable, not because deeper would be uninteresting. Below tier two sit the sub-Ortsteile — Wedding `l3503` under Berlin's Mitte, and every Ortsteil of the 137 cities — and below those, the entire **postcode layer**. Those nodes exist and work on the site; their ids appear in no source this project may read. `find_location` therefore answers a five-digit postcode with `count: 0`, and its input schema says so rather than letting the emptiness imply the place does not exist.

**A postcode still works as search input**, through `search_listings`' free-text `location` (`?locationStr=`), which the site resolves itself. That resolution silently picks among colliding nodes — `10115` is both Mitte `l9668` (358 hits) and Wedding `l3504` (39 hits), disjoint — which is what `location_resolution` (§4.1) exists to surface.

Nothing is lost by stopping at tier two, because **a location id implies its whole subtree** (§7): `l945` is all of Köln, and no caller ever has to enumerate a city's districts.

## The size budget moved, and is stated rather than met

§7 budgets "~84 KB gzipped", a figure measured on a payload of **slugs and ids only**. The five fields `find_location` returns cost roughly twice that. The dataset ships as one tuple per line — `[id, name, slug, state_index]`, with the 16 states in their own table — which lands it at **139 KB gzipped, 444 KB raw**, against 156 KB for the same data as objects.

An encoding that dropped the 10 495 slugs a name can reproduce would reach ~100 KB, and was rejected: it buys 39 KB in exchange for a slug-derivation rule duplicated in the generator and the loader that must never drift apart, for a field that is cosmetic anyway. The line per row is kept deliberately — it is what makes the drift check a readable diff (§8.2).

## The matching fold expands umlauts, one way

The two resolvers share one fold, and it produces **two forms** for every string: the plain diacritic strip (`Köln` → `koln`) and the German expansion (`Köln` → `koeln`). Two strings match when their form sets intersect, so `Köln`, `Koln` and `koeln` all reach `Köln` and nothing else does.

This is required by the same finding that gave us the second source. The catalogue names locations in real German — `Köln`, `Kr. München`, `Mülheim (Ruhr)` — while the site spells its own slugs `koeln`, `muenchen`, and a German caller on an ASCII keyboard writes it the second way. A fold that only stripped marks would answer `koeln` with nothing.

**It is transliteration, and §4.5's "never transliterate" does not reach it.** That rule governs the caller's string on its way to a **live `fulltext` query**, where the site's umlaut handling is uncharacterised (`köln` → 492 hits, `koln` → 3). Here both sides of a purely local comparison are folded identically, and the result is exact — not fuzzy, not edit-distance, not substring.

**The expansion runs one way only.** `ü` becomes `ue`; `ue` never becomes `ü`. Contraction would have to guess that a `ue` stands for an umlaut, which is wrong far more often than right — Neuss, Neuenkirchen, Duisburg — and a resolver that guesses is the thing this surface exists to prevent. The visible consequence is pinned by a test: the site carries **Füssen `l9915` and Fuessen `l9747`** as two distinct Bayern locations sharing one slug, so `Füssen` and `Fuessen` each return **both** ids and let the caller choose, while `Fussen` reaches only `l9915`.

`find_category` widens the same way, because two different matching rules under one shared spec sentence would be worse than one rule applied twice. It only ever widens: no category that matched before stops matching.
