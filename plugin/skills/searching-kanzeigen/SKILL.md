---
name: searching-kanzeigen
description: Finding secondhand goods, used cars, bikes, furniture or flats in German classifieds — kleinanzeigen.de. Use when someone wants to search, price or compare local listings in Germany, or asks about a seller's other ads, before reaching for any listing search tool.
---

# Searching kleinanzeigen.de

The kleinanzeigen server is read-only and takes ids, not names. Six things below
are what its tool descriptions cannot carry on their own. Read them before the
first call, not after it comes back wrong.

## The rules

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

## A worked sequence

A user asks for a used road bike in Cologne. The place name is the thing to
resolve first.

1. `find_location` with `{"query": "Köln"}`. It reads a snapshot on disk and
   makes no request, so this step is free.
2. Read `matches`. Each candidate carries a `location_id` plus `name`, `level`
   and `state` — enough to tell two same-named places apart. One clear match:
   take its `location_id`, a number. Several: name them to the user and let
   them pick. Never guess.
3. `search_listings` with `{"keywords": "Rennrad", "location_id": 945}`. The
   id is what scopes the search. `location` exists too, as free text the site
   resolves itself, and the two are mutually exclusive — a resolved id is the
   one you can report back.
4. Read `total` against `reachable` before paging. If `total` is far above
   1250, add a `category_id`, a `max_price` or a `radius` rather than walking
   pages.

The same shape holds for a category: `find_category` first, then
`search_listings` with the `category_id` it returned.
